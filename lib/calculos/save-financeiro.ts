/** A linha do job como o FINANCEIRO vê (decisão 099).
 *
 *  A produção vê um pedido de save na hora: a marca de save, o consumo e o
 *  planejado zerado mudam na marcação, e a planilha, o cabeçalho e o card
 *  de Totais calculam pelos itens. O financeiro só vê na APROVAÇÃO: os
 *  espelhos do job (`jobs.valor_total`, `faturamento_previsto`,
 *  `faturamento_save_previsto`), que alimentam fluxo de caixa, previsão de
 *  recebimento, fila, Visualizar Jobs e a lista de Jobs, não podem mudar
 *  por um pedido que ainda aguarda.
 *
 *  A regra é uma só, e o banco tem a mesma (`vw_itens_orcado_financeiro` e
 *  `vw_saves_consumos_financeiro`, migration 20260922140002): pedido
 *  `job_aberto` AGUARDANDO é desfeito na conta — a linha que gera deixa de
 *  ser save, e a que consome volta ao consumo de antes do pedido. Pedido
 *  de outro momento (abertura, reenvio, legado) o financeiro já conferiu
 *  na abertura e conta como está.
 *
 *  Todo código que grava os espelhos passa os itens por aqui antes de
 *  `calcularTotaisVersao`.
 */

import type {
  OrigemDeSave,
  SaveAprovacaoMomento,
  SaveAprovacaoSituacao,
  SaveAprovacaoTipo,
} from "@/lib/types";

/** O mínimo de um pedido para a conta do financeiro. */
export interface PedidoParaFinanceiro {
  id: string;
  jobItemOrcadoId: string | null;
  tipo: SaveAprovacaoTipo;
  situacao: SaveAprovacaoSituacao;
  momento: SaveAprovacaoMomento;
  origensAntes: OrigemDeSave[];
}

/** O mínimo de uma linha: o id é o de `jobs_itens_orcado`. */
export interface LinhaParaFinanceiro {
  id: string;
  em_save: boolean;
  save_consumido: number;
}

/**
 * Devolve os itens como o financeiro os vê.
 *
 * `contar` lista pedidos que devem contar como se já estivessem aprovados —
 * é o caso da aprovação, que grava os espelhos já com o pedido que está
 * aprovando (e só com ele: os outros que aguardam seguem de fora).
 */
export function itensParaOFinanceiro<T extends LinhaParaFinanceiro>(
  itens: T[],
  pedidos: PedidoParaFinanceiro[],
  contar: string[] = [],
): T[] {
  const pendentes = new Map<string, PedidoParaFinanceiro>();
  for (const p of pedidos) {
    if (
      p.situacao === "aguardando" &&
      p.momento === "job_aberto" &&
      p.jobItemOrcadoId &&
      !contar.includes(p.id)
    ) {
      pendentes.set(p.jobItemOrcadoId, p);
    }
  }
  if (pendentes.size === 0) return itens;

  return itens.map((i) => {
    const p = pendentes.get(i.id);
    if (!p) return i;
    if (p.tipo === "gera") return { ...i, em_save: false };
    const antes = p.origensAntes.reduce((s, o) => s + Number(o.valor ?? 0), 0);
    return { ...i, save_consumido: antes };
  });
}
