/**
 * A planilha modelo do modal de importação (decisão 110).
 *
 * Rode com:  node --import tsx --test lib/exportacao/modelo-de-planilha.test.ts
 *
 * O modelo baixado tem que voltar pelo importador no modelo certo — é a
 * garantia de que o "Baixar planilha modelo" não entrega um arquivo que o
 * próprio ERP recusa.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { montarPlanilhaModelo } from "./modelo-de-planilha";
import { parseOficial } from "../importacao/parser-oficial";

async function lerDeVolta(modelo: "nacional" | "internacional" | "mensal", meses: string[] = []) {
  const wb = montarPlanilhaModelo(modelo, meses);
  return parseOficial(Buffer.from(await wb.xlsx.writeBuffer()), { mensal: modelo === "mensal" });
}

test("o modelo nacional volta pelo importador como nacional, na aba Padrão, sem itens", async () => {
  const lido = await lerDeVolta("nacional");
  assert.equal(lido.modelo, "nacional");
  assert.equal(lido.aba, "Padrão");
  assert.equal(lido.grupos.length, 0);
  assert.ok(!lido.warnings.some((w) => w.motivo.startsWith("Não encontramos a linha de header")));
});

test("o modelo internacional volta como internacional", async () => {
  const lido = await lerDeVolta("internacional");
  assert.equal(lido.modelo, "internacional");
  assert.ok(!lido.warnings.some((w) => w.motivo.startsWith("Não encontramos a linha de header")));
});

test("o modelo mensal traz um bloco por mês", async () => {
  const lido = await lerDeVolta("mensal", ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.deepEqual(
    lido.meses.map((m) => m.mes),
    ["2026-10-01", "2026-11-01", "2026-12-01"],
  );
});
