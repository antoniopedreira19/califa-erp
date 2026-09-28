/**
 * A escolha da aba na importação (decisão 110, 27/09/2026).
 *
 * Rode com:  node --import tsx --test lib/importacao/abas-do-arquivo.test.ts
 *
 * O caso real: a planilha da Budweiser, exportada do Google Sheets, com a
 * versão atual numa aba visível, as antigas ocultas e uma legenda oculta
 * na frente. O importador lia a primeira aba — a legenda — e recusava tudo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  abaSugerida,
  lerTodasAsAbas,
  motivoDaAbaSemItens,
  ordenarAbas,
  totaisDaAba,
} from "./abas-do-arquivo";
import { parseOficial } from "./parser-oficial";

function abaDeOrcamento(ws: ExcelJS.Worksheet, itens: [string, number][]) {
  ws.addRow(["CATEGORIA", "ITEM", "R$", "QT", "D/M", "TT", ""]);
  for (const [nome, valor] of itens) ws.addRow(["EQUIPE", nome, valor, 1, 1, valor, "B"]);
}

async function arquivo(
  montar: (wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  montar(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("lê todas as abas; a visível vem marcada e na frente, a legenda por último", async () => {
  const buffer = await arquivo((wb) => {
    const legenda = wb.addWorksheet("Classificação de Custos");
    legenda.state = "hidden";
    legenda.addRow(["Classificação de Custos AMBEV:"]);
    const antiga = wb.addWorksheet(" INT BUDWEISER");
    antiga.state = "hidden";
    abaDeOrcamento(antiga, [["Produtor", 6000], ["Editor", 2000]]);
    abaDeOrcamento(wb.addWorksheet("Página9"), [["Produtor", 8000]]);
  });

  const lidas = await lerTodasAsAbas(buffer, {});
  assert.deepEqual(
    lidas.map((a) => [a.nome, a.visivel]),
    [["Classificação de Custos", false], [" INT BUDWEISER", false], ["Página9", true]],
  );

  const resumos = lidas.map((a) => ({
    nome: a.nome,
    visivel: a.visivel,
    legivel: a.parsed.grupos.length > 0,
    ...totaisDaAba(a.parsed),
  }));
  assert.deepEqual(
    ordenarAbas(resumos).map((a) => a.nome),
    ["Página9", " INT BUDWEISER", "Classificação de Custos"],
  );
  assert.equal(abaSugerida(resumos), "Página9");
  assert.equal(resumos[1].orcado, 8000);
  assert.equal(
    motivoDaAbaSemItens(lidas[0].parsed),
    "Sem o cabeçalho do orçamento (CATEGORIA, ITEM, R$).",
  );
});

test("aba chamada Padrão vem marcada mesmo oculta; sem visível legível, vale a primeira oculta", () => {
  assert.equal(
    abaSugerida([
      { nome: "Atual", visivel: true, legivel: true },
      { nome: "Padrão", visivel: false, legivel: true },
    ]),
    "Padrão",
  );
  assert.equal(
    abaSugerida([
      { nome: "Legenda", visivel: true, legivel: false },
      { nome: "V2", visivel: false, legivel: true },
    ]),
    "V2",
  );
  assert.equal(abaSugerida([{ nome: "Legenda", visivel: true, legivel: false }]), null);
});

test("a aba pedida é lida pelo nome exato, com os espaços", async () => {
  const buffer = await arquivo((wb) => {
    abaDeOrcamento(wb.addWorksheet("INT 2026 "), [["Com espaço no fim", 100]]);
    abaDeOrcamento(wb.addWorksheet(" INT 2026"), [["Com espaço no começo", 200]]);
  });
  const fim = await parseOficial(buffer, { aba: "INT 2026 " });
  const comeco = await parseOficial(buffer, { aba: " INT 2026" });
  assert.equal(fim.grupos[0].itens[0].item, "Com espaço no fim");
  assert.equal(comeco.grupos[0].itens[0].item, "Com espaço no começo");

  const sumiu = await parseOficial(buffer, { aba: "Outra" });
  assert.equal(sumiu.grupos.length, 0);
  assert.equal(sumiu.warnings[0].motivo, 'A aba "Outra" não está no arquivo.');
});
