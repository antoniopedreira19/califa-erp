/**
 * Cadastro de impostos (módulo fiscal, 02/10/2026): as contas puras e a
 * validação das edições. Rodar:
 *   node --import tsx --test lib/validations/fiscal-cadastro.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliquotasPisCofins,
  estabelecimentoSchema,
  formatarCodigoCnae,
  lerPercentual,
  novaVigenciaCnaeSchema,
  novoCnaeSchema,
  novoFeriadoSchema,
  percentualParaCampo,
  primeiroDiaDoMesSeguinte,
  vesperaDaVigencia,
} from "./fiscal-cadastro";

const ID = "304039bd-509d-4536-aa26-44e7091ee718";

test("máscara do CNAE vai pondo os separadores", () => {
  assert.equal(formatarCodigoCnae("82"), "82");
  assert.equal(formatarCodigoCnae("823"), "82.3");
  assert.equal(formatarCodigoCnae("8230"), "82.30");
  assert.equal(formatarCodigoCnae("82300"), "82.30-0");
  assert.equal(formatarCodigoCnae("823000"), "82.30-0-0");
  assert.equal(formatarCodigoCnae("8230001"), "82.30-0-01");
  assert.equal(formatarCodigoCnae("82.30-0-01"), "82.30-0-01");
  assert.equal(formatarCodigoCnae("82300019999"), "82.30-0-01");
});

test("percentual com vírgula, ponto, por cento e vazio", () => {
  assert.equal(lerPercentual("2,5"), 2.5);
  assert.equal(lerPercentual("2.5"), 2.5);
  assert.equal(lerPercentual(" 0,65 "), 0.65);
  assert.equal(lerPercentual("5%"), 5);
  assert.equal(lerPercentual(""), null);
  assert.equal(lerPercentual(null), null);
  assert.ok(Number.isNaN(lerPercentual("dois") as number));
  assert.ok(Number.isNaN(lerPercentual("1,2,3") as number));
  assert.equal(percentualParaCampo(1.65), "1,65");
  assert.equal(percentualParaCampo(null), "");
});

test("a linha atual fecha na véspera da vigência nova", () => {
  assert.equal(vesperaDaVigencia("2026-12-01"), "2026-11-30");
  assert.equal(vesperaDaVigencia("2027-01-01"), "2026-12-31");
  assert.equal(vesperaDaVigencia("2028-03-01"), "2028-02-29");
});

test("sugestão de vigência: primeiro dia do mês seguinte", () => {
  assert.equal(primeiroDiaDoMesSeguinte("2026-11-04"), "2026-12-01");
  assert.equal(primeiroDiaDoMesSeguinte("2026-12-15"), "2027-01-01");
  assert.equal(primeiroDiaDoMesSeguinte("2026-10-02"), "2026-11-01");
});

test("PIS e COFINS seguem a opção de crédito", () => {
  const naoCumulativo = { aliquota_pis: 1.65, aliquota_cofins: 7.6, cumulativo: false };
  const cumulativo = { aliquota_pis: 0.65, aliquota_cofins: 3, cumulativo: true };
  // Mantida a opção, ficam as alíquotas da linha.
  assert.deepEqual(aliquotasPisCofins(false, naoCumulativo), { aliquota_pis: 1.65, aliquota_cofins: 7.6 });
  assert.deepEqual(aliquotasPisCofins(true, cumulativo), { aliquota_pis: 0.65, aliquota_cofins: 3 });
  // Trocada, valem as do regime escolhido.
  assert.deepEqual(aliquotasPisCofins(true, naoCumulativo), { aliquota_pis: 0.65, aliquota_cofins: 3 });
  assert.deepEqual(aliquotasPisCofins(false, cumulativo), { aliquota_pis: 1.65, aliquota_cofins: 7.6 });
  // CNAE novo.
  assert.deepEqual(aliquotasPisCofins(false), { aliquota_pis: 1.65, aliquota_cofins: 7.6 });
  assert.deepEqual(aliquotasPisCofins(true, null), { aliquota_pis: 0.65, aliquota_cofins: 3 });
});

const estab = (o: Record<string, unknown>) =>
  estabelecimentoSchema.safeParse({ id: ID, cnpj: "", ativo: false, iss_dia: 10, iss_retido_dia: 10, iss_regra: "prorroga", observacao: "", ...o });

test("CNPJ emissor: máscara sai, dígito verificador confere, ativar pede CNPJ", () => {
  const ok = estab({ cnpj: "19.437.976/0001-54", ativo: true });
  assert.ok(ok.success);
  assert.equal(ok.data.cnpj, "19437976000154");
  assert.equal(ok.data.observacao, null);

  const semCnpj = estab({});
  assert.ok(semCnpj.success);
  assert.equal(semCnpj.data.cnpj, null);

  const dv = estab({ cnpj: "19.437.976/0001-55" });
  assert.ok(!dv.success);
  assert.equal(dv.error.issues[0].message, "CNPJ inválido: confira os dígitos.");

  const curto = estab({ cnpj: "19.437.976/0001" });
  assert.ok(!curto.success);
  assert.equal(curto.error.issues[0].message, "O CNPJ tem 14 dígitos.");

  const ativarSem = estab({ ativo: true });
  assert.ok(!ativarSem.success);
  assert.equal(ativarSem.error.issues[0].message, "Para ativar, informe o CNPJ.");

  const diaRuim = estab({ iss_dia: 32 });
  assert.ok(!diaRuim.success);
  assert.equal(diaRuim.error.issues[0].message, "Dia do ISS: informe um dia de 1 a 31.");

  const obs = estab({ observacao: "  a confirmar  " });
  assert.ok(obs.success);
  assert.equal(obs.data.observacao, "a confirmar");
});

test("Editar alíquotas: ISS com vírgula, vazio vira nulo, texto é recusado", () => {
  const base = { cnae_id: ID, vigencia_inicio: "2026-12-01", cumulativo: false };
  const r1 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "2,5" });
  assert.ok(r1.success);
  assert.equal(r1.data.aliquota_iss, 2.5);
  const r2 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "" });
  assert.ok(r2.success);
  assert.equal(r2.data.aliquota_iss, null);
  const r3 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "dois" });
  assert.ok(!r3.success);
  assert.equal(r3.error.issues[0].message, "ISS: use só números, como 2 ou 2,5.");
  const r4 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "100" });
  assert.ok(!r4.success);
  const r5 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "2", vigencia_inicio: "" });
  assert.ok(!r5.success);
});

test("Novo CNAE: código pela máscara, subitem com vírgula, descrição obrigatória", () => {
  const base = { estabelecimento_id: ID, descricao: "Produção musical", aliquota_iss: "5", cumulativo: false, vigencia_inicio: "2026-11-01" };
  const r1 = novoCnaeSchema.safeParse({ ...base, codigo: "9001902", subitem: "" });
  assert.ok(r1.success);
  assert.equal(r1.data.codigo, "90.01-9-02");
  assert.equal(r1.data.subitem, null);
  const r2 = novoCnaeSchema.safeParse({ ...base, codigo: "82.30-0-01", subitem: "12,08" });
  assert.ok(r2.success);
  assert.equal(r2.data.subitem, "12.08");
  const r3 = novoCnaeSchema.safeParse({ ...base, codigo: "82.30-0" });
  assert.ok(!r3.success);
  assert.equal(r3.error.issues[0].message, "Código do CNAE no formato 00.00-0-00.");
  const r4 = novoCnaeSchema.safeParse({ ...base, codigo: "8230001", subitem: "12" });
  assert.ok(!r4.success);
  const r5 = novoCnaeSchema.safeParse({ ...base, codigo: "8230001", descricao: "  " });
  assert.ok(!r5.success);
});

test("Feriado: nacional sem cidade, local com cidade", () => {
  const n = novoFeriadoSchema.safeParse({ data: "2027-06-24", nome: "São João", municipio: null });
  assert.ok(n.success);
  assert.equal(n.data.municipio, null);
  const l = novoFeriadoSchema.safeParse({ data: "2027-06-24", nome: " São João ", municipio: "Salvador" });
  assert.ok(l.success);
  assert.equal(l.data.nome, "São João");
  assert.equal(l.data.municipio, "Salvador");
  assert.ok(!novoFeriadoSchema.safeParse({ data: "2027-06-24", nome: "", municipio: null }).success);
});
