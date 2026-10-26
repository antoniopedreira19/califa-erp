/**
 * Testes do avaliador de SUMIFS da validação (E3) do histórico financeiro —
 * decisão 211. As fórmulas imitam as das DREs da planilha; a aba e os valores
 * são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/formulas.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Fonte, abasDaFormula, avaliar, lerFormula, predicadoDoCriterio } from "./formulas";

// Colunas da aba de conta: A data, B crédito, C débito, H jobs, J tipo.
const linha = (n: number, data: string, credito: string, debito: string, jobs: string, tipo: string) => {
  const l: string[] = [String(n), data, credito, debito];
  l[8] = jobs;
  l[10] = tipo;
  return l;
};
const CONTA = [
  ["1", "Data", "Credito", "Débito"],
  linha(2, "2026-01-10", "1000", "", "Marca X - Evento 1T 2026", "REC 1T 2026"),
  linha(3, "2026-01-11", "", "300", "Marca X - Evento 1T 2026", "CO 1T 2026"),
  linha(4, "2026-01-12", "50", "", "Marca X - Evento 1T 2026", "co 1T 2026"),
  linha(5, "2026-02-01", "", "200", "CMH 1T 2026", "CMH CO 1T 2026"),
  linha(6, "2026-02-02", "", "70", "CMH 1T 2026", "CO 1T 2026 "),
  linha(7, "2022-12-30", "500", "", "Outro", "REC 4T 2022"),
];
const fonte = new Fonte(new Map([["Conta Exemplo", CONTA]]));
const celulas: Record<string, string> = { C10: "REC 1T 2026", C11: "CO 1T 2026", C12: "CMH 1T 2026" };
const valor = (formula: string, f: Fonte = fonte) => {
  const no = lerFormula(formula);
  assert.ok(no, `fórmula não lida: ${formula}`);
  return avaliar(no, f, (ref) => celulas[ref] ?? "", "DRE");
};

test("receita: SUMIFS do crédito pelo Tipo", () => {
  assert.equal(valor("SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$J:$J,C10)"), 1000);
});

test("custo: débito menos crédito, sem diferença de maiúscula e com espaço sobrando contando", () => {
  // "co 1T 2026" entra (maiúscula não importa); "CO 1T 2026 " não (espaço sobrando).
  assert.equal(valor("SUMIFS('Conta Exemplo'!$C:$C,'Conta Exemplo'!$J:$J,C11)-SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$J:$J,C11)"), 250);
});

test("empréstimo entre empresas: pela coluna Jobs, entre parênteses e com sinal", () => {
  // As linhas 5 e 6 têm "CMH 1T 2026" na coluna Jobs: 200 + 70 de débito.
  assert.equal(valor("(SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$H:$H,C12)-SUMIFS('Conta Exemplo'!$C:$C,'Conta Exemplo'!$H:$H,C12))"), -270);
  assert.equal(valor("-SUMIFS('Conta Exemplo'!$C:$C,'Conta Exemplo'!$H:$H,C12)"), -270);
});

test("célula vazia como critério vale zero e não soma as linhas sem Tipo", () => {
  const comLinhaSemTipo = new Fonte(new Map([["Conta Exemplo", [...CONTA, linha(8, "2026-03-01", "999", "", "", "")]]]));
  assert.equal(valor("SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$J:$J,Z99)", comLinhaSemTipo), 0);
  assert.equal(valor("SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$J:$J,\"\")", comLinhaSemTipo), 999);
});

test("faixa de linhas e critério de data com curinga", () => {
  assert.equal(valor("SUMIFS('Conta Exemplo'!B$3:B5,'Conta Exemplo'!J$3:J5,\"*1T 2026\")"), 50);
  assert.equal(valor("SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$A:$A,\">=01/01/2023\")"), 1050);
});

test("fórmula que não é só SUMIFS não se avalia", () => {
  assert.equal(lerFormula("SUM(D611:M611)"), null);
  assert.equal(lerFormula("N612/N$611"), null);
  assert.equal(lerFormula("D611+R611"), null);
  assert.equal(lerFormula("SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$J:$J,C10)*2"), null);
});

test("aba que a fonte não tem, ou coluna que ela não guarda, volta nulo", () => {
  assert.equal(valor("SUMIFS('Outra Conta'!$B:$B,'Outra Conta'!$J:$J,C10)"), null);
  const semJobs = new Fonte(new Map([["Conta Exemplo", CONTA]]), new Map([["Conta Exemplo", new Set([1, 2, 3, 10])]]));
  assert.equal(valor("SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$J:$J,C10)", semJobs), 1000);
  assert.equal(valor("SUMIFS('Conta Exemplo'!$B:$B,'Conta Exemplo'!$H:$H,C12)", semJobs), null);
});

test("abas somadas pela fórmula", () => {
  const no = lerFormula("SUMIFS(Paypal!$B:$B,Paypal!$J:$J,C10)-SUMIFS('Conta Exemplo'!$C:$C,'Conta Exemplo'!$J:$J,C10)");
  assert.ok(no);
  assert.deepEqual(abasDaFormula(no, "DRE"), ["Paypal", "Conta Exemplo"]);
});

test("critérios do Google Sheets", () => {
  assert.equal(predicadoDoCriterio("REC 1T 2026").casa("rec 1t 2026"), true);
  assert.equal(predicadoDoCriterio("REC 1T 2026").casa("REC 1T 2026 "), false);
  assert.equal(predicadoDoCriterio("*rec *").casa("CMH REC 2T 2025"), true);
  assert.equal(predicadoDoCriterio("<>n/a").casa("n/a"), false);
  assert.equal(predicadoDoCriterio(2026).casa("2026"), true);
  assert.equal(predicadoDoCriterio("2026").casa("2026.0"), true);
  assert.equal(predicadoDoCriterio("<01/02/2026").casa("2026-01-31"), true);
  assert.equal(predicadoDoCriterio("").casa(""), true);
});
