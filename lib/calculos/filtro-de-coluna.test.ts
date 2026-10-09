/**
 * Testes do filtro pelo título da coluna — decisão 165.
 *
 * Rode com:  node --import tsx --test lib/calculos/filtro-de-coluna.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FILTRO_VAZIO,
  celulaData,
  celulaTexto,
  filtroAtivo,
  marcaDoGrupo,
  marcadoNoFiltro,
  novoFiltroDaLista,
  passaNaColuna,
  type FiltroDaColuna,
} from "./filtro-de-coluna";

/** O Status dos Títulos a Pagar no chip "A pagar". */
const A_PAGAR = [{ valor: "A pagar" }, { valor: "Parcial" }];

/** A Origem dos Títulos a Pagar: árvore tipo ▸ código. */
const ORIGEM = [
  { valor: "PP-00034", grupo: "PPs" },
  { valor: "PP-00040", grupo: "PPs" },
  { valor: "AV-001", grupo: "Avulsos" },
];

const marcado = (f: FiltroDaColuna, valor: string, grupo?: string) => marcadoNoFiltro(f, valor, grupo);

test("desmarcar um valor guarda 'todos menos este': valor novo chega marcado", () => {
  const f = novoFiltroDaLista(FILTRO_VAZIO, A_PAGAR, ["A pagar"]);
  assert.deepEqual(f.desmarcados, ["Parcial"]);
  assert.equal(f.marcados, null);
  // O chip "Pagos" traz "Pago", que não existia na hora do filtro.
  assert.equal(marcado(f, "Pago"), true);
  assert.equal(marcado(f, "Parcial"), false);
});

test("desmarcar o ÚNICO valor da coluna é 'menos este', não 'nenhum'", () => {
  // O "Em avaliação" das PPs: era o único valor; trocar para "Aprovadas"
  // zerava a tabela.
  const f = novoFiltroDaLista(FILTRO_VAZIO, [{ valor: "Em avaliação" }], []);
  assert.deepEqual(f.desmarcados, ["Em avaliação"]);
  assert.equal(marcado(f, "Aprovada"), true);
});

test("'(Selecionar tudo)' desmarcado começa um 'só estes': valor novo chega desmarcado", () => {
  const vazio = novoFiltroDaLista(FILTRO_VAZIO, A_PAGAR, [], { recomecar: true });
  assert.deepEqual(vazio.marcados, []);
  const so = novoFiltroDaLista(vazio, A_PAGAR, ["Parcial"]);
  assert.deepEqual(so.marcados, ["Parcial"]);
  assert.equal(marcado(so, "Pago"), false);
});

test("tudo marcado de novo: a coluna deixa de filtrar", () => {
  const f = novoFiltroDaLista(FILTRO_VAZIO, A_PAGAR, ["A pagar"]);
  const de_novo = novoFiltroDaLista(f, A_PAGAR, ["A pagar", "Parcial"]);
  assert.equal(filtroAtivo(de_novo), false);
});

test("grupo inteiro desmarcado vale para o grupo, inclusive o que aparecer depois", () => {
  const f = novoFiltroDaLista(FILTRO_VAZIO, ORIGEM, ["AV-001"], { grupo: "PPs" });
  assert.ok(f.desmarcados?.includes(marcaDoGrupo("PPs")));
  // PP paga, de outro código, chega no chip "Pagos": continua fora.
  assert.equal(marcado(f, "PP-00099", "PPs"), false);
  // Um avulso novo entra.
  assert.equal(marcado(f, "AV-002", "Avulsos"), true);
});

test("remarcar um item do grupo desmarcado tira a marca do grupo", () => {
  const sem = novoFiltroDaLista(FILTRO_VAZIO, ORIGEM, ["AV-001"], { grupo: "PPs" });
  const volta = novoFiltroDaLista(sem, ORIGEM, ["AV-001", "PP-00034"]);
  assert.equal(volta.desmarcados?.includes(marcaDoGrupo("PPs")), false);
  assert.deepEqual(volta.desmarcados, ["PP-00040"]);
  // Agora a PP nova entra: o grupo não está mais inteiro fora.
  assert.equal(marcado(volta, "PP-00099", "PPs"), true);
});

test("'só estes' por grupo: o grupo marcado traz o item novo dele", () => {
  const vazio = novoFiltroDaLista(FILTRO_VAZIO, ORIGEM, [], { recomecar: true });
  const soAvulsos = novoFiltroDaLista(vazio, ORIGEM, ["AV-001"], { grupo: "Avulsos" });
  assert.ok(soAvulsos.marcados?.includes(marcaDoGrupo("Avulsos")));
  assert.equal(marcado(soAvulsos, "AV-777", "Avulsos"), true);
  assert.equal(marcado(soAvulsos, "PP-00099", "PPs"), false);
});

test("o que outra coluna escondeu fica como estava", () => {
  // "Parcial" foi desmarcado com a lista inteira; depois outra coluna deixa
  // só "A pagar" na lista e o clique tira "A pagar" também.
  const f = novoFiltroDaLista(FILTRO_VAZIO, A_PAGAR, ["A pagar"]);
  const g = novoFiltroDaLista(f, [{ valor: "A pagar" }], []);
  assert.deepEqual(new Set(g.desmarcados), new Set(["Parcial", "A pagar"]));
});

test("célula de vários valores passa se ALGUM estiver marcado", () => {
  const marcas = [celulaTexto("LUPULADA"), celulaTexto("SOL DE VERÃO")];
  const semLupulada: FiltroDaColuna = { ...FILTRO_VAZIO, desmarcados: ["LUPULADA"] };
  assert.equal(passaNaColuna(marcas, semLupulada, false), true);
  const semAsDuas: FiltroDaColuna = { ...FILTRO_VAZIO, desmarcados: ["LUPULADA", "SOL DE VERÃO"] };
  assert.equal(passaNaColuna(marcas, semAsDuas, false), false);
});

test("busca da coluna ignora acento e acha pelo texto de busca", () => {
  const c = { ...celulaTexto("Diárias"), busca: "Diárias equipe técnica" };
  assert.equal(passaNaColuna([c], { ...FILTRO_VAZIO, busca: "tecnica" }, false), true);
  assert.equal(passaNaColuna([c], { ...FILTRO_VAZIO, busca: "hotel" }, false), false);
});

test("faixa 'de / até' olha o número da célula", () => {
  const v = [{ valor: "900000", rotulo: "R$ 9.000,00", ordem: 9000 }];
  assert.equal(passaNaColuna(v, { ...FILTRO_VAZIO, de: 9000 }, true), true);
  assert.equal(passaNaColuna(v, { ...FILTRO_VAZIO, de: 9000.01 }, true), false);
  assert.equal(passaNaColuna(v, { ...FILTRO_VAZIO, ate: 9000 }, true), true);
});

test("data vira dia dentro do mês, e o mês desmarcado inteiro vale para o dia novo", () => {
  const d = celulaData("2026-10-05");
  assert.equal(d.rotulo, "05/10/2026");
  assert.equal(d.grupo, "outubro de 2026");
  const semOutubro: FiltroDaColuna = { ...FILTRO_VAZIO, desmarcados: [marcaDoGrupo("outubro de 2026")] };
  const outroDia = celulaData("2026-10-20");
  assert.equal(passaNaColuna([outroDia], semOutubro, false), false);
  assert.equal(passaNaColuna([celulaData("2026-11-02")], semOutubro, false), true);
});
