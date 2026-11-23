// node --import tsx --test lib/ia/ler-nota-tomada.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cnaeLido, codigoServicoLido, leituraParaGravar, type DadosBrutosNotaTomada } from "./ler-nota-tomada";

const vazia = { aliquota: null, valor: null };
const base: DadosBrutosNotaTomada = {
  numero_nf: "000771",
  cnpj_emissor: "11222333000181",
  valor_total: 3000,
  descricao_servico: "  Locação de   equipamentos de filmagem ",
  cnae: "7739-0/99",
  codigo_servico: "17.06.01",
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

test("CNAE só no formato de CNAE; o item da LC 116 não é CNAE", () => {
  assert.equal(cnaeLido("7739-0/99"), "7739-0/99");
  assert.equal(cnaeLido("7739099"), "7739-0/99");
  assert.equal(cnaeLido("77.39-0-99"), "7739-0/99");
  assert.equal(cnaeLido("17.06.01 / -"), null);
  assert.equal(cnaeLido("11.04.01 / 099"), null);
  assert.equal(cnaeLido("17.06.01"), null);
  assert.equal(cnaeLido(null), null);
});

test("código do serviço: item da LC 116 com ou sem subitem", () => {
  assert.equal(codigoServicoLido("17.06.01 / -"), "17.06.01");
  assert.equal(codigoServicoLido("11.04.01 / 099"), "11.04.01");
  assert.equal(codigoServicoLido("1.03"), "01.03");
  assert.equal(codigoServicoLido("Código 17.06"), "17.06");
  assert.equal(codigoServicoLido("7739-0/99"), null);
  assert.equal(codigoServicoLido("77.39-0-99"), null);
  assert.equal(codigoServicoLido(null), null);
});

test("o código do serviço posto no CNAE vai para o lugar certo", () => {
  const r = leituraParaGravar({ ...base, cnae: "17.06.01 / -", codigo_servico: null }, nota);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.leitura.cnae, null);
  assert.equal(r.leitura.codigo_servico, "17.06.01");
});

