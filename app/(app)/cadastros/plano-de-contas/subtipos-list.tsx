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
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { SubtipoDrawer } from "./subtipo-drawer";
import { inativarSubtipo, reativarSubtipo } from "./actions";

type StatusFiltro = "ativas" | "inativas" | "todas";

const FILTRO_TIPO_TODOS = "__todos__";

export function SubtiposList({
  subtipos,
  tipos,
  canEdit,
}: {
  subtipos: PlanoContaSubtipo[];
  tipos: PlanoContaTipo[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [filtroTipoId, setFiltroTipoId] = React.useState<string>(FILTRO_TIPO_TODOS);
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<PlanoContaSubtipo | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    subtipo: PlanoContaSubtipo;
    acao: "inativar" | "reativar";
  } | null>(null);

  const tiposMap = React.useMemo(
    () => new Map(tipos.map((t) => [t.id, t])),
    [tipos],
  );

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return subtipos.filter((s) => {
      if (status === "ativas" && !s.ativo) return false;
      if (status === "inativas" && s.ativo) return false;
      if (filtroTipoId !== FILTRO_TIPO_TODOS && s.tipo_id !== filtroTipoId)
        return false;
      if (!q) return true;
      const tipoNome = tiposMap.get(s.tipo_id)?.nome ?? "";
      return (
        s.nome.toLowerCase().includes(q) ||
        tipoNome.toLowerCase().includes(q)
      );
    });
  }, [subtipos, busca, status, filtroTipoId, tiposMap]);

  function handleConfirm() {
    if (!confirmando) return;
    const { subtipo, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarSubtipo(subtipo.id)
          : await reativarSubtipo(subtipo.id);
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
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* Filtro por tipo */}
          <Select
            value={filtroTipoId}
            onValueChange={setFiltroTipoId}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTRO_TIPO_TODOS}>Todos os tipos</SelectItem>
              {tipos.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.codigo} · {t.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as StatusFiltro)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativas">Ativos</SelectItem>
              <SelectItem value="inativas">Inativos</SelectItem>
              <SelectItem value="todas">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && <SubtipoDrawer mode="criar" tipos={tipos} />}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {subtipos.length === 0
              ? "Nenhum subtipo cadastrado ainda."
              : "Nenhum subtipo corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">
                  Tipo
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-20">
                  Ordem
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-28">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const tipo = tiposMap.get(s.tipo_id);
                return (
                  <tr
                    key={s.id}
                    onClick={() => canEdit && setEditando(s)}
                    className={`border-b border-border last:border-0 transition-colors hover:bg-muted/50 ${canEdit ? "cursor-pointer" : ""}`}
                  >
                    <td className="px-4 py-3">
                      {tipo ? (
                        <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide">
                          {tipo.codigo}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{s.nome}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {s.ordem}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.ativo
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${s.ativo ? "bg-emerald-500" : "bg-muted-foreground"}`}
                        />
                        {s.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmando({
                              subtipo: s,
                              acao: s.ativo ? "inativar" : "reativar",
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          title={s.ativo ? "Inativar" : "Reativar"}
                        >
                          {s.ativo ? (
                            <PowerOff className="h-3.5 w-3.5" />
                          ) : (
                            <Power className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <SubtipoDrawer
          mode="editar"
          subtipo={editando}
          tipos={tipos}
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
              ? "Inativar subtipo?"
              : "Reativar subtipo?"
          }
          description={
            confirmando.acao === "inativar"
              ? `O subtipo "${confirmando.subtipo.nome}" ficará inativo e não poderá ser usado em novos lançamentos.`
              : `O subtipo "${confirmando.subtipo.nome}" voltará a ficar disponível.`
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
