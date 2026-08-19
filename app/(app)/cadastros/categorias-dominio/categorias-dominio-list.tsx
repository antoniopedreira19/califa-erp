"use client";

import * as React from "react";
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
import type { CategoriaDominio, CategoriaDominioEscopo } from "@/lib/types";
import { categoriaDominioEscopoLabel } from "@/lib/types";
import { CategoriaDominioDrawer } from "./categoria-dominio-drawer";
import { inativarCategoriaDominio, reativarCategoriaDominio } from "./actions";
import { useRouter } from "next/navigation";

type StatusFiltro = "ativas" | "inativas" | "todas";
type EscopoFiltro = "projeto" | "orcamento" | "todos";

export function CategoriasDominioList({
  categorias,
  isAdmin,
}: {
  categorias: CategoriaDominio[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [escopoFiltro, setEscopoFiltro] = React.useState<EscopoFiltro>("todos");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<CategoriaDominio | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    categoria: CategoriaDominio;
    acao: "inativar" | "reativar";
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return categorias.filter((c) => {
      if (status === "ativas" && !c.ativo) return false;
      if (status === "inativas" && c.ativo) return false;
      if (escopoFiltro !== "todos" && c.escopo !== escopoFiltro) return false;
      if (!q) return true;
      return c.nome.toLowerCase().includes(q);
    });
  }, [categorias, busca, status, escopoFiltro]);

  function handleConfirm() {
    if (!confirmando) return;
    const { categoria, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarCategoriaDominio(categoria.id)
          : await reativarCategoriaDominio(categoria.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  const defaultEscopoForCreate: CategoriaDominioEscopo =
    escopoFiltro === "todos" ? "projeto" : escopoFiltro;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={escopoFiltro}
            onValueChange={(v) => setEscopoFiltro(v as EscopoFiltro)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os escopos</SelectItem>
              <SelectItem value="projeto">Projeto</SelectItem>
              <SelectItem value="orcamento">Orçamento</SelectItem>
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
              <SelectItem value="ativas">Ativas</SelectItem>
              <SelectItem value="inativas">Inativas</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CategoriaDominioDrawer
          mode="criar"
          defaultEscopo={defaultEscopoForCreate}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {categorias.length === 0
              ? "Nenhuma categoria cadastrada ainda."
              : "Nenhuma categoria corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-36">
                  Escopo
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setEditando(c)}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3 font-medium">{c.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {categoriaDominioEscopoLabel(c.escopo)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.ativo
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          c.ativo ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {c.ativo ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmando({
                            categoria: c,
                            acao: c.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={c.ativo ? "Inativar" : "Reativar"}
                      >
                        {c.ativo ? (
                          <PowerOff className="h-3.5 w-3.5" />
                        ) : (
                          <Power className="h-3.5 w-3.5" />
                        )}
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
        <CategoriaDominioDrawer
          mode="editar"
          categoria={editando}
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
              ? "Inativar categoria?"
              : "Reativar categoria?"
          }
          description={
            confirmando.acao === "inativar"
              ? `A categoria "${confirmando.categoria.nome}" some dos dropdowns em novos projetos/orçamentos, mas continua aparecendo nos que já a usam.`
              : `A categoria "${confirmando.categoria.nome}" volta a aparecer nos dropdowns.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
