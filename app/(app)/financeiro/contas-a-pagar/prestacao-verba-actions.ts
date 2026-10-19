"use server";

/**
 * Aprovação da prestação de contas da verba pelo financeiro (decisão 081).
 *
 * Até 15/09/2026 este arquivo tinha `fecharPrestacaoVerba`: o próprio
 * financeiro digitava o gasto e fechava a prestação, que já nascia com a
 * devolução. A prestação passou para a produção (aba de PPs do job), e o
 * financeiro ficou com a conferência: aprovar — o que cria o estorno do
 * saldo na data prevista — ou reprovar com motivo.
 *
 * Papel e estado são checados de novo dentro das funções do banco; o gate
 * aqui existe para registrar a tentativa negada na auditoria, como as
 * outras ações do financeiro.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { MOTIVOS_SEM_CREDITO } from "@/lib/fiscal/calculos";

const BUCKET = "pedidos-compra";
const ANEXO_TTL_SEGUNDOS = 3600;

type Ok<T extends object = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T extends object = object> = Ok<T> | Err;

async function gateFinanceiro(
  ppId: string,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: ppId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }
  return { ok: true, session, supabase };
}

const aprovarSchema = z.object({
  pp_id: z.string().uuid(),
  data_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data prevista inválida.")
    .nullable(),
  /** Decisão 189: as NFs da prestação vão para o cadastro de notas do
   *  fiscal; o financeiro só tira o crédito de PIS/COFINS, e com motivo —
   *  como na aprovação da PP normal. */
  notas: z
    .array(
      z
        .object({
          documento_id: z.string().uuid(),
          credito_retirado: z.boolean(),
          credito_motivo: z.string().nullable(),
        })
        .refine(
          (n) =>
            !n.credito_retirado ||
            (MOTIVOS_SEM_CREDITO as readonly string[]).includes(n.credito_motivo ?? ""),
          "Escolha por que a NF não gera crédito de PIS/COFINS.",
        ),
    )
    .max(60)
    .default([]),
});

export async function aprovarPrestacaoVerba(
  input: z.input<typeof aprovarSchema>,
): Promise<Result<{ codigo: string; estornoCriado: boolean }>> {
  const parsed = aprovarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const gate = await gateFinanceiro(parsed.data.pp_id, "verba_producao.prestacao_aprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: estornoId, error } = await supabase.rpc("aprovar_prestacao_verba", {
    p_pp_id: parsed.data.pp_id,
    p_data_prevista: parsed.data.data_prevista,
    p_notas: parsed.data.notas.map((n) => ({
      documento_id: n.documento_id,
      credito_retirado: n.credito_retirado,
      credito_motivo: n.credito_retirado ? n.credito_motivo : null,
    })),
  });
  if (error) return { ok: false, message: error.message };

  // As NFs que a aprovação registrou, e de qual emitente (o cadastro que a
  // aprovação criou fica na auditoria).
  const [{ data: pp }, { data: notas }] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("codigo, job_id")
      .eq("id", parsed.data.pp_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("notas_fiscais_fornecedor")
      .select("id, numero, fornecedor_id, credito_pis_cofins_retirado")
      .eq("registrada_na_pp_id", parsed.data.pp_id)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  await logAuditEvent({
    acao: "verba_producao.prestacao_aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp?.codigo ?? null,
      estorno_id: estornoId ?? null,
      data_prevista: parsed.data.data_prevista,
      notas_registradas: notas ?? [],
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  if (pp?.job_id) revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true, codigo: pp?.codigo ?? "", estornoCriado: estornoId != null };
}

const reprovarSchema = z.object({
  pp_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "O motivo precisa ter pelo menos 10 caracteres.")
    .max(500, "Motivo passa de 500 caracteres."),
});

export async function reprovarPrestacaoVerba(
  input: z.input<typeof reprovarSchema>,
): Promise<Result<{ codigo: string }>> {
  const parsed = reprovarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const gate = await gateFinanceiro(parsed.data.pp_id, "verba_producao.prestacao_reprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase.rpc("reprovar_prestacao_verba", {
    p_pp_id: parsed.data.pp_id,
    p_motivo: parsed.data.motivo,
  });
  if (error) return { ok: false, message: error.message };

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("codigo, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  await logAuditEvent({
    acao: "verba_producao.prestacao_reprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: { pp_codigo: pp?.codigo ?? null, motivo: parsed.data.motivo },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  if (pp?.job_id) revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true, codigo: pp?.codigo ?? "" };
}

const corrigirSchema = z.object({
  pp_id: z.string().uuid(),
  documento_id: z.string().uuid(),
  campos: z.object({
    documento_numero: z.string().max(60, "O número passa de 60 caracteres."),
    documento_data: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Data inválida."),
    valor: z.number().positive("Informe um valor maior que zero.").max(999_999_999).nullable(),
    tomador_estabelecimento_id: z.string().uuid().nullable(),
    emitente_documento: z.string().max(30),
    emitente_nome: z.string().max(200, "Nome longo demais (até 200 caracteres)."),
    descricao: z.string().max(200, "Descrição longa demais (até 200 caracteres)."),
  }),
});

/**
 * O financeiro corrige os dados de um documento da prestação em avaliação,
 * conferindo com a imagem ao lado (decisão 189). O tipo não muda aqui: o
 * financeiro que discordar reprova. A soma da prestação se refaz no banco.
 */
export async function corrigirDocumentoPrestacao(
  input: z.input<typeof corrigirSchema>,
): Promise<Result<{ valorGasto: number; saldo: number }>> {
  const parsed = corrigirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const gate = await gateFinanceiro(parsed.data.pp_id, "verba_producao.prestacao_documento_corrigido");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const c = parsed.data.campos;

  const { error } = await supabase.rpc("corrigir_documento_prestacao_verba", {
    p_documento_id: parsed.data.documento_id,
    p_documento: {
      ...c,
      documento_numero: c.documento_numero.trim(),
      valor: c.valor == null ? null : Math.round(c.valor * 100) / 100,
    },
  });
  if (error) return { ok: false, message: error.message };

  const { data: prest } = await supabase
    .from("pp_verba_prestacoes")
    .select("valor_gasto, valor_devolvido")
    .eq("pedido_compra_id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  await logAuditEvent({
    acao: "verba_producao.prestacao_documento_corrigido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: { documento_id: parsed.data.documento_id, campos: c },
  });

  return {
    ok: true,
    valorGasto: Number(prest?.valor_gasto ?? 0),
    saldo: Number(prest?.valor_devolvido ?? 0),
  };
}

/**
 * Gera uma URL assinada (TTL 1h) para um documento da prestação.
 * Valida tenant antes de assinar — impede acesso cross-tenant.
 */
export async function signedUrlAnexoPrestacao(
  anexo_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo, error } = await supabase
    .from("pp_verba_prestacoes_anexos")
    .select("arquivo_path")
    .eq("id", anexo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, ANEXO_TTL_SEGUNDOS);

  if (signedErr || !signed) {
    return { ok: false, message: "Não foi possível gerar o link." };
  }

  return { ok: true, url: signed.signedUrl };
}
