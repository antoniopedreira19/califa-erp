"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Power, PowerOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Nivel } from "@/lib/types";
import { NivelDrawer } from "./nivel-drawer";
import { inativarNivel, reativarNivel } from "./actions";

type StatusFiltro = "ativos" | "inativos" | "todos";

export function NiveisList({ niveis }: { niveis: Nivel[] }) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativos");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<Nivel | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    nivel: Nivel;
    acao: "inativar" | "reativar";
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return niveis
      .filter((n) => {
        if (status === "ativos" && !n.ativo) return false;
        if (status === "inativos" && n.ativo) return false;
        if (!q) return true;
        return (
          n.codigo.toLowerCase().includes(q) ||
          (n.descricao ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Ordenar por ordem (nulls no fim), depois por código
        if (a.ordem !== null && b.ordem !== null) return a.ordem - b.ordem;
        if (a.ordem !== null) return -1;
        if (b.ordem !== null) return 1;
        return a.codigo.localeCompare(b.codigo, "pt-BR");
      });
  }, [niveis, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { nivel, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarNivel(nivel.id)
          : await reativarNivel(nivel.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por código ou descrição..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as StatusFiltro)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativos">Ativos</SelectItem>
              <SelectItem value="inativos">Inativos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <NivelDrawer mode="criar" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {niveis.length === 0
              ? "Nenhum nível cadastrado ainda."
              : "Nenhum nível corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">
                  Código
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Descrição
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">
                  Ordem
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr
                  key={n.id}
                  onClick={() => setEditando(n)}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3 font-medium">{n.codigo}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {n.descricao ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {n.ordem ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        n.ativo
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          n.ativo ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {n.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmando({
                          nivel: n,
                          acao: n.ativo ? "inativar" : "reativar",
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      title={n.ativo ? "Inativar" : "Reativar"}
                    >
                      {n.ativo ? (
                        <PowerOff className="h-3.5 w-3.5" />
                      ) : (
                        <Power className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <NivelDrawer
          mode="editar"
          nivel={editando}
          open={!!editando}
          onOpenChange={(next) => {
            if (!next) setEditando(null);
          }}
        />
      )}

      {confirmando && (
        <ConfirmDialog
          open={!!confirmando}
          onOpenChange={(next) => {
            if (!next) setConfirmando(null);
          }}
          title={
            confirmando.acao === "inativar"
              ? "Inativar nível?"
              : "Reativar nível?"
          }
          description={
            confirmando.acao === "inativar"
              ? `O nível "${confirmando.nivel.codigo}" some dos dropdowns em novos cadastros, mas continua aparecendo nos colaboradores que já o usam.`
              : `O nível "${confirmando.nivel.codigo}" volta a aparecer nos dropdowns.`
          }
          confirmLabel={
            confirmando.acao === "inativar" ? "Inativar" : "Reativar"
          }
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
