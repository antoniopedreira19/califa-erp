/**
 * As colunas da planilha de títulos (decisão 195): a ordem, a largura e o
 * filtro pelo título de cada uma. As larguras são as do protótipo aprovado
 * (`PlanilhaDeTitulos`, titulos.jsx), em px, com a Descrição absorvendo o
 * resto; a grade é `table-fixed` com `colgroup`.
 */

import type { ColunaFiltravel } from "@/components/ui/filtro-de-coluna";
import { celulaData, celulaTexto, celulaValor } from "@/lib/calculos/filtro-de-coluna";
import { formatBRL } from "@/lib/format";
import { situacaoVerbaLabel } from "@/lib/types";
import {
  colunaDoValor,
  dataEfetiva,
  siglaDaRegional,
  juntarRateio,
  trimestreDe,
  type LinhaDaPlanilha,
  type StatusDaLinha,
} from "@/lib/financeiro/planilha-de-titulos";

export type ChaveDaColuna =
  | "sel"
  | "data"
  | "credito"
  | "debito"
  | "saldo"
  | "descricao"
  | "contraparte"
  | "job"
  | "centro"
  | "tri"
  | "empresa"
  | "reg"
  | "status"
  | "acao";

export interface OpcoesDaGrade {
  /** Só a Conciliação › Títulos mostra o saldo previsto. */
  saldo: boolean;
  /** Os módulos mostram o Status. */
  status: boolean;
  /** A coluna Crédito que o módulo nunca usa (Impostos a Pagar): fina, só
   *  com "—". */
  creditoFino: boolean;
}

/** As colunas na ordem da grade, com a largura (`null` = o que sobra). */
export function colunasDaGrade(o: OpcoesDaGrade): Array<[ChaveDaColuna, number | null]> {
  return [
    ["sel", 36],
    ["data", 122],
    ["credito", o.creditoFino ? 72 : 116],
    ["debito", 116],
    ...(o.saldo ? ([["saldo", 128]] as Array<[ChaveDaColuna, number]>) : []),
    ["descricao", null],
    ["contraparte", 200],
    ["job", 104],
    ["centro", 176],
    ["tri", 58],
    ["empresa", 130],
    ["reg", 64],
    ...(o.status ? ([["status", 120]] as Array<[ChaveDaColuna, number]>) : []),
    ["acao", 120],
  ];
}

/** A grade do Extrato da conta (decisão 195): as mesmas colunas e larguras
 *  da planilha de títulos, sem a caixa da seleção e sem o Status, com o
 *  Saldo e só o ⓘ na Ação. */
export function colunasDoExtratoNaGrade(): Array<[ChaveDaColuna, number | null]> {
  return [
    ["data", 122],
    ["credito", 116],
    ["debito", 116],
    ["saldo", 128],
    ["descricao", null],
    ["contraparte", 200],
    ["job", 104],
    ["centro", 176],
    ["tri", 58],
    ["empresa", 130],
    ["reg", 64],
    ["acao", 56],
  ];
}

export const ROTULO_DO_STATUS: Record<StatusDaLinha, string> = {
  a_pagar: "A pagar",
  parcial: "Parcial",
  pago: "Pago",
  no_cartao: "No cartão",
  a_devolver: "A devolver",
  devolvido: "Devolvido",
  em_aberto: "Em aberto",
  inadimplente: "Inadimplente",
  recebido: "Recebido",
  a_transferir: "A transferir",
  transferido: "Transferida",
  vencido: "Vencido",
  cancelado: "Cancelado",
};

export function rotuloDoCentro(l: LinhaDaPlanilha): string {
  switch (l.centro.tipo) {
    case "plano":
      return l.centro.rotulo;
    case "fora_do_dre":
      return "Fora do DRE";
    case "itens_da_fatura":
      return "Itens da fatura";
    default:
      return "Definir na baixa";
  }
}

/**
 * O filtro pelo título de cada coluna (decisão 165), sobre a linha da
 * planilha. Uma função, e não uma constante, porque a coluna do valor da
 * transferência depende da conta; quem usa guarda o resultado num `useMemo`
 * (o hook pede colunas estáveis).
 */
export function colunasFiltraveis(e: {
  contaId: string | null;
  hoje: string;
  rotuloContraparte: string;
  status: boolean;
}): ColunaFiltravel<LinhaDaPlanilha>[] {
  const valorNa = (coluna: "credito" | "debito") => (l: LinhaDaPlanilha) => {
    const c = colunaDoValor(l, e.contaId).coluna;
    return celulaValor(c === coluna || c === "ambas" ? l.valor.conta : null, formatBRL);
  };
  return [
    { chave: "data", rotulo: "Data prevista", tipo: "data", celula: (l) => celulaData(l.pagoEm ?? l.dataPrevista) },
    { chave: "credito", rotulo: "Crédito", tipo: "valor", faixa: true, alinhar: "right", celula: valorNa("credito") },
    { chave: "debito", rotulo: "Débito", tipo: "valor", faixa: true, alinhar: "right", celula: valorNa("debito") },
    { chave: "descricao", rotulo: "Descrição", tipo: "texto", celula: (l) => celulaTexto(l.descricao) },
    { chave: "contraparte", rotulo: e.rotuloContraparte, tipo: "texto", celula: (l) => celulaTexto(l.contraparte) },
    {
      chave: "job",
      rotulo: "Job",
      tipo: "texto",
      celula: (l) =>
        l.job
          ? celulaTexto(l.job.codigo)
          : l.jobsDaFatura.length > 0
            ? l.jobsDaFatura.map((j) => celulaTexto(j))
            : celulaTexto("Não Vinculado"),
    },
    { chave: "centro", rotulo: "Centro de Custo", tipo: "texto", celula: (l) => celulaTexto(rotuloDoCentro(l)) },
    {
      chave: "tri",
      rotulo: "TRI",
      tipo: "texto",
      alinhar: "center",
      celula: (l) => celulaTexto(trimestreDe(dataEfetiva(l, e.hoje))),
    },
    { chave: "empresa", rotulo: "Empresa", tipo: "texto", celula: (l) => celulaTexto(l.empresa ?? "—") },
    {
      chave: "reg",
      rotulo: "REG",
      tipo: "texto",
      celula: (l) => {
        const partes = juntarRateio(l.rateio);
        if (partes.length === 0) return celulaTexto("—");
        return partes.length === 1 ? celulaTexto(siglaDaRegional(partes[0].regional)) : celulaTexto("TD");
      },
    },
    ...(e.status
      ? [
          {
            chave: "status",
            rotulo: "Status",
            tipo: "texto" as const,
            alinhar: "center" as const,
            celula: (l: LinhaDaPlanilha) =>
              celulaTexto(l.situacaoDaVerba ? situacaoVerbaLabel(l.situacaoDaVerba) : ROTULO_DO_STATUS[l.status]),
          },
        ]
      : []),
  ];
}
