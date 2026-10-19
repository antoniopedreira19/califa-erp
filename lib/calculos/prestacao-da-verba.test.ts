/**
 * A regra dos campos da prestação de contas da verba (decisão 189). É a
 * mesma de `_faltas_do_documento_da_prestacao` no banco — os casos daqui
 * foram conferidos contra a função em 19/10/2026.
 * Rodar: node --import tsx --test lib/calculos/prestacao-da-verba.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  faltasDoDocumento,
  formatarCpfCnpj,
  producaoEditaPrestacao,
  rotuloDoBotaoDaPrestacao,
  somaComprovadaEmCentavos,
  type CamposDoDocumento,
} from "./prestacao-da-verba";

const vazio: CamposDoDocumento = {
  documento_tipo: null,
  documento_numero: "",
  documento_data: "",
  valor: null,
  tomador_estabelecimento_id: null,
  emitente_documento: "",
  emitente_nome: "",
  descricao: "",
};

test("sem tipo, falta só o tipo", () => {
  assert.deepEqual(faltasDoDocumento(vazio), ["tipo"]);
});

test("a NF pede número, emissão, valor, tomador e o emitente inteiro", () => {
  assert.deepEqual(faltasDoDocumento({ ...vazio, documento_tipo: "nota_fiscal" }), [
    "numero",
    "data",
    "valor",
    "tomador",
    "emitenteDocumento",
    "emitenteNome",
  ]);
  const completa: CamposDoDocumento = {
    documento_tipo: "nota_fiscal",
    documento_numero: "4521",
    documento_data: "2026-10-15",
    valor: 1180,
    tomador_estabelecimento_id: "ssa",
    emitente_documento: "11.222.333/0001-81",
    emitente_nome: "ZZ Ferragens Teste Ltda",
    descricao: "",
  };
  assert.deepEqual(faltasDoDocumento(completa), []);
  // Número que não identifica a nota (sem letra nem dígito além de zeros).
  assert.deepEqual(faltasDoDocumento({ ...completa, documento_numero: "000" }), ["numero"]);
});

test("o cupom fiscal pede o CNPJ do emitente, e a razão social é opcional", () => {
  assert.deepEqual(
    faltasDoDocumento({
      ...vazio,
      documento_tipo: "cupom_fiscal",
      documento_numero: "--",
      documento_data: "2026-10-01",
      valor: 3,
      emitente_documento: "123",
    }),
    ["emitenteDocumento"],
  );
});

test("o recibo pede data, valor e quem recebeu; o número e o CPF/CNPJ são opcionais", () => {
  assert.deepEqual(
    faltasDoDocumento({ ...vazio, documento_tipo: "recibo", documento_data: "2026-10-01", valor: 3 }),
    ["emitenteNome"],
  );
});

test("boleto e contrato pedem número e data, e não têm valor", () => {
  assert.deepEqual(faltasDoDocumento({ ...vazio, documento_tipo: "boleto" }), ["numero", "data"]);
  assert.deepEqual(
    faltasDoDocumento({ ...vazio, documento_tipo: "contrato", documento_numero: "C-1", documento_data: "2026-10-01" }),
    [],
  );
});

test("o outro pede descrição, data e valor", () => {
  assert.deepEqual(faltasDoDocumento({ ...vazio, documento_tipo: "outro", valor: 5 }), ["descricao", "data"]);
});

test("boleto e contrato não somam no comprovado", () => {
  assert.equal(
    somaComprovadaEmCentavos([
      { documento_tipo: "nota_fiscal", valor: 1180 },
      { documento_tipo: "boleto", valor: 1180 },
      { documento_tipo: "cupom_fiscal", valor: 236.4 },
      { documento_tipo: null, valor: null },
    ]),
    141640,
  );
});

test("a produção mexe desde o envio ao financeiro até mandar a prestação, e de novo se reprovada", () => {
  const base = { verba_producao: true, tipo_verba: "producao", prestacao: null };
  assert.equal(producaoEditaPrestacao({ ...base, status: "gerada" }), false);
  assert.equal(producaoEditaPrestacao({ ...base, status: "em_avaliacao" }), true);
  assert.equal(producaoEditaPrestacao({ ...base, status: "pago" }), true);
  assert.equal(producaoEditaPrestacao({ ...base, status: "pago", prestacao: { status: "rascunho" } }), true);
  assert.equal(producaoEditaPrestacao({ ...base, status: "pago", prestacao: { status: "em_avaliacao" } }), false);
  assert.equal(producaoEditaPrestacao({ ...base, status: "pago", prestacao: { status: "reprovada" } }), true);
  assert.equal(producaoEditaPrestacao({ ...base, status: "pago", prestacao: { status: "aprovada" } }), false);
  assert.equal(producaoEditaPrestacao({ ...base, tipo_verba: "reembolso", status: "pago" }), false);
  assert.equal(producaoEditaPrestacao({ ...base, verba_producao: false, status: "pago" }), false);
});

test("o botão diz em que pé a prestação está", () => {
  assert.equal(rotuloDoBotaoDaPrestacao({ prestacao: null }), "Prestar contas");
  assert.equal(rotuloDoBotaoDaPrestacao({ prestacao: { status: "rascunho", documentos: [] } }), "Prestar contas");
  assert.equal(
    rotuloDoBotaoDaPrestacao({ prestacao: { status: "rascunho", documentos: [{} as never] } }),
    "Continuar prestação",
  );
  assert.equal(rotuloDoBotaoDaPrestacao({ prestacao: { status: "reprovada", documentos: [] } }), "Corrigir prestação");
});

test("CPF e CNPJ formatados; o resto como veio", () => {
  assert.equal(formatarCpfCnpj("11222333000181"), "11.222.333/0001-81");
  assert.equal(formatarCpfCnpj("11144477735"), "111.444.777-35");
  assert.equal(formatarCpfCnpj("123"), "123");
});
