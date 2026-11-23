// node --import tsx --test lib/ia/ler-nota-tomada.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { leituraParaGravar, type DadosBrutosNotaTomada } from "./ler-nota-tomada";

const vazia = { aliquota: null, valor: null };
const base: DadosBrutosNotaTomada = {
  numero_nf: "000771",
  cnpj_emissor: "11222333000181",
  valor_total: 3000,
  descricao_servico: "  Locação de   equipamentos de filmagem ",
  cnae: "7739-0/99",
  municipio_prestacao: "São Paulo/SP",
  competencia: "2026-11",
  codigo_verificacao: "ABCD1234",
  retencoes: { iss: { aliquota: 2, valor: 60 }, irrf: { aliquota: 1.5, valor: 45 }, pis: vazia, cofins: vazia, csll: vazia, inss: vazia },
  confianca_baixa: false,
};
const nota = { numero: "771", cnpjEmitente: "11.222.333/0001-81" };

test("monta a leitura e as retenções com valor", () => {
  const r = leituraParaGravar(base, nota);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.leitura.descricao_servico, "Locação de equipamentos de filmagem");
  assert.equal(r.leitura.competencia, "2026-11");
  assert.deepEqual(r.leitura.retencoes, [
    { imposto: "ISS", aliquota: 2, valor: 60 },
    { imposto: "IRRF", aliquota: 1.5, valor: 45 },
  ]);
});

test("recusa o arquivo de outra nota", () => {
  const r = leituraParaGravar({ ...base, numero_nf: "772" }, nota);
  assert.equal(r.ok, false);
});

test("recusa o arquivo de outro emitente", () => {
  const r = leituraParaGravar({ ...base, cnpj_emissor: "00000000000100" }, nota);
  assert.equal(r.ok, false);
});

test("competência fora do formato e alíquota absurda viram nulo", () => {
  const r = leituraParaGravar(
    { ...base, competencia: "11/2026", retencoes: { ...base.retencoes, irrf: { aliquota: 150, valor: 45 } } },
    nota,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.leitura.competencia, null);
  assert.equal(r.leitura.retencoes.find((x) => x.imposto === "IRRF")?.aliquota, null);
});

test("sem número ou CNPJ lidos, não recusa", () => {
  const r = leituraParaGravar({ ...base, numero_nf: null, cnpj_emissor: null }, nota);
  assert.ok(r.ok);
});
