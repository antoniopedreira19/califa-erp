"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import type { VersaoOrcamentoGrupo, VersaoOrcamentoItem, VersaoOrcamentoCategoria } from "@/lib/types";
import { removerGrupo, renomearGrupo } from "../actions";
import { ItemEditorDrawer } from "./item-editor-drawer";
import { ItensTable } from "./itens-table";

interface Props {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
  moeda: string;
  readOnly?: boolean;
  categorias: VersaoOrcamentoCategoria[];
}

export function GrupoCard({ grupo, itens, moeda, readOnly, categorias }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [renaming, setRenaming] = React.useState(false);
  const [nomeInput, setNomeInput] = React.useState(grupo.nome);
  const [error, setError] = React.useState<string | null>(null);
  const [askRemover, setAskRemover] = React.useState(false);

  const subtotal = itens.reduce(
    (sum, it) => sum + Number(it.total_orcado ?? 0),
    0,
  );

  function handleRenameSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await renomearGrupo(grupo.id, formData);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setRenaming(false);
      router.refresh();
    });
  }

  function handleRemoveConfirm() {
    startTransition(async () => {
      const res = await removerGrupo(grupo.id);
      if (!res.ok) {
        alert(res.message);
      }
      setAskRemover(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {renaming ? (
            <form
              onSubmit={handleRenameSubmit}
              className="flex items-center gap-2 flex-1"
            >
              <Input
                name="nome"
                value={nomeInput}
                onChange={(e) => setNomeInput(e.target.value)}
                autoFocus
                required
                className="h-9 max-w-md"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNomeInput(grupo.nome);
                    setRenaming(false);
                    setError(null);
                  }
                }}
              />
              <button
                type="submit"
                disabled={pending}
                title="Salvar"
                className="p-1.5 rounded-md text-white bg-california-red hover:bg-california-red-hover transition-colors disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setNomeInput(grupo.nome);
                  setRenaming(false);
                  setError(null);
                }}
                disabled={pending}
                title="Cancelar"
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <>
              <h3 className="text-base font-semibold text-foreground truncate">
                {grupo.nome}
              </h3>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  title="Renomear grupo"
                  className="p-1 rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {!renaming && (
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Subtotal
              </p>
              <p className="text-sm font-bold text-foreground tabular-nums">
                {formatCurrency(subtotal, moeda)}
              </p>
            </div>
            {!readOnly && (
              <>
                <ItemEditorDrawer
                  grupoId={grupo.id}
                  grupoNome={grupo.nome}
                />
                <button
                  type="button"
                  onClick={() => setAskRemover(true)}
                  disabled={pending}
                  title="Remover grupo"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
          {error}
        </div>
      )}

      {/* Tabela de itens */}
      <ItensTable
        grupoNome={grupo.nome}
        itens={itens}
        moeda={moeda}
        readOnly={readOnly}
        categorias={categorias}
      />

      <ConfirmDialog
        open={askRemover}
        onOpenChange={setAskRemover}
        title="Remover grupo?"
        description={
          itens.length > 0 ? (
            <>
              O grupo <strong className="text-foreground">{grupo.nome}</strong>{" "}
              tem {itens.length} {itens.length === 1 ? "item" : "itens"}.
              Remova os itens primeiro para poder excluir o grupo.
            </>
          ) : (
            <>
              Remover <strong className="text-foreground">{grupo.nome}</strong>?
              O grupo está vazio e essa ação não pode ser desfeita.
            </>
          )
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleRemoveConfirm}
      />
    </div>
  );
}
