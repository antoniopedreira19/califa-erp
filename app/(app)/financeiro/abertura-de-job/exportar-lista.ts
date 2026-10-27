import ExcelJS from "exceljs";
import { jobStatusExibido, jobStatusLabel } from "@/lib/types";
import type { JobAberto } from "./dados-abertos";
import { SITUACAO_META } from "./situacao-faturamento";
import { diaIsoBr } from "@/lib/formatar-data-hora";

/**
 * "Exportar" das listas Visualizar Jobs e Resultado de Job (pedido do Tiago,
 * 16/10/2026; as duas telas desde a decisão 207): a
 * lista em Excel, um job por linha e cada informação numa coluna — o que
 * na tela divide a mesma célula (nome e nome da produção, valor e situação
 * do faturamento, rentabilidade em R$ e em %) sai em
 * colunas separadas, para filtrar e somar no Excel.
 *
 * Sai o que a tela mostra: os filtros de cima e os dos títulos aplicados,
 * na ordem da arrumação escolhida. Nada é lido de novo do banco — as
 * linhas já estão no navegador, e o arquivo não tem como divergir da
 * tela. Este módulo só é carregado no clique (import dinâmico da lista):
 * o ExcelJS no pacote da página pesaria em toda visita
 * (`docs/PERFORMANCE.md`).
 */

type Tipo = "texto" | "moeda" | "data" | "percentual";

interface Coluna {
  cabecalho: string;
  largura: number;
  tipo: Tipo;
  valor: (j: JobAberto) => string | number | null;
}

const COLUNAS: Coluna[] = [
  { cabecalho: "Código", largura: 13, tipo: "texto", valor: (j) => j.codigo },
  { cabecalho: "Job", largura: 40, tipo: "texto", valor: (j) => j.nome },
  { cabecalho: "Nome na produção", largura: 40, tipo: "texto", valor: (j) => j.nome_producao },
  {
    cabecalho: "Status",
    largura: 22,
    tipo: "texto",
    // O mesmo selo da tela, que lá só aparece quando não é "Aberto".
    valor: (j) => jobStatusLabel(jobStatusExibido(j.status, null, j.cancelamento_pendente)),
  },
  // O projeto do FINANCEIRO, com o da produção de reserva — o mesmo da faixa.
  // Só o nome: a coluna "Código do projeto" saiu com o código das telas
  // (pedido do Tiago, 27/10/2026).
  {
    cabecalho: "Projeto",
    largura: 36,
    tipo: "texto",
    valor: (j) => j.projeto_financeiro_nome ?? j.projeto_nome,
  },
  { cabecalho: "Cliente", largura: 34, tipo: "texto", valor: (j) => j.cliente_nome },
  { cabecalho: "GP responsável", largura: 28, tipo: "texto", valor: (j) => j.responsavel_nome },
  // Regional e Marca são filtros da tela que não viram coluna nela.
  { cabecalho: "Regional", largura: 16, tipo: "texto", valor: (j) => j.regional_nome },
  { cabecalho: "Marca", largura: 30, tipo: "texto", valor: (j) => j.produto },
  // `timestamptz`: o dia de Brasília, não o do ISO cortado.
  {
    cabecalho: "Abertura",
    largura: 12,
    tipo: "data",
    valor: (j) => (j.data_abertura_financeiro ? diaIsoBr(j.data_abertura_financeiro) : null),
  },
  { cabecalho: "Valor do Job", largura: 17, tipo: "moeda", valor: (j) => j.valor_total },
  { cabecalho: "Faturamento", largura: 17, tipo: "moeda", valor: (j) => j.valor_faturamento },
  {
    cabecalho: "Situação do faturamento",
    largura: 22,
    tipo: "texto",
    valor: (j) => SITUACAO_META[j.situacao_faturamento].rotulo,
  },
  { cabecalho: "NF", largura: 10, tipo: "texto", valor: (j) => j.numero_nf },
  {
    cabecalho: "Vencimento em aberto",
    largura: 14,
    tipo: "data",
    valor: (j) => j.vencimento_em_aberto,
  },
  // A Rentabilidade da tela, a mesma do job (decisão 207): Recebimentos e
  // Custos saíram da lista e do arquivo.
  { cabecalho: "Rentabilidade", largura: 17, tipo: "moeda", valor: (j) => j.rentabilidade },
  {
    cabecalho: "Rentabilidade (%)",
    largura: 15,
    tipo: "percentual",
    // O Excel guarda a fração: 0,276 aparece como 27,60%.
    valor: (j) => (j.rentabilidade_pct === null ? null : j.rentabilidade_pct / 100),
  },
];

const FORMATO_MOEDA = '"R$" #,##0.00;-"R$" #,##0.00';
const FORMATO_DATA = "dd/mm/yyyy";
const FORMATO_PERCENTUAL = "0.00%";

/** Coluna `date` como data do Excel. UTC: o Excel não tem fuso, e a meia-noite
 *  local viraria o dia anterior em quem abre fora de Brasília. */
function dataDoExcel(iso: string): Date | null {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Letra da coluna (1 → A, 27 → AA). */
function letra(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** "16-10-2026", no fuso de Brasília — vai no nome do arquivo. */
function hojeNoNomeDoArquivo(): string {
  const [ano, mes, dia] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-");
  return `${dia}-${mes}-${ano}`;
}

/**
 * Monta o `.xlsx` e baixa no navegador. `nome` é o da tela ("Jobs no
 * financeiro", "Resultado de Job"); `filtrado` só acrescenta "(filtrado)" —
 * quem abre depois sabe que não é a lista inteira.
 */
export async function baixarJobsEmExcel(
  linhas: JobAberto[],
  filtrado: boolean,
  nome: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Califa ERP";
  const ws = wb.addWorksheet("Jobs", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = COLUNAS.map((c) => ({ width: c.largura }));

  const cabecalho = ws.addRow(COLUNAS.map((c) => c.cabecalho));
  cabecalho.font = { bold: true };
  cabecalho.alignment = { vertical: "middle" };
  cabecalho.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F2" } };
  });

  for (const j of linhas) {
    const row = ws.addRow(
      COLUNAS.map((c) => {
        const v = c.valor(j);
        if (v === null || v === "") return null;
        if (c.tipo === "data") return typeof v === "string" ? dataDoExcel(v) : null;
        return v;
      }),
    );
    COLUNAS.forEach((c, i) => {
      if (c.tipo === "moeda") row.getCell(i + 1).numFmt = FORMATO_MOEDA;
      if (c.tipo === "data") row.getCell(i + 1).numFmt = FORMATO_DATA;
      if (c.tipo === "percentual") row.getCell(i + 1).numFmt = FORMATO_PERCENTUAL;
    });
  }

  const ultima = linhas.length + 1;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ultima, column: COLUNAS.length } };

  // Total embaixo, fora do filtro. SUBTOTAL(109) soma só as linhas que o
  // filtro do próprio Excel deixa à vista.
  const total = ws.addRow([]);
  total.getCell(1).value = linhas.length === 1 ? "Total (1 job)" : `Total (${linhas.length} jobs)`;
  COLUNAS.forEach((c, i) => {
    if (c.tipo !== "moeda") return;
    const col = letra(i + 1);
    const cell = total.getCell(i + 1);
    cell.value = {
      formula: `SUBTOTAL(109,${col}2:${col}${ultima})`,
      result: linhas.reduce((s, j) => s + Number(c.valor(j) ?? 0), 0),
    };
    cell.numFmt = FORMATO_MOEDA;
  });
  total.font = { bold: true };
  for (let i = 1; i <= COLUNAS.length; i++) {
    total.getCell(i).border = { top: { style: "thin", color: { argb: "FFBFBFBF" } } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}${filtrado ? " (filtrado)" : ""} - ${hojeNoNomeDoArquivo()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O clique já entregou o arquivo ao navegador; a URL pode ir embora depois.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
