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

/** URL assinada para ver o PDF da NF dentro do drawer (modo leitura). */
export async function urlAnexoNf(path: string): Promise<Result<{ url: string }>> {
  const gate = await checarGateFinanceiro(path, "faturamento", "faturamento.anexo_lido");
  if (!gate.ok) return gate;

  const { data, error } = await gate.supabase.storage
    .from("faturamentos-nf")
    .createSignedUrl(path, 60 * 10);

  if (error || !data) {
    return { ok: false, message: "Não foi possível abrir o PDF da nota." };
  }
  return { ok: true, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Emitir Faturamento
// ---------------------------------------------------------------------------

const parcelaSchema = z.object({
  numero: z.number().int().min(1),
  valor: z.number().positive(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Um item da nota: o job (ou BV) coberto, e por quanto.
 *
 * `envio_parcela_id` é o que amarra o item à parcela do envio — é ele que
 * faz o saldo baixar na linha certa da aba Faturamento.
 */
const itemSchema = z.object({
  origem_tipo: z.enum(["job", "bv", "avulso"]),
  origem_id: z.string().uuid().nullable(),
  envio_parcela_id: z.string().uuid().nullable(),
  valor: z.number().positive(),
});

const emitirSchema = z.object({
  empresa_id: z.string().uuid("Selecione a empresa emissora."),
  origem_tipo: z.enum(["job", "bv", "avulso"]),
  origem_id: z.string().uuid().nullable(),
  cliente_id: z.string().uuid().nullable(),
  fornecedor_id: z.string().uuid().nullable(),
  numero_nf: z.string().trim().min(1, "Informe o número da NF."),
  data_emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de emissão inválida."),
  valor_total: z.number().positive("O valor total da NF precisa ser maior que zero."),
  descricao: z.string().trim().min(3, "Escreva a descrição que vai na nota fiscal."),
  anexo_nf_path: z.string().min(1, "Anexe o PDF da nota fiscal antes de emitir."),
  // Só o avulso informa (é o campo "Centro de custo" do formulário). Em
  // job/BV a classificação que vale é a da baixa do título.
  plano_conta_tipo_id: z.string().uuid().nullable(),
  plano_conta_subtipo_id: z.string().uuid().nullable(),
  itens: z.array(itemSchema).min(1, "A nota precisa cobrir ao menos um item."),
  parcelas: z.array(parcelaSchema).min(1, "A nota precisa de ao menos uma parcela."),
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

  const d = parsed.data;

  // Coerência contraparte × origem (defensivo — a RPC e o CHECK também
  // validam, e é aqui que a mensagem sai legível).
  if (d.origem_tipo === "bv" && (!d.fornecedor_id || d.cliente_id)) {
    return { ok: false, message: "BV precisa de fornecedor (e não cliente)." };
  }
  if (
    (d.origem_tipo === "job" || d.origem_tipo === "avulso") &&
    (!d.cliente_id || d.fornecedor_id)
  ) {
    return { ok: false, message: "Job e avulso precisam de cliente (e não fornecedor)." };
  }
  if (d.origem_tipo === "avulso" && (!d.plano_conta_tipo_id || !d.plano_conta_subtipo_id)) {
    return { ok: false, message: "No faturamento avulso, informe o centro de custo." };
  }

  // BV nunca entra em NF agrupada: a contraparte dele é o fornecedor.
  const bvs = d.itens.filter((i) => i.origem_tipo === "bv");
  if (bvs.length > 0 && d.itens.length > 1) {
    return {
      ok: false,
      message:
        "BV tem o fornecedor como contraparte e precisa ser faturado individualmente.",
    };
  }

  const somaItens = d.itens.reduce((s, i) => s + i.valor, 0);
  if (Math.abs(somaItens - d.valor_total) > 0.01) {
    return {
      ok: false,
      message: `A soma dos jobs desta NF (${brl(somaItens)}) não fecha com o total (${brl(d.valor_total)}).`,
    };
  }
  const somaParcelas = d.parcelas.reduce((s, p) => s + p.valor, 0);
  if (Math.abs(somaParcelas - d.valor_total) > 0.01) {
    return {
      ok: false,
      message: `A soma das parcelas (${brl(somaParcelas)}) não fecha com o total da NF (${brl(d.valor_total)}).`,
    };
  }

  const { data: fatId, error } = await supabase.rpc("emitir_faturamento", {
    payload: {
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      origem_tipo: d.origem_tipo,
      // NF agrupada não tem origem única — a verdade vai nos itens.
      origem_id: d.itens.length > 1 ? null : d.origem_id,
      cliente_id: d.cliente_id,
      fornecedor_id: d.fornecedor_id,
      numero_nf: d.numero_nf,
      serie: "1",
      data_emissao: d.data_emissao,
      valor_total: d.valor_total,
      descricao: d.descricao,
      anexo_nf_path: d.anexo_nf_path,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      emitido_por: session.profile.id,
      itens: d.itens,
      parcelas: d.parcelas,
    },
  });

  if (error) return { ok: false, message: `Falha ao emitir: ${error.message}` };

  await logAuditEvent({
    acao: "faturamento.emitido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "faturamento",
    entidadeId: fatId as string,
    metadata: {
      origem_tipo: d.origem_tipo,
      numero_nf: d.numero_nf,
      valor_total: d.valor_total,
      qtd_itens: d.itens.length,
      qtd_parcelas: d.parcelas.length,
      agrupada: d.itens.length > 1,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true, faturamento_id: fatId as string };
}

// ---------------------------------------------------------------------------
// Baixa do recebimento
// ---------------------------------------------------------------------------

/**
 * Os três obrigatórios do protótipo. `pago_em` é o mais importante:
 * título recebido SEMPRE tem data de recebimento — invariante garantida
 * aqui, no schema, e de novo dentro da RPC.
 */
const baixaSchema = z.object({
  titulo_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do recebimento."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária que recebeu."),
  plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
  plano_conta_subtipo_id: z
    .string()
    .uuid("Selecione o centro de custo do recebimento."),
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

  const { data: lancId, error } = await supabase.rpc("dar_baixa_titulo_com_plano", {
    p_titulo_id: parsed.data.titulo_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_tipo_id: parsed.data.plano_conta_tipo_id,
    p_subtipo_id: parsed.data.plano_conta_subtipo_id,
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
      plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
      plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
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
// Repactuar a previsão de recebimento
// ---------------------------------------------------------------------------

const previsaoSchema = z.object({
  titulo_id: z.string().uuid(),
  data_previsao_recebimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a nova previsão de recebimento."),
});

/**
 * O lápis da coluna Vencimento.
 *
 * Só a PREVISÃO muda. O vencimento da NF e a 1ª previsão registrada não
 * dependem desta action para ficarem intactos: o trigger
 * `congela_previsao_recebimento_primeira` reverte qualquer tentativa,
 * venha ela daqui ou de fora.
 */
export async function repactuarPrevisaoRecebimento(input: unknown): Promise<Result> {
  const parsed = previsaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.titulo_id,
    "titulo_receber",
    "titulo.previsao_repactuada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: titulo } = await supabase
    .from("titulos_receber")
    .select("id, status, data_previsao_recebimento")
    .eq("id", parsed.data.titulo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; data_previsao_recebimento: string | null }>();

  if (!titulo) return { ok: false, message: "Título não encontrado." };
  if (titulo.status !== "em_aberto") {
    return {
      ok: false,
      message: "Só título em aberto tem previsão de recebimento a repactuar.",
    };
  }

  const { error } = await supabase
    .from("titulos_receber")
    .update({ data_previsao_recebimento: parsed.data.data_previsao_recebimento })
    .eq("id", parsed.data.titulo_id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao salvar a previsão: ${error.message}` };

  await logAuditEvent({
    acao: "titulo.previsao_repactuada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "titulo_receber",
    entidadeId: parsed.data.titulo_id,
    metadata: {
      de: titulo.data_previsao_recebimento,
      para: parsed.data.data_previsao_recebimento,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Estorno e cancelamento — sem porta na UI desde a Tela 3.3
// ---------------------------------------------------------------------------
//
// O protótipo não tem estorno nem cancelamento de NF em lugar nenhum:
// título recebido exibe apenas "Conciliação". Mesma decisão que a 016 §9
// tomou no contas a pagar. As duas actions continuam aqui, funcionando,
// para o dia em que a tela voltar a precisar delas.

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

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
