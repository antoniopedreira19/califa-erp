"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Ok<T extends object = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T extends object = object> = Ok<T> | Err;

async function checarGateFinanceiro(
  entidadeId: string,
  entidadeTipo: string,
  acaoTentada: string,
): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase };
}

// ---------------------------------------------------------------------------
// Upload NF PDF
// ---------------------------------------------------------------------------

export async function uploadNfPdf(formData: FormData): Promise<Result<{ path: string }>> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode fazer upload." };
  }
  const supabase = createClient();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, message: "Arquivo inválido." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, message: "Arquivo maior que 10 MB." };
  }
  if (file.type !== "application/pdf") {
    return { ok: false, message: "Apenas PDF é aceito." };
  }

  const tempId = crypto.randomUUID();
  const path = `${session.activeTenant.id}/${tempId}/nf.pdf`;

  const { error } = await supabase.storage
    .from("faturamentos-nf")
    .upload(path, file, { contentType: "application/pdf", upsert: false });

  if (error) return { ok: false, message: `Falha no upload: ${error.message}` };

  return { ok: true, path };
}

// ---------------------------------------------------------------------------
// Emitir Faturamento
// ---------------------------------------------------------------------------

const parcelaSchema = z.object({
  numero: z.number().int().min(1),
  valor: z.number().positive(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const emitirSchema = z.object({
  empresa_id: z.string().uuid("Selecione a empresa emissora."),
  origem_tipo: z.enum(["job", "bv", "avulso"]),
  origem_id: z.string().uuid().nullable(),
  cliente_id: z.string().uuid().nullable(),
  fornecedor_id: z.string().uuid().nullable(),
  numero_nf: z.string().trim().min(1, "Número da NF obrigatório."),
  serie: z.string().trim().min(1, "Série obrigatória."),
  data_emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de emissão inválida."),
  valor_total: z.number().positive("Valor total precisa ser positivo."),
  descricao: z.string().trim().min(3, "Descrição obrigatória."),
  anexo_nf_path: z.string().min(1, "Anexe o PDF da NF."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
  parcelas: z.array(parcelaSchema).min(1, "Ao menos uma parcela."),
});

export async function emitirFaturamento(
  input: unknown,
): Promise<Result<{ faturamento_id: string }>> {
  const parsed = emitirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.origem_id ?? "",
    "faturamento",
    "faturamento.emitido",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Valida coerência contraparte × origem (defensivo — RPC também valida)
  if (
    parsed.data.origem_tipo === "bv" &&
    (!parsed.data.fornecedor_id || parsed.data.cliente_id)
  ) {
    return { ok: false, message: "BV precisa de fornecedor (e não cliente)." };
  }
  if (
    (parsed.data.origem_tipo === "job" || parsed.data.origem_tipo === "avulso") &&
    (!parsed.data.cliente_id || parsed.data.fornecedor_id)
  ) {
    return { ok: false, message: "Job e avulso precisam de cliente (e não fornecedor)." };
  }

  const { data: fatId, error } = await supabase.rpc("emitir_faturamento", {
    payload: {
      tenant_id: session.activeTenant.id,
      empresa_id: parsed.data.empresa_id,
      origem_tipo: parsed.data.origem_tipo,
      origem_id: parsed.data.origem_id,
      cliente_id: parsed.data.cliente_id,
      fornecedor_id: parsed.data.fornecedor_id,
      numero_nf: parsed.data.numero_nf,
      serie: parsed.data.serie,
      data_emissao: parsed.data.data_emissao,
      valor_total: parsed.data.valor_total,
      descricao: parsed.data.descricao,
      anexo_nf_path: parsed.data.anexo_nf_path,
      plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
      plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
      emitido_por: session.profile.id,
      parcelas: parsed.data.parcelas,
    },
  });

  if (error) return { ok: false, message: `Falha ao emitir: ${error.message}` };

  await logAuditEvent({
    acao: "faturamento.emitido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "faturamento",
    entidadeId: fatId as string,
    metadata: {
      origem_tipo: parsed.data.origem_tipo,
      origem_id: parsed.data.origem_id,
      numero_nf: parsed.data.numero_nf,
      serie: parsed.data.serie,
      valor_total: parsed.data.valor_total,
      qtd_parcelas: parsed.data.parcelas.length,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true, faturamento_id: fatId as string };
}

// ---------------------------------------------------------------------------
// Dar baixa em título
// ---------------------------------------------------------------------------

const baixaSchema = z.object({
  titulo_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

export async function darBaixaTitulo(input: unknown): Promise<Result> {
  const parsed = baixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.titulo_id,
    "titulo_receber",
    "titulo.baixado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: lancId, error } = await supabase.rpc("dar_baixa_titulo", {
    p_titulo_id: parsed.data.titulo_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_criado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "titulo.baixado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "titulo_receber",
    entidadeId: parsed.data.titulo_id,
    metadata: {
      pago_em: parsed.data.pago_em,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Estornar baixa
// ---------------------------------------------------------------------------

const estornoSchema = z.object({
  titulo_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter ao menos 10 caracteres."),
});

export async function estornarBaixaTitulo(input: unknown): Promise<Result> {
  const parsed = estornoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.titulo_id,
    "titulo_receber",
    "titulo.baixa_estornada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: reversoId, error } = await supabase.rpc("estornar_baixa_titulo", {
    p_titulo_id: parsed.data.titulo_id,
    p_motivo: parsed.data.motivo,
    p_criado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao estornar: ${error.message}` };

  await logAuditEvent({
    acao: "titulo.baixa_estornada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "titulo_receber",
    entidadeId: parsed.data.titulo_id,
    metadata: {
      motivo: parsed.data.motivo,
      lancamento_reverso_id: reversoId,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cancelar Faturamento
// ---------------------------------------------------------------------------

const cancelarSchema = z.object({
  faturamento_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter ao menos 10 caracteres."),
});

export async function cancelarFaturamento(input: unknown): Promise<Result> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.faturamento_id,
    "faturamento",
    "faturamento.cancelado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase.rpc("cancelar_faturamento", {
    p_faturamento_id: parsed.data.faturamento_id,
    p_motivo: parsed.data.motivo,
    p_cancelado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao cancelar: ${error.message}` };

  await logAuditEvent({
    acao: "faturamento.cancelado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "faturamento",
    entidadeId: parsed.data.faturamento_id,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}
