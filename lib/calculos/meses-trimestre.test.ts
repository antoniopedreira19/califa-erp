/**
 * Testes das datas do modelo mensal — decisão 078.
 *
 * Rode com:  node --import tsx --test lib/calculos/meses-trimestre.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  erroDoPeriodoMensal,
  mesesDoPeriodo,
  mesesDoTrimestre,
  mesmoTrimestre,
  periodoQueAcompanhaOsMeses,
  rotuloMes,
  rotuloTrimestre,
  siglaTrimestre,
  trimestreDe,
  ultimoDiaDoMes,
} from "./meses-trimestre";

test("trimestre de uma data", () => {
  assert.deepEqual(trimestreDe("2026-07-15"), { ano: 2026, trimestre: 3 });
  assert.deepEqual(trimestreDe("2027-03-31"), { ano: 2027, trimestre: 1 });
  assert.deepEqual(trimestreDe("2026-12-01"), { ano: 2026, trimestre: 4 });
});

test("meses do trimestre", () => {
  assert.deepEqual(mesesDoTrimestre({ ano: 2026, trimestre: 3 }), [
    "2026-07-01",
    "2026-08-01",
    "2026-09-01",
  ]);
});

test("meses do período, inclusive primeiro trimestre parcial e ano futuro", () => {
  assert.deepEqual(mesesDoPeriodo({ inicio: "2026-07-01", fim: "2026-09-30" }), [
    "2026-07-01",
    "2026-08-01",
    "2026-09-01",
  ]);
  assert.deepEqual(mesesDoPeriodo({ inicio: "2027-02-10", fim: "2027-03-31" }), [
    "2027-02-01",
    "2027-03-01",
  ]);
  assert.deepEqual(mesesDoPeriodo({ inicio: "2026-11-05", fim: "2026-11-20" }), [
    "2026-11-01",
  ]);
});

test("período no mesmo trimestre", () => {
  assert.equal(mesmoTrimestre("2026-07-01", "2026-09-30"), true);
  assert.equal(mesmoTrimestre("2026-09-15", "2026-10-15"), false);
  assert.equal(mesmoTrimestre("2026-03-01", "2027-03-01"), false);
});

test("último dia do mês, com fevereiro bissexto", () => {
  assert.equal(ultimoDiaDoMes("2026-02-10"), "2026-02-28");
  assert.equal(ultimoDiaDoMes("2028-02-10"), "2028-02-29");
  assert.equal(ultimoDiaDoMes("2026-09-01"), "2026-09-30");
});

test("apagar julho: o início vai para 01/08 e o fim digitado fica", () => {
  assert.deepEqual(
    periodoQueAcompanhaOsMeses({ inicio: "2026-07-01", fim: "2026-09-30" }, [
      "2026-08-01",
      "2026-09-01",
    ]),
    { inicio: "2026-08-01", fim: "2026-09-30" },
  );
});

test("apagar setembro: o fim vai para o último dia de agosto", () => {
  assert.deepEqual(
    periodoQueAcompanhaOsMeses({ inicio: "2026-07-01", fim: "2026-09-20" }, [
      "2026-07-01",
      "2026-08-01",
    ]),
    { inicio: "2026-07-01", fim: "2026-08-31" },
  );
});

test("adicionar julho de volta: o início vai para 01/07", () => {
  assert.deepEqual(
    periodoQueAcompanhaOsMeses({ inicio: "2026-08-15", fim: "2026-09-30" }, [
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]),
    { inicio: "2026-07-01", fim: "2026-09-30" },
  );
});

test("a ponta que não mudou mantém o dia digitado", () => {
  assert.deepEqual(
    periodoQueAcompanhaOsMeses({ inicio: "2026-08-15", fim: "2026-09-20" }, [
      "2026-08-01",
      "2026-09-01",
    ]),
    { inicio: "2026-08-15", fim: "2026-09-20" },
  );
});

test("sem mês não há período", () => {
  assert.equal(periodoQueAcompanhaOsMeses({ inicio: "2026-07-01", fim: "2026-09-30" }, []), null);
});

test("rótulos", () => {
  assert.equal(rotuloMes("2026-07-01"), "Julho de 2026");
  assert.equal(rotuloMes("2026-03-01"), "Março de 2026");
  assert.equal(rotuloTrimestre({ ano: 2026, trimestre: 3 }), "3º trimestre de 2026");
  assert.equal(siglaTrimestre({ ano: 2026, trimestre: 3 }), "3T/2026");
});

test("validação do período do orçamento mensal", () => {
  assert.equal(erroDoPeriodoMensal("2026-07-01", "2026-09-30"), null);
  assert.equal(erroDoPeriodoMensal("2027-10-01", "2027-12-31"), null);
  assert.match(erroDoPeriodoMensal(null, "2026-09-30") ?? "", /início e o fim/);
  assert.match(erroDoPeriodoMensal("2026-09-15", "2026-10-15") ?? "", /mesmo trimestre/);
  assert.match(erroDoPeriodoMensal("2026-09-30", "2026-07-01") ?? "", /posterior/);
  assert.match(erroDoPeriodoMensal("2026-02-30", "2026-03-31") ?? "", /início e o fim/);
});
