/**
 * Testes do fechamento da conciliação (decisão 205): o botão e as três
 * condições, o fechamento mais adiante, a mensagem da trava e a linha do
 * histórico. A trava em si (o gatilho) foi conferida no banco.
 *
 * Rode com:  node --import tsx --test lib/conciliacao/fechamento.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  botaoDoFechamento,
  eventosDoHistorico,
  linhaDoHistorico,
  mensagemDoPeriodoFechado,
  noPeriodoFechado,
  type RegistroDoFechamento,
} from "./fechamento";

const PRONTO = { ate: "2026-10-20", linhas_pendentes: 0, sem_linha: 0, saldo_banco: 82553.6, saldo_sistema: 82553.6, diferenca: 0 };

test("o botão liga com as três condições", () => {
  const b = botaoDoFechamento(PRONTO, null);
  assert.deepEqual(b, { ate: "2026-10-20", jaFechada: false, podeFechar: true, faltas: [] });
});

test("cada condição que falta desliga o botão e entra na dica", () => {
  assert.deepEqual(botaoDoFechamento({ ...PRONTO, linhas_pendentes: 11 }, null).faltas, [
    "11 linhas do banco até 20/10 sem conciliar",
  ]);
  assert.deepEqual(botaoDoFechamento({ ...PRONTO, linhas_pendentes: 1 }, null).faltas, [
    "1 linha do banco até 20/10 sem conciliar",
  ]);
  assert.deepEqual(botaoDoFechamento({ ...PRONTO, sem_linha: 3 }, null).faltas, [
    "3 lançamentos sem linha no extrato do banco",
  ]);
  const saldo = botaoDoFechamento({ ...PRONTO, diferenca: -142.11 }, null);
  assert.equal(saldo.podeFechar, false);
  assert.match(saldo.faltas[0], /^o saldo de 20\/10 não bate \(diferença de R\$\s142,11\)$/);
  assert.deepEqual(botaoDoFechamento({ ...PRONTO, diferenca: null }, null).faltas, [
    "o extrato não informou o saldo do banco",
  ]);
  assert.equal(botaoDoFechamento({ ...PRONTO, linhas_pendentes: 2, sem_linha: 1, diferenca: 5 }, null).faltas.length, 3);
});

test("sem extrato importado não há o que fechar", () => {
  assert.deepEqual(botaoDoFechamento({ ate: null }, null), { ate: null, jaFechada: false, podeFechar: false, faltas: [] });
  assert.equal(botaoDoFechamento(null, null).podeFechar, false);
});

test("com um fechamento ativo, só fecha mais adiante", () => {
  const igual = botaoDoFechamento(PRONTO, "2026-10-20");
  assert.equal(igual.jaFechada, true);
  assert.equal(igual.podeFechar, false);
  const adiante = botaoDoFechamento({ ...PRONTO, ate: "2026-10-21" }, "2026-10-20");
  assert.equal(adiante.jaFechada, false);
  assert.equal(adiante.podeFechar, true);
});

test("a trava: até o dia do fechamento, inclusive", () => {
  assert.equal(noPeriodoFechado("2026-10-20", "2026-10-20"), true);
  assert.equal(noPeriodoFechado("2026-10-19", "2026-10-20"), true);
  assert.equal(noPeriodoFechado("2026-10-21", "2026-10-20"), false);
  assert.equal(noPeriodoFechado("2026-10-19", null), false);
  assert.equal(noPeriodoFechado(null, "2026-10-20"), false);
  assert.equal(
    mensagemDoPeriodoFechado("2026-10-20"),
    "Período fechado até 20/10: reabra a conciliação para mudar esse lançamento.",
  );
});

test("a linha do histórico: fechou, reabriu com quem e por quê, e fechou de novo", () => {
  const registros: RegistroDoFechamento[] = [
    {
      id: "a",
      ate: "2026-10-19",
      fechadoEm: "2026-10-20T13:00:00Z",
      fechadoPor: "COLABORADOR 001 EXEMPLO",
      reabertoEm: "2026-10-21T14:00:00Z",
      reabertoPor: "COLABORADOR 002 EXEMPLO",
      motivo: "A baixa do frete foi na conta errada",
      ativo: false,
    },
    {
      id: "b",
      ate: "2026-10-20",
      fechadoEm: "2026-10-21T15:00:00Z",
      fechadoPor: "COLABORADOR 001 EXEMPLO",
      reabertoEm: null,
      reabertoPor: null,
      motivo: null,
      ativo: true,
    },
  ];
  assert.equal(
    linhaDoHistorico(registros),
    "fechada até 19/10 em 20/10/2026 · reaberta em 21/10/2026 por COLABORADOR 002 EXEMPLO: “A baixa do frete foi na conta errada” · fechada até 20/10 em 21/10/2026",
  );
  assert.equal(eventosDoHistorico(registros), 3);
  assert.equal(eventosDoHistorico(registros.slice(1)), 1);
});

test("o dia do histórico é o de Brasília", () => {
  const r: RegistroDoFechamento = {
    id: "c",
    ate: "2026-10-20",
    // 01:30 UTC de 22/10 ainda é 21/10 em Brasília.
    fechadoEm: "2026-10-22T01:30:00Z",
    fechadoPor: "COLABORADOR 001 EXEMPLO",
    reabertoEm: null,
    reabertoPor: null,
    motivo: null,
    ativo: true,
  };
  assert.equal(linhaDoHistorico([r]), "fechada até 20/10 em 21/10/2026");
});
