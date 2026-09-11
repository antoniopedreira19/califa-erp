"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { formatarCNPJ } from "@/lib/utils/formato-fiscal";
import { inativarEmpresaContabil, reativarEmpresaContabil } from "./actions";
import { EmpresaContabilDrawer } from "./empresa-contabil-drawer";
import type { EmpresaContabilRow } from "./types";

interface Props {
  empresa: EmpresaContabilRow;
}

export function EmpresaContabilCard({ empresa }: Props) {
  const [menu, setMenu] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [editarOpen, setEditarOpen] = React.useState(false);
  const [confirmar, setConfirmar] = React.useState<"inativar" | "reativar" | null>(null);

  const nomeExibicao = empresa.nome_fantasia ?? empresa.razao_social;

  async function executarAcaoAtivo(acao: "inativar" | "reativar") {
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarEmpresaContabil(empresa.id)
          : await reativarEmpresaContabil(empresa.id);
      if (!res.ok && "message" in res) alert(res.message);
      setConfirmar(null);
    });
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card shadow-soft overflow-hidden",
        !empresa.ativo && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-4 p-6">
        {/* Clica no corpo para editar */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setEditarOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditarOpen(true);
            }
          }}
          className="flex-1 min-w-0 cursor-pointer focus-visible:outline-none"
        >
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground truncate">
              {nomeExibicao}
            </h3>
            {!empresa.ativo && (
              <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border">
                Inativa
              </Badge>
            )}
          </div>

          {empresa.nome_fantasia && (
            <p className="text-sm text-muted-foreground truncate">
              {empresa.razao_social}
            </p>
          )}

          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            {formatarCNPJ(empresa.cnpj)}
          </p>
        </div>

        {/* Menu de ações */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Ações da empresa contábil"
            onClick={() => setMenu((v) => !v)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {menu && (
            <div
              className="absolute right-0 top-full mt-1 z-10 min-w-[180px] rounded-lg border border-border bg-white p-1 shadow-lg"
              onMouseLeave={() => setMenu(false)}
            >
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  setEditarOpen(true);
                }}
              >
                Editar
              </MenuItem>
              {empresa.ativo ? (
                <MenuItem
                  disabled={pending}
                  onClick={() => {
                    setMenu(false);
                    setConfirmar("inativar");
                  }}
                >
                  Inativar
                </MenuItem>
              ) : (
                <MenuItem
                  disabled={pending}
                  onClick={() => {
                    setMenu(false);
                    setConfirmar("reativar");
                  }}
                >
                  Reativar
                </MenuItem>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Drawer de edição — montado condicionalmente para resetar estado */}
      {editarOpen && (
        <EmpresaContabilDrawer
          mode="editar"
          empresa={empresa}
          openInitially
          onClose={() => setEditarOpen(false)}
        />
      )}

      {confirmar && (
        <ConfirmDialog
          open={!!confirmar}
          onOpenChange={(next) => {
            if (!next) setConfirmar(null);
          }}
          title={
            confirmar === "inativar"
              ? "Inativar empresa contábil?"
              : "Reativar empresa contábil?"
          }
          description={
            confirmar === "inativar"
              ? `"${nomeExibicao}" não aparecerá mais nas opções de emissão de documentos.`
              : `"${nomeExibicao}" voltará a aparecer nas opções de emissão de documentos.`
          }
          confirmLabel={confirmar === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={() => executarAcaoAtivo(confirmar)}
          pending={pending}
        />
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
