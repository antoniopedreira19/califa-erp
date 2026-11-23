import ExcelJS from "exceljs";
import { ROTULO_DA_ORIGEM } from "./dados";
import type { NotaEmitida, NotaTomada } from "./dados";
import { linhasDaDivergencia } from "./divergencia";

/**
 * "Exportar Excel" das duas abas de Notas Fiscais (decisão 271): o que a tela mostra, uma
 * nota por linha, cada informação numa coluna (o mesmo gerador de
 * Visualizar Jobs: cabeçalho fixo, filtro do Excel e total com SUBTOTAL).
 * Carregado só no clique (import dinâmico) — o ExcelJS não desce para quem
 * só abre a tela.
 */
type Tipo = "texto" | "moeda" | "data";
interface Coluna<L> {
  cabecalho: string;
  largura: number;
  tipo: Tipo;
  valor: (l: L) => string | number | null;
}

const RECEBIMENTO = { recebida: "Recebida", parcial: "Parcial", a_receber: "A receber", vencida: "Vencida", cancelada: "Cancelada", sem_registro: "Sem registro" } as const;
const ORIGEM = { job: "Job", bv: "BV", save: "Save", avulso: "Avulso", historico: "Histórico" } as const;
const SITUACAO = { registrada: "Registrada", em_avaliacao: "Em avaliação", sem_pp: "Sem documento ativo" } as const;
const PAGAMENTO = { paga: "Paga", parcial: "Parcial", a_pagar: "A pagar", sem_pagamento: "" } as const;

const EMITIDAS: Coluna<NotaEmitida>[] = [
  { cabecalho: "NF", largura: 10, tipo: "texto", valor: (n) => n.numero_nf },
  { cabecalho: "Emissão", largura: 12, tipo: "data", valor: (n) => n.data_emissao },
  { cabecalho: "CNPJ emissor", largura: 26, tipo: "texto", valor: (n) => n.emissor?.nome ?? null },
  { cabecalho: "CNPJ", largura: 20, tipo: "texto", valor: (n) => n.emissor?.cnpj ?? null },
  { cabecalho: "Tomador", largura: 36, tipo: "texto", valor: (n) => n.contraparte_nome },
  { cabecalho: "CNPJ do tomador", largura: 20, tipo: "texto", valor: (n) => n.tomador_documento },
  { cabecalho: "Origem", largura: 14, tipo: "texto", valor: (n) => n.origens.map((o) => ORIGEM[o]).join(", ") },
  { cabecalho: "Job", largura: 40, tipo: "texto", valor: (n) => n.jobs.map((j) => j.nome).join("; ") || (n.classe ?? null) },
  { cabecalho: "Código do job", largura: 16, tipo: "texto", valor: (n) => n.jobs.map((j) => j.codigo).filter(Boolean).join(", ") },
  { cabecalho: "CNAE", largura: 30, tipo: "texto", valor: (n) => n.cnae },
  { cabecalho: "Série", largura: 8, tipo: "texto", valor: (n) => n.serie },
  { cabecalho: "Valor", largura: 16, tipo: "moeda", valor: (n) => (n.status === "cancelado" ? 0 : n.valor_total) },
  { cabecalho: "Retido pelo cliente", largura: 16, tipo: "moeda", valor: (n) => n.retido },
  { cabecalho: "Recebido", largura: 16, tipo: "moeda", valor: (n) => n.recebimentoNaLista.recebido },
  { cabecalho: "A receber", largura: 16, tipo: "moeda", valor: (n) => n.recebimentoNaLista.aberto },
  { cabecalho: "Recebimento", largura: 14, tipo: "texto", valor: (n) => RECEBIMENTO[n.recebimentoNaLista.situacao] },
  { cabecalho: "Situação", largura: 12, tipo: "texto", valor: (n) => (n.status === "cancelado" ? "Cancelada" : "Emitida") },
  { cabecalho: "Valor cancelado", largura: 16, tipo: "moeda", valor: (n) => (n.status === "cancelado" ? n.valor_total : null) },
];

const TOMADAS: Coluna<NotaTomada>[] = [
  { cabecalho: "NF", largura: 10, tipo: "texto", valor: (n) => n.numero },
  { cabecalho: "Emissão", largura: 12, tipo: "data", valor: (n) => n.data_emissao },
  { cabecalho: "Emitente", largura: 36, tipo: "texto", valor: (n) => n.fornecedor.razao_social ?? n.fornecedor.nome },
  { cabecalho: "CNPJ do emitente", largura: 20, tipo: "texto", valor: (n) => n.fornecedor.documento },
  { cabecalho: "CNAE", largura: 14, tipo: "texto", valor: (n) => n.leitura.cnae ?? n.leitura.cnaeDoCadastro },
  { cabecalho: "Código do serviço", largura: 14, tipo: "texto", valor: (n) => n.leitura.codigoServico },
  { cabecalho: "PDF diferente do registro", largura: 40, tipo: "texto", valor: (n) => linhasDaDivergencia(n).join(" | ") },
  { cabecalho: "CNPJ tomador", largura: 26, tipo: "texto", valor: (n) => n.tomador?.nome ?? null },
  { cabecalho: "CNPJ", largura: 20, tipo: "texto", valor: (n) => n.tomador?.cnpj ?? null },
  { cabecalho: "Origem", largura: 22, tipo: "texto", valor: (n) => [...new Set(n.documentos.map((d) => ROTULO_DA_ORIGEM[d.origem]))].join(", ") },
  { cabecalho: "Documentos", largura: 26, tipo: "texto", valor: (n) => n.documentos.map((d) => d.codigo).join(", ") },
  { cabecalho: "Jobs", largura: 22, tipo: "texto", valor: (n) => [...new Set(n.documentos.map((d) => d.job?.codigo).filter(Boolean))].join(", ") },
  { cabecalho: "Valor da NF", largura: 16, tipo: "moeda", valor: (n) => n.valor },
  { cabecalho: "Lançado nos documentos", largura: 18, tipo: "moeda", valor: (n) => n.nasDocumentos },
  { cabecalho: "Retido (destacado na NF)", largura: 18, tipo: "moeda", valor: (n) => n.leitura.retido },
  { cabecalho: "Situação", largura: 14, tipo: "texto", valor: (n) => SITUACAO[n.situacao] },
  { cabecalho: "Registrada em", largura: 13, tipo: "data", valor: (n) => n.registrada_em },
  { cabecalho: "Pagamento", largura: 12, tipo: "texto", valor: (n) => PAGAMENTO[n.pagamento.situacao] },
  { cabecalho: "Pago", largura: 16, tipo: "moeda", valor: (n) => n.pagamento.pago },
  { cabecalho: "A pagar", largura: 16, tipo: "moeda", valor: (n) => n.pagamento.aPagar },
  { cabecalho: "Crédito PIS/COFINS retirado", largura: 22, tipo: "texto", valor: (n) => (n.credito_retirado ? n.credito_motivo ?? "Sim" : "") },
];

const FORMATO_MOEDA = '"R$" #,##0.00;-"R$" #,##0.00';
const FORMATO_DATA = "dd/mm/yyyy";

function dataDoExcel(iso: string): Date | null {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(Date.UTC(ano, mes - 1, dia));
}
function letra(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const hojeNoArquivo = () => new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(/\//g, "-");

export async function baixarNotasEmExcel(
  aba: "emitidas" | "tomadas",
  linhas: Array<NotaEmitida | NotaTomada>,
  filtrado: boolean,
): Promise<void> {
  const colunas = (aba === "emitidas" ? EMITIDAS : TOMADAS) as Coluna<any>[];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Califa ERP";
  const ws = wb.addWorksheet(aba === "emitidas" ? "NFs emitidas" : "NFs tomadas", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = colunas.map((c) => ({ width: c.largura }));
  const cabecalho = ws.addRow(colunas.map((c) => c.cabecalho));
  cabecalho.font = { bold: true };
  cabecalho.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F2" } };
  });
  for (const l of linhas) {
    const row = ws.addRow(
      colunas.map((c) => {
        const v = c.valor(l);
        if (v === null || v === "") return null;
        if (c.tipo === "data") return typeof v === "string" ? dataDoExcel(v) : null;
        return v;
      }),
    );
    colunas.forEach((c, i) => {
      if (c.tipo === "moeda") row.getCell(i + 1).numFmt = FORMATO_MOEDA;
      if (c.tipo === "data") row.getCell(i + 1).numFmt = FORMATO_DATA;
    });
  }
  const ultima = linhas.length + 1;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ultima, column: colunas.length } };
  const total = ws.addRow([]);
  total.getCell(1).value = linhas.length === 1 ? "Total (1 nota)" : `Total (${linhas.length} notas)`;
  colunas.forEach((c, i) => {
    if (c.tipo !== "moeda") return;
    const col = letra(i + 1);
    const cell = total.getCell(i + 1);
    cell.value = { formula: `SUBTOTAL(109,${col}2:${col}${ultima})`, result: linhas.reduce((s, l) => s + Number(c.valor(l) ?? 0), 0) };
    cell.numFmt = FORMATO_MOEDA;
  });
  total.font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `NFs ${aba} ${hojeNoArquivo()}${filtrado ? " (filtrado)" : ""}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
