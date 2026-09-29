/**
 * As baixas de cada documento (decisão 125): título a receber, parcela de
 * PP ou conta avulsa podem ter várias, cada uma um lançamento no extrato
 * com os impostos retidos dela pendurados (`baixas_retencoes`).
 *
 * A consulta traz os lançamentos `*_baixa` com a conta, o centro de custo e
 * os retidos; o agrupamento monta, por documento, a lista na ordem em que
 * as baixas aconteceram — é o que o popup do olho mostra, e é da soma
 * delas (líquido + retidos) que sai o "falta R$ X" da linha.
 */

import type {
  BaixaDoTitulo,
  EstornoDaBaixa,
} from "@/components/financeiro/baixa-registrada-dialog";
import type { ImpostoRetido } from "@/lib/types";

/** Colunas da baixa. Quem consulta acrescenta a coluna do documento
 *  (`titulo_receber_id`, `pedido_compra_parcela_id`, `conta_avulsa_id`). */
export const SELECT_BAIXA_DO_DOCUMENTO = `
  id, conta_bancaria_id, data_movimento, valor, created_at,
  conta:contas_bancarias(nome, banco),
  tipo:plano_contas_tipos(codigo, nome),
  subtipo:plano_contas_subtipos(nome),
  retencoes:baixas_retencoes(imposto, aliquota, valor)
`;

type BaixaRaw = {
  id: string;
  conta_bancaria_id: string;
  data_movimento: string;
  valor: string | number;
  created_at: string;
  conta: { nome: string; banco: string } | null;
  tipo: { codigo: string; nome: string } | null;
  subtipo: { nome: string } | null;
  retencoes: Array<{
    imposto: ImpostoRetido;
    aliquota: string | number | null;
    valor: string | number;
  }> | null;
} & Record<string, unknown>;

const ORDEM_DOS_IMPOSTOS: Record<ImpostoRetido, number> = {
  ISS: 0,
  PIS: 1,
  COFINS: 2,
  CSLL: 3,
  IRRF: 4,
};

/**
 * Documento → baixas dele, da mais antiga para a mais nova. `campo` é a
 * coluna do documento no lançamento.
 */
export function agruparBaixasPorDocumento(
  data: unknown[] | null,
  campo:
    | "titulo_receber_id"
    | "pedido_compra_parcela_id"
    | "conta_avulsa_id"
    | "desembolso_parcela_id"
    | "pp_verba_devolucao_id",
  estornosPorBaixa: Map<string, EstornoDaBaixa[]>,
): Map<string, BaixaDoTitulo[]> {
  const porDocumento = new Map<string, BaixaDoTitulo[]>();
  const linhas = ((data ?? []) as BaixaRaw[])
    .filter((l) => typeof l[campo] === "string")
    .sort(
      (a, b) =>
        a.data_movimento.localeCompare(b.data_movimento) ||
        a.created_at.localeCompare(b.created_at),
    );
  for (const l of linhas) {
    const documento = l[campo] as string;
    const lista = porDocumento.get(documento) ?? [];
    lista.push({
      lancamentoId: l.id,
      data: l.data_movimento,
      contaNome: l.conta ? `${l.conta.nome} · ${l.conta.banco}` : null,
      contaBancariaId: l.conta_bancaria_id,
      centroNome: l.tipo ? `${l.tipo.codigo} · ${l.tipo.nome}` : null,
      subtipoNome: l.subtipo?.nome ?? null,
      movimentado: Number(l.valor),
      retencoes: (l.retencoes ?? [])
        .map((r) => ({
          imposto: r.imposto,
          aliquota: r.aliquota === null ? null : Number(r.aliquota),
          valor: Number(r.valor),
        }))
        .sort((a, b) => ORDEM_DOS_IMPOSTOS[a.imposto] - ORDEM_DOS_IMPOSTOS[b.imposto]),
      estornos: estornosPorBaixa.get(l.id) ?? [],
    });
    porDocumento.set(documento, lista);
  }
  return porDocumento;
}

/** O que as baixas quitaram do documento: líquido + retidos. */
export function totalBaixado(baixas: BaixaDoTitulo[]): number {
  return (
    baixas.reduce(
      (acc, b) =>
        acc +
        Math.round(b.movimentado * 100) +
        b.retencoes.reduce((s, r) => s + Math.round(r.valor * 100), 0),
      0,
    ) / 100
  );
}

/** Os retidos de todas as baixas do documento. */
export function totalRetido(baixas: BaixaDoTitulo[]): number {
  return (
    baixas.reduce(
      (acc, b) => acc + b.retencoes.reduce((s, r) => s + Math.round(r.valor * 100), 0),
      0,
    ) / 100
  );
}

type UltimaRetencaoRaw = {
  natureza: "entrada" | "saida";
  parte_id: string;
  referencia: string | null;
  data_movimento: string;
  aliquotas: Partial<Record<ImpostoRetido, string | number>> | null;
};

/** `vw_retencao_mais_recente` → cliente/fornecedor → alíquotas para o
 *  "Repetir as alíquotas" (D6 2a). */
export function mapearUltimasRetencoes(data: unknown[] | null): Record<
  string,
  { referencia: string; data: string; aliquotas: Partial<Record<ImpostoRetido, number>> }
> {
  const mapa: Record<
    string,
    { referencia: string; data: string; aliquotas: Partial<Record<ImpostoRetido, number>> }
  > = {};
  for (const r of (data ?? []) as UltimaRetencaoRaw[]) {
    if (!r.parte_id || !r.aliquotas) continue;
    const aliquotas: Partial<Record<ImpostoRetido, number>> = {};
    for (const [imposto, valor] of Object.entries(r.aliquotas)) {
      const n = Number(valor);
      if (Number.isFinite(n) && n > 0) aliquotas[imposto as ImpostoRetido] = n;
    }
    mapa[r.parte_id] = {
      referencia: r.referencia ?? "última baixa",
      data: r.data_movimento,
      aliquotas,
    };
  }
  return mapa;
}
