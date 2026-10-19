/**
 * Decisão 185: a errata em revisão trava o envio de PP só na linha que ela
 * mudou, e só enquanto a revisão não foi registrada.
 *
 * Rodar: `npm run test:linhas-da-revisao`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inicioDaRevisao, linhasAlteradasDesde } from "./linhas-da-revisao";

const abertura = "2026-10-01T12:00:00+00:00";
const revisao = "2026-10-10T12:00:00+00:00";

test("a janela começa no último registro, ou na abertura sem registro", () => {
  assert.equal(inicioDaRevisao(abertura, revisao), new Date(revisao).getTime());
  assert.equal(inicioDaRevisao(abertura, null), new Date(abertura).getTime());
  assert.equal(inicioDaRevisao(null, null), null);
});

test("só as erratas depois do último registro travam linha", () => {
  const linhas = linhasAlteradasDesde(
    [
      // Já revisada: o registro de 10/10 conferiu esta errata.
      { created_at: "2026-10-05T12:00:00+00:00", itens: [{ job_item_orcado_id: "a" }] },
      { created_at: "2026-10-16T12:00:00+00:00", itens: [{ job_item_orcado_id: "b" }] },
      { created_at: "2026-10-16T13:00:00+00:00", itens: [{ job_item_orcado_id: "c" }] },
    ],
    inicioDaRevisao(abertura, revisao),
  );
  assert.deepEqual([...linhas].sort(), ["b", "c"]);
});

test("errata só de organização e linha removida não travam nada", () => {
  const linhas = linhasAlteradasDesde(
    [
      // Decisão 162: mover item e renomear grupo não gravam linha.
      { created_at: "2026-10-16T12:00:00+00:00", itens: [] },
      { created_at: "2026-10-16T12:00:00+00:00", itens: null },
      // A linha removida não existe mais para receber PP.
      { created_at: "2026-10-16T12:00:00+00:00", itens: [{ job_item_orcado_id: null }] },
    ],
    inicioDaRevisao(abertura, revisao),
  );
  assert.equal(linhas.size, 0);
});

test("errata no mesmo instante do registro já foi revisada", () => {
  const linhas = linhasAlteradasDesde(
    [{ created_at: revisao, itens: [{ job_item_orcado_id: "a" }] }],
    inicioDaRevisao(abertura, revisao),
  );
  assert.equal(linhas.size, 0);
});
