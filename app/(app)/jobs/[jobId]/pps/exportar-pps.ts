import ExcelJS from "exceljs";
import { diaIsoBr } from "@/lib/formatar-data-hora";

/**
 * "Exportar" da aba PPs do job (18/11/2026): a tabela em Excel, cada linha
 * uma parcela (como na tela), uma coluna por informação. Sai exatamente o
 * que o filtro deixa à vista — na ordem da tela, com o mesmo total que
 * aparece embaixo (canceladas já ficaram de fora, decisão 242).
 *
 * Mesmo padrão de "Visualizar Jobs" (exportar-lista.ts, 16/10/2026): o
 * módulo só carrega no clique (import dinâmico), para o ExcelJS não pesar no
 * pacote da página (`docs/PERFORMANCE.md`).
 */

export interface LinhaExportPP {
  /** Código da PP, ex.: "PP-01312". */
  codigo: string;
  /** "1/3" se parcelada; "" quando parcela única. */
  parcela: string;
  /** Bloco do job (grupo). */
  bloco: string;
  /** Item do job (linha da planilha). */
  item: string;
  /** Descrição curta do serviço. */
  servico: string;
  /** Fornecedor ou verba de produção. */
  fornecedor: string;
  /** ISO da data de vencimento, se houver. */
  vencimento: string | null;
  /** ISO da data de pagamento (paga ou programada), se houver. */
  dataPagamento: string | null;
  /** "paga" / "programada" / "" — mesma regra da célula DtPagamento. */
  situacaoPagamento: string;
  /** Em reais (ponto decimal). */
  valor: number;
  /** Rótulo do status (o selo da coluna Status). */
  status: string;
}

const FORMATO_MOEDA = '"R$" #,##0.00;-"R$" #,##0.00';
const FORMATO_DATA = "dd/mm/yyyy";

interface Coluna {
  cabecalho: string;
  largura: number;
}

const COLUNAS: Coluna[] = [
  { cabecalho: "Código", largura: 13 },
  { cabecalho: "Parcela", largura: 9 },
  { cabecalho: "Bloco", largura: 22 },
  { cabecalho: "Item do job", largura: 30 },
  { cabecalho: "Serviço", largura: 32 },
  { cabecalho: "Fornecedor", largura: 32 },
  { cabecalho: "Vencimento", largura: 12 },
  { cabecalho: "Dt. pagamento", largura: 13 },
  { cabecalho: "Situação do pagamento", largura: 14 },
  { cabecalho: "Valor", largura: 15 },
  { cabecalho: "Status", largura: 24 },
];
/** Posição 1-indexada da coluna "Valor" (para a fórmula do total). */
const COL_VALOR = 10;

/** Coluna `date` como data do Excel. UTC: o Excel não tem fuso, e a
 *  meia-noite local viraria o dia anterior em quem abre fora de Brasília. */
function dataDoExcel(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [ano, mes, dia] = diaIsoBr(iso).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Letra da coluna (10 → J). */
function letra(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** "18-11-2026" no fuso de Brasília. */
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

/** Caracteres proibidos em nome de arquivo no Windows e macOS. */
function nomeDeArquivoSeguro(s: string): string {
  return s.replace(/[\\/?%*:|"<>]/g, "-").trim();
}

/**
 * Monta o `.xlsx` e baixa no navegador. `filtrado = true` acrescenta
 * "(filtrado)" ao nome do arquivo, para quem abre depois saber que não é a
 * tabela inteira do job.
 */
export async function baixarPPsEmExcel(
  linhas: readonly LinhaExportPP[],
  opts: { codigoDoJob: string; nomeDoJob: string; filtrado: boolean },
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Califa ERP";
  const ws = wb.addWorksheet("PPs", {
    // Cabeçalho e Código sempre à vista.
    views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
  });

  ws.columns = COLUNAS.map((c) => ({ width: c.largura }));

  const cabecalho = ws.addRow(COLUNAS.map((c) => c.cabecalho));
  cabecalho.font = { bold: true };
  cabecalho.alignment = { vertical: "middle" };
  cabecalho.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F2" } };
  });

  for (const l of linhas) {
    const row = ws.addRow([
      l.codigo,
      l.parcela || null,
      l.bloco || null,
      l.item || null,
      l.servico || null,
      l.fornecedor || null,
      dataDoExcel(l.vencimento),
      dataDoExcel(l.dataPagamento),
      l.situacaoPagamento || null,
      l.valor,
      l.status,
    ]);
    row.getCell(7).numFmt = FORMATO_DATA;
    row.getCell(8).numFmt = FORMATO_DATA;
    row.getCell(COL_VALOR).numFmt = FORMATO_MOEDA;
  }

  const ultima = linhas.length + 1;
  if (linhas.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: ultima, column: COLUNAS.length },
    };

    // Total embaixo, fora do filtro — SUBTOTAL(109) soma só as linhas que o
    // filtro do próprio Excel deixa à vista.
    const total = ws.addRow([]);
    total.getCell(1).value =
      linhas.length === 1 ? "Total (1 linha)" : `Total (${linhas.length} linhas)`;
    const col = letra(COL_VALOR);
    const cell = total.getCell(COL_VALOR);
    cell.value = {
      formula: `SUBTOTAL(109,${col}2:${col}${ultima})`,
      result: linhas.reduce((s, l) => s + l.valor, 0),
    };
    cell.numFmt = FORMATO_MOEDA;
    total.font = { bold: true };
    for (let i = 1; i <= COLUNAS.length; i++) {
      total.getCell(i).border = { top: { style: "thin", color: { argb: "FFBFBFBF" } } };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const nome = nomeDeArquivoSeguro(`${opts.codigoDoJob} - ${opts.nomeDoJob}`);
  a.href = url;
  a.download = `PPs - ${nome}${opts.filtrado ? " (filtrado)" : ""} - ${hojeNoNomeDoArquivo()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O clique já entregou o arquivo ao navegador; a URL pode ir embora depois.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
