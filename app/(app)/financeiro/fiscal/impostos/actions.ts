"use server";

/**
 * Impostos a Pagar (módulo fiscal, entrega 2 — desenho aprovado pelo Tiago
 * no protótipo de 30/09 a 02/10/2026): dar baixa numa guia, cancelar a
 * baixa, corrigir o valor (a guia da contabilidade veio diferente) e lançar
 * um imposto à mão (avulso).
 *
 * Cada action confere a sessão e o papel (admin ou financeiro, com
 * `acao_negada` no audit, como as actions vizinhas de Contas a Pagar),
 * valida a entrada e chama a função do banco — que confere de novo o
 * papel, grava o rateio e os lançamentos e registra o próprio evento em
 * `audit_events` (`baixar_imposto`, `cancelar_baixa_imposto`,
 * `corrigir_imposto`, `criar_imposto_avulso`, migration 20261002100701).
 *
 * Os anexos (guia, comprovante, guia nova da correção) sobem do navegador
 * para o bucket privado `impostos`, em `<tenant_id>/...` (o padrão dos
 * anexos de contas avulsas); aqui só se confere que o caminho é do tenant
 * da sessão.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Err = { ok: false; message: string };

const SEM_PERMISSAO = "Apenas admin ou financeiro pode executar esta ação.";

/** Gate: apenas admin ou financeiro, com `acao_negada` no audit. */
async function checarGateFinanceiro(
  entidadeId: string | null,
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
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "imposto_a_pagar",
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: SEM_PERMISSAO };
  }
  return { ok: true, session, supabase: createClient() };
}

/** Tudo que mostra imposto, saldo ou extrato. */
function revalidarImpostos() {
  revalidatePath("/financeiro/fiscal");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
}

/**
 * A mensagem do banco, pronta para a tela. As funções levantam exceção com
 * o texto em português; o prefixo do Postgres é o que precisa sair. Texto
 * técnico (nome de constraint, aspas) vira a mensagem genérica.
 */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/[_"]/.test(limpa)) return limpa;
  return generica;
}

/** O anexo é do tenant da sessão (o bucket já barra o resto pela RLS). */
function anexoDoTenant(path: string | null | undefined, tenantId: string): boolean {
  return !path || (path.startsWith(`${tenantId}/`) && !path.includes(".."));
}

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.");
const caminho = z.string().trim().min(1).max(500);

// ---------------------------------------------------------------------------
// Baixa
// ---------------------------------------------------------------------------

const baixaSchema = z.object({
  imposto_id: z.string().uuid(),
  pago_em: dataIso,
  conta_bancaria_id: z.string().uuid("Selecione a conta que pagou a guia."),
  multa_juros: z.number().min(0, "Multa e juros não podem ser negativos.").max(1e10),
  /** A guia nova; nula = a que o imposto já tem (a da aprovação). */
  guia_path: caminho.nullable(),
  comprovante_path: caminho,
  /**
   * O valor do imposto que a tela mostrou. Se ele mudou desde então
   * (correção em outra aba), a baixa não sai: o banco baixa pelo valor
   * dele, e não pode tirar da conta um valor que não foi o confirmado.
   */
  valor_confirmado: z.number().positive(),
});

export type EntradaDaBaixaDeImposto = z.input<typeof baixaSchema>;

export async function darBaixaImposto(
  input: EntradaDaBaixaDeImposto,
): Promise<{ ok: true } | Err> {
  const parsed = baixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const d = parsed.data;
  const gate = await checarGateFinanceiro(d.imposto_id, "imposto_a_pagar.baixa");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;

  if (!anexoDoTenant(d.guia_path, tenantId) || !anexoDoTenant(d.comprovante_path, tenantId)) {
    return { ok: false, message: "Anexo inválido. Anexe o arquivo de novo." };
  }

  const { data: atual, error: erroAtual } = await supabase
    .from("impostos_a_pagar")
    .select("valor, status")
    .eq("id", d.imposto_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (erroAtual) {
    console.error("[impostos.baixa.leitura]", erroAtual.message);
    return { ok: false, message: "Não foi possível dar baixa. Tente novamente." };
  }
  if (!atual) return { ok: false, message: "Imposto não encontrado." };
  if (atual.status !== "a_pagar") {
    return { ok: false, message: atual.status === "cancelado" ? "Este imposto foi cancelado." : "Este imposto já está pago." };
  }
  if (Math.abs(Number(atual.valor) - d.valor_confirmado) >= 0.005) {
    return {
      ok: false,
      message: `O valor deste imposto mudou desde que a tela abriu (agora ${Number(atual.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). Feche, confira e dê baixa de novo.`,
    };
  }

  const { error } = await supabase.rpc("baixar_imposto", {
    p_imposto_id: d.imposto_id,
    p_pago_em: d.pago_em,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_multa_juros: Math.round(d.multa_juros * 100) / 100,
    p_guia_path: d.guia_path,
    p_comprovante_path: d.comprovante_path,
  });
  if (error) {
    console.error("[impostos.baixa]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível dar baixa. Tente novamente.") };
  }

  revalidarImpostos();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cancelar a baixa
// ---------------------------------------------------------------------------

const cancelarSchema = z.object({
  imposto_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Explique o motivo do cancelamento em pelo menos 10 caracteres.")
    .max(1000),
});

export async function cancelarBaixaImposto(
  input: z.input<typeof cancelarSchema>,
): Promise<{ ok: true } | Err> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.imposto_id, "imposto_a_pagar.cancelar_baixa");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("cancelar_baixa_imposto", {
    p_imposto_id: parsed.data.imposto_id,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    console.error("[impostos.cancelar_baixa]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível cancelar a baixa. Tente novamente."),
    };
  }

  revalidarImpostos();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cancelar o título em aberto (decisão 145, item 6)
// ---------------------------------------------------------------------------

const cancelarTituloSchema = z.object({
  imposto_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Explique o motivo do cancelamento em pelo menos 10 caracteres.")
    .max(1000),
});

/**
 * Cancela, à mão e com motivo, um imposto ainda em aberto — por exemplo,
 * quando as notas da guia aprovada foram canceladas e o imposto deixou de
 * ser devido. O pago não se cancela: fica a recuperar, com a contabilidade.
 * O banco grava quem, quando e por quê (`fiscal.imposto_cancelado`).
 */
export async function cancelarImposto(
  input: z.input<typeof cancelarTituloSchema>,
): Promise<{ ok: true } | Err> {
  const parsed = cancelarTituloSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.imposto_id, "imposto_a_pagar.cancelar");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("cancelar_imposto_a_pagar", {
    p_imposto_id: parsed.data.imposto_id,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    console.error("[impostos.cancelar]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível cancelar o imposto. Tente novamente."),
    };
  }

  revalidarImpostos();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Corrigir o valor
// ---------------------------------------------------------------------------

const corrigirSchema = z.object({
  imposto_id: z.string().uuid(),
  valor: z.number().positive("Informe o valor corrigido.").max(1e10),
  justificativa: z
    .string()
    .trim()
    .min(10, "Explique o motivo da correção em pelo menos 10 caracteres.")
    .max(1000),
  anexo_path: caminho.nullable(),
});

export async function corrigirImposto(
  input: z.input<typeof corrigirSchema>,
): Promise<{ ok: true } | Err> {
  const parsed = corrigirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const d = parsed.data;
  const gate = await checarGateFinanceiro(d.imposto_id, "imposto_a_pagar.corrigir");
  if (!gate.ok) return gate;
  if (!anexoDoTenant(d.anexo_path, gate.session.activeTenant.id)) {
    return { ok: false, message: "Anexo inválido. Anexe o arquivo de novo." };
  }

  const { error } = await gate.supabase.rpc("corrigir_imposto", {
    p_imposto_id: d.imposto_id,
    p_valor: Math.round(d.valor * 100) / 100,
    p_justificativa: d.justificativa,
    p_anexo_path: d.anexo_path,
  });
  if (error) {
    console.error("[impostos.corrigir]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível corrigir o valor. Tente novamente."),
    };
  }

  revalidarImpostos();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lançamento avulso
// ---------------------------------------------------------------------------

const TRIBUTOS = ["ISS", "PIS", "COFINS", "IRPJ", "CSLL", "ISS_RET", "CSRF", "IRRF", "OUTRO"] as const;

const avulsoSchema = z.object({
  tributo: z.enum(TRIBUTOS, { errorMap: () => ({ message: "Escolha o imposto." }) }),
  titulo: z.string().trim().min(2).max(120),
  codigo_receita: z.string().trim().max(20).nullable(),
  empresa_contabil_id: z.string().uuid("Escolha o CNPJ."),
  /** Só na guia municipal (ISS); a federal é da PJ. */
  estabelecimento_id: z.string().uuid().nullable(),
  competencia: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2]|T[1-4])$/, "Escolha a competência."),
  rotulo_competencia: z.string().trim().min(1).max(60),
  descricao: z.string().trim().min(3, "Descreva o lançamento.").max(500),
  vencimento: dataIso,
  valor: z.number().positive("Informe o valor.").max(1e10),
  rateio: z
    .array(
      z.object({
        empresa_id: z.string().uuid(),
        regional_id: z.string().uuid(),
        valor: z.number().positive("Cada parte do rateio precisa de valor."),
      }),
    )
    .min(1, "O rateio precisa somar 100% e ter as regionais escolhidas."),
  guia_path: caminho.nullable(),
});

export async function criarImpostoAvulso(
  input: z.input<typeof avulsoSchema>,
): Promise<{ ok: true; id: string } | Err> {
  const parsed = avulsoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const d = parsed.data;
  const gate = await checarGateFinanceiro(null, "imposto_a_pagar.criar_avulso");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  if (!anexoDoTenant(d.guia_path, tenantId)) {
    return { ok: false, message: "Anexo inválido. Anexe o arquivo de novo." };
  }
  const valor = Math.round(d.valor * 100) / 100;
  const soma = Math.round(d.rateio.reduce((s, r) => s + Math.round(r.valor * 100), 0)) / 100;
  if (Math.abs(soma - valor) >= 0.005) {
    return { ok: false, message: "O rateio não fecha com o valor do imposto." };
  }

  const { data, error } = await gate.supabase.rpc("criar_imposto_avulso", {
    p_tenant_id: tenantId,
    p_tributo: d.tributo,
    p_titulo: d.titulo,
    p_codigo_receita: d.codigo_receita || null,
    p_empresa_contabil_id: d.empresa_contabil_id,
    p_estabelecimento_id: d.estabelecimento_id,
    p_competencia: d.competencia,
    p_rotulo_competencia: d.rotulo_competencia,
    p_descricao: d.descricao,
    p_vencimento: d.vencimento,
    p_valor: valor,
    p_rateio: d.rateio.map((r) => ({
      empresa_id: r.empresa_id,
      regional_id: r.regional_id,
      valor: Math.round(r.valor * 100) / 100,
    })),
    p_guia_path: d.guia_path,
  });
  if (error || typeof data !== "string") {
    console.error("[impostos.criar_avulso]", error?.message);
    return {
      ok: false,
      message: error
        ? mensagemDoBanco(error.message, "Não foi possível criar o lançamento. Tente novamente.")
        : "Não foi possível criar o lançamento. Tente novamente.",
    };
  }

  revalidarImpostos();
  return { ok: true, id: data };
}

// ---------------------------------------------------------------------------
// Ver um anexo
// ---------------------------------------------------------------------------

/** URL assinada (10 minutos) para abrir a guia, o comprovante ou o anexo da correção. */
export async function urlDoAnexoImposto(path: string): Promise<{ ok: true; url: string } | Err> {
  const gate = await checarGateFinanceiro(null, "imposto_a_pagar.anexo_lido");
  if (!gate.ok) return gate;
  if (typeof path !== "string" || !path || !anexoDoTenant(path, gate.session.activeTenant.id)) {
    return { ok: false, message: "Anexo não encontrado." };
  }
  const { data, error } = await gate.supabase.storage.from("impostos").createSignedUrl(path, 60 * 10);
  if (error || !data) {
    return { ok: false, message: "Não foi possível abrir o anexo." };
  }
  return { ok: true, url: data.signedUrl };
}
