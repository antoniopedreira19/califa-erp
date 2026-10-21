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

// ---------- calcularInss2026 (tabela 10/2026, Portaria MPS/MF nº 13/2026) ----

test("inss: faixa 1 (até 1.621) = base * 7,5%", () => {
  assert.equal(round2(calcularInss2026(1000)), 75);
});

test("inss: faixa 2 (1.621,01–2.902,84) = base * 9% - 24,32", () => {
  assert.equal(round2(calcularInss2026(2000)), round2(2000 * 0.09 - 24.32));
});

test("inss: Caroline — base 2.250 → R$ 178,18 (bate com planilha)", () => {
  assert.equal(round2(calcularInss2026(2250)), 178.18);
});

test("inss: faixa 3 (2.902,85–4.354,27) = base * 12% - 111,40", () => {
  assert.equal(round2(calcularInss2026(3500)), round2(3500 * 0.12 - 111.4));
});

test("inss: faixa 4 (4.354,28–8.475,55) = base * 14% - 198,49", () => {
  assert.equal(round2(calcularInss2026(5000)), round2(5000 * 0.14 - 198.49));
});

test("inss: teto (acima de 8.475,55) = 8.475,55 * 14% - 198,49", () => {
  assert.equal(
    round2(calcularInss2026(20000)),
    round2(8475.55 * 0.14 - 198.49),
  );
});

// ---------- calcularIrrf2026 (Lei 15.191/2025 + Lei 15.270/2025) -----------

test("irrf: base baixa → isento (abatida pela dedução simplificada + redução 15.270)", () => {
  // Caroline: base=2250, INSS=178,18 → dedução = max(178,18, 607,20) = 607,20
  // baseIR = 2250 - 607,20 = 1642,80 → faixa isenta → 0
  // Redução Lei 15.270: 2250 <= 5000 → 312,89 (não aplica porque IR já é 0)
  assert.equal(calcularIrrf2026(2250, 178.18), 0);
});

test("irrf: salário médio no 13º → 0 por isenção efetiva (base <= 5000)", () => {
  // base=3500, INSS=308,60 → dedução = 607,20 → baseIR = 2892,80
  // faixa 2 (<=2826,65)? Não; faixa 3 (<=3751,05) → 2892,80 × 15% − 394,16 = 39,76
  // Redução 15.270: 3500 <= 5000 → 312,89 → IR final = max(0, 39,76 − 312,89) = 0
  assert.equal(calcularIrrf2026(3500, calcularInss2026(3500)), 0);
});

test("irrf: faixa de transição (5000 < base <= 7350) aplica redução parcial", () => {
  // base=5500, INSS=571,51 → dedução = 607,20 → baseIR = 4892,80
  // faixa 5 (>4664,68) → 4892,80 × 27,5% − 908,73 = 1345,52 − 908,73 = 436,79
  // Redução 15.270: 5500 > 5000, <= 7350 → max(0, 978,62 − 0,133145 × 5500) = 246,32
  // IR final = max(0, 436,79 − 246,32) = 190,47
  const base = 5500;
  const inss = calcularInss2026(base);
  const r = calcularIrrf2026(base, inss);
  assert.ok(r > 0);
  assert.ok(r < 300);
});

test("irrf: base alta (>7350) sem redução Lei 15.270", () => {
  // base=10000, INSS=teto=988,09 → dedução = max(988,09, 607,20) = 988,09
  // baseIR = 10000 - 988,09 = 9011,91
  // faixa 5 → 9011,91 × 27,5% − 908,73 = 2478,28 − 908,73 = 1569,55
  // Redução 15.270: 10000 > 7350 → 0
  // IR final = 1569,55
  const base = 10000;
  const inss = calcularInss2026(base);
  assert.equal(round2(calcularIrrf2026(base, inss)), 1569.55);
});

test("irrf: dependentes reduzem a base de cálculo", () => {
  const base = 10000;
  const inss = calcularInss2026(base);
  const semDeps = calcularIrrf2026(base, inss, 0);
  const comDeps = calcularIrrf2026(base, inss, 3);
  // 3 dependentes × R$ 189,59 = R$ 568,77 a menos na base, cai no 27,5%
  // → economia esperada de ~R$ 156,41
  assert.ok(comDeps < semDeps);
  assert.ok(semDeps - comDeps > 100);
});

// ---------- calcularLinhaDecimoTerceiro (orquestração) ----------

test("linha Caroline (CLT 3000, 9 meses, 0 adiantamento): 1ª 1125, INSS 178,18, IRRF 0, líquido 2.071,82", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 3000,
    dataAdmissao: new Date("2026-03-23"),
    ano: 2026,
    tipoContratacao: "clt",
    totalAdiantado: 0,
  });
  assert.equal(r.avos, 9);
  assert.equal(r.primeiraParcela, 1125);
  assert.equal(r.segundaParcela, 1125);
  assert.equal(r.descontoInss, 178.18);
  assert.equal(r.descontoIrrf, 0);
  assert.equal(r.totalBruto, 2250);
  assert.equal(r.totalLiquido, 2071.82);
});

test("linha CLT ano cheio salário alto: integral desconta INSS e IRRF", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 10000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "clt",
    totalAdiantado: 0,
  });
  assert.equal(r.avos, 12);
  assert.equal(r.primeiraParcela, 5000);
  assert.equal(r.segundaParcela, 5000);
  assert.ok(r.descontoInss > 0);
  assert.ok(r.descontoIrrf > 0);
  assert.equal(r.totalBruto, 10000);
  assert.equal(
    round2(r.totalLiquido),
    round2(10000 - r.descontoInss - r.descontoIrrf),
  );
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
    salarioEditado: 15000,
  });
  assert.equal(r.totalBruto, 15000);
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

test("linha CLT recibo sem valorRecibo é tratado como CLT puro (tem descontos)", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 10000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "clt_recibo",
    totalAdiantado: 0,
  });
  assert.ok(r.descontoInss > 0);
  assert.ok(r.descontoIrrf > 0);
  assert.equal(r.parteClt, null);
  assert.equal(r.partePj, null);
});

// ---------- Híbrido CLT_recibo com valorRecibo ----------

test("híbrido: salario=10000 com valorRecibo=4000 → parte CLT (6000) + parte PJ (4000)", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 10000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "clt_recibo",
    totalAdiantado: 0,
    valorRecibo: 4000,
  });
  assert.ok(r.parteClt);
  assert.equal(r.parteClt!.primeiraParcela, 3000);
  assert.equal(r.parteClt!.segundaParcela, 3000);
  assert.ok(r.parteClt!.descontoInss > 0);
  assert.ok(r.partePj);
  assert.equal(r.partePj!.primeiraParcela, 2000);
  assert.equal(r.partePj!.segundaParcela, 2000);
  assert.equal(r.partePj!.totalLiquido, 4000);
  assert.equal(r.primeiraParcela, 5000);
  assert.equal(r.segundaParcela, 5000);
  assert.equal(r.totalBruto, 10000);
  assert.equal(r.descontoInss, r.parteClt!.descontoInss);
  assert.equal(r.descontoIrrf, r.parteClt!.descontoIrrf);
});

test("híbrido: valorRecibo=0 cai no caminho CLT puro (sem breakdown)", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 5000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "clt_recibo",
    totalAdiantado: 0,
    valorRecibo: 0,
  });
  assert.equal(r.parteClt, null);
  assert.equal(r.partePj, null);
  assert.ok(r.descontoInss > 0);
});

test("híbrido: adiantamento rateia proporcional ao salário de cada parte", () => {
  const r = calcularLinhaDecimoTerceiro({
    salario: 10000,
    dataAdmissao: new Date("2020-01-01"),
    ano: 2026,
    tipoContratacao: "clt_recibo",
    totalAdiantado: 1000,
    valorRecibo: 4000, // CLT 6000, PJ 4000 → proporção 60/40
  });
  assert.ok(r.parteClt);
  assert.equal(r.parteClt!.primeiraParcela, 2400); // 3000 - 600
  assert.ok(r.partePj);
  assert.equal(r.partePj!.primeiraParcela, 1600); // 2000 - 400
  assert.equal(r.primeiraParcela, 4000); // 5000 - 1000
});
