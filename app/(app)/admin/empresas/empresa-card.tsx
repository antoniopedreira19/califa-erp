"use client";

import * as React from "react";
import { MapPin, MoreHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { formatarCNPJ } from "@/lib/utils/formato-fiscal";
import type { Regional } from "@/lib/types";
import { EmpresaDrawer } from "./empresa-drawer";
import { RegionalDrawer } from "./regional-drawer";
import type { EmpresaRow } from "./types";
import {
  desativarEmpresa,
  inativarRegional,
  marcarPrincipal,
  reativarEmpresa,
  reativarRegional,
} from "./actions";

interface Props {
  empresa: EmpresaRow;
  regionais: Regional[];
}

/**
 * Card do organograma de /admin/empresas: header com dados da empresa
 * + botão "+ Regional" e menu de ações; corpo com as regionais dela.
 * Cada regional tem seu próprio menu (Editar, Inativar/Reativar).
 */
export function EmpresaCard({ empresa, regionais }: Props) {
  const [editarEmpresa, setEditarEmpresa] = React.useState(false);
  const [menuEmpresa, setMenuEmpresa] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [novaRegional, setNovaRegional] = React.useState(false);
  const [editarRegional, setEditarRegional] = React.useState<Regional | null>(null);
  const [confirmarRegional, setConfirmarRegional] = React.useState<{
    regional: Regional;
    acao: "inativar" | "reativar";
  } | null>(null);
  const [menuRegional, setMenuRegional] = React.useState<string | null>(null);

  const nomeExibicao = empresa.nome_fantasia ?? empresa.razao_social;

  async function acao(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.message) alert(res.message);
      setMenuEmpresa(false);
      setMenuRegional(null);
    });
  }

  function confirmarAcaoRegional() {
    if (!confirmarRegional) return;
    const { regional, acao: tipo } = confirmarRegional;
    startTransition(async () => {
      const res =
        tipo === "inativar"
          ? await inativarRegional(regional.id)
          : await reativarRegional(regional.id);
      if (!res.ok && res.message) alert(res.message);
      setConfirmarRegional(null);
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
      {/* Header do card */}
      <div className="flex items-start justify-between gap-4 p-6">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setEditarEmpresa(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditarEmpresa(true);
            }
          }}
          className="flex-1 min-w-0 cursor-pointer focus-visible:outline-none"
        >
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground truncate">
              {empresa.razao_social}
            </h3>
            {empresa.principal && (
              <Badge className="bg-california-red/10 text-california-red hover:bg-california-red/10 border-california-red/20">
                Principal
              </Badge>
            )}
            {!empresa.ativo && (
              <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border">
                Inativa
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {empresa.nome_fantasia && (
              <>
                {empresa.nome_fantasia}
                <span className="mx-1.5">·</span>
              </>
            )}
            <span className="font-mono text-xs">{formatarCNPJ(empresa.cnpj)}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {empresa.cidade}/{empresa.uf}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setNovaRegional(true)}
            disabled={!empresa.ativo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={empresa.ativo ? "Nova regional" : "Empresa inativa"}
          >
            <Plus className="h-3.5 w-3.5" />
            Regional
          </button>
          <div className="relative">
            <button
              type="button"
              aria-label="Ações da empresa"
              onClick={() => setMenuEmpresa((v) => !v)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuEmpresa && (
              <div
                className="absolute right-0 top-full mt-1 z-10 min-w-[180px] rounded-lg border border-border bg-white p-1 shadow-lg"
                onMouseLeave={() => setMenuEmpresa(false)}
              >
                <MenuItem
                  onClick={() => {
                    setMenuEmpresa(false);
                    setEditarEmpresa(true);
                  }}
                >
                  Editar
                </MenuItem>
                {!empresa.principal && empresa.ativo && (
                  <MenuItem
                    disabled={pending}
                    onClick={() => acao(() => marcarPrincipal(empresa.id))}
                  >
                    Marcar como principal
                  </MenuItem>
                )}
                {empresa.ativo && !empresa.principal && (
                  <MenuItem
                    disabled={pending}
                    onClick={() => acao(() => desativarEmpresa(empresa.id))}
                  >
                    Desativar
                  </MenuItem>
                )}
                {!empresa.ativo && (
                  <MenuItem
                    disabled={pending}
                    onClick={() => acao(() => reativarEmpresa(empresa.id))}
                  >
                    Reativar
                  </MenuItem>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Corpo: regionais */}
      <div className="border-t border-border bg-muted/20">
        {regionais.length === 0 ? (
          <div className="px-6 py-6 text-center text-xs text-muted-foreground">
            Nenhuma regional nesta empresa. Clique em{" "}
            <span className="font-medium">+ Regional</span> pra criar a primeira.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {regionais.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-6 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className={cn("text-sm truncate", !r.ativo && "text-muted-foreground line-through")}>
                    {r.nome}
                  </span>
                  {!r.ativo && (
                    <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border text-[10px] px-1.5 py-0">
                      Inativa
                    </Badge>
                  )}
                </div>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label={`Ações da regional ${r.nome}`}
                    onClick={() => setMenuRegional(menuRegional === r.id ? null : r.id)}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuRegional === r.id && (
                    <div
                      className="absolute right-0 top-full mt-1 z-10 min-w-[160px] rounded-lg border border-border bg-white p-1 shadow-lg"
                      onMouseLeave={() => setMenuRegional(null)}
                    >
                      <MenuItem
                        onClick={() => {
                          setMenuRegional(null);
                          setEditarRegional(r);
                        }}
                      >
                        Editar
                      </MenuItem>
                      <MenuItem
                        disabled={pending}
                        onClick={() => {
                          setMenuRegional(null);
                          setConfirmarRegional({
                            regional: r,
                            acao: r.ativo ? "inativar" : "reativar",
                          });
                        }}
                      >
                        {r.ativo ? "Inativar" : "Reativar"}
                      </MenuItem>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editarEmpresa && (
        <EmpresaDrawer
          mode="edit"
          empresa={empresa}
          openInitially
          onClose={() => setEditarEmpresa(false)}
        />
      )}

      {novaRegional && (
        <RegionalDrawer
          empresaId={empresa.id}
          empresaNome={nomeExibicao}
          open={novaRegional}
          onOpenChange={setNovaRegional}
        />
      )}

      {editarRegional && (
        <RegionalDrawer
          empresaId={empresa.id}
          empresaNome={nomeExibicao}
          regional={editarRegional}
          open={!!editarRegional}
          onOpenChange={(next) => {
            if (!next) setEditarRegional(null);
          }}
        />
      )}

      {confirmarRegional && (
        <ConfirmDialog
          open={!!confirmarRegional}
          onOpenChange={(next) => {
            if (!next) setConfirmarRegional(null);
          }}
          title={
            confirmarRegional.acao === "inativar"
              ? "Inativar regional?"
              : "Reativar regional?"
          }
          description={
            confirmarRegional.acao === "inativar"
              ? `A regional "${confirmarRegional.regional.nome}" some do dropdown em novos jobs, mas continua nos jobs que já a usam.`
              : `A regional "${confirmarRegional.regional.nome}" volta a aparecer no dropdown.`
          }
          confirmLabel={confirmarRegional.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={confirmarAcaoRegional}
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
