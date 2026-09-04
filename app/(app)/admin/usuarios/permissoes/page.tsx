import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { roleLabel, type AppRole } from "@/lib/types";
import {
  permissoes,
  recursos,
  getRolesFor,
  type Recurso,
} from "@/lib/permissoes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Ordem em que os 5 papeis aparecem nas colunas da matriz. Comeca por
 * Administrador (superset) e termina por Financeiro (papel mais
 * lateral). Freelancer vem antes do Financeiro porque no dia-a-dia da
 * California ele conversa com Producao mais do que com Financeiro.
 */
const PAPEIS_EM_ORDEM: readonly AppRole[] = [
  "administrador",
  "gerente_producao",
  "produtor",
  "freelancer",
  "financeiro",
];

/**
 * Grupos visuais da matriz. Cada grupo tem titulo e um filtro que decide
 * quais recursos entram nele. A ordem aqui e a ordem em que a tela
 * renderiza — comeca por sidebar (mais visivel pro usuario) e termina por
 * relatorios + auditoria (mais raros).
 */
const GRUPOS: {
  titulo: string;
  descricao?: string;
  filtro: (r: Recurso) => boolean;
}[] = [
  {
    titulo: "Sidebar",
    descricao: "Itens de menu que cada papel enxerga.",
    filtro: (r) => r.startsWith("sidebar."),
  },
  {
    titulo: "Listas",
    descricao:
      "Chave 'Meus/Todos' que aparece em Projetos, Orcamentos e Jobs.",
    filtro: (r) => r.startsWith("listas."),
  },
  {
    titulo: "Cadastros globais",
    filtro: (r) => r.startsWith("cadastros."),
  },
  {
    titulo: "Orçamento",
    filtro: (r) => r.startsWith("orcamentos."),
  },
  {
    titulo: "Job",
    filtro: (r) => r.startsWith("jobs."),
  },
  {
    titulo: "Chat do job",
    filtro: (r) => r.startsWith("chat."),
  },
  {
    titulo: "Financeiro",
    filtro: (r) => r.startsWith("financeiro."),
  },
  {
    titulo: "Desembolsos",
    filtro: (r) => r.startsWith("desembolsos."),
  },
  {
    titulo: "Relatórios",
    filtro: (r) => r.startsWith("relatorios."),
  },
  {
    titulo: "Auditoria",
    filtro: (r) => r.startsWith("auditoria."),
  },
];

/**
 * Labels amigaveis por recurso. O que nao esta aqui cai no fallback
 * (`labelPadrao` abaixo) e mostra a chave crua, o que ja e legivel na
 * maioria dos casos.
 */
const LABELS: Partial<Record<Recurso, string>> = {
  "sidebar.home": "Home",
  "sidebar.cadastros": "Cadastros",
  "sidebar.orcamentos": "Orçamentos",
  "sidebar.jobs": "Jobs",
  "sidebar.financeiro": "Financeiro",
  "sidebar.desembolsos": "Desembolsos",
  "sidebar.relatorios": "Relatórios",
  "sidebar.administracao": "Administração",

  "listas.chave_meus_todos": "Alternar 'Meus/Todos'",

  "cadastros.clientes.editar": "Clientes",
  "cadastros.fornecedores.editar": "Fornecedores (tela)",
  "cadastros.fornecedores.inline": "Fornecedor (cadastro rápido no PP)",
  "cadastros.empresas.editar": "Empresas do tenant",
  "cadastros.contas_bancarias.editar": "Contas bancárias",
  "cadastros.plano_contas.editar": "Plano de contas",
  "cadastros.cartoes.editar": "Cartões de crédito",
  "cadastros.categorias_orcamento.editar": "Categorias de orçamento",
  "cadastros.regionais.editar": "Regionais",
  "cadastros.cidades.editar": "Cidades",
  "cadastros.usuarios.editar": "Usuários e permissões",
  "auditoria.ver": "Auditoria (feed de eventos)",

  "orcamentos.ver": "Ver orçamento (completo)",
  "orcamentos.ver_restrito": "Ver orçamento (modo espectador — sem BV/totais/save)",
  "orcamentos.editar": "Editar orçamento (gate genérico da UI)",
  "orcamentos.criar": "Criar projeto e orçamento",
  "orcamentos.duplicar": "Duplicar orçamento/versão",
  "orcamentos.exportar": "Exportar planilha",
  "orcamentos.editar_impostos": "Editar impostos/honorários",
  "orcamentos.aprovar": "Aprovar versão",
  "orcamentos.marcar_em_save": "Marcar linha em Save",

  "jobs.ver": "Ver job (completo)",
  "jobs.ver_restrito": "Ver job (modo espectador — só planejado + realizado)",
  "jobs.editar": "Editar job (gate genérico da UI)",
  "jobs.editar_metadata": "Editar metadata do job",
  "jobs.editar_realizado": "Editar realizado",
  "jobs.consumir_save": "Consumir Save no job",
  "jobs.criar_errata": "Criar errata",
  "jobs.emitir_pp": "Emitir PP",
  "jobs.cancelar_pp": "Cancelar PP",
  "jobs.enviar_faturamento": "Enviar pra faturamento",
  "jobs.encerrar": "Encerrar job",
  "jobs.abrir_financeiro": "Abertura financeira do job",

  "chat.ver": "Ver mensagens do chat",
  "chat.enviar": "Enviar mensagem",

  "financeiro.contas_pagar": "Contas a pagar",
  "financeiro.contas_receber": "Contas a receber",
  "financeiro.conciliacao": "Conciliação bancária",
  "financeiro.fluxo_caixa": "Fluxo de caixa",

  "desembolsos.solicitar": "Solicitar desembolso",
  "desembolsos.aprovar": "Aprovar/pagar desembolso",

  "relatorios.ver": "Ver relatórios (rentabilidade, faturamento)",
};

function labelDoRecurso(recurso: Recurso): string {
  return LABELS[recurso] ?? recurso;
}

export default async function AdminPermissoesPage() {
  // Reforca o gate: /admin/* ja tem requireAdmin no layout do grupo, mas
  // esta tela expoe TODAS as decisoes de acesso do sistema — vale a
  // segunda barreira explicita.
  await requireAdmin();

  return (
    <div className="space-y-8">
      <Link
        href="/admin/usuarios"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-california-red transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Usuários
      </Link>

      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Administração
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <ShieldCheck className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Matriz de permissões
          </h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          O que cada papel pode fazer no sistema. Fonte-verdade em{" "}
          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            lib/permissoes.ts
          </code>
          . Esta tela é apenas leitura — pra mudar uma célula, edite o objeto
          e a matriz aparece atualizada aqui, na sidebar, nos gates de
          servidor e nas policies RLS.
        </p>
      </header>

      <div className="space-y-8">
        {GRUPOS.map((grupo) => {
          const recursosDoGrupo = recursos.filter(grupo.filtro);
          if (recursosDoGrupo.length === 0) return null;

          return (
            <section
              key={grupo.titulo}
              className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden"
            >
              <div className="border-b border-border bg-muted/30 px-6 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {grupo.titulo}
                </h2>
                {grupo.descricao && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {grupo.descricao}
                  </p>
                )}
              </div>

              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left font-semibold px-6 py-2.5 w-1/2">
                      Ação
                    </th>
                    {PAPEIS_EM_ORDEM.map((papel) => (
                      <th
                        key={papel}
                        className="text-center font-semibold px-3 py-2.5"
                      >
                        {roleLabel(papel)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recursosDoGrupo.map((recurso) => {
                    const rolesAutorizados = getRolesFor(recurso);
                    return (
                      <tr
                        key={recurso}
                        className="hover:bg-accent/30 transition-colors"
                      >
                        <td className="px-6 py-2.5">
                          <div className="text-foreground">
                            {labelDoRecurso(recurso)}
                          </div>
                          <code className="font-mono text-[10px] text-muted-foreground">
                            {recurso}
                          </code>
                        </td>
                        {PAPEIS_EM_ORDEM.map((papel) => {
                          const permitido = rolesAutorizados.includes(papel);
                          return (
                            <td
                              key={papel}
                              className={cn(
                                "text-center px-3 py-2.5 font-mono text-sm",
                                permitido
                                  ? "text-emerald-700 font-semibold"
                                  : "text-muted-foreground/40",
                              )}
                              aria-label={
                                permitido
                                  ? `${roleLabel(papel)} pode`
                                  : `${roleLabel(papel)} não pode`
                              }
                            >
                              {permitido ? "✓" : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-california-red" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Como mudar uma permissão
          </p>
          <p>
            Toda a matriz mora em{" "}
            <code className="font-mono text-[11px] bg-background px-1 py-0.5 rounded">
              lib/permissoes.ts
            </code>
            . Adicionar ou trocar um papel no array de um recurso propaga
            automaticamente pra sidebar, gates de server actions, contexts de
            UI e esta tela. As policies RLS têm que ser atualizadas separadamente
            via migration — elas espelham a mesma regra no banco.
          </p>
          <p className="pt-1">
            Recurso especial <code className="font-mono text-[11px] bg-background px-1 py-0.5 rounded">ver_restrito</code> significa
            &ldquo;modo espectador&rdquo; — quem tem só ele vê os dados sem os controles de edição.
          </p>
        </div>
      </div>
    </div>
  );
}
