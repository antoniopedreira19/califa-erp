/**
 * Os estornos pendurados em cada baixa viva (decisão 120), para o popup do
 * olho e para o "estornado R$ X" da linha, em Títulos a Receber e em
 * Títulos a Pagar.
 *
 * A consulta traz TODA linha `*_estorno` do tenant — são poucas — e o
 * agrupamento fica só com as que apontam para uma baixa que a tela conhece.
 * Os estornos antigos (anteriores à 120) desfaziam a baixa inteira: o pai
 * deles virou `*_baixa_estornada` e não está em lista nenhuma, então
 * caem fora sem filtro próprio.
 */

import type { EstornoDaBaixa } from "@/components/financeiro/baixa-registrada-dialog";

export const SELECT_ESTORNO_DE_BAIXA = `
  id, estorno_de_lancamento_id, data_movimento, valor, motivo_estorno,
  conta:contas_bancarias(nome, banco)
`;

type EstornoRaw = {
  id: string;
  estorno_de_lancamento_id: string | null;
  data_movimento: string;
  valor: string | number;
  motivo_estorno: string | null;
  conta: { nome: string; banco: string } | null;
};

/** Pai (id do lançamento da baixa) → estornos dele, do mais antigo ao
 *  mais novo. */
export function agruparEstornosPorBaixa(
  data: unknown[] | null,
): Map<string, EstornoDaBaixa[]> {
  const porBaixa = new Map<string, EstornoDaBaixa[]>();
  const linhas = ((data ?? []) as EstornoRaw[])
    .filter((e) => e.estorno_de_lancamento_id)
    .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento));
  for (const e of linhas) {
    const pai = e.estorno_de_lancamento_id as string;
    const lista = porBaixa.get(pai) ?? [];
    lista.push({
      id: e.id,
      data: e.data_movimento,
      valor: Number(e.valor),
      contaNome: e.conta ? `${e.conta.nome} · ${e.conta.banco}` : null,
      motivo: e.motivo_estorno,
    });
    porBaixa.set(pai, lista);
  }
  return porBaixa;
}
