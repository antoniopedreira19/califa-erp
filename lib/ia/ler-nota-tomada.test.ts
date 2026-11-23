// node --import tsx --test lib/ia/ler-nota-tomada.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveDoNumero, cnaeLido, codigoServicoLido, leituraParaGravar, type DadosBrutosNotaTomada } from "./ler-nota-tomada";

const vazia = { aliquota: null, valor: null };
const base: DadosBrutosNotaTomada = {
  numero_nf: "000771",
  cnpj_emissor: "11222333000181",
  data_emissao: "2026-11-05",
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
const nota = { numero: "771", cnpjEmitente: "11.222.333/0001-81", valor: 3000, emissao: "2026-11-05" };

test("monta a leitura e as retenções com valor", () => {
  const r = leituraParaGravar(base, nota);
  assert.equal(r.arquivoDaNota, true);
  assert.deepEqual(r.leitura.divergencias, []);
  assert.equal(r.leitura.descricao_servico, "Locação de equipamentos de filmagem");
  assert.equal(r.leitura.competencia, "2026-11");
  assert.deepEqual(r.leitura.retencoes, [
    { imposto: "ISS", aliquota: 2, valor: 60 },
    { imposto: "IRRF", aliquota: 1.5, valor: 45 },
  ]);
});

test("o PDF de outra nota: guarda o que o PDF traz, sem os dados da leitura", () => {
  const r = leituraParaGravar({ ...base, numero_nf: "59540" }, nota);
  assert.equal(r.arquivoDaNota, false);
  assert.equal(r.motivo, "O PDF traz a NF 59540, não a 771.");
  assert.deepEqual(r.leitura.divergencias, ["numero"]);
  assert.equal(r.leitura.pdf.numero, "59540");
  assert.equal(r.leitura.descricao_servico, null);
  assert.deepEqual(r.leitura.retencoes, []);
});

test("o PDF de outro emitente (CNPJ válido) não é desta nota", () => {
  const r = leituraParaGravar({ ...base, cnpj_emissor: "00000000000191" }, nota);
  assert.equal(r.arquivoDaNota, false);
  assert.deepEqual(r.leitura.divergencias, ["emitente"]);
});

test("CNPJ lido com dígito errado (inválido) não recusa o arquivo", () => {
  // 11.222.333/0001-81 com dois dígitos trocados: o verificador não fecha.
  const r = leituraParaGravar({ ...base, cnpj_emissor: "11223233000181" }, nota);
  assert.equal(r.arquivoDaNota, true);
  assert.deepEqual(r.leitura.divergencias, []);
});

test("emissão e valor diferentes são divergência, não recusa", () => {
  const r = leituraParaGravar({ ...base, data_emissao: "2026-11-02", valor_total: 2500 }, nota);
  assert.equal(r.arquivoDaNota, true);
  assert.deepEqual(r.leitura.divergencias, ["emissao", "valor"]);
  assert.equal(r.leitura.pdf.emissao, "2026-11-02");
  assert.equal(r.leitura.pdf.valor, 2500);
});

test("número com pontos e zeros à esquerda é o mesmo número", () => {
  assert.equal(chaveDoNumero("000.003.107"), "3107");
  const r = leituraParaGravar({ ...base, numero_nf: "000.000.771" }, nota);
  assert.deepEqual(r.leitura.divergencias, []);
});

test("o sufixo da série no número não é outro número", () => {
  const r = leituraParaGravar({ ...base, numero_nf: "771/NFE" }, nota);
  assert.deepEqual(r.leitura.divergencias, []);
});

test("competência fora do formato, alíquota absurda e emissão inválida viram nulo", () => {
  const r = leituraParaGravar(
    { ...base, competencia: "11/2026", data_emissao: "05/11/2026", retencoes: { ...base.retencoes, irrf: { aliquota: 150, valor: 45 } } },
    nota,
  );
  assert.equal(r.leitura.competencia, null);
  assert.equal(r.leitura.pdf.emissao, null);
  assert.deepEqual(r.leitura.divergencias, []);
  assert.deepEqual(r.leitura.retencoes[1], { imposto: "IRRF", aliquota: null, valor: 45 });
});

test("sem número ou CNPJ lidos, não recusa", () => {
  const r = leituraParaGravar({ ...base, numero_nf: null, cnpj_emissor: null, data_emissao: null }, nota);
  assert.equal(r.arquivoDaNota, true);
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
  assert.equal(r.leitura.cnae, null);
  assert.equal(r.leitura.codigo_servico, "17.06.01");
});
