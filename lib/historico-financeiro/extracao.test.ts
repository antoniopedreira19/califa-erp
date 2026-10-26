/**
 * Testes da E1 do histórico financeiro (decisão 211): o CSV e a leitura do
 * XML das abas do .xlsx. Dados fictícios, montados à mão no formato que o
 * Google Sheets exporta.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/extracao.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOM, indiceDaColuna, lerCsv, letrasDaColuna, linhaCsv } from "./csv";
import {
  abasDoWorkbook,
  celulasDaLinha,
  decodificarXml,
  estilosDeData,
  formatoEhData,
  serialParaData,
  textosCompartilhados,
} from "./xlsx-em-fluxo";

test("CSV: aspas só quando o campo pede, e a leitura devolve o mesmo texto", () => {
  const campos = ["simples", "com, vírgula", 'com "aspas"', "duas\nlinhas", "", "Descrição"];
  const linha = linhaCsv(campos);
  assert.equal(linha, 'simples,"com, vírgula","com ""aspas""","duas\nlinhas",,Descrição\n');
  assert.deepEqual(lerCsv(BOM + linha + linhaCsv(["a", "b"])), [campos, ["a", "b"]]);
});

test("CSV: aceita CRLF e última linha sem quebra", () => {
  assert.deepEqual(lerCsv("a,b\r\nc,d"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("colunas: letras ↔ índice", () => {
  assert.equal(indiceDaColuna("A1"), 1);
  assert.equal(indiceDaColuna("Z9"), 26);
  assert.equal(indiceDaColuna("AA10"), 27);
  assert.equal(indiceDaColuna("AN59840"), 40);
  assert.equal(letrasDaColuna(1), "A");
  assert.equal(letrasDaColuna(27), "AA");
  assert.equal(letrasDaColuna(40), "AN");
});

test("XML: entidades e caracteres numéricos", () => {
  assert.equal(decodificarXml("A &amp; B &lt;1&gt; &quot;x&quot; &#10;&#xE9;"), 'A & B <1> "x" \né');
});

test("workbook: ordem, nome, aba oculta e caminho da entrada", () => {
  const workbook =
    '<workbook><sheets><sheet state="visible" name="Conta Exemplo" sheetId="1" r:id="rId4"/>' +
    '<sheet state="hidden" name="Res. Jobs 2020" sheetId="2" r:id="rId5"/></sheets></workbook>';
  const rels =
    '<Relationships><Relationship Id="rId4" Type="x" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId5" Type="x" Target="worksheets/sheet2.xml"/></Relationships>';
  assert.deepEqual(abasDoWorkbook(workbook, rels), [
    { ordem: 1, nome: "Conta Exemplo", oculta: false, entrada: "xl/worksheets/sheet1.xml" },
    { ordem: 2, nome: "Res. Jobs 2020", oculta: true, entrada: "xl/worksheets/sheet2.xml" },
  ]);
});

test("textos compartilhados: texto simples, rico e vazio", () => {
  const xml =
    '<sst><si><t>Data</t></si><si><r><t>FORNECEDOR </t></r><r><rPr/><t xml:space="preserve">001 EXEMPLO</t></r></si>' +
    "<si><t/></si><si><t>P&amp;D</t></si></sst>";
  assert.deepEqual(textosCompartilhados(xml), ["Data", "FORNECEDOR 001 EXEMPLO", "", "P&D"]);
});

test("formato de data: embutidos e códigos do Google", () => {
  assert.equal(formatoEhData(14, undefined), true);
  assert.equal(formatoEhData(0, undefined), false);
  assert.equal(formatoEhData(164, "dd/mm/yyyy"), true);
  assert.equal(formatoEhData(165, '"R$"\\ #,##0.00'), false);
  assert.equal(formatoEhData(166, "[$-416]mmmm"), true);
  assert.equal(formatoEhData(167, "h:mm"), true);
  assert.equal(formatoEhData(168, "0.00%"), false);
  assert.equal(formatoEhData(169, "General"), false);
});

test("estilos: só o bloco cellXfs conta, na ordem", () => {
  const xml =
    '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
    '<cellStyleXfs count="1"><xf numFmtId="164"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"><alignment/></xf><xf numFmtId="4"/></cellXfs></styleSheet>';
  assert.deepEqual(estilosDeData(xml), [false, true, false]);
});

test("série do Excel → data ISO, com hora quando houver", () => {
  assert.equal(serialParaData(46086), "2026-03-05");
  assert.equal(serialParaData(45951.5), "2025-10-21 12:00:00");
});

test("linha: texto compartilhado, número, data, erro de fórmula, fórmula de texto e célula vazia", () => {
  const contexto = { textos: ["Recebimento", "CO 1T 2026"], estiloEhData: [false, true] };
  const xml =
    '<row r="7"><c r="A7" s="1"><v>46086</v></c><c r="B7"><f>460+219.7</f><v>679.7</v></c>' +
    '<c r="C7" t="s"><v>0</v></c><c r="E7" t="e"><f>SUM(#REF!)</f><v>#REF!</v></c>' +
    '<c r="F7" t="str"><f>A1&amp;B1</f><v>x &amp; y</v></c><c r="G7" s="1"/><c r="J7" t="s"><v>1</v></c></row>';
  const linha = celulasDaLinha(xml, contexto);
  assert.equal(linha.numero, 7);
  assert.equal(linha.formulas, 3);
  assert.deepEqual(Object.fromEntries(linha.celulas), {
    1: "2026-03-05",
    2: "679.7",
    3: "Recebimento",
    5: "#REF!",
    6: "x & y",
    10: "CO 1T 2026",
  });
  assert.deepEqual(Object.fromEntries(linha.textosDasFormulas), { 2: "460+219.7", 5: "SUM(#REF!)", 6: "A1&B1" });
});

test("fórmula compartilhada: a primeira traz o texto, as seguintes não", () => {
  const contexto = { textos: [], estiloEhData: [false] };
  const xml =
    '<row r="3"><c r="D3"><f t="shared" ref="D3:D5" si="1">D2+B3-C3</f><v>150</v></c>' +
    '<c r="E3"><f t="shared" si="1"/><v>10</v></c></row>';
  const linha = celulasDaLinha(xml, contexto);
  assert.equal(linha.formulas, 2);
  assert.deepEqual(Object.fromEntries(linha.textosDasFormulas), { 4: "D2+B3-C3" });
});
