"use client";

import * as React from "react";
import { Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pode, type Recurso } from "@/lib/permissoes";
import { roleLabel, type AppRole } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAPEIS_EM_ORDEM: readonly AppRole[] = [
  "administrador",
  "gerente_producao",
  "produtor",
  "freelancer",
  "financeiro",
];

type Acao = "ver" | "criar" | "editar" | "excluir";

/**
 * Cada linha da tabela e uma acao de negocio que o admin reconhece —
 * nada de nomenclatura tecnica. Se uma coluna (ver/criar/editar/excluir)
 * nao faz sentido pra aquela linha, deixa vazia — a celula so aparece
 * marcada quando ha permissao no lib/permissoes.ts.
 *
 * Pra items simples de cadastro, uso o mesmo recurso nas 4 colunas: quem
 * pode editar tambem pode criar e excluir, e ver e sempre implicito no
 * modulo. Pra acoes especificas (aprovar orcamento, encerrar job, etc.)
 * uso o recurso proprio.
 */
type Linha = {
  modulo: string;
  item?: string;
  permissoes: Partial<Record<Acao, Recurso>>;
};

const LINHAS: readonly Linha[] = [
  { modulo: "Painel inicial", permissoes: { ver: "sidebar.home" } },

  // ---- Cadastros ----
  { modulo: "Cadastros", item: "Clientes",
    permissoes: {
      ver: "sidebar.cadastros",
      criar: "cadastros.clientes.editar",
      editar: "cadastros.clientes.editar",
      excluir: "cadastros.clientes.editar",
    },
  },
  { modulo: "Cadastros", item: "Fornecedores (tela)",
    permissoes: {
      ver: "sidebar.cadastros",
      criar: "cadastros.fornecedores.editar",
      editar: "cadastros.fornecedores.editar",
      excluir: "cadastros.fornecedores.editar",
    },
  },
  { modulo: "Cadastros", item: "Fornecedor rápido dentro do PP",
    permissoes: { criar: "cadastros.fornecedores.inline" },
  },
  { modulo: "Cadastros", item: "Empresas do grupo",
    permissoes: {
      ver: "sidebar.cadastros",
      criar: "cadastros.empresas.editar",
      editar: "cadastros.empresas.editar",
      excluir: "cadastros.empresas.editar",
    },
  },
  { modulo: "Cadastros", item: "Contas bancárias",
    permissoes: {
      ver: "cadastros.contas_bancarias.editar",
      criar: "cadastros.contas_bancarias.editar",
      editar: "cadastros.contas_bancarias.editar",
      excluir: "cadastros.contas_bancarias.editar",
    },
  },
  { modulo: "Cadastros", item: "Plano de contas",
    permissoes: {
      ver: "cadastros.plano_contas.editar",
      criar: "cadastros.plano_contas.editar",
      editar: "cadastros.plano_contas.editar",
      excluir: "cadastros.plano_contas.editar",
    },
  },
  { modulo: "Cadastros", item: "Cartões de crédito",
    permissoes: {
      ver: "cadastros.cartoes.editar",
      criar: "cadastros.cartoes.editar",
      editar: "cadastros.cartoes.editar",
      excluir: "cadastros.cartoes.editar",
    },
  },
  { modulo: "Cadastros", item: "Categorias de orçamento",
    permissoes: {
      ver: "sidebar.cadastros",
      criar: "cadastros.categorias_orcamento.editar",
      editar: "cadastros.categorias_orcamento.editar",
      excluir: "cadastros.categorias_orcamento.editar",
    },
  },
  { modulo: "Cadastros", item: "Regionais",
    permissoes: {
      ver: "sidebar.cadastros",
      criar: "cadastros.regionais.editar",
      editar: "cadastros.regionais.editar",
      excluir: "cadastros.regionais.editar",
    },
  },
  { modulo: "Cadastros", item: "Cidades",
    permissoes: {
      ver: "sidebar.cadastros",
      criar: "cadastros.cidades.editar",
      editar: "cadastros.cidades.editar",
      excluir: "cadastros.cidades.editar",
    },
  },

  // ---- Orçamentos ----
  { modulo: "Orçamentos", item: "Projetos e orçamentos",
    permissoes: {
      ver: "orcamentos.ver",
      criar: "orcamentos.criar",
      editar: "orcamentos.editar",
    },
  },
  { modulo: "Orçamentos", item: "Orçamento em modo espectador (Freelancer)",
    permissoes: { ver: "orcamentos.ver_restrito" },
  },
  { modulo: "Orçamentos", item: "Duplicar orçamento/versão",
    permissoes: { criar: "orcamentos.duplicar" },
  },
  { modulo: "Orçamentos", item: "Exportar planilha",
    permissoes: { ver: "orcamentos.exportar" },
  },
  { modulo: "Orçamentos", item: "Editar impostos e honorários",
    permissoes: { editar: "orcamentos.editar_impostos" },
  },
  { modulo: "Orçamentos", item: "Aprovar versão",
    permissoes: { editar: "orcamentos.aprovar" },
  },
  { modulo: "Orçamentos", item: "Marcar linha em Save",
    permissoes: { editar: "orcamentos.marcar_em_save" },
  },

  // ---- Jobs ----
  { modulo: "Jobs", item: "Job (metadata, planejado, realizado)",
    permissoes: {
      ver: "jobs.ver",
      editar: "jobs.editar",
    },
  },
  { modulo: "Jobs", item: "Job em modo espectador (Freelancer)",
    permissoes: { ver: "jobs.ver_restrito" },
  },
  { modulo: "Jobs", item: "Editar planilha realizada",
    permissoes: { editar: "jobs.editar_realizado" },
  },
  { modulo: "Jobs", item: "Consumir Save (crédito entre jobs)",
    permissoes: { criar: "jobs.consumir_save" },
  },
  { modulo: "Jobs", item: "Criar errata",
    permissoes: { criar: "jobs.criar_errata" },
  },
  { modulo: "Jobs", item: "Emitir Pedido de Pagamento (PP)",
    permissoes: { criar: "jobs.emitir_pp" },
  },
  { modulo: "Jobs", item: "Cancelar PP",
    permissoes: { excluir: "jobs.cancelar_pp" },
  },
  { modulo: "Jobs", item: "Enviar pra faturamento",
    permissoes: { editar: "jobs.enviar_faturamento" },
  },
  { modulo: "Jobs", item: "Encerrar job",
    permissoes: { editar: "jobs.encerrar" },
  },
  { modulo: "Jobs", item: "Abrir job no financeiro",
    permissoes: { editar: "jobs.abrir_financeiro" },
  },

  // ---- Chat ----
  { modulo: "Chat do job", item: "Mensagens",
    permissoes: {
      ver: "chat.ver",
      criar: "chat.enviar",
    },
  },

  // ---- Financeiro ----
  { modulo: "Financeiro", item: "Contas a pagar",
    permissoes: {
      ver: "financeiro.contas_pagar",
      criar: "financeiro.contas_pagar",
      editar: "financeiro.contas_pagar",
      excluir: "financeiro.contas_pagar",
    },
  },
  { modulo: "Financeiro", item: "Contas a receber",
    permissoes: {
      ver: "financeiro.contas_receber",
      criar: "financeiro.contas_receber",
      editar: "financeiro.contas_receber",
      excluir: "financeiro.contas_receber",
    },
  },
  { modulo: "Financeiro", item: "Conciliação bancária",
    permissoes: {
      ver: "financeiro.conciliacao",
      editar: "financeiro.conciliacao",
    },
  },
  { modulo: "Financeiro", item: "Fluxo de caixa",
    permissoes: { ver: "financeiro.fluxo_caixa" },
  },

  // ---- Desembolsos ----
  { modulo: "Desembolsos", item: "Solicitar",
    permissoes: {
      ver: "sidebar.desembolsos",
      criar: "desembolsos.solicitar",
    },
  },
  { modulo: "Desembolsos", item: "Aprovar e pagar",
    permissoes: { editar: "desembolsos.aprovar" },
  },

  // ---- Relatórios ----
  { modulo: "Relatórios", item: "Rentabilidade e faturamento",
    permissoes: { ver: "relatorios.ver" },
  },

  // ---- Administração ----
  { modulo: "Administração", item: "Usuários",
    permissoes: {
      ver: "sidebar.administracao",
      criar: "cadastros.usuarios.editar",
      editar: "cadastros.usuarios.editar",
    },
  },
  { modulo: "Administração", item: "Auditoria (feed de eventos)",
    permissoes: { ver: "auditoria.ver" },
  },
];

/** Checkbox estilizado — puramente visual, sem interação. */
function CheckboxRO({ marcado }: { marcado: boolean }) {
  return (
    <div
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors",
        marcado
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-background",
      )}
      aria-hidden="true"
    >
      {marcado && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </div>
  );
}

export function MatrizPermissoes() {
  const [papel, setPapel] = React.useState<AppRole>("administrador");

  // Agrupa linhas consecutivas do mesmo modulo pra so a primeira mostrar
  // o nome do modulo em negrito.
  const linhasComFlag = React.useMemo(() => {
    let ultimoModulo = "";
    return LINHAS.map((l) => {
      const primeiraDoModulo = l.modulo !== ultimoModulo;
      ultimoModulo = l.modulo;
      return { ...l, primeiraDoModulo };
    });
  }, []);

  function podeAcao(linha: Linha, acao: Acao): boolean {
    const recurso = linha.permissoes[acao];
    if (!recurso) return false;
    return pode(papel, recurso);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <span className="text-sm text-muted-foreground">Ver permissões de:</span>
        <Select value={papel} onValueChange={(v) => setPapel(v as AppRole)}>
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAPEIS_EM_ORDEM.map((p) => (
              <SelectItem key={p} value={p}>
                {roleLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left font-semibold px-6 py-3 w-1/2">
                Módulo / Item
              </th>
              <th className="text-center font-semibold px-4 py-3">Ver</th>
              <th className="text-center font-semibold px-4 py-3">Criar</th>
              <th className="text-center font-semibold px-4 py-3">Editar</th>
              <th className="text-center font-semibold px-4 py-3">Excluir</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhasComFlag.map((linha, i) => (
              <tr key={i} className="hover:bg-accent/30 transition-colors">
                <td className="px-6 py-3">
                  {linha.primeiraDoModulo && (
                    <span
                      className={cn(
                        "font-semibold text-foreground",
                        linha.item && "mr-2",
                      )}
                    >
                      {linha.modulo}
                    </span>
                  )}
                  {linha.item && (
                    <span
                      className={cn(
                        "text-muted-foreground",
                        !linha.primeiraDoModulo && "ml-4",
                      )}
                    >
                      {linha.item}
                    </span>
                  )}
                </td>
                <td className="text-center px-4 py-3">
                  <CheckboxRO marcado={podeAcao(linha, "ver")} />
                </td>
                <td className="text-center px-4 py-3">
                  <CheckboxRO marcado={podeAcao(linha, "criar")} />
                </td>
                <td className="text-center px-4 py-3">
                  <CheckboxRO marcado={podeAcao(linha, "editar")} />
                </td>
                <td className="text-center px-4 py-3">
                  <CheckboxRO marcado={podeAcao(linha, "excluir")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
