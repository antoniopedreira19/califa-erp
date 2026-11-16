/**
 * O recebimento antes da NF que ainda espera a nota (decisão 130), lido do
 * mesmo jeito pela página de Contas a Receber (o selo da linha e a parcela
 * 1 do Faturar) e pela conciliação (decisão 256: o registro mudou para lá).
 *
 * Módulo sem "use client" nem "use server": a página (server) e a action
 * (server) usam a mesma leitura.
 */
import { chaveDoRecebidoAntes } from "./chave-info";
import type { RecebidoAntesDaNf } from "./recebimento-antes-nf-dialog";

export const SELECT_RECEBIDO_ANTES = `
  id, envio_nota_id, item_bv_id, job_id, valor, data, created_at,
  moeda, valor_moeda, cotacao, iof, tarifa, variacao_cambial,
  conta:contas_bancarias(nome, banco),
  lancamento:lancamentos_financeiros(
    tipo:plano_contas_tipos(codigo, nome),
    subtipo:plano_contas_subtipos(nome)
  )
`;

interface RecebidoAntesDoBanco {
  id: string;
  envio_nota_id: string | null;
  item_bv_id: string | null;
  job_id: string | null;
  valor: string | number;
  data: string;
  moeda: string | null;
  valor_moeda: string | number | null;
  cotacao: string | number | null;
  iof: string | number | null;
  tarifa: string | number | null;
  variacao_cambial: string | number | null;
  conta: { nome: string; banco: string } | null;
  lancamento: {
    tipo: { codigo: string; nome: string } | null;
    subtipo: { nome: string } | null;
  } | null;
}

/** Os recebidos que esperam nota, pela chave da linha (nota, BV ou job). */
export function recebidosAntesPorChave(dados: unknown[] | null): Record<string, RecebidoAntesDaNf[]> {
  const porChave: Record<string, RecebidoAntesDaNf[]> = {};
  for (const r of (dados ?? []) as RecebidoAntesDoBanco[]) {
    // Decisão 256: sem nota de envio nem BV, o recebido é preso ao job.
    const chave = chaveDoRecebidoAntes(r.envio_nota_id, r.item_bv_id, r.job_id);
    if (!chave) continue;
    (porChave[chave] ??= []).push({
      id: r.id,
      data: r.data,
      valor: Number(r.valor),
      contaNome: r.conta ? `${r.conta.nome} · ${r.conta.banco}` : "—",
      centroNome: r.lancamento?.tipo ? `${r.lancamento.tipo.codigo} · ${r.lancamento.tipo.nome}` : "—",
      subtipoNome: r.lancamento?.subtipo?.nome ?? "—",
      // O câmbio fechado do internacional (decisão 229).
      cambio: r.moeda
        ? {
            moeda: r.moeda,
            valorMoeda: Number(r.valor_moeda ?? 0),
            cotacao: Number(r.cotacao ?? 0),
            iof: Number(r.iof ?? 0),
            tarifa: Number(r.tarifa ?? 0),
            variacao: Number(r.variacao_cambial ?? 0),
          }
        : null,
    });
  }
  return porChave;
}
