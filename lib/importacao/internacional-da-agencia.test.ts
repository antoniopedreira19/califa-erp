/**
 * A planilha interna internacional da agência (16/10/2026).
 *
 * Rode com:  node --import tsx --test lib/importacao/internacional-da-agencia.test.ts
 *
 * O caso real: "_INTERNA - YOUTUBE - Gen AI - MEXICO.xlsx", 4 abas V1–V4.
 *   1. Num orçamento de Evento (nacional) as 4 abas caíam por modelo, e a
 *      tela só dizia "Confira o modelo e envie de novo".
 *   2. O planejado traz H · USD antes do R$ (I · R$, J · QT, K · D/M); com
 *      as colunas fixas H/I/J a V4 saiu com R$ 40,9 milhões de planejado.
 *   3. O FEE é "=G26*13%", e a leitura parava no TOTAL: a versão nasceu com
 *      os 12% do cadastro sem aviso nenhum.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseOficial } from "./parser-oficial";
import { lerTodasAsAbas, mensagemSemAbaLegivel } from "./abas-do-arquivo";
import { montarPreviewDaAba } from "./preview-da-aba";

async function arquivo(montar: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  montar(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A aba como a agência monta: título, cabeçalho com USD no planejado,
 *  itens por fórmula sobre o câmbio da B35 e o fechamento com o FEE. */
function abaDaAgencia(ws: ExcelJS.Worksheet) {
  ws.getCell("A1").value = "Youtube - Mex Gen AI";
  ws.mergeCells("A1:G1");
  ws.getCell("I1").value = "PLANEJADO";
  ws.mergeCells("I1:M1");
  ws.addRow([
    "SHEET", "ITEM", "TT USD", "BRL", "QT", "D/M", "TT BRL",
    "USD", "R$", "QT", "D/M", "TT", "RENTA",
  ]);
  ws.addRow(["ACREDITACIÓN"]);
  // Linha 4: R$ 11,891 × 90 no orçado; R$ 8,789 × 90 × 1 no planejado.
  ws.addRow([
    "ACREDITACIÓN", "Credencial laminada", 2.3,
    { formula: "C4*5.17", result: 11.891 }, 90, 1, { formula: "D4*E4*F4", result: 1070.19 },
    1.7, { formula: "H4*5.17", result: 8.789 }, 90, 1, { formula: "I4*J4*K4", result: 791.01 },
  ]);
  // Linha 5: planejado com QT 2 — a QT tem de vir da J, não da I.
  ws.addRow([
    "ACREDITACIÓN", "Backdrop", 1300,
    { formula: "C5*5.17", result: 6721 }, 1, 1, { formula: "D5*E5*F5", result: 6721 },
    1175, { formula: "H5*5.17", result: 6074.75 }, 2, 1, { formula: "I5*J5*K5", result: 12149.5 },
  ]);
  const total = ws.addRow(["", "", "TOTAL", "", "", null, { formula: "SUM(G3:G5)", result: 7791.19 }]);
  ws.mergeCells(`C${total.number}:E${total.number}`);
  const fee = ws.addRow(["", "", "FEE", "", "", null, { formula: `G${total.number}*13%`, result: 1012.8547 }]);
  ws.mergeCells(`C${fee.number}:E${fee.number}`);
  ws.addRow([]);
  ws.addRow(["COMPRA", 4.97, "", "", "", "18,02%.   =", " IR 17,64%  IOF 0,37%"]);
}

test("agência: o planejado sai das colunas do cabeçalho (I · R$, J · QT, K · D/M)", async () => {
  const parsed = await parseOficial(await arquivo((wb) => abaDaAgencia(wb.addWorksheet("V4"))));
  assert.equal(parsed.modelo, "internacional");
  const itens = parsed.grupos.flatMap((g) => g.itens);
  assert.deepEqual(
    itens.map((i) => [i.item, i.valor_unitario_planejado, i.quantidade_planejada, i.dias_meses_planejado]),
    [
      ["Credencial laminada", 8.789, 90, 1],
      ["Backdrop", 6074.75, 2, 1],
    ],
  );
  // O orçado continua na D/E/F.
  assert.deepEqual(
    itens.map((i) => [i.valor_unitario_orcado, i.quantidade_orcada, i.dias_meses_orcado]),
    [
      [11.891, 90, 1],
      [6721, 1, 1],
    ],
  );
});

test("agência: o % do FEE é lido da fórmula, depois do TOTAL", async () => {
  const parsed = await parseOficial(await arquivo((wb) => abaDaAgencia(wb.addWorksheet("V4"))));
  assert.equal(parsed.percentual_honorarios, 13);
  // O fechamento não vira item, e a linha do câmbio também não.
  assert.equal(parsed.grupos.flatMap((g) => g.itens).length, 2);
});

test("agência: o aviso de honorários do nacional aparece na prévia", async () => {
  const parsed = await parseOficial(await arquivo((wb) => abaDaAgencia(wb.addWorksheet("V4"))));
  const r = montarPreviewDaAba(parsed, {
    modelo: "internacional",
    anterior: null,
    mesesDestino: null,
    honorarios: { percentual: 12, clienteNome: "GOOGLE", versao: "v1" },
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  // A tela compara os dois e mostra "A planilha traz 13% de honorários…".
  assert.equal(r.preview.percentual_honorarios, 13);
  assert.equal(r.preview.percentual_honorarios_cliente, 12);
});

test("interna do ERP: planejado na H e o % do FEE sozinho na E", async () => {
  const parsed = await parseOficial(
    await arquivo((wb) => {
      const ws = wb.addWorksheet("Interna");
      ws.addRow(["SHEET", "ITEM", "TT USD", "BRL", "QT", "D/M", "TT BRL", "R$", "QT", "D/M", "TT", "RENTABILIDADE"]);
      ws.addRow(["EQUIPE", "Diretor", 1000, 5000, 1, 2, 10000, 4000, 1, 2, 8000]);
      ws.addRow(["", "", "TOTAL", "", "", 2000, 10000]);
      const fee = ws.addRow(["", "", "FEE", "", 0.14, 280, 1400]);
      ws.mergeCells(`C${fee.number}:D${fee.number}`);
    }),
  );
  const [item] = parsed.grupos.flatMap((g) => g.itens);
  assert.deepEqual(
    [item.valor_unitario_planejado, item.quantidade_planejada, item.dias_meses_planejado],
    [4000, 1, 2],
  );
  // 0,14 × 100 = 14,000000000000002 no JavaScript: o aviso compararia errado.
  assert.equal(parsed.percentual_honorarios, 14);
});

test("planilha do cliente: H com as marcas continua sem planejado", async () => {
  const parsed = await parseOficial(
    await arquivo((wb) => {
      const ws = wb.addWorksheet("Orçamento");
      ws.addRow(["SHEET", "ITEM", "TT USD", "BRL", "QT", "D/M", "TT BRL"]);
      ws.addRow(["EQUIPE", "Diretor", 1000, 5000, 1, 1, 5000, "grp:g1|it:i1", 0]);
      ws.addRow(["", "", "FEE", "", "", 120, { formula: "G3*12/100", result: 600 }]);
    }),
  );
  const [item] = parsed.grupos.flatMap((g) => g.itens);
  assert.equal(item.item_id, "i1");
  assert.equal(item.valor_unitario_planejado, 0);
  assert.equal(item.quantidade_planejada, 0);
  assert.equal(parsed.percentual_honorarios, null);
});

test("nenhuma aba entra pelo mesmo motivo: a mensagem diz qual", async () => {
  const buffer = await arquivo((wb) => {
    for (const nome of ["V1", "V2", "V3", "V4"]) abaDaAgencia(wb.addWorksheet(nome));
  });
  const lidas = await lerTodasAsAbas(buffer, {});
  const abas = lidas.map((l) => {
    const r = montarPreviewDaAba(l.parsed, { modelo: "nacional", anterior: null, mesesDestino: null, honorarios: null });
    return { motivo: r.ok ? null : r.motivo };
  });
  assert.equal(
    mensagemSemAbaLegivel(abas),
    "Nenhuma das 4 abas do arquivo entra. Esta é uma planilha internacional (SHEET · ITEM · TT USD · BRL · QT · D/M · TT BRL), e o orçamento é nacional. Nada foi importado.",
  );
});

test("mensagem sem aba legível: uma aba, motivos diferentes", () => {
  assert.equal(mensagemSemAbaLegivel([{ motivo: "Sem o cabeçalho do orçamento (CATEGORIA, ITEM, R$)." }]),
    "Sem o cabeçalho do orçamento (CATEGORIA, ITEM, R$).");
  assert.equal(mensagemSemAbaLegivel([{ motivo: null }]), "Nenhum item encontrado na planilha.");
  assert.equal(
    mensagemSemAbaLegivel([{ motivo: "Sem o cabeçalho do orçamento (CATEGORIA, ITEM, R$)." }, { motivo: "Nenhum item no formato do orçamento." }]),
    "Nenhuma das 2 abas do arquivo está no formato do orçamento. Confira o modelo e envie de novo.",
  );
});
