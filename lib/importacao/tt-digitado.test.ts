/**
 * O aviso do TT que não bate com R$ × QT × D/M (08/10/2026).
 *
 * Rode com:  node --import tsx --test lib/importacao/tt-digitado.test.ts
 *
 * O caso que motivou: a aba SUL da Ânima com "Social Media Unicuritiba" em
 * QT 0 e o TT digitado à mão (R$ 7.000,00). O ERP grava a conta — R$ 0 — e o
 * orçado da versão ficava R$ 7.000,00 abaixo da planilha sem aviso nenhum.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseOficial } from "./parser-oficial";
import { mesesDaAbaParaGravar } from "./meses-da-planilha";

async function buffer(montar: (ws: ExcelJS.Worksheet) => void, aba = "Padrão"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  montar(wb.addWorksheet(aba));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const avisosDeTt = <T extends { motivo: string }>(w: T[]): T[] =>
  w.filter((x) => /R\$ × QT × D\/M/.test(x.motivo));

test("nacional: TT digitado diferente da conta avisa no orçado e no planejado", async () => {
  const parsed = await parseOficial(
    await buffer((ws) => {
      ws.addRow(["CATEGORIA", "ITEM", "R$", "QT", "D/M", "TT", "", "R$", "QT", "D/M", "TT"]);
      // QT 0 com o TT digitado: a conta dá zero.
      ws.addRow(["Equipe", "Social Media", 7000, 0, 1, 7000, "B", 5000, 1, 1, 5000]);
      // TT por fórmula, igual à conta; o planejado digitado não bate.
      ws.addRow(["Equipe", "Editor", 1000, 2, 1, { formula: "C3*D3*E3", result: 2000 }, "B", 800, 2, 1, 1000]);
      // TT vazio não se confere.
      ws.addRow(["Equipe", "Produtor", 3000, 1, 1, null, "B", 2000, 1, 1, null]);
    }),
  );
  const itens = parsed.grupos.flatMap((g) => g.itens);
  // A linha continua entrando com a conta.
  assert.equal(itens.find((i) => i.item === "Social Media")?.quantidade_orcada, 0);
  assert.deepEqual(
    avisosDeTt(parsed.warnings).map((w) => [w.linha, w.coluna, w.severidade, w.motivo.replace(/\s/g, " ")]),
    [
      [2, "F", "ajuste", "O TT da planilha é R$ 7.000,00, mas R$ × QT × D/M dá R$ 0,00 — a linha entra com a conta."],
      [3, "K", "ajuste", "O TT planejado da planilha é R$ 1.000,00, mas R$ × QT × D/M dá R$ 1.600,00 — a linha entra com a conta."],
    ],
  );
});

test("internacional: o TT BRL é conferido", async () => {
  const parsed = await parseOficial(
    await buffer((ws) => {
      ws.addRow(["SHEET", "ITEM", "TT USD", "BRL", "QT", "D/M", "TT BRL"]);
      ws.addRow(["Equipe", "Diretor", 0, 5000, 2, 1, 5000]);
      ws.addRow(["Equipe", "Produtor", 0, 3000, 1, 1, 3000]);
    }),
  );
  assert.deepEqual(
    avisosDeTt(parsed.warnings).map((w) => [w.linha, w.coluna]),
    [[2, "G"]],
  );
});

test("Interno: o planejado não é conferido (ele é o orçado)", async () => {
  const parsed = await parseOficial(
    await buffer((ws) => {
      ws.addRow(["CATEGORIA", "ITEM", "R$", "QT", "D/M", "TT", "", "R$", "QT", "D/M", "TT"]);
      ws.addRow(["Equipe", "Editor", 1000, 1, 1, 1000, "B", 800, 1, 1, 999]);
    }),
    { tipoFixo: "FI" },
  );
  assert.deepEqual(avisosDeTt(parsed.warnings), []);
});

/** Planilha interna com o mesmo item em três meses: QT 0 e TT digitado. */
async function internaComTtDigitado(): Promise<Buffer> {
  return buffer((ws) => {
    let n = 1;
    const linha = (cells: Record<string, unknown>) => {
      for (const [col, v] of Object.entries(cells)) ws.getCell(`${col}${n}`).value = v as any;
      n++;
    };
    for (const mes of ["SETEMBRO", "OUTUBRO", "NOVEMBRO"]) {
      linha({ A: "On Going", B: mes, H: "FATURAMENTO" });
      linha({ A: "PLANILHA", B: "ITEM", F: "R$", G: "QT", H: "DIAS", I: "TT", K: "R$", L: "QT", M: "DIAS", N: "TT" });
      linha({ A: "EQUIPE", B: "Social Media Unicuritiba", F: 7000, G: 0, H: 1, I: 7000, J: "B", K: 5000, L: 1, M: 1, N: 5000 });
      linha({ A: "EQUIPE", B: "Editores", F: 20000, G: 1, H: 1, I: { formula: `F${n}*G${n}*H${n}`, result: 20000 }, J: "B", K: 5000, L: 1, M: 1, N: 5000 });
      linha({ F: "SUB-TOTAL B", I: 27000, J: "B" });
      linha({ B: 60000, F: "HONORÁRIOS", I: { formula: "I5*13%", result: 3510 } });
      linha({ F: "FATURAMENTO", I: 1 });
    }
  }, "SUL");
}

test("mensal: avisa o TT digitado só nos meses que entram na versão", async () => {
  const parsed = await parseOficial(await internaComTtDigitado(), { mensal: true });
  // A leitura da aba avisa nos três blocos (L3, L10, L17), coluna I.
  assert.deepEqual(
    avisosDeTt(parsed.warnings).map((w) => [w.linha, w.coluna]),
    [
      [3, "I"],
      [10, "I"],
      [17, "I"],
    ],
  );
  // Num orçamento de outubro e novembro, o de setembro fica de fora.
  const r = mesesDaAbaParaGravar(parsed, ["2026-10-01", "2026-11-01"], null);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(
      avisosDeTt(r.parsed.warnings).map((w) => w.linha),
      [10, 17],
    );
    // E o orçado entra com a conta: R$ 20.000,00 por mês.
    const orcado = r.parsed.grupos
      .flatMap((g) => g.itens)
      .reduce((s, i) => s + i.valor_unitario_orcado * i.quantidade_orcada * i.dias_meses_orcado, 0);
    assert.equal(orcado, 40000);
  }
});
