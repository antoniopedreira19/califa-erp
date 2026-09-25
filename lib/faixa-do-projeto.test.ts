/**
 * Testes da faixa do projeto — decisão 106.
 *
 * Rode com:  node --import tsx --test lib/faixa-do-projeto.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGREGADA,
  destinoDaAba,
  itensDeJobs,
  itensDeOrcamentos,
} from "./faixa-do-projeto";

const J42 = "7eb9b771";
const J44 = "5d8f38fb";

test("Jobs: da agregada, o job abre na Planilha Interna com o from=jobs", () => {
  assert.equal(
    destinoDaAba({ modulo: "jobs", alvo: J42, ativo: AGREGADA, href: `/jobs/${J42}`, abaAtual: null, from: null }),
    `/jobs/${J42}?from=jobs&aba=planilha`,
  );
});

test("Jobs: entre jobs, a aba de seção se mantém", () => {
  assert.equal(
    destinoDaAba({ modulo: "jobs", alvo: J42, ativo: J44, href: `/jobs/${J42}`, abaAtual: "pps", from: "jobs" }),
    `/jobs/${J42}?from=jobs&aba=pps`,
  );
});

test("Jobs: Informações é a aba padrão e não vai no link", () => {
  assert.equal(
    destinoDaAba({ modulo: "jobs", alvo: J42, ativo: J44, href: `/jobs/${J42}`, abaAtual: "info", from: null }),
    `/jobs/${J42}`,
  );
});

test("Jobs: quem chegou pelo orçamento continua sem from", () => {
  assert.equal(
    destinoDaAba({ modulo: "jobs", alvo: J42, ativo: J44, href: `/jobs/${J42}`, abaAtual: "planilha", from: null }),
    `/jobs/${J42}?aba=planilha`,
  );
});

test("Jobs: aba desconhecida na URL não é repassada", () => {
  assert.equal(
    destinoDaAba({ modulo: "jobs", alvo: J42, ativo: J44, href: `/jobs/${J42}`, abaAtual: "fluxo", from: "jobs" }),
    `/jobs/${J42}?from=jobs`,
  );
});

test("Jobs: a agregada não leva aba nem from", () => {
  assert.equal(
    destinoDaAba({ modulo: "jobs", alvo: AGREGADA, ativo: J44, href: "/jobs/projeto/p1", abaAtual: "planilha", from: "jobs" }),
    "/jobs/projeto/p1",
  );
});

test("Financeiro: da agregada, Planilha Interna; do fluxo do projeto, fluxo do job", () => {
  const base = { modulo: "financeiro" as const, alvo: J42, ativo: AGREGADA, href: `/financeiro/jobs/${J42}`, from: null };
  assert.equal(destinoDaAba({ ...base, abaAtual: null }), `/financeiro/jobs/${J42}?aba=planilha`);
  assert.equal(destinoDaAba({ ...base, abaAtual: "planilha" }), `/financeiro/jobs/${J42}?aba=planilha`);
  assert.equal(destinoDaAba({ ...base, abaAtual: "fluxo" }), `/financeiro/jobs/${J42}?aba=fluxo`);
});

test("Financeiro: entre jobs a aba se mantém; Abertura é a padrão", () => {
  const base = { modulo: "financeiro" as const, alvo: J42, ativo: J44, href: `/financeiro/jobs/${J42}`, from: null };
  assert.equal(destinoDaAba({ ...base, abaAtual: "fluxo" }), `/financeiro/jobs/${J42}?aba=fluxo`);
  assert.equal(destinoDaAba({ ...base, abaAtual: "abertura" }), `/financeiro/jobs/${J42}`);
  assert.equal(destinoDaAba({ ...base, abaAtual: null }), `/financeiro/jobs/${J42}`);
});

test("Financeiro: do fluxo do job, a agregada abre no fluxo do projeto", () => {
  const base = { modulo: "financeiro" as const, alvo: AGREGADA, ativo: J44, href: "/financeiro/projetos/p1", from: null };
  assert.equal(destinoDaAba({ ...base, abaAtual: "fluxo" }), "/financeiro/projetos/p1?aba=fluxo");
  assert.equal(destinoDaAba({ ...base, abaAtual: "planilha" }), "/financeiro/projetos/p1");
});

test("Orçamentos: o link é a rota do orçamento, sem query", () => {
  assert.equal(
    destinoDaAba({ modulo: "orcamentos", alvo: "o1", ativo: "o2", href: "/orcamentos/p/o1", abaAtual: "x", from: "jobs" }),
    "/orcamentos/p/o1",
  );
});

test("Orçamentos: fora cancelados e recusados, menos o aberto; cadeado e revisão", () => {
  const itens = itensDeOrcamentos(
    "p",
    [
      { id: "o3", codigo: "TES-0002/26-03", nome: "Teste 3", status: "job_criado" },
      { id: "o1", codigo: "TES-0002/26-01", nome: "Teste 1", status: "aprovado" },
      { id: "o2", codigo: "TES-0002/26-02", nome: "Teste 2", status: "rascunho" },
      { id: "o4", codigo: "TES-0002/26-04", nome: "Cancelado", status: "cancelado" },
      { id: "o5", codigo: "TES-0002/26-05", nome: "Recusado aberto", status: "recusado" },
      { id: "o6", codigo: "TES-0002/26-06", nome: "Revisão", status: "em_revisao" },
    ],
    "o5",
  );
  assert.deepEqual(itens.map((i) => i.id), ["o1", "o2", "o3", "o5", "o6"]);
  assert.deepEqual(itens.map((i) => i.travado), [true, false, true, false, false]);
  assert.equal(itens.find((i) => i.id === "o6")?.emRevisao, true);
  assert.equal(itens[0].href, "/orcamentos/p/o1");
});

test("Jobs: cada módulo filtra; o job aberto entra sempre", () => {
  const jobs = [
    { id: "a", codigo: "JOB-0044", nome: "Teste 1", status: "aberto" },
    { id: "b", codigo: "JOB-0042", nome: "Teste 3", status: "aberto" },
    { id: "c", codigo: "JOB-0041", nome: "Cancelado", status: "cancelado" },
  ];
  const itens = itensDeJobs("/jobs/", jobs, "a", (s) => s !== "cancelado");
  assert.deepEqual(itens.map((i) => i.codigo), ["JOB-0042", "JOB-0044"]);
  assert.equal(itens[0].href, "/jobs/b");
  const comAtualCancelado = itensDeJobs("/financeiro/jobs/", jobs, "c", (s) => s === "aberto");
  assert.deepEqual(comAtualCancelado.map((i) => i.codigo), ["JOB-0041", "JOB-0042", "JOB-0044"]);
});
