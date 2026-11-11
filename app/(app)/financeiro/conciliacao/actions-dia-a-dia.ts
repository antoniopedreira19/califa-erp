"use server";

/**
 * As ações da conciliação dia a dia (decisão 254) que as de sempre da aba
 * (`actions-conciliacao.ts`) não cobriam.
 *
 * `conciliarMisto`: a linha do banco que paga, de uma vez, baixas que já
 * estavam no sistema e títulos ainda em aberto. Os títulos ganham a baixa
 * com os dados do banco (a baixa em lote de sempre, com as travas e a
 * retenção da aprovação) e a linha se liga a tudo. A soma é conferida pelo
 * banco (`conciliar_linha`).
 *
 * `mudarDataDaBaixa` e `mudarDataDaPrevisao`: o que está no dia errado muda
 * de dia sem cancelar e refazer. As regras (papel, período fechado, baixa já
 * conciliada, data futura) são das funções do banco.
 *
 * `previaDeRetirarExtrato` e `retirarExtrato`: tirar da conta o último
 * extrato importado. Desfazer as conciliações das linhas dele usa o
 * `desfazerConciliacao` de sempre (que cancela a baixa nascida na
 * conciliação), em partes, para nenhuma chamada passar do tempo da função;
 * o banco só apaga com todas as linhas sem conciliação.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { EntradaDaBaixaEmLote } from "@/lib/financeiro/baixa-em-lote";
import { baixarEConciliar, baixarPelaLinha, cancelarBaixasDesfeitas, desfazerConciliacao } from "./actions-conciliacao";

type Resultado = { ok: true; mensagem?: string } | { ok: false; message: string };
type ItensDaBaixa = EntradaDaBaixaEmLote["itens"];

const UUID = z.string().uuid();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

async function gate() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false as const, message: "Só admin ou financeiro concilia o extrato do banco." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

function revalidar() {
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
}

/** As funções do banco levantam exceção com o texto pronto para a tela; o
 *  que não for assim (erro técnico) vira a mensagem genérica. */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

/** A coluna de `lancamentos_financeiros` que guarda o documento de cada baixa do lote. */
function baixaDoItem(alvo: ItensDaBaixa[number]["alvo"]): { origem: string; coluna: string } {
  if (alvo.modulo === "imposto") return { origem: "imposto_baixa", coluna: "imposto_a_pagar_id" };
  if (alvo.modulo === "receber") return alvo.origem === "nf" ? { origem: "titulo_baixa", coluna: "titulo_receber_id" } : { origem: "avulsa_baixa", coluna: "conta_avulsa_id" };
  return alvo.origem === "pp" ? { origem: "pp_baixa", coluna: "pedido_compra_parcela_id" } : { origem: "avulsa_baixa", coluna: "conta_avulsa_id" };
}

export async function conciliarMisto(entrada: { linhaId: string; lancamentoIds: string[]; itens: ItensDaBaixa }): Promise<Resultado> {
  if (!UUID.safeParse(entrada.linhaId).success || !z.array(UUID).max(500).safeParse(entrada.lancamentoIds).success) {
    return { ok: false, message: "Entrada inválida." };
  }
  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0 || entrada.itens.length > 100) return { ok: false, message: "Entrada inválida." };
  // Só títulos: é o "baixar e conciliar" de sempre, que o Desfazer sabe cancelar.
  if (entrada.lancamentoIds.length === 0) return baixarEConciliar({ linhaId: entrada.linhaId, itens: entrada.itens });

  const g = await gate();
  if (!g.ok) return g;
  const tenantId = g.session.activeTenant.id;
  const { data: linha, error } = await g.supabase
    .from("vw_extrato_linhas")
    .select("id, conta_bancaria_id, data")
    .eq("tenant_id", tenantId)
    .eq("id", entrada.linhaId)
    .maybeSingle<{ id: string; conta_bancaria_id: string; data: string }>();
  if (error || !linha) return { ok: false, message: "Linha do extrato não encontrada." };

  const baixa = await baixarPelaLinha({ linhaId: entrada.linhaId, itens: entrada.itens });
  if (!baixa.ok) return baixa;

  // As baixas que acabaram de nascer: a de cada documento, nesta conta e sem linha.
  const achadas = await Promise.all(
    entrada.itens.map((i) => {
      const { origem, coluna } = baixaDoItem(i.alvo);
      return g.supabase
        .from("lancamentos_financeiros")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("conta_bancaria_id", linha.conta_bancaria_id)
        .is("extrato_linha_id", null)
        .eq("origem", origem)
        .eq(coluna, i.alvo.id)
        .eq("data_movimento", linha.data)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();
    }),
  );
  const novas = achadas.map((r) => r.data?.id).filter((id): id is string => !!id);
  if (novas.length !== entrada.itens.length) {
    revalidar();
    return {
      ok: false,
      message: "Os títulos foram baixados com os dados do banco, mas a linha ficou sem conciliar: as baixas aparecem em “Só no sistema” deste dia. Adicione-as à linha e concilie.",
    };
  }

  const { error: erroDaLiga } = await g.supabase.rpc("conciliar_linha", {
    p_linha_id: entrada.linhaId,
    p_lancamento_ids: [...entrada.lancamentoIds, ...novas],
    p_como: "ligacao",
    p_sozinha: null,
  });
  revalidar();
  if (erroDaLiga) {
    console.error("[conciliacao.conciliar_misto]", erroDaLiga.message);
    return {
      ok: false,
      message: `${mensagemDoBanco(erroDaLiga.message, "Não foi possível ligar a linha do banco.")} Os títulos já foram baixados e aparecem em “Só no sistema” deste dia.`,
    };
  }
  const n = entrada.lancamentoIds.length + novas.length;
  return {
    ok: true,
    mensagem: `${novas.length === 1 ? "1 título baixado" : `${novas.length} títulos baixados`} com os dados do banco e ${n} lançamentos conciliados com a linha.`,
  };
}

// ---------------------------------------------------------------------------
// As datas
// ---------------------------------------------------------------------------

/** A baixa lançada no dia errado (ainda sem linha do banco) muda de dia. */
export async function mudarDataDaBaixa(lancamentoIds: string[], data: string): Promise<Resultado> {
  if (!z.array(UUID).min(1).max(500).safeParse(lancamentoIds).success || !DATA.safeParse(data).success) {
    return { ok: false, message: "Entrada inválida." };
  }
  const g = await gate();
  if (!g.ok) return g;
  const { error } = await g.supabase.rpc("mudar_data_da_baixa", { p_lancamento_ids: lancamentoIds, p_data: data });
  if (error) {
    console.error("[conciliacao.mudar_data_da_baixa]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível mudar a data da baixa. Tente de novo.") };
  }
  revalidar();
  return { ok: true, mensagem: `Data da baixa alterada para ${ddmm(data)}.` };
}

/** A previsão da planilha muda de data; a carga nova da planilha não desfaz o ajuste. */
export async function mudarDataDaPrevisao(movimentoId: string, data: string): Promise<Resultado> {
  if (!UUID.safeParse(movimentoId).success || !DATA.safeParse(data).success) return { ok: false, message: "Entrada inválida." };
  const g = await gate();
  if (!g.ok) return g;
  const { data: res, error } = await g.supabase.rpc("mudar_data_da_previsao", { p_movimento_id: movimentoId, p_data: data });
  if (error) {
    console.error("[conciliacao.mudar_data_da_previsao]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível mudar a data da previsão. Tente de novo.") };
  }
  revalidar();
  const planilha = (res as { data_da_planilha?: string } | null)?.data_da_planilha;
  return {
    ok: true,
    mensagem:
      planilha && planilha !== data
        ? `Data da previsão alterada para ${ddmm(data)}. A da planilha (${ddmm(planilha)}) continua registrada.`
        : `A previsão voltou à data da planilha, ${ddmm(data)}.`,
  };
}

// ---------------------------------------------------------------------------
// Retirar o extrato importado
// ---------------------------------------------------------------------------

export interface PreviaDaRetirada {
  importacaoId: string;
  arquivo: string;
  linhas: number;
  conciliadas: number;
  ignoradas: number;
  /** A conta está fechada até este dia e o extrato tem linhas nele. */
  fechadoAte: string | null;
  /** Outro motivo que impede a retirada, pronto para a tela. */
  travada: string | null;
}

type PreviaCrua = { importacao_id: string; arquivo: string; linhas: number; conciliadas: number; ignoradas: number; fechado_ate: string | null; presas: number };

async function lerPrevia(supabase: ReturnType<typeof createClient>, contaId: string): Promise<{ ok: true; previa: PreviaDaRetirada } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("previa_de_retirar_extrato", { p_conta_id: contaId });
  if (error || !data) {
    if (error) console.error("[conciliacao.previa_de_retirar_extrato]", error.message);
    return { ok: false, message: mensagemDoBanco(error?.message ?? "", "Não foi possível ler o extrato desta conta. Tente de novo.") };
  }
  const p = data as PreviaCrua;
  return {
    ok: true,
    previa: {
      importacaoId: p.importacao_id,
      arquivo: p.arquivo,
      linhas: p.linhas,
      conciliadas: p.conciliadas,
      ignoradas: p.ignoradas,
      fechadoAte: p.fechado_ate,
      travada:
        p.presas > 0
          ? "Este extrato tem linha com correção de baixa em vigor ou IOF de mútuo registrado no histórico: ele não pode ser retirado."
          : null,
    },
  };
}

/** O último extrato importado da conta e o que sairia com ele. Não muda nada. */
export async function previaDeRetirarExtrato(contaId: string): Promise<{ ok: true; previa: PreviaDaRetirada } | { ok: false; message: string }> {
  if (!UUID.safeParse(contaId).success) return { ok: false, message: "Entrada inválida." };
  const g = await gate();
  if (!g.ok) return g;
  return lerPrevia(g.supabase, contaId);
}

/** Quantas conciliações uma chamada desfaz antes de devolver para a tela chamar de novo. */
const DESFAZER_POR_CHAMADA = 5;

/**
 * Retira o extrato em partes. Enquanto houver linha dele conciliada, desfaz
 * algumas e devolve `continua` (a tela chama de novo); com todas livres,
 * apaga as linhas e o arquivo pelo banco, com a auditoria e o motivo.
 */
export async function retirarExtrato(entrada: {
  contaId: string;
  importacaoId: string;
  motivo: string;
  /** Quantas conciliações o extrato tinha na confirmação: vai para a auditoria. */
  conciliadasNoInicio: number;
}): Promise<Resultado & { continua?: boolean }> {
  if (!UUID.safeParse(entrada.contaId).success || !UUID.safeParse(entrada.importacaoId).success) return { ok: false, message: "Entrada inválida." };
  const desfeitas = Number.isInteger(entrada.conciliadasNoInicio) && entrada.conciliadasNoInicio > 0 ? entrada.conciliadasNoInicio : 0;
  const motivo = String(entrada.motivo ?? "").trim();
  const g = await gate();
  if (!g.ok) return g;

  const lida = await lerPrevia(g.supabase, entrada.contaId);
  if (!lida.ok) return lida;
  const previa = lida.previa;
  if (previa.importacaoId !== entrada.importacaoId) return { ok: false, message: "Outro extrato foi importado nesta conta depois: recarregue a página." };
  if (previa.fechadoAte) {
    return { ok: false, message: `A conciliação desta conta está fechada até ${ddmm(previa.fechadoAte)}, e este extrato tem linhas nesse período: reabra a conciliação antes de retirar o extrato.` };
  }
  if (previa.travada) return { ok: false, message: previa.travada };
  if ((desfeitas > 0 || previa.conciliadas > 0) && motivo.length < 10) return { ok: false, message: "Explique o motivo (pelo menos 10 caracteres)." };

  if (previa.conciliadas > 0) {
    const { data: linhas, error } = await g.supabase
      .from("vw_extrato_linhas")
      .select("id")
      .eq("tenant_id", g.session.activeTenant.id)
      .eq("importacao_id", previa.importacaoId)
      .eq("conciliada", true)
      .order("data", { ascending: true })
      .order("ordem", { ascending: true })
      .limit(DESFAZER_POR_CHAMADA)
      .returns<Array<{ id: string }>>();
    if (error || !linhas?.length) return { ok: false, message: "Não foi possível ler as linhas conciliadas deste extrato. Tente de novo." };
    for (const l of linhas) {
      // Desfeita junto com outra do mesmo grupo: o desfazer não acha o que mexer e devolve ok.
      const res = await desfazerConciliacao(l.id);
      if (!res.ok) return { ok: false, message: `O extrato não foi retirado. ${res.message}` };
      let restantes = res.restantes ?? [];
      while (restantes.length) {
        const parte = await cancelarBaixasDesfeitas(restantes.slice(0, 20));
        if (!parte.ok) return { ok: false, message: `O extrato não foi retirado. ${parte.message}` };
        restantes = restantes.slice(20);
      }
    }
    return { ok: true, continua: true };
  }

  const { data, error } = await g.supabase.rpc("retirar_extrato", {
    p_conta_id: entrada.contaId,
    p_importacao_id: entrada.importacaoId,
    p_motivo: motivo.slice(0, 1000),
    p_conciliacoes_desfeitas: desfeitas,
  });
  if (error) {
    console.error("[conciliacao.retirar_extrato]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível retirar o extrato. Tente de novo.") };
  }
  revalidar();
  const r = data as { arquivo: string; linhas: number };
  return {
    ok: true,
    mensagem: `Extrato ${r.arquivo} retirado: ${r.linhas === 1 ? "1 linha saiu" : `${r.linhas} linhas saíram`}${
      desfeitas ? ` e ${desfeitas === 1 ? "1 conciliação foi desfeita" : `${desfeitas} conciliações foram desfeitas`}` : ""
    }. Dá para importar o mesmo arquivo de novo.`,
  };
}
