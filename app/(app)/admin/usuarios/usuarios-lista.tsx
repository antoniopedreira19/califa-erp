"use client";

import * as React from "react";
import { MailWarning, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReenviarConviteButton } from "./reenviar-convite-button";
import { EditarUsuarioDrawer } from "./editar-drawer";
import { roleLabel, type AppRole, type Empresa, type Regional } from "@/lib/types";

type AcessoStatus = "ativo" | "pendente" | "inativo";

export type UsuarioRow = {
  user_id: string;
  role: AppRole;
  status: "ativo" | "inativo";
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

  return (
    <>
      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum usuário cadastrado ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-6 py-3">Nome</th>
                <th className="text-left font-semibold px-6 py-3">E-mail</th>
                <th className="text-left font-semibold px-6 py-3">Papel</th>
                <th className="text-left font-semibold px-6 py-3">Status</th>
                <th className="text-right font-semibold px-6 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
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
          empresas={empresas}
          regionais={regionais}
          open={editando !== null}
          onOpenChange={(o) => {
            if (!o) setEditando(null);
          }}
        />
      )}
    </>
  );
}
