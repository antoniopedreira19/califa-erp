/**
 * Testes do botão Voltar — decisão 108.
 *
 * Rode com:  node --import tsx --test lib/voltar.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RASTRO_VAZIO,
  chaveDaPagina,
  destinoDoVoltar,
  marcarVoltar,
  nomeDaPagina,
  registrarNavegacao,
  type Marcas,
  type Rastro,
} from "./voltar";

/** Navega por uma sequência de URLs, como cliques em links. */
function navegar(...urls: string[]): Rastro {
  return urls.reduce((r, u) => registrarNavegacao(r, u, { popstate: false }), RASTRO_VAZIO);
}

const atual = (r: Rastro) => r.entradas[r.cursor];

test("sem rastro, vale a reserva", () => {
  assert.deepEqual(destinoDoVoltar(RASTRO_VAZIO, {}, "/financeiro/contas-a-pagar", "/financeiro"), {
    href: "/financeiro",
    indice: null,
  });
});

test("volta para a página anterior, com a URL de quando saiu dela", () => {
  const r = navegar(
    "/financeiro/contas-a-pagar",
    "/financeiro/contas-a-pagar?tab=recorrentes",
    "/financeiro/contas-a-pagar/recorrente/r1",
  );
  assert.equal(r.entradas.length, 2, "trocar de aba não é página nova");
  assert.deepEqual(
    destinoDoVoltar(r, {}, atual(r), "/financeiro/contas-a-pagar"),
    { href: "/financeiro/contas-a-pagar?tab=recorrentes", indice: 0 },
  );
});

test("versão e mês do orçamento não contam como página", () => {
  const r = navegar("/orcamentos/p1", "/orcamentos/p1/o1", "/orcamentos/p1/o1?v=v2", "/orcamentos/p1/o1?v=v2&mes=2026-10");
  assert.deepEqual(destinoDoVoltar(r, {}, atual(r), "/orcamentos/p1"), { href: "/orcamentos/p1", indice: 0 });
});

test("a Home como página anterior leva ao início do módulo (a reserva)", () => {
  const r = navegar("/home", "/financeiro/contas-a-receber?filtro=vencidas");
  assert.deepEqual(destinoDoVoltar(r, {}, atual(r), "/financeiro"), { href: "/financeiro", indice: null });
});

test("a página atual fora do rastro (primeiro instante) cai na reserva", () => {
  const r = navegar("/jobs", "/jobs/j1");
  assert.equal(destinoDoVoltar(r, {}, "/jobs/j2", "/jobs").href, "/jobs");
});

const marcasJobs: Marcas = {
  "/jobs/projeto/p1": { grupo: "jobs:/jobs/projeto/p1" },
  "/jobs/j42": { grupo: "jobs:/jobs/projeto/p1" },
  "/jobs/j44": { grupo: "jobs:/jobs/projeto/p1" },
  "/orcamentos/p1/o1": { grupo: "orcamentos:/orcamentos/p1/agregado" },
  "/orcamentos/p1/agregado": { grupo: "orcamentos:/orcamentos/p1/agregado" },
};

test("faixa do projeto: as abas são puladas (I6, job X → job Y)", () => {
  const r = navegar("/orcamentos/p1", "/orcamentos/p1/o1", "/jobs/j42", "/jobs/j44");
  assert.deepEqual(destinoDoVoltar(r, marcasJobs, atual(r), "/orcamentos/p1/o2"), {
    href: "/orcamentos/p1/o1",
    indice: 1,
  });
});

test("faixa do projeto: agregada aberta do job volta à origem do job (I5)", () => {
  const r = navegar("/orcamentos/p1/o1", "/jobs/j42", "/jobs/projeto/p1");
  assert.equal(destinoDoVoltar(r, marcasJobs, atual(r), "/jobs").href, "/orcamentos/p1/o1");
});

test("faixa de Orçamentos: projeto → agregada → orçamento volta ao projeto (I3)", () => {
  const r = navegar("/orcamentos", "/orcamentos/p1", "/orcamentos/p1/agregado", "/orcamentos/p1/o1");
  assert.equal(destinoDoVoltar(r, marcasJobs, atual(r), "/orcamentos/p1").href, "/orcamentos/p1");
});

test("o job no Financeiro volta para a Conciliação de onde foi aberto (I12)", () => {
  const r = navegar(
    "/financeiro/conciliacao",
    "/financeiro/conciliacao?conta=c1&de=2026-09-01&ate=2026-09-30",
    "/financeiro/jobs/j42",
  );
  assert.equal(
    destinoDoVoltar(r, {}, atual(r), "/financeiro/abertura-de-job?aba=abertos").href,
    "/financeiro/conciliacao?conta=c1&de=2026-09-01&ate=2026-09-30",
  );
});

test("o extrato da conciliação é outra página que a lista de contas", () => {
  assert.notEqual(chaveDaPagina("/financeiro/conciliacao"), chaveDaPagina("/financeiro/conciliacao?conta=c1"));
  const r = navegar("/financeiro", "/financeiro/conciliacao", "/financeiro/conciliacao?conta=c1");
  assert.equal(destinoDoVoltar(r, {}, atual(r), "/financeiro/conciliacao").href, "/financeiro/conciliacao");
});

test("depois de voltar, o rastro é cortado e o voltar seguinte continua para trás", () => {
  let r = navegar("/jobs", "/jobs/j1", "/orcamentos/p1/o1");
  const d = destinoDoVoltar(r, {}, atual(r), "/orcamentos/p1");
  assert.equal(d.href, "/jobs/j1");
  r = marcarVoltar(r, d.indice);
  r = registrarNavegacao(r, d.href, { popstate: false });
  assert.deepEqual(r.entradas, ["/jobs", "/jobs/j1"]);
  assert.equal(destinoDoVoltar(r, {}, atual(r), "/orcamentos/p1/o1").href, "/jobs");
});

test("o voltar do navegador anda o cursor em vez de empilhar", () => {
  let r = navegar("/jobs", "/jobs/j1", "/orcamentos/p1/o1");
  r = registrarNavegacao(r, "/jobs/j1", { popstate: true });
  assert.equal(r.cursor, 1);
  assert.equal(r.entradas.length, 3);
  assert.equal(destinoDoVoltar(r, {}, atual(r), "/x").href, "/jobs");
  r = registrarNavegacao(r, "/orcamentos/p1/o1", { popstate: true });
  assert.equal(r.cursor, 2, "e o avançar anda para a frente");
});

test("sem voltar pelo botão, reabrir a mesma URL empilha (é navegação nova)", () => {
  const r = navegar("/jobs", "/jobs/j1", "/jobs");
  assert.equal(r.entradas.length, 3);
  assert.equal(destinoDoVoltar(r, {}, "/jobs", "/home").href, "/jobs/j1");
});

test("rota que só redireciona não entra no rastro", () => {
  const r = navegar("/jobs/j1", "/orcamentos/p1/o1/versoes/v1", "/orcamentos/p1/o1?v=v1");
  assert.deepEqual(r.entradas, ["/jobs/j1", "/orcamentos/p1/o1?v=v1"]);
  assert.equal(destinoDoVoltar(r, {}, atual(r), "/orcamentos/p1").href, "/jobs/j1");
});

test("página redirecionada ao abrir é trocada pela de destino (substituirAtual)", () => {
  let r = navegar("/financeiro/abertura-de-job?aba=abertos", "/financeiro/abertura-de-job/j1");
  r = registrarNavegacao(r, "/financeiro/jobs/j1", { popstate: false, substituirAtual: true });
  assert.deepEqual(r.entradas, ["/financeiro/abertura-de-job?aba=abertos", "/financeiro/jobs/j1"]);
});

test("nome da página no balão", () => {
  assert.equal(nomeDaPagina("/financeiro/contas-a-pagar?tab=titulos", {}), "Contas a Pagar");
  assert.equal(nomeDaPagina("/financeiro/abertura-de-job?aba=calendario", {}), "Calendário de Jobs");
  assert.equal(nomeDaPagina("/financeiro/conciliacao?conta=c1", {}), "o extrato da conta");
  assert.equal(nomeDaPagina("/orcamentos/p1/agregado", {}), "Visão agregada");
  assert.equal(nomeDaPagina("/orcamentos/categorias", {}), "Categorias");
  assert.equal(nomeDaPagina("/rh/colaboradores/niveis", {}), "Níveis");
  assert.equal(
    nomeDaPagina("/jobs/j44?aba=pps", { "/jobs/j44": { rotulo: "JOB-0044 · Teste 1" } }),
    "JOB-0044 · Teste 1",
  );
});
