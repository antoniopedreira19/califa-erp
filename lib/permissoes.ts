/**
 * Matriz de permissoes do ERP California — parte PURA (client-safe).
 *
 * Este arquivo NAO importa nada que puxe next/headers ou audit. Client
 * components (ex.: components/sidebar.tsx) importam daqui em seguranca.
 *
 * As duas funcoes que fazem side-effect (`checarPermissao` e
 * `requirePermissao`, que gravam `acao_negada` na auditoria) moram em
 * `lib/permissoes-server.ts`. Server actions e server components devem
 * importar daquele modulo.
 *
 * Sempre que uma permissao nova nascer, adicione uma linha na tabela
 * `permissoes` e o resto se propaga automaticamente. A propria tela do
 * admin em /admin/usuarios/permissoes (futura) le esse objeto.
 *
 * Ver spec: docs/superpowers/specs/2026-09-03-permissoes-e-papeis-design.md.
 */

import type { AppRole } from "./types";

/**
 * Cada chave e um "recurso.acao" (ex: "orcamentos.aprovar"). O valor e
 * a lista de papeis que podem executar.
 *
 * Observacao sobre Freelancer: o escopo row-level ("so os projetos onde
 * ele participa") NAO vive aqui — vive nas policies RLS que filtram por
 * projeto_responsaveis. Aqui e so a checagem de papel.
 */
export const permissoes = {
  // ==================================================================
  // Sidebar — visibilidade dos itens de menu
  // ==================================================================
  "sidebar.home":                ["administrador", "gerente_producao", "produtor", "freelancer", "financeiro"],
  "sidebar.cadastros":           ["administrador", "financeiro"],
  "sidebar.orcamentos":          ["administrador", "gerente_producao", "produtor", "freelancer", "financeiro"],
  "sidebar.jobs":                ["administrador", "gerente_producao", "produtor", "freelancer", "financeiro"],
  "sidebar.financeiro":          ["administrador", "financeiro"],
  "sidebar.desembolsos":         ["administrador", "gerente_producao", "produtor", "financeiro"],
  "sidebar.relatorios":          ["administrador", "financeiro"],
  "sidebar.administracao":       ["administrador"],

  // ==================================================================
  // Chave "Meus/Todos" nas listas (Projetos, Orcamentos, Jobs)
  // Freelancer NAO ve o toggle — filtro dele fica sempre em "Meus".
  // ==================================================================
  "listas.chave_meus_todos":     ["administrador", "gerente_producao", "produtor", "financeiro"],

  // ==================================================================
  // Cadastros globais
  // ==================================================================
  "cadastros.clientes.editar":              ["administrador"],
  "cadastros.fornecedores.editar":          ["administrador"],
  /** Cadastro rapido de fornecedor DENTRO do fluxo de PP (drawer inline). */
  "cadastros.fornecedores.inline":          ["administrador", "gerente_producao", "produtor"],
  /**
   * Cadastro rapido de portal de fornecedor do cliente DENTRO do envio do
   * job para faturamento (decisao 050). Espelha `jobs.enviar_faturamento`:
   * quem pode enviar precisa poder cadastrar o portal que o envio pede.
   */
  "cadastros.clientes.portal_inline":       ["administrador", "gerente_producao"],
  "cadastros.empresas.editar":              ["administrador"],
  "cadastros.contas_bancarias.editar":      ["administrador", "financeiro"],
  "cadastros.plano_contas.editar":          ["administrador", "financeiro"],
  "cadastros.cartoes.editar":               ["administrador", "financeiro"],
  "cadastros.categorias_orcamento.editar":  ["administrador"],
  "cadastros.regionais.editar":             ["administrador"],
  "cadastros.cidades.editar":               ["administrador"],
  "cadastros.usuarios.editar":              ["administrador"],
  "auditoria.ver":                          ["administrador"],

  // ==================================================================
  // Orcamento
  // ==================================================================
  /** Ver bruto completo (BV, totais, save). */
  "orcamentos.ver":                ["administrador", "gerente_producao", "produtor", "financeiro"],
  /** Ver bruto restrito (sem BV, sem totais, sem save) — Freelancer. */
  "orcamentos.ver_restrito":       ["freelancer"],
  /** UI podeEditar: gate generico de "posso mexer neste orcamento?". */
  "orcamentos.editar":             ["administrador", "gerente_producao", "produtor"],
  "orcamentos.criar":              ["administrador", "gerente_producao", "produtor"],
  "orcamentos.duplicar":           ["administrador", "gerente_producao", "produtor"],
  "orcamentos.exportar":           ["administrador", "gerente_producao", "produtor"],
  "orcamentos.editar_impostos":    ["administrador", "gerente_producao"],
  "orcamentos.aprovar":            ["administrador", "gerente_producao"],
  "orcamentos.marcar_em_save":     ["administrador", "gerente_producao"],

  // ==================================================================
  // Job
  // ==================================================================
  /** Ver job completo (metadata, planejado, realizado, rentabilidade). */
  "jobs.ver":                     ["administrador", "gerente_producao", "produtor", "financeiro"],
  /** Ver job restrito (so planejado + realizado) — Freelancer. */
  "jobs.ver_restrito":            ["freelancer"],
  /** UI podeEditar: gate generico de metadata/estado do job. */
  "jobs.editar":                  ["administrador", "gerente_producao", "produtor"],
  "jobs.editar_metadata":         ["administrador", "gerente_producao", "produtor"],
  /** Freelancer edita realizado dos jobs dele (escopo row-level pelo RLS). */
  "jobs.editar_realizado":        ["administrador", "gerente_producao", "produtor", "freelancer"],
  "jobs.consumir_save":           ["administrador", "gerente_producao", "produtor"],
  "jobs.criar_errata":            ["administrador", "gerente_producao", "produtor"],
  "jobs.emitir_pp":               ["administrador", "gerente_producao", "produtor"],
  "jobs.cancelar_pp":             ["administrador", "gerente_producao", "produtor"],
  "jobs.enviar_faturamento":      ["administrador", "gerente_producao"],
  "jobs.encerrar":                ["administrador", "gerente_producao"],
  /** Abrir job no financeiro — via /financeiro/abertura-de-job. */
  "jobs.abrir_financeiro":        ["administrador", "financeiro"],

  // ==================================================================
  // Chat de job
  // ==================================================================
  "chat.ver":                     ["administrador", "gerente_producao", "produtor", "freelancer", "financeiro"],
  "chat.enviar":                  ["administrador", "gerente_producao", "produtor"],

  // ==================================================================
  // Financeiro (contas, conciliacao, fluxo)
  // ==================================================================
  "financeiro.contas_pagar":      ["administrador", "financeiro"],
  "financeiro.contas_receber":    ["administrador", "financeiro"],
  "financeiro.conciliacao":       ["administrador", "financeiro"],
  "financeiro.fluxo_caixa":       ["administrador", "financeiro"],

  // ==================================================================
  // Desembolsos
  // ==================================================================
  "desembolsos.solicitar":        ["administrador", "gerente_producao", "produtor", "financeiro"],
  "desembolsos.aprovar":          ["administrador", "financeiro"],

  // ==================================================================
  // Relatorios
  // ==================================================================
  "relatorios.ver":               ["administrador", "financeiro"],
} as const satisfies Record<string, readonly AppRole[]>;

/** Chaves validas da matriz — usada como tipo em consumidores. */
export type Recurso = keyof typeof permissoes;

/** Lista completa de recursos, util pra iterar (ex.: tela de admin). */
export const recursos = Object.keys(permissoes) as Recurso[];

/**
 * Devolve o array de papeis que podem executar o recurso.
 * Util pra debug, telas de admin, e testes de contrato.
 */
export function getRolesFor(recurso: Recurso): readonly AppRole[] {
  return permissoes[recurso];
}

/** Erro lancado por requirePermissao quando o papel nao autoriza. */
export class PermissaoNegadaError extends Error {
  readonly recurso: Recurso;
  constructor(recurso: Recurso) {
    super(`Sem permissao para: ${recurso}`);
    this.name = "PermissaoNegadaError";
    this.recurso = recurso;
  }
}

/**
 * Retorna true se o papel pode executar o recurso.
 *
 * Lookup puro em objeto TS — zero I/O, zero query, O(<=5) no pior caso.
 * Seguro pra chamar em render de server component, sidebar, etc.
 */
export function pode(role: AppRole, recurso: Recurso): boolean {
  const rolesPermitidos = permissoes[recurso] as readonly AppRole[];
  return rolesPermitidos.includes(role);
}

/**
 * Utilitario pra montar respostas amigaveis em server actions que ja
 * usam o padrao `{ ok: false, message }`. Puro — nao grava audit; a
 * gravacao acontece dentro de `checarPermissao` (lib/permissoes-server).
 */
export function respostaPermissaoNegada(recurso: Recurso): {
  ok: false;
  message: string;
  code: "permissao_negada";
  recurso: Recurso;
} {
  return {
    ok: false,
    message: "Você não tem permissão para essa ação.",
    code: "permissao_negada",
    recurso,
  };
}
