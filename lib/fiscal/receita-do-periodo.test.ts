/**
 * A receita do período que divide a guia entre as regionais (decisão 277).
 *
 * Rodar: node --import tsx --test lib/fiscal/receita-do-periodo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDaReceita, periodoDe, receitaDoHistorico } from "./receita-do-periodo";

test("o período do mês e do trimestre", () => {
  assert.deepEqual(periodoDe("2026-09"), { inicio: "2026-09-01", fim: "2026-09-30" });
  assert.deepEqual(periodoDe("2026-T3"), { inicio: "2026-07-01", fim: "2026-09-30" });
});

test("o histórico reparte pela regional do job: id resolvido, divisão por código (AGE = Agency, DOC = Doca) ou sem regional", () => {
  const regionais = new Map([
    ["cal", [{ id: "ne", nome: "NE" }, { id: "sp", nome: "SP" }, { id: "ss", nome: "SS" }]],
    ["cch", [{ id: "agency", nome: "Agency" }, { id: "doca", nome: "Doca" }]],
  ]);
  const partes = receitaDoHistorico(
    [
      { empresa_id: "cal", empresa_nome: "Agência California", valor: 1000, regional_id: "ss", rateio_regional: null },
      { empresa_id: "cal", empresa_nome: "Agência California", valor: 2000, regional_id: null, rateio_regional: { NE: 0.5, SP: 0.5 } },
      { empresa_id: "cch", empresa_nome: "CCH", valor: 900, regional_id: null, rateio_regional: { AGE: 2, DOC: 1 } },
      { empresa_id: "cal", empresa_nome: "Agência California", valor: 100, regional_id: null, rateio_regional: null },
      { empresa_id: null, empresa_nome: "—", valor: 50, regional_id: null, rateio_regional: null },
    ],
    regionais,
  );
  const base = baseDaReceita(partes);
  assert.deepEqual(
    base.map((b) => [b.empresa_id, b.regional_nome, b.valor]),
    [
      ["cal", "SS", 1000],
      ["cal", "NE", 1000],
      ["cal", "SP", 1000],
      ["cch", "Agency", 600],
      ["cch", "Doca", 300],
      ["cal", null, 100],
    ],
  );
  assert.equal(base.reduce((s, b) => s + b.pct, 0).toFixed(0), "100");
});
