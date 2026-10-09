/**
 * Testes da organização da planilha na errata — decisão 162.
 *
 * Rode com:  node --import tsx --test lib/calculos/organizacao-errata.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  erroDoNomeDoGrupo,
  gruposQueSaem,
  mudancasDeEstrutura,
  resumoDaEstrutura,
  type Organizacao,
} from "./organizacao-errata";

/** O print do Tiago, resumido: EQUIPE, CONTEÚDO (1 item) e TOOLKIT. */
function antes(): Organizacao {
  return {
    grupos: [
      { id: "g1", nome: "EQUIPE", mesId: null },
      { id: "g2", nome: "CONTEÚDO", mesId: null },
      { id: "g3", nome: "TOOLKIT", mesId: null },
      { id: "g4", nome: "VAZIO DESDE SEMPRE", mesId: null },
    ],
    linhas: [
      { id: "e1", grupoId: "g1", item: "Produtor" },
      { id: "e2", grupoId: "g1", item: "DA" },
      { id: "c1", grupoId: "g2", item: "Fotógrafo" },
      { id: "t1", grupoId: "g3", item: "Bandeiras" },
      { id: "t2", grupoId: "g3", item: "Toalhas" },
      { id: "t3", grupoId: "g3", item: "Bandeiras" },
    ],
  };
}

test("sem mudança, nada muda e nada sai", () => {
  const a = antes();
  assert.deepEqual(mudancasDeEstrutura(a, a, new Map()), []);
  assert.deepEqual(gruposQueSaem(a, a), []);
});

test("o grupo que ficou vazio sai; o que já era vazio fica", () => {
  const a = antes();
  const d: Organizacao = {
    grupos: a.grupos,
    linhas: [
      { id: "e1", grupoId: "g1", item: "Produtor" },
      { id: "e2", grupoId: "g1", item: "DA" },
      { id: "c1", grupoId: "g1", item: "Fotógrafo" },
      ...a.linhas.filter((l) => l.grupoId === "g3"),
    ],
  };
  assert.deepEqual(gruposQueSaem(a, d), ["g2"]);
  const m = mudancasDeEstrutura(a, d, new Map());
  assert.deepEqual(m, [
    { tipo: "grupo_removido", chave: "g2", nome: "CONTEÚDO" },
    { tipo: "item_movido", chave: "c1", item: "Fotógrafo", de: "CONTEÚDO", para: "EQUIPE" },
  ]);
  assert.deepEqual(resumoDaEstrutura(m), ["1 item movido", "1 grupo removido"]);
});

test("grupo novo com item aparece; vazio não nasce", () => {
  const a = antes();
  const d: Organizacao = {
    grupos: [...a.grupos, { id: "novo:1", nome: "ENXOVAL ", mesId: null }, { id: "novo:2", nome: "SOBRA", mesId: null }],
    linhas: a.linhas.map((l) => (l.id === "t2" ? { ...l, grupoId: "novo:1" } : l)),
  };
  assert.deepEqual(gruposQueSaem(a, d), ["novo:2"]);
  const m = mudancasDeEstrutura(a, d, new Map());
  assert.deepEqual(
    m.map((x) => x.tipo),
    ["grupo_novo", "item_movido"],
  );
  assert.equal((m[0] as { nome: string }).nome, "ENXOVAL");
});

test("renomear para o mesmo nome não é mudança; trocar é", () => {
  const a = antes();
  const igual: Organizacao = { ...a, grupos: a.grupos.map((g) => (g.id === "g3" ? { ...g, nome: "TOOLKIT " } : g)) };
  assert.deepEqual(mudancasDeEstrutura(a, igual, new Map()), []);
  const outro: Organizacao = { ...a, grupos: a.grupos.map((g) => (g.id === "g3" ? { ...g, nome: "BANDEIRAS" } : g)) };
  assert.deepEqual(mudancasDeEstrutura(a, outro, new Map()), [
    { tipo: "grupo_renomeado", chave: "g3", de: "TOOLKIT", para: "BANDEIRAS" },
  ]);
});

test("ordem: só conta quem já era do grupo", () => {
  const a = antes();
  // t3 sobe para o topo do TOOLKIT: ordem alterada.
  const d: Organizacao = {
    grupos: a.grupos,
    linhas: [
      ...a.linhas.filter((l) => l.grupoId !== "g3"),
      { id: "t3", grupoId: "g3", item: "Bandeiras" },
      { id: "t1", grupoId: "g3", item: "Bandeiras" },
      { id: "t2", grupoId: "g3", item: "Toalhas" },
    ],
  };
  assert.deepEqual(mudancasDeEstrutura(a, d, new Map()), [
    { tipo: "ordem", chave: "ordem:g3", grupo: "TOOLKIT" },
  ]);
  // O Fotógrafo chegando no topo da EQUIPE é "movido", não "ordem".
  const chegou: Organizacao = {
    grupos: a.grupos,
    linhas: [
      { id: "c1", grupoId: "g1", item: "Fotógrafo" },
      ...a.linhas.filter((l) => l.grupoId === "g1" || l.grupoId === "g3"),
    ],
  };
  assert.deepEqual(
    mudancasDeEstrutura(a, chegou, new Map()).map((m) => m.tipo),
    ["grupo_removido", "item_movido"],
  );
});

test("linha nova no fim do grupo onde nasceu não é ordem; no topo, é", () => {
  const a = antes();
  const novas = new Map([["nova:1", "g1"]]);
  const noFim: Organizacao = {
    grupos: a.grupos,
    linhas: [
      ...a.linhas.filter((l) => l.grupoId === "g1"),
      { id: "nova:1", grupoId: "g1", item: "Motorista" },
      ...a.linhas.filter((l) => l.grupoId !== "g1"),
    ],
  };
  assert.deepEqual(mudancasDeEstrutura(a, noFim, novas), []);
  const noTopo: Organizacao = {
    grupos: a.grupos,
    linhas: [{ id: "nova:1", grupoId: "g1", item: "Motorista" }, ...a.linhas],
  };
  assert.deepEqual(mudancasDeEstrutura(a, noTopo, novas), [
    { tipo: "ordem", chave: "ordem:g1", grupo: "EQUIPE" },
  ]);
});

test("nome: vazio, longo, repetido no job e no mês", () => {
  const g = antes().grupos;
  assert.equal(erroDoNomeDoGrupo("  ", null, g, null), "Informe o nome do grupo.");
  assert.equal(erroDoNomeDoGrupo("x".repeat(121), null, g, null), "Máximo 120 caracteres.");
  assert.equal(erroDoNomeDoGrupo("equipe", null, g, null), "Já existe um grupo com esse nome neste job.");
  assert.equal(erroDoNomeDoGrupo("EQUIPE", null, g, "g1"), null);
  const mensal = [
    { id: "o1", nome: "EQUIPE", mesId: "out" },
    { id: "n1", nome: "EQUIPE", mesId: "nov" },
  ];
  assert.equal(erroDoNomeDoGrupo("Equipe", "dez", mensal, null), null);
  assert.equal(erroDoNomeDoGrupo("Equipe", "out", mensal, null), "Já existe um grupo com esse nome neste mês.");
});
