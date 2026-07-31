"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatarCNPJ } from "@/lib/utils/formato-fiscal";
import type { Regional, UF } from "@/lib/types";
import { EmpresaDrawer } from "./empresa-drawer";
import {
  desativarEmpresa,
  marcarPrincipal,
  reativarEmpresa,
} from "./actions";

export interface EmpresaRow {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  cidade: string;
  uf: UF;
  principal: boolean;
  ativo: boolean;
  regional_id: string;
  regional_nome: string | null;
}

interface Props {
  rows: EmpresaRow[];
  regionais: Pick<Regional, "id" | "nome">[];
}

export function EmpresasList({ rows, regionais }: Props) {
  const [editar, setEditar] = React.useState<EmpresaRow | null>(null);
  const [menu, setMenu] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  async function acao(fn: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.message) alert(res.message);
      setMenu(null);
    });
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma empresa cadastrada ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-6 py-3">Razão social</th>
                <th className="text-left font-semibold px-6 py-3">CNPJ</th>
                <th className="text-left font-semibold px-6 py-3">Regional</th>
                <th className="text-left font-semibold px-6 py-3">Cidade/UF</th>
                <th className="text-left font-semibold px-6 py-3">Status</th>
                <th className="w-10 px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className="hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
                  onClick={() => setEditar(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setEditar(row);
                    }
                  }}
                >
                  <td className="px-6 py-3.5">
                    <div className="font-medium text-foreground">{row.razao_social}</div>
                    {row.nome_fantasia && (
                      <div className="text-xs text-muted-foreground">
                        {row.nome_fantasia}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3.5 font-mono text-xs text-muted-foreground">
                    {formatarCNPJ(row.cnpj)}
                  </td>
                  <td className="px-6 py-3.5">
                    {row.regional_nome ? (
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200">
                        {row.regional_nome}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-muted-foreground">
                    {row.cidade}/{row.uf}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-1.5">
                      {row.principal && (
                        <Badge className="bg-california-red/10 text-california-red hover:bg-california-red/10 border-california-red/20">
                          Principal
                        </Badge>
                      )}
                      {!row.ativo && (
                        <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border">
                          Inativa
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-6 py-3.5 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="relative inline-block">
                      <button
                        type="button"
                        aria-label="Ações"
                        onClick={() => setMenu(menu === row.id ? null : row.id)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menu === row.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 min-w-[180px] rounded-lg border border-border bg-white p-1 shadow-lg"
                          onMouseLeave={() => setMenu(null)}
                        >
                          <MenuItem
                            onClick={() => {
                              setMenu(null);
                              setEditar(row);
                            }}
                          >
                            Editar
                          </MenuItem>
                          {!row.principal && row.ativo && (
                            <MenuItem
                              disabled={pending}
                              onClick={() => acao(() => marcarPrincipal(row.id))}
                            >
                              Marcar como principal
                            </MenuItem>
                          )}
                          {row.ativo && !row.principal && (
                            <MenuItem
                              disabled={pending}
                              onClick={() => acao(() => desativarEmpresa(row.id))}
                            >
                              Desativar
                            </MenuItem>
                          )}
                          {!row.ativo && (
                            <MenuItem
                              disabled={pending}
                              onClick={() => acao(() => reativarEmpresa(row.id))}
                            >
                              Reativar
                            </MenuItem>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editar && (
        <EmpresaDrawer
          mode="edit"
          empresa={editar}
          regionais={regionais}
          openInitially
          onClose={() => setEditar(null)}
        />
      )}
    </>
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
