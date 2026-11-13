/**
 * A leitura página a página, sem o corte de 1.000 do PostgREST (decisão 255).
 * Rodar: node --import tsx --test lib/supabase/todas-as-linhas.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINHAS_POR_PAGINA, todasAsLinhas } from "./todas-as-linhas";

/** Um "banco" de `total` linhas que responde como o PostgREST: no máximo
 *  1.000 por pedido, do `de` ao `ate`. */
function banco(total: number) {
  const pedidos: Array<[number, number]> = [];
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }));
  const pagina = (de: number, ate: number) => {
    pedidos.push([de, ate]);
    return Promise.resolve({
      data: linhas.slice(de, Math.min(ate + 1, de + LINHAS_POR_PAGINA)),
      error: null,
    });
  };
  return { pagina, pedidos };
}

test("menos de 1.000: um pedido só", async () => {
  const b = banco(412);
  const res = await todasAsLinhas(b.pagina);
  assert.equal(res.data.length, 412);
  assert.equal(res.error, null);
  assert.deepEqual(b.pedidos, [[0, 999]]);
});

test("3.378 linhas: quatro páginas, nenhuma repetida nem perdida", async () => {
  const b = banco(3378);
  const res = await todasAsLinhas(b.pagina);
  assert.equal(res.data.length, 3378);
  assert.equal(new Set(res.data.map((l) => l.id)).size, 3378);
  assert.deepEqual(b.pedidos, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
    [3000, 3999],
  ]);
});

test("exatamente 1.000: pede a segunda página e para no vazio", async () => {
  const b = banco(1000);
  const res = await todasAsLinhas(b.pagina);
  assert.equal(res.data.length, 1000);
  assert.equal(b.pedidos.length, 2);
});

test("erro numa página: devolve o erro e o que já veio", async () => {
  let n = 0;
  const res = await todasAsLinhas(() => {
    n++;
    return Promise.resolve(
      n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: { message: "timeout" } },
    );
  });
  assert.equal(res.data.length, 1000);
  assert.equal(res.error?.message, "timeout");
});
