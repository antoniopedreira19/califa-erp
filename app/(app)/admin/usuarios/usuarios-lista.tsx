"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MailWarning,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ReenviarConviteButton } from "./reenviar-convite-button";
import { AlterarStatusButton } from "./alterar-status-button";
import { EditarUsuarioDrawer } from "./editar-drawer";
import { roleLabel, type AppRole, type Empresa, type Regional } from "@/lib/types";

type AcessoStatus = "ativo" | "pendente" | "inativo";

type CampoOrdenacao = "nome" | "email";
/** `null` = ordem de cadastro, como a lista vem do servidor. */
type Ordenacao = { campo: CampoOrdenacao; direcao: "asc" | "desc" } | null;

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
  const [ordenacao, setOrdenacao] = React.useState<Ordenacao>(null);

  const visiveis = React.useMemo(() => {
    const q = normalizar(busca.trim());
    const filtradas = q
      ? rows.filter(
          (r) => normalizar(r.nome).includes(q) || normalizar(r.email).includes(q),
        )
      : rows;
    if (!ordenacao) return filtradas;
    const fator = ordenacao.direcao === "asc" ? 1 : -1;
    const { campo } = ordenacao;
    return [...filtradas].sort(
      (a, b) =>
        a[campo].localeCompare(b[campo], "pt-BR", { sensitivity: "base" }) * fator,
    );
  }, [rows, busca, ordenacao]);

  // A → Z, Z → A e de volta à ordem de cadastro.
  function trocarOrdenacao(campo: CampoOrdenacao) {
    setOrdenacao((atual) => {
      if (atual?.campo !== campo) return { campo, direcao: "asc" };
      if (atual.direcao === "asc") return { campo, direcao: "desc" };
      return null;
    });
  }

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
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
                  className="w-[35%]"
                />
                <CabecalhoOrdenavel
                  rotulo="E-mail"
                  campo="email"
                  ordenacao={ordenacao}
                  onTrocar={trocarOrdenacao}
                  className="w-[30%]"
                />
                <th className="w-[13%] text-left font-semibold px-6 py-3">Papel</th>
                <th className="w-[12%] text-left font-semibold px-6 py-3">Status</th>
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
                    Nenhum usuário encontrado para “{busca.trim()}”.
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
                  <td className="px-6 py-3.5">
                    {row.acesso === "ativo" && (
                      <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/20">
                        Ativo
                      </Badge>
                    )}
                    {row.acesso === "pendente" && (
                      <Badge className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/10 border-amber-500/20 inline-flex items-center gap-1">
                        <MailWarning className="h-3 w-3" />
                        Convite pendente
                      </Badge>
                    )}
                    {row.acesso === "inativo" && (
                      <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border">
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
