/**
 * Dias/meses zero no orçado (decisão 109, 27/09/2026).
 *
 * Rode com:  node --import tsx --test lib/importacao/dias-meses-zero.test.ts
 *
 * Como a quantidade (decisão 078), o D/M zero entra como zero: a
 * importação não emenda a planilha. Até 27/09 ele virava 1 com aviso, e o
 * "Motion (Bonificado 100%)" da planilha da Budweiser (R$ 3.000 × 1 × 0)
 * entrava cobrado — o ERP somava R$ 3.000 a mais que o TOTAL da planilha.
 * Vazio ou ilegível continua virando 1; só o negativo vira 1 com aviso.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseOficial } from "./parser-oficial";

async function buffer(montar: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  montar(wb.addWorksheet("Padrão"));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("nacional: D/M 0 fica 0, sem aviso; vazio vira 1; negativo vira 1 com aviso", async () => {
  const parsed = await parseOficial(
    await buffer((ws) => {
      ws.addRow(["CATEGORIA", "ITEM", "R$", "QT", "D/M", "TT", ""]);
      ws.addRow(["EQUIPE INTERNA", "Motion (Bonificado 100%)", 3000, 1, 0, 0, "B"]);
      ws.addRow(["EQUIPE INTERNA", "Social Media", 5000, 1, null, 5000, "B"]);
      ws.addRow(["EQUIPE INTERNA", "Editor", 2000, 1, -2, 2000, "B"]);
      ws.addRow(["EQUIPE INTERNA", "Diretor", 1000, 0, 0, 0, "B"]);
    }),
  );

  const itens = parsed.grupos.flatMap((g) => g.itens);
  const dm = (nome: string) => itens.find((i) => i.item === nome)?.dias_meses_orcado;
  assert.equal(dm("Motion (Bonificado 100%)"), 0);
  assert.equal(dm("Social Media"), 1);
  assert.equal(dm("Editor"), 1);
  assert.equal(dm("Diretor"), 0);
  assert.equal(itens.find((i) => i.item === "Diretor")?.quantidade_orcada, 0);

  const avisosDeDm = parsed.warnings.filter((w) => w.coluna === "E");
  assert.deepEqual(
    avisosDeDm.map((w) => w.motivo),
    ["Dias/meses negativo (-2) — assumido 1."],
  );
});

test("internacional: D/M 0 fica 0; negativo vira 1 com aviso", async () => {
  const parsed = await parseOficial(
    await buffer((ws) => {
      ws.addRow(["SHEET", "ITEM", "TT USD", "BRL", "QT", "D/M", "TT BRL"]);
      ws.addRow(["Equipe", "Diretor", 0, 5000, 1, 0, 0]);
      ws.addRow(["Equipe", "Produtor", 0, 3000, 1, -1, 3000]);
    }),
  );

  assert.equal(parsed.modelo, "internacional");
  const itens = parsed.grupos.flatMap((g) => g.itens);
  assert.equal(itens.find((i) => i.item === "Diretor")?.dias_meses_orcado, 0);
  assert.equal(itens.find((i) => i.item === "Produtor")?.dias_meses_orcado, 1);
  assert.deepEqual(
    parsed.warnings.filter((w) => w.coluna === "F").map((w) => w.motivo),
    ["Dias/meses negativo (-1) — assumido 1."],
  );
});
