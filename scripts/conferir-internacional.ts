/**
 * Confere o fechamento INTERNACIONAL contra a planilha que o define:
 * `Modelo de planilha interna - Internacional 2026.xlsx`, aba
 * "INTERNA USD" (New Balance — Loud & Live), entregue pelo Tiago em
 * 10/09/2026 junto do design `Orcamento Internacional - Planilha e
 * Totais.dc.html` (projeto Claude Design `69342d83`).
 *
 * Roda com `npx tsx scripts/conferir-internacional.ts`. Sem infraestrutura
 * de teste no projeto, é este script que sustenta a cadeia — do mesmo jeito
 * que `conferir-save.ts` sustenta o save.
 *
 * São três provas:
 *
 *  1. **A cadeia bate célula a célula** com a aba INTERNA USD, em BRL e na
 *     moeda estrangeira (as 12 células de fechamento).
 *  2. **O nacional não se mexeu**: rodar `calcularTotaisVersao` sem o 4º
 *     parâmetro tem que dar exatamente o mesmo que dava antes de 11/09/2026.
 *  3. **O resultado operacional sobra em `fee + rentabilidade`**, que é a
 *     decisão 072 §1 — e é o número que a planilha teria em `L11` se a
 *     célula apontasse `G6` (FEE) em vez de `G10` (BRAZILIAN TAXES).
 */
import {
  calcularTotaisVersao,
  calcularEfeitoDaMudanca,
  calcularResultadoOperacional,
  type ItemParaTotais,
} from "../lib/calculos/versao-totais";

let falhas = 0;

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Um centavo. A planilha guarda os resultados com mais casas do que
 *  exibe, então a comparação é sobre o valor cheio. */
function conferir(rotulo: string, obtido: number, esperado: number, tol = 0.01) {
  const dif = Math.abs(obtido - esperado);
  const ok = dif <= tol;
  if (!ok) falhas += 1;
  console.log(
    `${ok ? "  ok  " : "  XX  "} ${rotulo.padEnd(36)} ${brl(obtido).padStart(16)} ${
      ok ? "=" : "≠"
    } ${brl(esperado).padStart(16)}${ok ? "" : `   (dif ${brl(dif)})`}`,
  );
}

// =====================================================================
// 1. A aba INTERNA USD
// =====================================================================
//
// A aba tem UM item, tipo B (bi-tributação — é o que a planilha
// internacional assume para tudo), e o planejado de uma linha só.
//
//   D4 283.668,01 (unitário BRL) × E4 1 × F4 1  ->  G4 283.668,01
//   H4   3.263,10 (unitário planejado)          ->  K4   3.263,10
//
// Parâmetros da aba: FEE 20% (G6), INT TAXES 18,02% (G7),
// BRAZILIAN TAXES 19,53% (G10, escrito como /0,8047),
// INT TRANSACTION COSTS 0 (G9), compra B15 = 5,17 − 0,20 = 4,97.
const ORCADO = 283_668.01;
const PLANEJADO = 3_263.1;
const FEE = 20;
const INT_TAXES = 18.02;
const IMPOSTO_BR = 19.53;
const ITC = 0;
const COMPRA = 4.97;

const itens: ItemParaTotais[] = [{ tipo_custo: "B", total_orcado: ORCADO }];

const t = calcularTotaisVersao(itens, FEE, IMPOSTO_BR, {
  percentualIntTaxes: INT_TAXES,
  intTransactionCosts: ITC,
});

const f = t.faturamento;
const totalRecebidoExterior = f.principal + f.honorarios + f.intTaxes;

console.log("\n=== 1. Cadeia em BRL — aba INTERNA USD ===");
console.log(`  ${"".padEnd(42)}${"código".padStart(16)}   ${"planilha".padStart(16)}`);
conferir("G5  sub-total", f.principal, 283_668.01);
conferir("G6  fee (20%)", f.honorarios, 56_733.602);
conferir("G7  int taxes (18,02% gross-up)", f.intTaxes, 74_823.57951);
conferir("G8  total recebido no exterior", totalRecebidoExterior, 415_225.1915);
conferir("G9  int transaction costs", f.intTransactionCosts, 0);
conferir("G10 brazilian taxes (19,53%)", f.imposto, 100_774.7979);
conferir("G11 invoicing", f.total, 515_999.9894);

console.log("\n=== 2. Mesma cadeia na moeda estrangeira (÷ compra 4,97) ===");
conferir("F5  sub-total USD", f.principal / COMPRA, 57_076.05835);
conferir("F6  fee USD", f.honorarios / COMPRA, 11_415.21167);
conferir("F7  int taxes USD", f.intTaxes / COMPRA, 15_055.04618);
conferir("F8  total exterior USD", totalRecebidoExterior / COMPRA, 83_546.3162);
conferir("F10 brazilian taxes USD", f.imposto / COMPRA, 20_276.6193);
conferir("F11 invoicing USD", f.total / COMPRA, 103_822.9355);

// =====================================================================
// 3. Rentabilidade e resultado — decisão 072 §1
// =====================================================================
//
// A planilha escreve `L11 = L5 + G10` (renta + BRAZILIAN TAXES) e chega a
// 381.179,71 / 73,87%. Apontando `G6` (FEE) em vez de `G10`, a mesma
// célula dá 337.138,51 — exatamente o que a nossa conta produz, e o que o
// design especifica. A decisão 072 adotou o fee.
const renta = ORCADO - PLANEJADO;
const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
  t.valorJob,
  t.deducoesDoResultado,
  PLANEJADO,
);

console.log("\n=== 3. Rentabilidade e resultado operacional ===");
conferir("L5  renta (orçado − planejado)", renta, 280_404.91);
conferir("L10 % renta (renta ÷ orçado)", (renta / ORCADO) * 100, 98.8496_7642, 0.0001);
conferir("res. operacional = fee + renta", resultadoOperacional ?? NaN, f.honorarios + renta);
conferir("  … e o L5+G6 da planilha", resultadoOperacional ?? NaN, 337_138.512);
conferir(
  "res. geral (resOp ÷ valor do job)",
  resultadoGeral ?? NaN,
  ((f.honorarios + renta) / t.valorJob) * 100,
  0.0001,
);

// Sem save, valor do job e faturamento previsto coincidem — é o caso da
// planilha modelo, que não conhece save.
conferir("valor do job = faturamento previsto", t.valorJob, t.faturamentoPrevisto);

// =====================================================================
// 4. O NACIONAL NÃO SE MEXEU
// =====================================================================
//
// A prova que importa para o resto do sistema: sem o 4º parâmetro, a
// conta é a de sempre. Os números abaixo são os da cadeia nacional
// fechada à mão — honorários sobre a base, imposto em gross-up sobre
// (base + honorários), total = principal + honorários + imposto.
console.log("\n=== 4. Fechamento nacional, sem o 4º parâmetro ===");
const n = calcularTotaisVersao(itens, FEE, IMPOSTO_BR);
const honNac = ORCADO * 0.2;
const impNac = ((ORCADO + honNac) * 0.1953) / (1 - 0.1953);

conferir("honorários", n.honorarios, honNac);
conferir("imposto", n.imposto, impNac);
conferir("int taxes (tem que ser zero)", n.intTaxes, 0);
conferir("custos de transação (zero)", n.intTransactionCosts, 0);
conferir("deduções = imposto", n.deducoesDoResultado, n.imposto);
conferir("valor do job", n.valorJob, ORCADO + honNac + impNac);

// =====================================================================
// 5. As alavancas por tipo continuam valendo (decisão 072 §2)
// =====================================================================
//
// Um item A · Direto — cliente paga o fornecedor direto: entra no valor do
// job, não no faturamento, entra na base de honorários e NÃO na de
// imposto. A cadeia internacional tem que respeitar isso, senão o fee e as
// int. taxes correriam sobre dinheiro que nunca passou pela California.
console.log("\n=== 5. Alavancas por tipo na cadeia internacional ===");
const mistos: ItemParaTotais[] = [
  { tipo_custo: "B", total_orcado: 100_000 },
  { tipo_custo: "A", total_orcado: 50_000 },
];
const m = calcularTotaisVersao(mistos, 10, 19.53, {
  percentualIntTaxes: 18.02,
  intTransactionCosts: 1_000,
});

// fee sobre os dois (A e B têm honorarios: true) = 150.000 × 10%
conferir("fee sobre A + B", m.faturamento.honorarios, 15_000);
// int taxes só sobre (tipos com imposto = só o B) + fee
const baseInt = 100_000 + 15_000;
const intM = (baseInt * 0.1802) / (1 - 0.1802);
conferir("base das int taxes = B + fee", m.faturamento.baseIntTaxes, baseInt);
conferir("int taxes", m.faturamento.intTaxes, intM);
// imposto BR sobre (B + fee + int taxes)
const impM = ((baseInt + intM) * 0.1953) / (1 - 0.1953);
conferir("imposto BR", m.faturamento.imposto, impM);
// o principal do A não fatura, mas entra no valor do job
conferir("principal faturado (só o B)", m.faturamento.principal, 100_000);
conferir("principal do valor do job (A + B)", m.job.principal, 150_000);
conferir("custos de transação entram no total", m.faturamento.intTransactionCosts, 1_000);
conferir(
  "faturamento previsto",
  m.faturamentoPrevisto,
  100_000 + 15_000 + intM + impM + 1_000,
);

// =====================================================================
// 6. Com save, a fatia continua exata
// =====================================================================
//
// A invariante do save (decisão 028 §4): o faturamento atribuído às
// linhas em save mais o fechamento sobre os custos do job reconstitui o
// faturamento previsto. Os custos de transação ficam DE FORA dessa soma
// de propósito — são constante da versão, não fatia de linha.
console.log("\n=== 6. Save + internacional: a fatia fecha ===");
const comSave: ItemParaTotais[] = [
  { tipo_custo: "B", total_orcado: 100_000, em_save: true },
  { tipo_custo: "B", total_orcado: 60_000 },
];
const s = calcularTotaisVersao(comSave, 12, 19.53, {
  percentualIntTaxes: 18.02,
  intTransactionCosts: 2_500,
});
const soCustos = calcularTotaisVersao(
  [{ tipo_custo: "B", total_orcado: 60_000 }],
  12,
  19.53,
  { percentualIntTaxes: 18.02, intTransactionCosts: 0 },
);
conferir(
  "receita do save + custos do job",
  s.save.receita + soCustos.faturamentoPrevisto,
  s.faturamentoPrevisto - s.faturamento.intTransactionCosts,
);
// A linha em save sai do valor do job e fica no faturamento.
conferir("base do faturamento", s.faturamento.base, 160_000);
conferir("base do valor do job", s.job.base, 60_000);

// =====================================================================
// 7. Errata: a soma dos efeitos por linha fecha com o delta total
// =====================================================================
//
// É a propriedade que sustenta o card de Erratas: cada linha mostra o
// próprio efeito, e a barra mostra o total. Se as duas contas divergirem,
// o usuário vê parcelas que não somam o que está escrito embaixo.
//
// Vale no internacional porque cada parcela da cadeia é LINEAR na base —
// fee, int. taxes e imposto, todas. A exceção são os custos de transação,
// que são constante da versão e por isso ficam fora do efeito por linha.
console.log("\n=== 7. Errata internacional: efeitos somam o delta total ===");
const INT = { percentualIntTaxes: 18.02, intTransactionCosts: 3_000 };
const antesItens: ItemParaTotais[] = [
  { tipo_custo: "B", total_orcado: 80_000 },
  { tipo_custo: "A", total_orcado: 40_000 },
  { tipo_custo: "C", total_orcado: 25_000 },
];
// Uma errata que mexe em duas linhas: B sobe, A vira AR.
const depoisItens: ItemParaTotais[] = [
  { tipo_custo: "B", total_orcado: 95_000 },
  { tipo_custo: "AR", total_orcado: 40_000 },
  { tipo_custo: "C", total_orcado: 25_000 },
];
const tAntes = calcularTotaisVersao(antesItens, 12, 19.53, INT);
const tDepois = calcularTotaisVersao(depoisItens, 12, 19.53, INT);

const efeitos = [
  calcularEfeitoDaMudanca(
    { total: 80_000, tipoCusto: "B" },
    { total: 95_000, tipoCusto: "B" },
    12,
    19.53,
    INT,
  ),
  calcularEfeitoDaMudanca(
    { total: 40_000, tipoCusto: "A" },
    { total: 40_000, tipoCusto: "AR" },
    12,
    19.53,
    INT,
  ),
];
conferir(
  "Σ efeitos = Δ faturamento",
  efeitos.reduce((s, e) => s + e.faturamentoPrevisto, 0),
  tDepois.faturamentoPrevisto - tAntes.faturamentoPrevisto,
);
conferir(
  "Σ efeitos = Δ valor do job",
  efeitos.reduce((s, e) => s + e.valorJob, 0),
  tDepois.valorJob - tAntes.valorJob,
);
// Os custos de transação são constante: entram nos dois totais e se
// cancelam no delta, e nenhum efeito de linha os carrega.
conferir("custos de transação no total", tAntes.intTransactionCosts, 3_000);

console.log(
  falhas === 0
    ? "\n✅ Tudo bate — cadeia internacional, nacional intacto, alavancas e save.\n"
    : `\n❌ ${falhas} divergência(s).\n`,
);
process.exit(falhas === 0 ? 0 : 1);
