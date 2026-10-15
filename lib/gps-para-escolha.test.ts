/**
 * Testes da lista de GP do orçamento — decisão 176.
 *
 * Rode com:  node --import tsx --test lib/gps-para-escolha.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRUPO_GPS_DO_PROJETO,
  GRUPO_OUTROS_GPS,
  gpDeFora,
  itensDeGp,
  montarGpsParaEscolha,
} from "./gps-para-escolha";

const doProjeto = [
  { id: "b", nome: "Bruna" },
  { id: "a", nome: "Ana" },
];
const ativos = [
  { id: "a", nome: "Ana" },
  { id: "c", nome: "Carlos" },
  { id: "b", nome: "Bruna" },
  { id: "d", nome: "Álvaro" },
];

test("os GPs do projeto vêm primeiro, sem repetir, cada lado por nome", () => {
  const gps = montarGpsParaEscolha(doProjeto, ativos);
  assert.equal(gps.length, 4);
  const itens = itensDeGp(gps);
  assert.deepEqual(
    itens.map((i) => [i.label, i.grupo]),
    [
      ["Ana", GRUPO_GPS_DO_PROJETO],
      ["Bruna", GRUPO_GPS_DO_PROJETO],
      ["Álvaro", GRUPO_OUTROS_GPS],
      ["Carlos", GRUPO_OUTROS_GPS],
    ],
  );
});

test("sem gente dos dois lados, a lista não mostra grupo", () => {
  const soDeFora = itensDeGp(montarGpsParaEscolha([], ativos));
  assert.ok(soDeFora.every((i) => i.grupo === undefined));
  const soDoProjeto = itensDeGp(montarGpsParaEscolha(doProjeto, doProjeto));
  assert.ok(soDoProjeto.every((i) => i.grupo === undefined));
});

test("o aviso de que o GP entra no projeto só vale para quem é de fora", () => {
  const gps = montarGpsParaEscolha(doProjeto, ativos);
  assert.equal(gpDeFora(gps, "c")?.nome, "Carlos");
  assert.equal(gpDeFora(gps, "a"), null);
  assert.equal(gpDeFora(gps, ""), null);
  assert.equal(gpDeFora(gps, "x"), null);
});
