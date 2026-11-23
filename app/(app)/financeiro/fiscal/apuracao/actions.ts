"use server";

/**
 * Aprovação das guias da Apuração (módulo fiscal, entrega 2 — protótipo
 * aprovado pelo Tiago em 02/10/2026).
 *
 * O cliente manda só as decisões da pessoa (valor da guia, justificativa,
 * compensação, cota única, juros das cotas e o anexo já enviado ao bucket).
 * A guia é RECALCULADA aqui, com os fatos do banco de agora: o calculado, a
 * memória, as compensações, as cotas e o rateio saem do servidor
 * (`montarPedidoDeAprovacao`), e `aprovar_guia_fiscal` grava a aprovação e
 * os títulos de Impostos a Pagar numa transação, com as mesmas travas.
 *
 * Trava de papel como as vizinhas: admin ou financeiro, com `acao_negada`
 * na auditoria (a função do banco confere de novo).
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { carregarFatosFiscais, type FatosDoBanco } from "@/lib/fiscal/apuracao-fatos";
import { calcularApuracao, estadoDaGuia, type Guia } from "@/lib/fiscal/apuracao";
import { rateioPorGerencial } from "@/lib/fiscal/rateio-gerencial";
import { carregarRegrasDoRateio, regrasDoCnpj } from "@/lib/fiscal/rateio-gerencial-dados";
import { montarPedidoDeAprovacao, type EntradaDaAprovacao } from "./aprovacao";
import { hojeEmSaoPaulo } from "./dados";

type Err = { ok: false; message: string };

const ROLES_PERMITIDOS = ["administrador", "financeiro"] as const;
const CAMINHO = "/financeiro/fiscal";
const BUCKET = "impostos";

async function checarGate(acaoTentada: string, entidadeId: string | null) {
  const session = await requireSession();
  if (!(ROLES_PERMITIDOS as readonly string[]).includes(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "fiscal_aprovacao",
      entidadeId: entidadeId ?? undefined,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false as const, message: "Apenas admin ou financeiro aprova as guias da apuração." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

/** O que o banco devolve, em português para a tela. */
function mensagemDoBanco(msg: string) {
  if (/uq_fiscal_aprovacao_por_guia|duplicate key/i.test(msg)) return "Esta guia já foi aprovada.";
  return msg;
}

interface Recalculo {
  fatos: FatosDoBanco;
  hoje: string;
  guias: Guia[];
  /** As PJs de teste (decisão 181): a guia em curso delas se aprova. */
  pjsDeTeste: Set<string>;
}

async function recalcular(supabase: ReturnType<typeof createClient>, tenantId: string): Promise<Recalculo> {
  const hoje = hojeEmSaoPaulo();
  const [fatos, testeRes] = await Promise.all([
    carregarFatosFiscais(supabase, tenantId),
    supabase.from("empresas_contabeis").select("id").eq("tenant_id", tenantId).eq("de_teste", true),
  ]);
  if (testeRes.error) throw new Error(`[fiscal.apuracao.pjs_de_teste] ${testeRes.error.message}`);
  return {
    fatos,
    hoje,
    guias: calcularApuracao(fatos.cadastro, fatos.fatos, hoje, fatos.aprovacoes),
    pjsDeTeste: new Set(((testeRes.data ?? []) as Array<{ id: string }>).map((p) => p.id)),
  };
}

/** Monta o pedido de uma guia já recalculada (a cidade da matriz dá o vencimento das cotas). */
function pedidoDa(r: Recalculo, g: Guia, entrada: EntradaDaAprovacao) {
  const estado = estadoDaGuia(g, r.hoje, r.fatos.aprovacoes);
  const matriz =
    r.fatos.cadastro.estabelecimentos.find((e) => e.empresa_contabil_id === g.empresa_contabil_id && e.papel === "matriz") ??
    r.fatos.cadastro.estabelecimentos.find((e) => e.empresa_contabil_id === g.empresa_contabil_id);
  return montarPedidoDeAprovacao({
    guia: g,
    estado: estado.estado,
    delta: estado.delta,
    aprovacao: estado.aprovacao ?? null,
    entrada,
    cadastro: r.fatos.cadastro,
    hoje: r.hoje,
    cidadeDaMatriz: matriz?.municipio ?? "",
    pjDeTeste: r.pjsDeTeste.has(g.empresa_contabil_id),
  });
}

// ---------------------------------------------------------------------------
// Aprovar uma guia (ou a diferença dela)
// ---------------------------------------------------------------------------

const aprovarSchema = z.object({
  chave: z.string().min(3).max(300),
  valor_guia: z.number().finite().min(0, "Informe o valor da guia.").max(1e11),
  justificativa: z.string().max(2000).default(""),
  usar_compensacao: z.boolean().default(true),
  cota_unica: z.boolean().default(false),
  juros_pct: z.array(z.number().finite().nullable()).max(3).nullable().default(null),
  /** O anexo já enviado ao bucket `impostos` pelo navegador. */
  guia_path: z.string().min(3).max(500).nullable().default(null),
  /**
   * Decisão 277: o valor de cada empresa gerencial (o da contabilidade); as
   * regionais dividem pela receita, no servidor. Nulo = o rateio do sistema.
   */
  rateio_gerencial: z
    .array(
      z.object({
        empresa_id: z.string().uuid(),
        valor: z.number().finite().positive("Cada empresa gerencial do rateio precisa de valor."),
        regional_id: z.string().uuid().nullable(),
      }),
    )
    .max(20)
    .nullable()
    .default(null),
  /** Decisão 277: o saldo credor que a contabilidade levou para o mês seguinte (PIS/COFINS não cumulativos). */
  saldo_credor_contabil: z.number().finite().min(0, "O saldo credor não pode ser negativo.").max(1e11).nullable().default(null),
});

/** A guia de PIS ou COFINS não cumulativos: a única com saldo credor. */
const temSaldoCredor = (chave: string) => /^(pis|cofins)\|/.test(chave);

export async function aprovarGuia(
  input: unknown,
): Promise<{ ok: true; aprovacaoId: string; titulos: number; aviso: string | null } | Err> {
  const parsed = aprovarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const v = parsed.data;
  const gate = await checarGate("fiscal.guia_aprovada", v.chave);
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;

  // O anexo: só no lugar das guias deste tenant, e precisa existir.
  if (v.guia_path) {
    if (!v.guia_path.startsWith(`${tenantId}/guias/`) || v.guia_path.includes("..")) {
      return { ok: false, message: "Anexo inválido. Escolha o arquivo da guia de novo." };
    }
    const { error } = await supabase.storage.from(BUCKET).createSignedUrl(v.guia_path, 30);
    if (error) return { ok: false, message: "O anexo da guia não foi encontrado. Escolha o arquivo de novo." };
  }

  let r: Recalculo;
  try {
    r = await recalcular(supabase, tenantId);
  } catch (e) {
    return { ok: false, message: `Não foi possível recalcular a apuração: ${e instanceof Error ? e.message : String(e)}` };
  }
  const calculada = r.guias.find((x) => x.chave === v.chave);
  if (!calculada) return { ok: false, message: "Esta guia não está mais na apuração. Atualize a página." };
  if (v.saldo_credor_contabil !== null && !temSaldoCredor(v.chave)) {
    return { ok: false, message: "Só a guia de PIS ou COFINS não cumulativos tem saldo credor." };
  }

  // Decisão 277: o rateio por empresa gerencial (o da contabilidade), com as regionais pela receita.
  let g = calculada;
  if (v.rateio_gerencial && v.valor_guia > 0) {
    let regras;
    try {
      regras = await carregarRegrasDoRateio(supabase, tenantId);
    } catch (e) {
      return { ok: false, message: `Não foi possível ler as empresas do rateio: ${e instanceof Error ? e.message : String(e)}` };
    }
    const rateio = rateioPorGerencial(v.rateio_gerencial, calculada.rateio, regrasDoCnpj(regras, calculada.empresa_contabil_id), v.valor_guia);
    if (!rateio.ok) return rateio;
    g = { ...calculada, rateio: rateio.rateio };
  }

  const montagem = pedidoDa(r, g, {
    valor_guia: v.valor_guia,
    justificativa: v.justificativa,
    usar_compensacao: v.usar_compensacao,
    cota_unica: v.cota_unica,
    juros_pct: v.juros_pct,
  });
  if (!montagem.ok) return montagem;

  const { data, error } = await supabase.rpc("aprovar_guia_fiscal", {
    ...montagem.pedido,
    p_tenant_id: tenantId,
    p_guia_path: v.guia_path,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error.message) };

  // O saldo da contabilidade vai na aprovação recém-criada (à parte: pode ser informado depois também).
  let aviso: string | null = null;
  if (v.saldo_credor_contabil !== null && Math.abs(v.saldo_credor_contabil - calculada.saldo_credor_gerado) >= 0.01) {
    const s = await supabase.rpc("definir_saldo_credor_contabil", {
      p_tenant_id: tenantId,
      p_chave: v.chave,
      p_valor: v.saldo_credor_contabil,
    });
    if (s.error) aviso = `A guia foi aprovada, mas o saldo credor da contabilidade não foi gravado (${s.error.message}). Informe de novo na guia.`;
  }

  revalidatePath(CAMINHO);
  return { ok: true, aprovacaoId: String(data), titulos: montagem.pedido.p_titulos.length, aviso };
}

// ---------------------------------------------------------------------------
// O saldo credor da contabilidade, depois da aprovação (decisão 277)
// ---------------------------------------------------------------------------

const saldoSchema = z.object({
  chave: z.string().min(3).max(300),
  /** Nulo volta ao saldo calculado. */
  valor: z.number().finite().min(0, "O saldo credor não pode ser negativo.").max(1e11).nullable(),
});

export async function informarSaldoCredorDaContabilidade(input: unknown): Promise<{ ok: true } | Err> {
  const parsed = saldoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const v = parsed.data;
  if (!temSaldoCredor(v.chave)) return { ok: false, message: "Só a guia de PIS ou COFINS não cumulativos tem saldo credor." };
  const gate = await checarGate("fiscal.saldo_credor_contabil", v.chave);
  if (!gate.ok) return gate;
  const { error } = await gate.supabase.rpc("definir_saldo_credor_contabil", {
    p_tenant_id: gate.session.activeTenant.id,
    p_chave: v.chave,
    p_valor: v.valor,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error.message) };
  revalidatePath(CAMINHO);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Aprovar várias pelo valor calculado
// ---------------------------------------------------------------------------

const loteSchema = z.object({ chaves: z.array(z.string().min(3).max(300)).min(1).max(200) });

/**
 * "Aprovar as N guias pelo valor calculado": cada guia a aprovar vira um
 * imposto a pagar com o calculado (compensação sugerida incluída, cotas do
 * calculado). Diferença não entra (cada uma se aprova sozinha). Uma guia que
 * falha não segura as outras; a resposta diz quais.
 */
export async function aprovarGuiasPeloCalculado(
  input: unknown,
): Promise<{ ok: true; aprovadas: number; falhas: Array<{ titulo: string; message: string }> } | Err> {
  const parsed = loteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Nenhuma guia escolhida." };
  const gate = await checarGate("fiscal.guias_aprovadas_pelo_calculado", null);
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;

  let r: Recalculo;
  try {
    r = await recalcular(supabase, tenantId);
  } catch (e) {
    return { ok: false, message: `Não foi possível recalcular a apuração: ${e instanceof Error ? e.message : String(e)}` };
  }

  let aprovadas = 0;
  const falhas: Array<{ titulo: string; message: string }> = [];
  for (const chave of [...new Set(parsed.data.chaves)]) {
    const g = r.guias.find((x) => x.chave === chave);
    if (!g) {
      falhas.push({ titulo: chave, message: "Esta guia não está mais na apuração." });
      continue;
    }
    const nome = `${g.titulo} · ${g.local}`;
    if (estadoDaGuia(g, r.hoje, r.fatos.aprovacoes).estado !== "a_aprovar") {
      falhas.push({ titulo: nome, message: "Não está mais a aprovar." });
      continue;
    }
    const montagem = pedidoDa(r, g, {
      valor_guia: g.apurado,
      justificativa: "",
      usar_compensacao: true,
      cota_unica: false,
      juros_pct: null,
    });
    if (!montagem.ok) {
      falhas.push({ titulo: nome, message: montagem.message });
      continue;
    }
    const { error } = await supabase.rpc("aprovar_guia_fiscal", {
      ...montagem.pedido,
      p_tenant_id: tenantId,
      p_guia_path: null,
    });
    if (error) falhas.push({ titulo: nome, message: mensagemDoBanco(error.message) });
    else aprovadas++;
  }

  revalidatePath(CAMINHO);
  return { ok: true, aprovadas, falhas };
}

// ---------------------------------------------------------------------------
// Abrir a guia anexada a uma aprovação
// ---------------------------------------------------------------------------

export async function urlDaGuiaAprovada(aprovacaoId: string): Promise<{ ok: true; url: string } | Err> {
  if (!z.string().uuid().safeParse(aprovacaoId).success) return { ok: false, message: "Aprovação inválida." };
  const gate = await checarGate("fiscal.guia_lida", aprovacaoId);
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const { data } = await supabase
    .from("fiscal_aprovacoes")
    .select("guia_path")
    .eq("id", aprovacaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ guia_path: string | null }>();
  if (!data?.guia_path) return { ok: false, message: "Guia não encontrada." };
  const { data: assinada, error } = await supabase.storage.from(BUCKET).createSignedUrl(data.guia_path, 60 * 10);
  if (error || !assinada) return { ok: false, message: "Não foi possível abrir a guia." };
  return { ok: true, url: assinada.signedUrl };
}
