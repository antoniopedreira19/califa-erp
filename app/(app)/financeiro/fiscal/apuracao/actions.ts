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
}

async function recalcular(supabase: ReturnType<typeof createClient>, tenantId: string): Promise<Recalculo> {
  const hoje = hojeEmSaoPaulo();
  const fatos = await carregarFatosFiscais(supabase, tenantId);
  return { fatos, hoje, guias: calcularApuracao(fatos.cadastro, fatos.fatos, hoje, fatos.aprovacoes) };
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
});

export async function aprovarGuia(
  input: unknown,
): Promise<{ ok: true; aprovacaoId: string; titulos: number } | Err> {
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
  const g = r.guias.find((x) => x.chave === v.chave);
  if (!g) return { ok: false, message: "Esta guia não está mais na apuração. Atualize a página." };

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

  revalidatePath(CAMINHO);
  return { ok: true, aprovacaoId: String(data), titulos: montagem.pedido.p_titulos.length };
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
