/**
 * Testes da ordem dos itens da planilha — decisão 104.
 *
 * Rode com:  node --import tsx --test lib/calculos/ordem-itens.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  destinoPorTecla,
  gruposNaOrdemDaTela,
  moverNaLista,
  numerarItens,
  ordensAlteradas,
} from "./ordem-itens";

/** A v1 do print: 4 agrupamentos, 11 itens. */
function planilha() {
  const g = (id: string, ...itens: string[]) => ({
    id,
    nome: `Agrupamento ${id}`,
    itens: itens.map((i) => ({ id: i })),
  });
  return [
    g("g1", "a1", "a2", "a3", "a4"),
    g("g2", "b1", "b2", "b3"),
    g("g3", "c1", "c2", "c3"),
    g("g4", "d1"),
  ];
}

const ids = (grupos: { id: string; itens: { id: string }[] }[]) =>
  grupos.map((g) => `${g.id}:${g.itens.map((i) => i.id).join(",")}`);

test("desce dentro do mesmo grupo", () => {
  const r = moverNaLista(planilha(), "a1", "g1", 3);
  assert.deepEqual(ids(r!), ["g1:a2,a3,a4,a1", "g2:b1,b2,b3", "g3:c1,c2,c3", "g4:d1"]);
});

test("sobe dentro do mesmo grupo", () => {
  const r = moverNaLista(planilha(), "a4", "g1", 0);
  assert.deepEqual(ids(r!).slice(0, 1), ["g1:a4,a1,a2,a3"]);
});

test("troca de agrupamento e o de origem perde o item", () => {
  const r = moverNaLista(planilha(), "b1", "g1", 1);
  assert.deepEqual(ids(r!).slice(0, 2), ["g1:a1,b1,a2,a3,a4", "g2:b2,b3"]);
});

test("índice fora da faixa vai para a ponta", () => {
  assert.deepEqual(ids(moverNaLista(planilha(), "a1", "g4", 99)!)[3], "g4:d1,a1");
  assert.deepEqual(ids(moverNaLista(planilha(), "d1", "g1", -5)!)[0], "g1:d1,a1,a2,a3,a4");
});

test("mesma posição não é movimento", () => {
  assert.equal(moverNaLista(planilha(), "a2", "g1", 1), null);
});

test("item ou grupo inexistente devolve null", () => {
  assert.equal(moverNaLista(planilha(), "zz", "g1", 0), null);
  assert.equal(moverNaLista(planilha(), "a1", "gz", 0), null);
});

test("não muta a lista recebida e preserva os outros campos do grupo", () => {
  const antes = planilha();
  const copia = JSON.stringify(antes);
  const r = moverNaLista(antes, "a1", "g2", 0)!;
  assert.equal(JSON.stringify(antes), copia);
  assert.equal(r[0].nome, "Agrupamento g1");
  assert.equal(r[2], antes[2], "grupo intocado volta o mesmo objeto");
});

test("Alt + setas: anda no grupo e atravessa para o vizinho", () => {
  const p = planilha();
  assert.deepEqual(destinoPorTecla(p, "a2", -1), { grupoId: "g1", indice: 0 });
  assert.deepEqual(destinoPorTecla(p, "a4", 1), { grupoId: "g2", indice: 0 });
  assert.deepEqual(destinoPorTecla(p, "b1", -1), { grupoId: "g1", indice: 4 });
  assert.equal(destinoPorTecla(p, "a1", -1), null);
  assert.equal(destinoPorTecla(p, "d1", 1), null);
});

test("numeração global na sequência da tela", () => {
  const r = numerarItens(moverNaLista(planilha(), "c3", "g1", 0)!);
  assert.deepEqual(r.slice(0, 2), [
    { id: "c3", grupo_id: "g1", ordem: 1 },
    { id: "a1", grupo_id: "g1", ordem: 2 },
  ]);
  assert.equal(r.length, 11);
  assert.deepEqual(r.map((x) => x.ordem), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("do banco para a tela: grupos e itens pela ordem, não pela chegada", () => {
  // Versão com a ordem global fora da sequência dos grupos — acontece
  // quando se acrescenta item num grupo de cima depois de criar os de baixo.
  const telas = gruposNaOrdemDaTela(
    [
      { id: "g2", ordem: 2 },
      { id: "g1", ordem: 1 },
    ],
    [
      { id: "x9", grupo_id: "g1", ordem: 9 },
      { id: "y1", grupo_id: "g2", ordem: 3 },
      { id: "x1", grupo_id: "g1", ordem: 1 },
    ],
  );
  assert.deepEqual(ids(telas), ["g1:x1,x9", "g2:y1"]);
});

test("só vai ao banco o que mudou", () => {
  const atuais = [
    { id: "x1", grupo_id: "g1", ordem: 1 },
    { id: "x9", grupo_id: "g1", ordem: 9 },
    { id: "y1", grupo_id: "g2", ordem: 3 },
  ];
  const novas = numerarItens(
    gruposNaOrdemDaTela(
      [
        { id: "g1", ordem: 1 },
        { id: "g2", ordem: 2 },
      ],
      atuais,
    ),
  );
  assert.deepEqual(ordensAlteradas(atuais, novas), [
    { id: "x9", grupo_id: "g1", ordem: 2 },
  ]);
});
