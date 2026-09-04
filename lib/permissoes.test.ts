/**
 * Testes da matriz de permissoes.
 *
 * Rode com:  npm run test:permissoes
 *
 * Objetivos:
 *   1. Garantir que a estrutura da matriz respeita AppRole (nenhuma
 *      string aleatoria vira role por descuido).
 *   2. Congelar regras "de negocio" da California para que uma edicao
 *      descuidada da matriz nao passe silenciosamente. Exemplos:
 *      - Administrador enxerga tudo.
 *      - Freelancer NAO cria/aprova/edita_impostos etc.
 *      - Financeiro NAO cria nem aprova em orcamento/job.
 *      - Chave "Meus/Todos" nao aparece pro Freelancer.
 *   3. Sanity dos helpers `pode` e `getRolesFor`.
 *
 * Referencia: docs/superpowers/specs/2026-09-03-permissoes-e-papeis-design.md.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { AppRole } from "./types";
import {
  permissoes,
  pode,
  getRolesFor,
  recursos,
  requirePermissao,
  PermissaoNegadaError,
  type Recurso,
} from "./permissoes";

const ROLES_VALIDAS: readonly AppRole[] = [
  "administrador",
  "gerente_producao",
  "produtor",
  "freelancer",
  "financeiro",
];

// --------------------------------------------------------------
// 1. Estrutura da matriz
// --------------------------------------------------------------

test("toda entrada da matriz e um array de AppRole", () => {
  for (const [recurso, roles] of Object.entries(permissoes)) {
    assert.ok(Array.isArray(roles), `${recurso}: valor nao e array`);
    assert.ok(roles.length > 0, `${recurso}: array vazio — recurso orfao`);
    for (const r of roles) {
      assert.ok(
        ROLES_VALIDAS.includes(r as AppRole),
        `${recurso}: role invalida "${r}"`,
      );
    }
  }
});

test("nenhuma entrada tem role duplicada", () => {
  for (const [recurso, roles] of Object.entries(permissoes)) {
    const unicos = new Set(roles);
    assert.equal(
      unicos.size,
      roles.length,
      `${recurso}: role duplicada em ${JSON.stringify(roles)}`,
    );
  }
});

test("recursos e keyof permissoes batem", () => {
  const keys = Object.keys(permissoes).sort();
  const rs = [...recursos].sort();
  assert.deepEqual(rs, keys);
});

// --------------------------------------------------------------
// 2. Regras de negocio congeladas (spec 2026-09-03)
// --------------------------------------------------------------

test("administrador esta em TODA permissao (superset), exceto os modos restritos do Freelancer", () => {
  // Os "modos restritos" (ver_restrito) sao subsets exclusivos do
  // Freelancer — Admin ja tem o modo completo (ver) e nao precisa nem
  // deve estar no restrito. Se Admin acessa um recurso pela via
  // freelancer, algo ta errado — o teste protege esse invariante.
  const excecoesFreelancerOnly: readonly Recurso[] = [
    "orcamentos.ver_restrito",
    "jobs.ver_restrito",
  ];

  const semAdmin = recursos
    .filter((r) => !excecoesFreelancerOnly.includes(r))
    .filter((r) => !getRolesFor(r).includes("administrador"));

  assert.equal(
    semAdmin.length,
    0,
    `Recursos sem administrador (fora das excecoes): ${semAdmin.join(", ")}`,
  );

  // Reciproca: os modos restritos SO tem freelancer.
  for (const recurso of excecoesFreelancerOnly) {
    assert.deepEqual(
      [...getRolesFor(recurso)],
      ["freelancer"],
      `${recurso} deveria ser exclusivo do Freelancer`,
    );
  }
});

test("sidebar do Administrador contem os 8 itens esperados", () => {
  const itensSidebar = recursos.filter((r) => r.startsWith("sidebar."));
  const paraAdm = itensSidebar.filter((r) => pode("administrador", r));
  assert.equal(paraAdm.length, 8, `ADM deveria ver 8 itens, viu ${paraAdm.length}`);
});

test("sidebar do Gerente de Producao: Home, Orcamentos, Jobs, Desembolsos", () => {
  const esperados = new Set<Recurso>([
    "sidebar.home",
    "sidebar.orcamentos",
    "sidebar.jobs",
    "sidebar.desembolsos",
  ]);
  const visiveis = recursos
    .filter((r) => r.startsWith("sidebar."))
    .filter((r) => pode("gerente_producao", r));
  assert.deepEqual(new Set(visiveis), esperados);
});

test("sidebar do Produtor: Home, Orcamentos, Jobs, Desembolsos", () => {
  const esperados = new Set<Recurso>([
    "sidebar.home",
    "sidebar.orcamentos",
    "sidebar.jobs",
    "sidebar.desembolsos",
  ]);
  const visiveis = recursos
    .filter((r) => r.startsWith("sidebar."))
    .filter((r) => pode("produtor", r));
  assert.deepEqual(new Set(visiveis), esperados);
});

test("sidebar do Freelancer: SO Home, Orcamentos, Jobs", () => {
  const esperados = new Set<Recurso>([
    "sidebar.home",
    "sidebar.orcamentos",
    "sidebar.jobs",
  ]);
  const visiveis = recursos
    .filter((r) => r.startsWith("sidebar."))
    .filter((r) => pode("freelancer", r));
  assert.deepEqual(new Set(visiveis), esperados);
});

test("sidebar do Financeiro: tudo MENOS Administracao", () => {
  const esperados = new Set<Recurso>([
    "sidebar.home",
    "sidebar.cadastros",
    "sidebar.orcamentos",
    "sidebar.jobs",
    "sidebar.financeiro",
    "sidebar.desembolsos",
    "sidebar.relatorios",
  ]);
  const visiveis = recursos
    .filter((r) => r.startsWith("sidebar."))
    .filter((r) => pode("financeiro", r));
  assert.deepEqual(new Set(visiveis), esperados);
  assert.equal(pode("financeiro", "sidebar.administracao"), false);
});

test("Freelancer NAO ve chave Meus/Todos (fica em 'Meus' forcado)", () => {
  assert.equal(pode("freelancer", "listas.chave_meus_todos"), false);
});

test("Freelancer NAO cria/duplica/exporta/aprova orcamento", () => {
  assert.equal(pode("freelancer", "orcamentos.criar"), false);
  assert.equal(pode("freelancer", "orcamentos.duplicar"), false);
  assert.equal(pode("freelancer", "orcamentos.exportar"), false);
  assert.equal(pode("freelancer", "orcamentos.editar_impostos"), false);
  assert.equal(pode("freelancer", "orcamentos.aprovar"), false);
  assert.equal(pode("freelancer", "orcamentos.marcar_em_save"), false);
});

test("Freelancer NAO ve orcamento em modo completo", () => {
  assert.equal(pode("freelancer", "orcamentos.ver"), false);
  assert.equal(pode("freelancer", "orcamentos.ver_restrito"), true);
});

test("Freelancer edita realizado, NAO edita metadata do job", () => {
  assert.equal(pode("freelancer", "jobs.editar_realizado"), true);
  assert.equal(pode("freelancer", "jobs.editar_metadata"), false);
  assert.equal(pode("freelancer", "jobs.editar"), false);
});

test("Freelancer NAO cria errata, PP nem consome Save", () => {
  assert.equal(pode("freelancer", "jobs.criar_errata"), false);
  assert.equal(pode("freelancer", "jobs.emitir_pp"), false);
  assert.equal(pode("freelancer", "jobs.cancelar_pp"), false);
  assert.equal(pode("freelancer", "jobs.consumir_save"), false);
});

test("Freelancer VE chat mas NAO envia", () => {
  assert.equal(pode("freelancer", "chat.ver"), true);
  assert.equal(pode("freelancer", "chat.enviar"), false);
});

test("Financeiro NAO cria/aprova/edita em orcamento", () => {
  assert.equal(pode("financeiro", "orcamentos.criar"), false);
  assert.equal(pode("financeiro", "orcamentos.duplicar"), false);
  assert.equal(pode("financeiro", "orcamentos.exportar"), false);
  assert.equal(pode("financeiro", "orcamentos.editar"), false);
  assert.equal(pode("financeiro", "orcamentos.editar_impostos"), false);
  assert.equal(pode("financeiro", "orcamentos.aprovar"), false);
  assert.equal(pode("financeiro", "orcamentos.marcar_em_save"), false);
});

test("Financeiro NAO edita metadata nem realizado, mas ABRE job no financeiro", () => {
  assert.equal(pode("financeiro", "jobs.editar_metadata"), false);
  assert.equal(pode("financeiro", "jobs.editar_realizado"), false);
  assert.equal(pode("financeiro", "jobs.criar_errata"), false);
  assert.equal(pode("financeiro", "jobs.enviar_faturamento"), false);
  assert.equal(pode("financeiro", "jobs.encerrar"), false);
  // A abertura financeira do job (via /financeiro/abertura-de-job) e SIM
  // acao do Financeiro — separa do "editar job" do dia-a-dia.
  assert.equal(pode("financeiro", "jobs.abrir_financeiro"), true);
});

test("Financeiro NAO envia chat (so Producao envia)", () => {
  assert.equal(pode("financeiro", "chat.enviar"), false);
  assert.equal(pode("financeiro", "chat.ver"), true);
});

test("So Administrador e Gerente de Producao aprovam versao", () => {
  const aprovadores = getRolesFor("orcamentos.aprovar");
  assert.deepEqual(
    new Set(aprovadores),
    new Set<AppRole>(["administrador", "gerente_producao"]),
  );
});

test("So Administrador e Gerente de Producao enviam pra faturamento e encerram job", () => {
  const enviar = getRolesFor("jobs.enviar_faturamento");
  const encerrar = getRolesFor("jobs.encerrar");
  const esperado = new Set<AppRole>(["administrador", "gerente_producao"]);
  assert.deepEqual(new Set(enviar), esperado);
  assert.deepEqual(new Set(encerrar), esperado);
});

test("Produtor faz TUDO em job/orcamento menos aprovar/enviar_faturamento/encerrar", () => {
  assert.equal(pode("produtor", "orcamentos.criar"), true);
  assert.equal(pode("produtor", "orcamentos.duplicar"), true);
  assert.equal(pode("produtor", "orcamentos.exportar"), true);
  assert.equal(pode("produtor", "jobs.editar_metadata"), true);
  assert.equal(pode("produtor", "jobs.editar_realizado"), true);
  assert.equal(pode("produtor", "jobs.criar_errata"), true);
  assert.equal(pode("produtor", "jobs.emitir_pp"), true);
  assert.equal(pode("produtor", "jobs.cancelar_pp"), true);
  assert.equal(pode("produtor", "jobs.consumir_save"), true);
  // Nao aprova
  assert.equal(pode("produtor", "orcamentos.aprovar"), false);
  assert.equal(pode("produtor", "orcamentos.editar_impostos"), false);
  assert.equal(pode("produtor", "orcamentos.marcar_em_save"), false);
  assert.equal(pode("produtor", "jobs.enviar_faturamento"), false);
  assert.equal(pode("produtor", "jobs.encerrar"), false);
});

test("GP e Produtor cadastram fornecedor INLINE (exceção do PP)", () => {
  const inline = getRolesFor("cadastros.fornecedores.inline");
  assert.ok(inline.includes("gerente_producao"));
  assert.ok(inline.includes("produtor"));
  // Mas nao via a tela cheia
  assert.equal(pode("gerente_producao", "cadastros.fornecedores.editar"), false);
  assert.equal(pode("produtor", "cadastros.fornecedores.editar"), false);
});

test("So Administrador e Financeiro veem/gerenciam contas bancarias, plano de contas e cartoes", () => {
  const esperado = new Set<AppRole>(["administrador", "financeiro"]);
  assert.deepEqual(new Set(getRolesFor("cadastros.contas_bancarias.editar")), esperado);
  assert.deepEqual(new Set(getRolesFor("cadastros.plano_contas.editar")), esperado);
  assert.deepEqual(new Set(getRolesFor("cadastros.cartoes.editar")), esperado);
});

test("So Administrador e Financeiro veem Relatorios", () => {
  const esperado = new Set<AppRole>(["administrador", "financeiro"]);
  assert.deepEqual(new Set(getRolesFor("relatorios.ver")), esperado);
});

test("So Administrador ve Auditoria", () => {
  assert.deepEqual([...getRolesFor("auditoria.ver")], ["administrador"]);
});

test("Desembolsos: Freelancer NAO solicita (GP pede por ele)", () => {
  assert.equal(pode("freelancer", "desembolsos.solicitar"), false);
});

test("Desembolsos: so Administrador e Financeiro aprovam/pagam", () => {
  const esperado = new Set<AppRole>(["administrador", "financeiro"]);
  assert.deepEqual(new Set(getRolesFor("desembolsos.aprovar")), esperado);
});

// --------------------------------------------------------------
// 3. Sanity dos helpers
// --------------------------------------------------------------

test("pode() e boolean puro", () => {
  const r = pode("administrador", "orcamentos.aprovar");
  assert.equal(typeof r, "boolean");
  assert.equal(r, true);
});

test("getRolesFor() devolve o array literal da matriz", () => {
  const roles = getRolesFor("orcamentos.aprovar");
  assert.deepEqual(
    [...roles],
    ["administrador", "gerente_producao"],
  );
});

test("requirePermissao lanca PermissaoNegadaError quando papel nao autoriza", async () => {
  const sessionFake = {
    profile: { id: "u1", nome: "Freela", email: "f@x", role: "freelancer" as AppRole, ativo: true, created_at: "", updated_at: "" },
    memberships: [],
    activeTenant: { id: "t1", nome: "Tenant", slug: "t", status: "ativo" as const, created_at: "", updated_at: "" },
    activeRole: "freelancer" as AppRole,
  };
  await assert.rejects(
    () => requirePermissao(sessionFake, "orcamentos.aprovar"),
    (err: unknown) => err instanceof PermissaoNegadaError && err.recurso === "orcamentos.aprovar",
  );
});

test("requirePermissao NAO lanca quando papel autoriza", async () => {
  const sessionFake = {
    profile: { id: "u1", nome: "Admin", email: "a@x", role: "administrador" as AppRole, ativo: true, created_at: "", updated_at: "" },
    memberships: [],
    activeTenant: { id: "t1", nome: "Tenant", slug: "t", status: "ativo" as const, created_at: "", updated_at: "" },
    activeRole: "administrador" as AppRole,
  };
  await assert.doesNotReject(() =>
    requirePermissao(sessionFake, "orcamentos.aprovar"),
  );
});
