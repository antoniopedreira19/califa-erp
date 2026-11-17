"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  MailWarning,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ReenviarConviteButton } from "./reenviar-convite-button";
import { AlterarStatusButton } from "./alterar-status-button";
import { EditarUsuarioDrawer } from "./editar-drawer";
import { roleLabel, type AppRole, type Empresa, type Regional } from "@/lib/types";

type AcessoStatus = "ativo" | "pendente" | "inativo";

type CampoOrdenacao = "nome" | "email";
/** `null` = ordem de cadastro, como a lista vem do servidor. */
type Ordenacao = { campo: CampoOrdenacao; direcao: "asc" | "desc" } | null;

/**
 * Sentinel pros filtros. Radix SelectItem crasha com value="", então usamos
 * uma string marcada como "todos".
 */
const TODOS = "__todos__";
type FiltroStatus = AcessoStatus | typeof TODOS;
type FiltroRole = AppRole | typeof TODOS;
const ROLES_ORDEM: AppRole[] = [
  "administrador",
  "gerente_producao",
  "produtor",
  "financeiro",
  "rh",
  "freelancer",
  "colaborador",
];

/** Busca sem distinguir acento nem caixa: "natalia" acha "Natália". */
function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type UsuarioRow = {
  user_id: string;
  role: AppRole;
  status: "ativo" | "inativo";
  profileAtivo: boolean;
  acesso: AcessoStatus;
  nome: string;
  email: string;
};

export type UsuariosListaProps = {
  rows: UsuarioRow[];
  currentUserId: string;
  empresas: Pick<Empresa, "id" | "razao_social" | "nome_fantasia">[];
  regionais: Pick<Regional, "id" | "nome" | "empresa_id">[];
};

export function UsuariosLista({
  rows,
  currentUserId,
  empresas,
  regionais,
}: UsuariosListaProps) {
  const [editando, setEditando] = React.useState<UsuarioRow | null>(null);
  const [busca, setBusca] = React.useState("");
  const [filtroStatus, setFiltroStatus] = React.useState<FiltroStatus>(TODOS);
  const [filtroRole, setFiltroRole] = React.useState<FiltroRole>(TODOS);
  const [ordenacao, setOrdenacao] = React.useState<Ordenacao>(null);
  const [exportando, setExportando] = React.useState(false);

  const visiveis = React.useMemo(() => {
    const q = normalizar(busca.trim());
    const filtradas = rows.filter((r) => {
      if (q && !(normalizar(r.nome).includes(q) || normalizar(r.email).includes(q))) {
        return false;
      }
      if (filtroStatus !== TODOS && r.acesso !== filtroStatus) return false;
      if (filtroRole !== TODOS && r.role !== filtroRole) return false;
      return true;
    });
    if (!ordenacao) return filtradas;
    const fator = ordenacao.direcao === "asc" ? 1 : -1;
    const { campo } = ordenacao;
    return [...filtradas].sort(
      (a, b) =>
        a[campo].localeCompare(b[campo], "pt-BR", { sensitivity: "base" }) * fator,
    );
  }, [rows, busca, filtroStatus, filtroRole, ordenacao]);

  // A → Z, Z → A e de volta à ordem de cadastro.
  function trocarOrdenacao(campo: CampoOrdenacao) {
    setOrdenacao((atual) => {
      if (atual?.campo !== campo) return { campo, direcao: "asc" };
      if (atual.direcao === "asc") return { campo, direcao: "desc" };
      return null;
    });
  }

  const temFiltroAtivo =
    busca.trim().length > 0 || filtroStatus !== TODOS || filtroRole !== TODOS;

  async function exportar() {
    if (visiveis.length === 0 || exportando) return;
    setExportando(true);
    try {
      const { exportarUsuariosXlsx } = await import("./exportar-usuarios");
      await exportarUsuariosXlsx(visiveis);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou e-mail..."
              aria-label="Buscar usuário por nome ou e-mail"
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={filtroStatus}
              onValueChange={(v) => setFiltroStatus(v as FiltroStatus)}
            >
              <SelectTrigger
                aria-label="Filtrar por status"
                className="w-[170px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os status</SelectItem>
                <SelectItem value="ativo">Ativos</SelectItem>
                <SelectItem value="pendente">Convite pendente</SelectItem>
                <SelectItem value="inativo">Inativos</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filtroRole}
              onValueChange={(v) => setFiltroRole(v as FiltroRole)}
            >
              <SelectTrigger
                aria-label="Filtrar por papel"
                className="w-[180px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os papéis</SelectItem>
                {ROLES_ORDEM.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            onClick={exportar}
            disabled={visiveis.length === 0 || exportando}
            className="md:ml-auto inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-foreground"
            aria-label="Exportar usuários para planilha"
          >
            <Download className="h-4 w-4" />
            {exportando ? "Exportando..." : "Exportar"}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum usuário cadastrado ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            {/* Larguras fixas: sem elas as colunas mudam de lugar a cada letra da busca. */}
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <CabecalhoOrdenavel
                  rotulo="Nome"
                  campo="nome"
                  ordenacao={ordenacao}
                  onTrocar={trocarOrdenacao}
                  className="w-[32%]"
                />
                <CabecalhoOrdenavel
                  rotulo="E-mail"
                  campo="email"
                  ordenacao={ordenacao}
                  onTrocar={trocarOrdenacao}
                  className="w-[28%]"
                />
                <th className="w-[13%] text-left font-semibold px-6 py-3">Papel</th>
                <th className="w-[16%] text-left font-semibold px-6 py-3">Status</th>
                <th className="text-right font-semibold px-6 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visiveis.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-10 text-center text-sm text-muted-foreground"
                  >
                    {temFiltroAtivo
                      ? "Nenhum usuário encontrado com esses filtros."
                      : "Nenhum usuário encontrado."}
                  </td>
                </tr>
              )}
              {visiveis.map((row) => (
                <tr
                  key={row.user_id}
                  onClick={() => {
                    if (row.acesso === "inativo") return;
                    setEditando(row);
                  }}
                  className={
                    row.acesso === "inativo"
                      ? "opacity-70"
                      : "hover:bg-accent/40 transition-colors cursor-pointer"
                  }
                >
                  <td className="px-6 py-3.5 font-medium text-foreground">
                    {row.nome}
                    {row.user_id === currentUserId && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-california-red">
                        você
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-muted-foreground">
                    {row.email}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                      {row.role === "administrador" && (
                        <ShieldCheck className="h-3.5 w-3.5 text-california-red" />
                      )}
                      {roleLabel(row.role)}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 whitespace-nowrap">
                    {row.acesso === "ativo" && (
                      <Badge className="whitespace-nowrap bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/20">
                        Ativo
                      </Badge>
                    )}
                    {row.acesso === "pendente" && (
                      <Badge className="whitespace-nowrap inline-flex items-center gap-1 bg-amber-500/10 text-amber-700 hover:bg-amber-500/10 border-amber-500/20">
                        <MailWarning className="h-3 w-3" />
                        Convite pendente
                      </Badge>
                    )}
                    {row.acesso === "inativo" && (
                      <Badge className="whitespace-nowrap bg-muted text-muted-foreground hover:bg-muted border-border">
                        Inativo
                      </Badge>
                    )}
                  </td>
                  <td
                    className="px-6 py-3.5 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.acesso === "pendente" ? (
                      <ReenviarConviteButton userId={row.user_id} />
                    ) : row.user_id === currentUserId ? (
                      // Não deixa admin inativar a si mesmo pela tela — o
                      // server bloqueia, mas escondemos o botão pra não dar
                      // a impressão de que é uma ação disponível.
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : !row.profileAtivo ? (
                      // Conta desativada no sistema (profiles.ativo=false).
                      // Não é escopo desta tela reativar isso — é decisão
                      // global (fora do MVP).
                      <span className="text-[11px] text-muted-foreground">
                        Desativado no sistema
                      </span>
                    ) : row.acesso === "ativo" ? (
                      <AlterarStatusButton
                        userId={row.user_id}
                        userNome={row.nome}
                        statusAtual="ativo"
                      />
                    ) : row.status === "inativo" ? (
                      <AlterarStatusButton
                        userId={row.user_id}
                        userNome={row.nome}
                        statusAtual="inativo"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editando && (
        <EditarUsuarioDrawer
          userId={editando.user_id}
          userNome={editando.nome}
          userEmail={editando.email}
          userRole={editando.role}
          isSelf={editando.user_id === currentUserId}
          empresas={empresas}
          regionais={regionais}
          open={editando !== null}
          onOpenChange={(o) => {
            if (!o) setEditando(null);
          }}
        />
      )}
    </div>
  );
}

/** Cabeçalho que ordena ao clicar, no desenho da lista de folhas do financeiro. */
function CabecalhoOrdenavel({
  rotulo,
  campo,
  ordenacao,
  onTrocar,
  className,
}: {
  rotulo: string;
  campo: CampoOrdenacao;
  ordenacao: Ordenacao;
  onTrocar: (campo: CampoOrdenacao) => void;
  className?: string;
}) {
  const direcao = ordenacao?.campo === campo ? ordenacao.direcao : null;
  return (
    <th
      aria-sort={
        direcao === "asc" ? "ascending" : direcao === "desc" ? "descending" : "none"
      }
      className={cn("text-left font-semibold px-6 py-3", className)}
    >
      <button
        type="button"
        onClick={() => onTrocar(campo)}
        title={
          direcao === "asc"
            ? "Ordenar de Z a A"
            : direcao === "desc"
              ? "Voltar à ordem de cadastro"
              : "Ordenar de A a Z"
        }
        className={cn(
          "inline-flex items-center gap-1.5 uppercase tracking-wider transition-colors hover:text-foreground",
          direcao && "text-foreground",
        )}
      >
        {rotulo}
        {direcao === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : direcao === "desc" ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}
