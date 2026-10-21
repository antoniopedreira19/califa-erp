import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularAvos,
  calcularInss2026,
  calcularIrrf2026,
  calcularLinhaDecimoTerceiro,
} from "./calc";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- calcularAvos (regra do dia 15) ----------

test("avos: admitido antes do ano = 12", () => {
  assert.equal(calcularAvos(new Date("2020-05-10"), 2026), 12);
});

test("avos: admitido em jan/2026 dia 10 = 12 (regra do dia 15)", () => {
  assert.equal(calcularAvos(new Date("2026-01-10"), 2026), 12);
});

test("avos: admitido em jan/2026 dia 20 = 11", () => {
  assert.equal(calcularAvos(new Date("2026-01-20"), 2026), 11);
});

test("avos: admitido em out/2026 dia 1 = 3", () => {
  assert.equal(calcularAvos(new Date("2026-10-01"), 2026), 3);
});

test("avos: admitido em dez/2026 dia 20 = 0", () => {
  assert.equal(calcularAvos(new Date("2026-12-20"), 2026), 0);
});

test("avos: admitido depois do ano = 0", () => {
  assert.equal(calcularAvos(new Date("2027-01-10"), 2026), 0);
});

// ---------- calcularInss2026 (tabela progressiva) ----------

test("inss: faixa 1 (até 1.518) = base * 7,5%", () => {
  assert.equal(round2(calcularInss2026(1000)), 75);
});

test("inss: faixa 2 (1.518–2.793,88) = base * 9% - 22,77", () => {
  assert.equal(round2(calcularInss2026(2000)), round2(2000 * 0.09 - 22.77));
});

test("inss: faixa 3 (2.793,88–4.190,83) = base * 12% - 106,59", () => {
  assert.equal(round2(calcularInss2026(3500)), round2(3500 * 0.12 - 106.59));
});

test("inss: faixa 4 (4.190,83–8.157,41) = base * 14% - 190,40", () => {
  assert.equal(round2(calcularInss2026(5000)), round2(5000 * 0.14 - 190.4));
});

test("inss: teto (acima de 8.157,41) = 8.157,41 * 14% - 190,40", () => {
  assert.equal(round2(calcularInss2026(20000)), round2(8157.41 * 0.14 - 190.4));
});

// ---------- calcularIrrf2026 ----------

test("irrf: faixa isenta (base ajustada <= 1.903,98 — exemplo com inss) = 0", () => {
  // base=1000, inss=75 → base ajustada = 925 → isento
  assert.equal(calcularIrrf2026(1000, 75), 0);
});

test("irrf: faixa 7,5%", () => {
  const base = 2500;
  const inss = calcularInss2026(base);
  const esperado = Math.max(0, (base - inss) * 0.075 - 169.44);
  assert.equal(round2(calcularIrrf2026(base, inss)), round2(esperado));
});

test("irrf: faixa 15%", () => {
  const base = 3500;
  const inss = calcularInss2026(base);
  const esperado = Math.max(0, (base - inss) * 0.15 - 381.44);
  assert.equal(round2(calcularIrrf2026(base, inss)), round2(esperado));
});

test("irrf: faixa 22,5%", () => {
  const base = 5500;
  const inss = calcularInss2026(base);
  const esperado = Math.max(0, (base - inss) * 0.225 - 662.77);
  assert.equal(round2(calcularIrrf2026(base, inss)), round2(esperado));
});

test("irrf: faixa 27,5%", () => {
  const base = 10000;
  const inss = calcularInss2026(base);
  const esperado = Math.max(0, (base - inss) * 0.275 - 896);
  assert.equal(round2(calcularIrrf2026(base, inss)), round2(esperado));
});

// ---------- calcularLinhaDecimoTerceiro (orquestração) ----------

test("linha CLT ano cheio: integral desconta INSS e IRRF", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "clt",
    totalAdiantado: 0,
  });
  assert.equal(r.avos, 12);
  assert.equal(r.primeiraParcela, 2500);
  assert.equal(r.segundaParcela, 2500);
  assert.ok(r.descontoInss > 0);
  assert.ok(r.descontoIrrf > 0);
  assert.equal(r.totalBruto, 5000);
  assert.equal(round2(r.totalLiquido), round2(5000 - r.descontoInss - r.descontoIrrf));
});

test("linha PJ ano cheio: sem descontos", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "pj",
    totalAdiantado: 0,
  });
  assert.equal(r.descontoInss, 0);
  assert.equal(r.descontoIrrf, 0);
  assert.equal(r.totalLiquido, 5000);
});

test("linha com adiantamento abate da 1ª parcela", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "pj",
    totalAdiantado: 1000,
  });
  assert.equal(r.primeiraParcela, 1500);
  assert.equal(r.segundaParcela, 2500);
});

test("linha com avos=0 (admitido após 15/dez): tudo zero", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000,
    dataAdmissao: new Date("2026-12-20"),
    ano: 2026,
    tipoContratacao: "clt",
    totalAdiantado: 0,
  });
  assert.equal(r.avos, 0);
  assert.equal(r.primeiraParcela, 0);
  assert.equal(r.segundaParcela, 0);
  assert.equal(r.totalBruto, 0);
  assert.equal(r.totalLiquido, 0);
  assert.equal(r.descontoInss, 0);
  assert.equal(r.descontoIrrf, 0);
});

test("linha com salarioEditado sobrescreve snapshot", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "pj",
    totalAdiantado: 0,
    salarioEditado: 10000,
  });
  assert.equal(r.totalBruto, 10000);
});

test("linha com avosEditado sobrescreve calculado", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 6000,
    dataAdmissao: new Date("2026-10-01"),
    ano: 2026,
    tipoContratacao: "pj",
    totalAdiantado: 0,
    avosEditado: 12,
  });
  assert.equal(r.avos, 12);
  assert.equal(r.totalBruto, 6000);
});

test("linha CLT recibo é tratado como CLT (tem descontos)", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "clt_recibo",
    totalAdiantado: 0,
  });
  assert.ok(r.descontoInss > 0);
  assert.ok(r.descontoIrrf > 0);
});
