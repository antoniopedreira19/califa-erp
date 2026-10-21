import ExcelJS from "exceljs";
import type { TipoContratacao } from "@/lib/types";

export interface LinhaExport {
  snapshot_nome: string;
  snapshot_empresa_nome: string | null;
  snapshot_tipo_contratacao: TipoContratacao;
  snapshot_data_admissao: string;
  snapshot_salario: number;
  avos: number;
  total_adiantado: number;
  primeira_parcela: number;
  segunda_parcela: number;
  desconto_inss: number;
  desconto_irrf: number;
  total_liquido: number;
  obs: string | null;
}

function tipoLabel(tipo: TipoContratacao): string {
  switch (tipo) {
    case "clt":
      return "CLT";
    case "clt_recibo":
      return "Híbrido";
    case "pj":
      return "PJ";
    case "mei":
      return "MEI";
    case "estagio":
      return "Estágio";
    case "socio":
      return "Sócio";
    default:
      return tipo;
  }
}

function parseData(iso: string): Date {
  // "YYYY-MM-DD" → Date em UTC pra ExcelJS gravar como dd/mm/yyyy limpo.
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(ano!, mes! - 1, dia!));
}

const BRL = '"R$ "#,##0.00';
const DATA = "dd/mm/yyyy";

interface AbaConfig {
  nome: string;
  linhas: LinhaExport[];
  comDescontos: boolean;
}

function adicionarAba(wb: ExcelJS.Workbook, cfg: AbaConfig): void {
  const ws = wb.addWorksheet(cfg.nome);

  const headerBase = [
    "#",
    "Nome Completo",
    "Empresa",
    "Tipo de Contratação",
    "Data de Início",
    "Salário",
    "Meses",
    "Total Adiantado",
    "1ª parc 30/11 (sem desconto)",
  ];
  const headerDescontos = cfg.comDescontos
    ? ["Desconto INSS", "Desconto IRRF"]
    : [];
  const headerFim = [
    "2ª parc 20/12 (líquida)",
    "Total líquido do 13º",
    "Obs.",
  ];
  const header = [...headerBase, ...headerDescontos, ...headerFim];

  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  cfg.linhas.forEach((l, idx) => {
    const segundaLiquida = l.segunda_parcela - l.desconto_inss - l.desconto_irrf;
    const base = [
      idx + 1,
      l.snapshot_nome,
      l.snapshot_empresa_nome ?? "",
      tipoLabel(l.snapshot_tipo_contratacao),
      parseData(l.snapshot_data_admissao),
      l.snapshot_salario,
      l.avos,
      l.total_adiantado,
      l.primeira_parcela,
    ];
    const descontos = cfg.comDescontos
      ? [l.desconto_inss, l.desconto_irrf]
      : [];
    const fim = [segundaLiquida, l.total_liquido, l.obs ?? ""];
    ws.addRow([...base, ...descontos, ...fim]);
  });

  // Linha de totais
  if (cfg.linhas.length > 0) {
    const totalRow: (string | number)[] = ["", "TOTAL", "", "", "", 0, "", 0, 0];
    const idxSalario = 5;
    const idxTotalAdiantado = 7;
    const idxPrimeira = 8;
    const totalSalario = cfg.linhas.reduce((a, l) => a + l.snapshot_salario, 0);
    const totalAdiantado = cfg.linhas.reduce((a, l) => a + l.total_adiantado, 0);
    const total1a = cfg.linhas.reduce((a, l) => a + l.primeira_parcela, 0);
    const total2aLiq = cfg.linhas.reduce(
      (a, l) => a + (l.segunda_parcela - l.desconto_inss - l.desconto_irrf),
      0,
    );
    totalRow[idxSalario] = totalSalario;
    totalRow[idxTotalAdiantado] = totalAdiantado;
    totalRow[idxPrimeira] = total1a;
    if (cfg.comDescontos) {
      const totalInss = cfg.linhas.reduce((a, l) => a + l.desconto_inss, 0);
      const totalIrrf = cfg.linhas.reduce((a, l) => a + l.desconto_irrf, 0);
      totalRow.push(totalInss, totalIrrf);
    }
    const totalLiquido = cfg.linhas.reduce((a, l) => a + l.total_liquido, 0);
    totalRow.push(total2aLiq, totalLiquido, "");
    const addedTotal = ws.addRow(totalRow);
    addedTotal.font = { bold: true };
  }

  // Formatação de colunas
  ws.getColumn(5).numFmt = DATA; // Data de Início
  ws.getColumn(5).width = 12;
  ws.getColumn(6).numFmt = BRL; // Salário
  ws.getColumn(6).width = 14;
  ws.getColumn(8).numFmt = BRL; // Total Adiantado
  ws.getColumn(8).width = 14;
  ws.getColumn(9).numFmt = BRL; // 1ª parc
  ws.getColumn(9).width = 16;
  if (cfg.comDescontos) {
    ws.getColumn(10).numFmt = BRL; // INSS
    ws.getColumn(10).width = 14;
    ws.getColumn(11).numFmt = BRL; // IRRF
    ws.getColumn(11).width = 14;
    ws.getColumn(12).numFmt = BRL; // 2ª parc líquida
    ws.getColumn(12).width = 16;
    ws.getColumn(13).numFmt = BRL; // Total líquido
    ws.getColumn(13).width = 18;
  } else {
    ws.getColumn(10).numFmt = BRL; // 2ª parc líquida
    ws.getColumn(10).width = 16;
    ws.getColumn(11).numFmt = BRL; // Total líquido
    ws.getColumn(11).width = 18;
  }

  ws.getColumn(1).width = 5; // #
  ws.getColumn(2).width = 32; // Nome
  ws.getColumn(3).width = 20; // Empresa
  ws.getColumn(4).width = 14; // Tipo
  ws.getColumn(7).width = 7; // Meses
}

/**
 * Gera o XLSX da folha de 13º no formato equivalente à planilha original
 * (duas abas: CLT e PJ). PJ e MEI entram na aba PJ e sem colunas de
 * desconto (não têm INSS/IRRF).
 */
export async function gerarXlsxFolhaDecimoTerceiro(
  ano: number,
  linhas: LinhaExport[],
): Promise<Buffer> {
  const linhasCLT = linhas.filter(
    (l) =>
      l.snapshot_tipo_contratacao === "clt" ||
      l.snapshot_tipo_contratacao === "clt_recibo",
  );
  const linhasPJ = linhas.filter(
    (l) =>
      l.snapshot_tipo_contratacao === "pj" ||
      l.snapshot_tipo_contratacao === "mei",
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "califa-erp";
  wb.created = new Date();
  wb.description = `Folha de 13º Salário de ${ano}`;

  adicionarAba(wb, { nome: "CLT", linhas: linhasCLT, comDescontos: true });
  adicionarAba(wb, { nome: "PJ", linhas: linhasPJ, comDescontos: false });

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
