"use client";

import * as React from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type UsuarioAcesso = {
  user_id: string;
  nome: string;
  email: string;
  escopo: "todas" | "restrito";
  regionais: string[];
};

export function UsuariosAcessoModal({
  open,
  onOpenChange,
  empresaNome,
  usuarios,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaNome: string;
  usuarios: UsuarioAcesso[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quem tem acesso a {empresaNome}</DialogTitle>
          <DialogDescription>
            {usuarios.length}{" "}
            {usuarios.length === 1 ? "usuário" : "usuários"} com permissão
            ativa nesta empresa.
          </DialogDescription>
        </DialogHeader>
        {usuarios.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhum usuário não-admin tem acesso configurado. Administradores
            do tenant enxergam todas as empresas por padrão.
          </div>
        ) : (
          <ul className="divide-y divide-border max-h-96 overflow-y-auto">
            {usuarios.map((u) => (
              <li
                key={u.user_id}
                className="py-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {u.nome}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {u.email}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground shrink-0 text-right">
                  {u.escopo === "todas" ? (
                    <span className="text-emerald-700 font-medium">
                      Todas regionais
                    </span>
                  ) : (
                    <span>{u.regionais.join(", ") || "Sem regional"}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="pt-3 border-t border-border">
          <Link
            href="/admin/usuarios"
            prefetch={false}
            className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Editar acesso em Usuários →
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
