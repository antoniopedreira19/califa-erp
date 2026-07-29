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
import type { Regional } from "@/lib/types";
import { RegionalDrawer } from "./regional-drawer";
import { inativarRegional, reativarRegional } from "./actions";

type StatusFiltro = "ativas" | "inativas" | "todas";

export function RegionaisList({
  regionais,
  isAdmin,
}: {
  regionais: Regional[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<Regional | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    regional: Regional;
    acao: "inativar" | "reativar";
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return regionais.filter((r) => {
      if (status === "ativas" && !r.ativo) return false;
      if (status === "inativas" && r.ativo) return false;
      if (!q) return true;
      return r.nome.toLowerCase().includes(q);
    });
  }, [regionais, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { regional, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarRegional(regional.id)
          : await reativarRegional(regional.id);
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
              placeholder="Buscar por nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFiltro)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativas">Ativas</SelectItem>
              <SelectItem value="inativas">Inativas</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <RegionalDrawer mode="criar" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {regionais.length === 0
              ? "Nenhuma regional cadastrada ainda."
              : "Nenhuma regional corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditando(r)}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3">{r.nome}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.ativo
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          r.ativo ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {r.ativo ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmando({
                            regional: r,
                            acao: r.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={r.ativo ? "Inativar" : "Reativar"}
                      >
                        {r.ativo ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <RegionalDrawer
          mode="editar"
          regional={editando}
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
              ? "Inativar regional?"
              : "Reativar regional?"
          }
          description={
            confirmando.acao === "inativar"
              ? `A regional "${confirmando.regional.nome}" some do dropdown em novos jobs, mas continua nos jobs que já a usam.`
              : `A regional "${confirmando.regional.nome}" volta a aparecer no dropdown.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
