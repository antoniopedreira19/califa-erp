/**
 * Testes da data-limite de envio da PP — decisão 157 (07/10/2026).
 *
 * Rode com:  node --import tsx --test lib/calculos/janelas-pagamento.test.ts
 *
 * Os casos de agosto a dezembro de 2026 são as linhas do calendário que o
 * financeiro mandou ("Calendário de envio de PPs"); as que caem em fim de
 * semana voltam ao dia útil anterior, como o Tiago pediu.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  acomodarDatasDasParcelas,
  dataLimiteDaQuarta,
  dataLimiteDeEnvio,
  ehQuarta,
  janelasComEnvioAberto,
  parcelaForaDaRegra,
  primeiraDataDaProximaParcela,
  ppAceitaQuarta,
  primeiraDataPossivelDoPrazo,
  tipoDoPrazo,
  ppSegueOPrazoDeEnvio,
  primeiraJanelaComEnvioAberto,
  vencimentoAceitaEnvio,
} from "./janelas-pagamento";

test("as linhas do calendário do financeiro (dia útil)", () => {
  const casos: Array<[string, string]> = [
    ["2026-08-10", "2026-07-24"], // 08/08 é sábado: paga 10/08, limite pelo 08
    ["2026-08-20", "2026-08-05"],
    ["2026-09-08", "2026-08-24"],
    ["2026-09-21", "2026-09-04"], // 20/09 domingo; 05/09 sábado → sexta 04/09
    ["2026-10-08", "2026-09-23"],
    ["2026-10-20", "2026-10-05"],
    ["2026-11-09", "2026-10-23"], // 08/11 domingo; 24/10 sábado → sexta 23/10
    ["2026-11-20", "2026-11-05"],
    ["2026-12-08", "2026-11-23"],
    ["2026-12-21", "2026-12-04"], // 20/12 domingo; 05/12 sábado → sexta 04/12
  ];
  for (const [vencimento, limite] of casos) {
    assert.equal(dataLimiteDeEnvio(vencimento), limite, vencimento);
  }
});

test("domingo volta para a sexta, não para o sábado", () => {
  // 08/02/2027 − 15 = domingo, 24/01/2027.
  assert.equal(dataLimiteDeEnvio("2027-02-08"), "2027-01-22");
});

test("feriado nacional também volta ao dia útil anterior", () => {
  // Limite de 20/10/2026 é segunda 05/10; se 05/10 fosse feriado, sexta 02/10.
  assert.equal(dataLimiteDeEnvio("2026-10-20", ["2026-10-05"]), "2026-10-02");
  // Feriado em outro dia não mexe.
  assert.equal(dataLimiteDeEnvio("2026-10-20", ["2026-10-12"]), "2026-10-05");
});

test("data fora das janelas não tem data-limite", () => {
  assert.equal(dataLimiteDeEnvio("2026-10-15"), null);
  assert.equal(vencimentoAceitaEnvio("2026-10-15", "2026-10-01"), false);
});

test("o limite é inclusivo", () => {
  assert.equal(vencimentoAceitaEnvio("2026-11-09", "2026-10-23"), true);
  assert.equal(vencimentoAceitaEnvio("2026-11-09", "2026-10-24"), false);
});

test("em 07/10/2026 a primeira janela possível é a de 08/11 (paga 09/11)", () => {
  assert.equal(primeiraJanelaComEnvioAberto("2026-10-07"), "2026-11-09");
  assert.deepEqual(janelasComEnvioAberto("2026-10-07", [], 4), [
    "2026-11-09",
    "2026-11-20",
    "2026-12-08",
    "2026-12-21",
  ]);
});

test("no dia seguinte ao limite de 08/11, a primeira é a de 20/11", () => {
  assert.equal(primeiraJanelaComEnvioAberto("2026-10-24"), "2026-11-20");
  assert.equal(primeiraJanelaComEnvioAberto("2026-10-23"), "2026-11-09");
});

test("virada de ano", () => {
  // Limite de 08/01/2027 é 24/12/2026 (quinta).
  assert.equal(primeiraJanelaComEnvioAberto("2026-12-24"), "2027-01-08");
  assert.equal(primeiraJanelaComEnvioAberto("2026-12-25"), "2027-01-20");
});

test("PP gerada antes de 08/10/2026 (São Paulo) fica fora da regra", () => {
  assert.equal(ppSegueOPrazoDeEnvio("2026-10-07T12:00:00Z"), false);
  // 23h59 de 07/10 em São Paulo ainda é 07/10, mesmo já sendo 08/10 em UTC.
  assert.equal(ppSegueOPrazoDeEnvio("2026-10-08T02:59:00Z"), false);
  assert.equal(ppSegueOPrazoDeEnvio("2026-10-08T03:00:00Z"), true);
  assert.equal(ppSegueOPrazoDeEnvio(null), true);
});

// ---------------------------------------------------------------------------
// Quarta de exceções e datas das parcelas — decisão 172 (14/10/2026)
// ---------------------------------------------------------------------------

const FERIADOS = ["2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25", "2027-01-01", "2027-04-21"];

test("a quarta fecha na sexta anterior; sexta feriado volta para a quinta", () => {
  assert.equal(dataLimiteDaQuarta("2026-10-21", FERIADOS), "2026-10-16");
  assert.equal(dataLimiteDaQuarta("2026-11-25", FERIADOS), "2026-11-19"); // 20/11 Consciência Negra
  assert.equal(dataLimiteDaQuarta("2026-12-30", FERIADOS), "2026-12-24"); // 25/12 Natal
  assert.equal(dataLimiteDaQuarta("2027-04-21", FERIADOS), null); // Tiradentes: não há pagamento
  assert.equal(dataLimiteDaQuarta("2026-10-22", FERIADOS), null); // quinta
  // A data-limite de envio da PP vale para a quarta também.
  assert.equal(dataLimiteDeEnvio("2026-10-21", FERIADOS), "2026-10-16");
});

test("a quarta da semana seguinte fica aberta até sexta, e só com urgência", () => {
  assert.equal(tipoDoPrazo("2026-10-21", "2026-10-13", FERIADOS, true), "quarta");
  assert.equal(tipoDoPrazo("2026-10-21", "2026-10-16", FERIADOS, true), "quarta");
  assert.equal(tipoDoPrazo("2026-10-21", "2026-10-17", FERIADOS, true), null);
  assert.equal(tipoDoPrazo("2026-10-21", "2026-10-13", FERIADOS, false), null);
  assert.equal(tipoDoPrazo("2026-10-14", "2026-10-13", FERIADOS, true), null); // a da mesma semana
  assert.equal(tipoDoPrazo("2026-11-25", "2026-11-19", FERIADOS, true), "quarta");
  assert.equal(tipoDoPrazo("2026-11-25", "2026-11-20", FERIADOS, true), null);
  // As janelas continuam como antes, com ou sem urgência.
  assert.equal(tipoDoPrazo("2026-11-09", "2026-10-13", FERIADOS, false), "janela");
  assert.equal(tipoDoPrazo("2026-11-09", "2026-10-13", FERIADOS, true), "janela");
  assert.equal(tipoDoPrazo("2026-10-20", "2026-10-13", FERIADOS, true), null);
  assert.equal(tipoDoPrazo("2026-10-12", "2026-10-13", FERIADOS, true), null); // passado
});

test("a quarta vale na PP urgente e na verba, urgente ou não (revisão da 172)", () => {
  assert.equal(ppAceitaQuarta({ urgente: true, verba: false }), true);
  assert.equal(ppAceitaQuarta({ urgente: false, verba: true }), true);
  assert.equal(ppAceitaQuarta({ urgente: true, verba: true }), true);
  assert.equal(ppAceitaQuarta({ urgente: false, verba: false }), false);
  const verba = ppAceitaQuarta({ urgente: false, verba: true });
  assert.equal(tipoDoPrazo("2026-10-21", "2026-10-16", FERIADOS, verba), "quarta");
  assert.equal(primeiraDataPossivelDoPrazo("2026-10-16", FERIADOS, verba), "2026-10-21");
});

test("a primeira data possível do prazo, com e sem urgência", () => {
  assert.equal(primeiraDataPossivelDoPrazo("2026-10-13", FERIADOS, false), "2026-11-09");
  assert.equal(primeiraDataPossivelDoPrazo("2026-10-13", FERIADOS, true), "2026-10-21");
  assert.equal(primeiraDataPossivelDoPrazo("2026-10-17", FERIADOS, true), "2026-10-28");
  assert.equal(primeiraDataPossivelDoPrazo("2026-11-20", FERIADOS, true), "2026-12-02");
});

test("a quarta que é janela segue só a regra da janela", () => {
  // 20/01/2027 é quarta e é janela: o limite de envio é 05/01, não a sexta 15/01.
  assert.equal(ehQuarta("2027-01-20"), true);
  assert.equal(tipoDoPrazo("2027-01-20", "2027-01-04", FERIADOS, true), "janela");
  assert.equal(tipoDoPrazo("2027-01-20", "2027-01-10", FERIADOS, true), null);
});

test("a 2ª parcela pula a janela logo seguinte", () => {
  assert.equal(primeiraDataDaProximaParcela("2026-10-21"), "2026-11-20"); // pulou 09/11
  assert.equal(primeiraDataDaProximaParcela("2026-11-04"), "2026-11-20"); // pulou 09/11
  assert.equal(primeiraDataDaProximaParcela("2027-02-03"), "2027-02-22"); // pulou 08/02; 20/02 é sábado
  assert.equal(primeiraDataDaProximaParcela("2026-11-09"), "2026-12-08"); // janela: mês seguinte
  assert.equal(primeiraDataDaProximaParcela("2026-12-21"), "2027-01-20"); // 20/12 caiu no domingo
});

test("as datas padrão das parcelas e o ajuste à mão", () => {
  const novas = (n: number) => Array.from({ length: n }, () => ({ data: "", ajustada: false }));
  const datas = (xs: Array<{ data: string; ajustada: boolean }>) =>
    xs.map((x) => x.data + (x.ajustada ? "*" : ""));
  assert.deepEqual(datas(acomodarDatasDasParcelas("2026-10-21", novas(3))), [
    "2026-10-21",
    "2026-11-20",
    "2026-12-21",
  ]);
  assert.deepEqual(datas(acomodarDatasDasParcelas("2026-11-09", novas(3))), [
    "2026-11-09",
    "2026-12-08",
    "2027-01-08",
  ]);
  // A 2ª adiada para 21/12 empurra a 3ª para 20/01.
  const adiada = acomodarDatasDasParcelas("2026-10-21", [
    { data: "", ajustada: false },
    { data: "2026-12-21", ajustada: true },
    { data: "", ajustada: false },
  ]);
  assert.deepEqual(datas(adiada), ["2026-10-21", "2026-12-21*", "2027-01-20"]);
  // O prazo andou para 09/11: a adiada ainda cabe e fica.
  assert.deepEqual(datas(acomodarDatasDasParcelas("2026-11-09", adiada)), [
    "2026-11-09",
    "2026-12-21*",
    "2027-01-20",
  ]);
  // O prazo andou para 08/12: a adiada ficou cedo demais e volta ao padrão.
  assert.deepEqual(datas(acomodarDatasDasParcelas("2026-12-08", adiada)), [
    "2026-12-08",
    "2027-01-08",
    "2027-02-08",
  ]);
  // Adiada para fora das janelas não fica.
  assert.deepEqual(
    datas(
      acomodarDatasDasParcelas("2026-10-21", [
        { data: "", ajustada: false },
        { data: "2026-12-23", ajustada: true },
      ]),
    ),
    ["2026-10-21", "2026-11-20"],
  );
});

test("sem prazo, as parcelas padrão ficam vazias e a adiada fica", () => {
  assert.equal(primeiraDataDaProximaParcela(""), "");
  const semPrazo = acomodarDatasDasParcelas("", [
    { data: "2026-10-21", ajustada: false },
    { data: "2026-12-21", ajustada: true },
    { data: "2027-01-20", ajustada: false },
  ]);
  // A 3ª já se calcula a partir da adiada.
  assert.deepEqual(semPrazo, [
    { data: "", ajustada: false },
    { data: "2026-12-21", ajustada: true },
    { data: "2027-01-20", ajustada: false },
  ]);
  // O prazo voltou: a adiada ainda cabe e fica; as outras voltam ao padrão.
  assert.deepEqual(
    acomodarDatasDasParcelas("2026-10-21", semPrazo).map((x) => x.data),
    ["2026-10-21", "2026-12-21", "2027-01-20"],
  );
});

test("a trava do servidor nas datas das parcelas", () => {
  assert.equal(parcelaForaDaRegra(["2026-10-21", "2026-11-20", "2026-12-21"]), null);
  assert.equal(parcelaForaDaRegra(["2026-10-21", "2026-11-09"]), 2); // a janela logo seguinte
  assert.equal(parcelaForaDaRegra(["2026-11-09", "2026-11-20"]), 2);
  assert.equal(parcelaForaDaRegra(["2026-11-09", "2026-12-08", "2026-12-21"]), 3);
  assert.equal(parcelaForaDaRegra(["2026-10-21", "2026-11-25"]), 2); // quarta só no 1º vencimento
  assert.equal(parcelaForaDaRegra(["2026-10-21", "2027-03-08"]), null); // adiar é livre para frente
  assert.equal(parcelaForaDaRegra(["2026-10-21"]), null);
});
