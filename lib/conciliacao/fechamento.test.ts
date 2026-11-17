/**
 * Testes do fechamento da conciliação (decisão 205; por mês desde a decisão
 * 262): a mensagem da trava, os meses fechados e abertos da faixa, o que
 * continua fechado ao reabrir um mês e o texto de cada registro do
 * histórico. A trava em si (o gatilho) e o "Reabrir" mês a mês
 * (`reabrir_mes_da_conciliacao`) foram conferidos no banco.
 *
 * Rode com:  node --import tsx --test lib/conciliacao/fechamento.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  continuaFechadoAoReabrir,
  fimDoMesAnterior,
  fimDoMesSeguinte,
  mensagemDoPeriodoFechado,
  mesesDoFechamento,
  noPeriodoFechado,
  quemFechouOMes,
  textoDoFechado,
  textoDoRegistro,
  type RegistroDoFechamento,
} from "./fechamento";

const reg = (id: string, ate: string, extra: Partial<RegistroDoFechamento> = {}): RegistroDoFechamento => ({
  id,
  ate,
  fechadoEm: `${fimDoMesSeguinte(ate).slice(0, 8)}05T13:00:00Z`,
  fechadoPor: "COLABORADOR 001 EXEMPLO",
  reabertoEm: null,
  reabertoPor: null,
  motivo: null,
  ativo: false,
  daReabertura: false,
  ...extra,
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

test("o fim dos meses, na virada do ano e em fevereiro", () => {
  assert.equal(fimDoMesAnterior("2026-01-31"), "2025-12-31");
  assert.equal(fimDoMesAnterior("2026-03-15"), "2026-02-28");
  assert.equal(fimDoMesSeguinte("2026-12-31"), "2027-01-31");
  assert.equal(fimDoMesSeguinte("2028-01-31"), "2028-02-29");
  assert.equal(textoDoFechado("2026-10-31"), "Outubro fechado");
  assert.equal(textoDoFechado("2026-10-19"), "Fechado até 19/10");
});

test("reabrir um mês: o anterior continua fechado só se já tinha sido fechado", () => {
  const setembro = reg("a", "2026-09-30");
  const outubro = reg("b", "2026-10-31", { ativo: true });
  assert.equal(continuaFechadoAoReabrir({ ativo: outubro, registros: [setembro, outubro] }), "2026-09-30");
  // Outubro foi o primeiro fechamento da conta: reabrir deixa a conta toda aberta.
  assert.equal(continuaFechadoAoReabrir({ ativo: outubro, registros: [outubro] }), null);
  // Um fechamento antigo, por dia, antes de setembro também conta.
  assert.equal(continuaFechadoAoReabrir({ ativo: outubro, registros: [reg("c", "2026-08-19"), outubro] }), "2026-09-30");
  // Um fechamento por dia no meio de outubro não é de setembro.
  assert.equal(continuaFechadoAoReabrir({ ativo: outubro, registros: [reg("d", "2026-10-08"), outubro] }), null);
  assert.equal(continuaFechadoAoReabrir({ ativo: null, registros: [setembro] }), null);
});

test("a faixa: os fechados (os 3 últimos) e cada mês aberto até o de hoje", () => {
  const registros = ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"].map((ate, i) => reg(String(i), ate));
  const ativo = { ...registros[3], ativo: true };
  const f = { ativo, ultimo: ativo, registros: [...registros.slice(0, 3), ativo] };
  assert.deepEqual(mesesDoFechamento(f, "2026-11-16"), {
    fechados: ["2026-07-31", "2026-08-31", "2026-09-30"],
    maisAntigos: true,
    parcialAte: null,
    abertos: ["2026-10-31", "2026-11-30"],
  });
  // Sem nenhum fechamento, a faixa não aparece.
  assert.deepEqual(mesesDoFechamento({ ativo: null, ultimo: null, registros: [] }, "2026-11-16").abertos, []);
});

test("a faixa com o mês reaberto e com o fechamento antigo, por dia", () => {
  // Outubro reaberto sem setembro fechado antes: a conta toda aberta, de outubro em diante.
  const reaberto = reg("a", "2026-10-31", { reabertoEm: "2026-11-16T12:00:00Z", reabertoPor: "COLABORADOR 002 EXEMPLO", motivo: "Baixa na conta errada." });
  assert.deepEqual(mesesDoFechamento({ ativo: null, ultimo: reaberto, registros: [reaberto] }, "2026-11-16"), {
    fechados: [],
    maisAntigos: false,
    parcialAte: null,
    abertos: ["2026-10-31", "2026-11-30"],
  });
  // O fechamento de antes da decisão 262, até 19/10: outubro aberto, com o "Fechado até 19/10"
  // (como no primeiro fechamento por mês, o que vem antes do primeiro registro não aparece).
  const antigo = reg("b", "2026-10-19", { ativo: true });
  assert.deepEqual(mesesDoFechamento({ ativo: antigo, ultimo: antigo, registros: [antigo] }, "2026-11-16"), {
    fechados: [],
    maisAntigos: false,
    parcialAte: "2026-10-19",
    abertos: ["2026-10-31", "2026-11-30"],
  });
});

test("o histórico em palavras de mês, com o mês que continuou fechado", () => {
  const outubro = reg("b", "2026-10-31", {
    reabertoEm: "2026-11-16T14:00:00Z",
    reabertoPor: "COLABORADOR 002 EXEMPLO",
    motivo: "A baixa do frete foi na conta errada.",
  });
  assert.equal(
    textoDoRegistro(outubro),
    "Outubro fechado em 05/11/2026 por COLABORADOR 001 EXEMPLO · reaberto em 16/11/2026 por COLABORADOR 002 EXEMPLO: “A baixa do frete foi na conta errada”",
  );
  const mantido = reg("c", "2026-09-30", { fechadoEm: "2026-11-16T14:00:00Z", fechadoPor: "COLABORADOR 002 EXEMPLO", daReabertura: true, ativo: true });
  assert.equal(textoDoRegistro(mantido), "Setembro continuou fechado ao reabrir outubro em 16/11/2026");
  // O dia é o de Brasília: 01:30 UTC de 22/10 ainda é 21/10.
  assert.equal(textoDoRegistro(reg("d", "2026-10-20", { fechadoEm: "2026-10-22T01:30:00Z" })), "Fechado até 20/10/2026 em 21/10/2026 por COLABORADOR 001 EXEMPLO");
  // Quem fechou setembro foi quem fechou de verdade, não a reabertura de outubro.
  const setembro = reg("a", "2026-09-30");
  assert.equal(quemFechouOMes([setembro, outubro, mantido], "2026-09-30")?.id, "a");
  assert.equal(quemFechouOMes([outubro, mantido], "2026-09-30"), null);
});
