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
import type { Cidade } from "@/lib/types";
import { CidadeDrawer } from "./cidade-drawer";
import { inativarCidade, reativarCidade } from "./actions";

type StatusFiltro = "ativas" | "inativas" | "todas";

export function CidadesList({
  cidades,
  isAdmin,
}: {
  cidades: Cidade[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<Cidade | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    cidade: Cidade;
    acao: "inativar" | "reativar";
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return cidades.filter((r) => {
      if (status === "ativas" && !r.ativo) return false;
      if (status === "inativas" && r.ativo) return false;
      if (!q) return true;
      return r.nome.toLowerCase().includes(q);
    });
  }, [cidades, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { cidade, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarCidade(cidade.id)
          : await reativarCidade(cidade.id);
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
        <CidadeDrawer mode="criar" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {cidades.length === 0
              ? "Nenhuma cidade cadastrada ainda."
              : "Nenhuma cidade corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16">UF</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">Origem</th>
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
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {r.uf ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.fonte === "ibge" ? (
                      <span className="inline-flex items-center rounded-md bg-california-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-california-red">
                        IBGE
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Manual</span>
                    )}
                  </td>
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
                            cidade: r,
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
        <CidadeDrawer
          mode="editar"
          cidade={editando}
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
              ? "Inativar cidade?"
              : "Reativar cidade?"
          }
          description={
            confirmando.acao === "inativar"
              ? `A cidade "${confirmando.cidade.nome}" some do dropdown em novos projetos, mas continua nos projetos que já a usam.`
              : `A cidade "${confirmando.cidade.nome}" volta a aparecer no dropdown.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
