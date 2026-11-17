import ExcelJS from "exceljs";
import { roleLabel } from "@/lib/types";
import type { UsuarioRow } from "./usuarios-lista";

/**
 * Exporta nome, e-mail, papel e status dos usuários em XLSX. Lê as linhas
 * já renderizadas (respeita busca e filtros ativos) e nunca o banco — o
 * arquivo não tem como divergir da tela. Import dinâmico no clique pra não
 * pesar o pacote da página com ExcelJS (`docs/PERFORMANCE.md`).
 */

const STATUS_LABEL: Record<UsuarioRow["acesso"], string> = {
  ativo: "Ativo",
  pendente: "Convite pendente",
  inativo: "Inativo",
};

export async function exportarUsuariosXlsx(rows: UsuarioRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Agência California";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Usuários");

  sheet.columns = [
    { header: "Nome", key: "nome", width: 32 },
    { header: "E-mail", key: "email", width: 36 },
    { header: "Papel", key: "papel", width: 20 },
    { header: "Status", key: "status", width: 18 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  for (const r of rows) {
    sheet.addRow({
      nome: r.nome,
      email: r.email,
      papel: roleLabel(r.role),
      status: STATUS_LABEL[r.acesso],
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `usuarios-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
