import ExcelJS from "exceljs";
import { jobStatusLabel } from "@/lib/types";
import type { JobRow } from "./jobs-list";

/**
 * Exporta a lista de jobs em XLSX, na mesma ordem e com os mesmos filtros
 * que a tela mostrou. Lê as linhas já renderizadas (nunca o banco) pra
 * garantir que arquivo e tela não divergem. Import dinâmico no clique pra
 * não pesar o pacote da página com ExcelJS (`docs/PERFORMANCE.md`).
 */

function formatarData(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export async function exportarJobsXlsx(rows: JobRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Agência California";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Jobs");

  sheet.columns = [
    { header: "Código", key: "codigo", width: 14 },
    { header: "Projeto", key: "projeto", width: 32 },
    { header: "Nome", key: "nome", width: 40 },
    { header: "Empresa", key: "empresa", width: 20 },
    { header: "Marca", key: "marca", width: 18 },
    { header: "Regional", key: "regional", width: 14 },
    { header: "Cliente", key: "cliente", width: 24 },
    { header: "Responsável", key: "responsavel", width: 22 },
    { header: "Início", key: "inicio", width: 12 },
    { header: "Valor total", key: "valor_total", width: 16 },
    { header: "Status", key: "status", width: 22 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  for (const r of rows) {
    const linha = sheet.addRow({
      codigo: r.codigo,
      projeto: r.projeto_nome ?? "",
      nome: r.nome,
      empresa: r.empresa_nome ?? "",
      marca: r.produto ?? "",
      regional: r.regional_nome ?? "",
      cliente: r.cliente_nome ?? "",
      responsavel: r.responsavel_nome ?? "",
      inicio: formatarData(r.data_inicio_prevista),
      valor_total: r.valor_total ?? null,
      status: jobStatusLabel(r.status),
    });
    linha.getCell("valor_total").numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `jobs-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
