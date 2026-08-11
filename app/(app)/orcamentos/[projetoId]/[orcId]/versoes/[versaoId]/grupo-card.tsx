"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Pencil, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn } from "@/lib/utils";
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  Categoria,
  ItemBv,
} from "@/lib/types";
import { removerGrupo, renomearGrupo } from "../actions";
import { ItensTable } from "./itens-table";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";

interface Props {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
  moeda: string;
  readOnly?: boolean;
  categorias: Categoria[];
  aberto: boolean;
  onAlternar: () => void;
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  versaoLabel: string;
}

export function GrupoCard({
  grupo,
  itens,
  moeda,
  readOnly,
  categorias,
  aberto,
  onAlternar,
  bvsPorItem,
  fornecedores,
  versaoLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [renaming, setRenaming] = React.useState(false);
  const [nomeInput, setNomeInput] = React.useState(grupo.nome);
  const [error, setError] = React.useState<string | null>(null);
  const [askRemover, setAskRemover] = React.useState(false);

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

  /** Identidade do grupo — vai para dentro da faixa do thead, ao lado de
   *  ORÇADO / PLANEJADO / RENTABILIDADE. A barra de título de antes só
   *  existia para segurar isto e custava uma linha inteira de altura. */
  const cabecalho = renaming ? (
    <form onSubmit={handleRenameSubmit} className="flex items-center gap-2">
      <Input
        name="nome"
        value={nomeInput}
        onChange={(e) => setNomeInput(e.target.value)}
        autoFocus
        required
        className="h-8 max-w-[260px]"
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
    <div className="flex min-w-0 items-center gap-2.5">
      <button
        type="button"
        onClick={onAlternar}
        title={aberto ? "Ocultar itens do grupo" : "Mostrar itens do grupo"}
        aria-expanded={aberto}
        className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md border border-border bg-white text-muted-foreground hover:text-california-red hover:border-california-red/40 transition-colors"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-150",
            !aberto && "-rotate-90",
          )}
        />
      </button>
      <TruncateTooltip
        as="h3"
        text={grupo.nome}
        className="text-base font-semibold text-foreground"
      />
      {!readOnly && (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          title="Renomear grupo"
          className="flex-none p-1 rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  /** Contador e remover: calha à direita da tabela, na altura da faixa. */
  const acoes = renaming ? null : (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">
        {itens.length} {itens.length === 1 ? "item" : "itens"}
        {!aberto && itens.length > 0 && " ocultos"}
      </span>
      {!readOnly && (
        <button
          type="button"
          onClick={() => setAskRemover(true)}
          disabled={pending}
          title="Remover grupo"
          className="rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    // Sem overflow-hidden: a trilha de ações da ItensTable precisa
    // escapar do frame do card. Os cantos são arredondados por filho.
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      {error && (
        <div className="rounded-t-2xl border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
          {error}
        </div>
      )}

      {/* Tabela de itens — agora abre o card: a faixa dela carrega o nome
          do grupo junto com os rótulos dos blocos. */}
      <ItensTable
        grupoId={grupo.id}
        grupoNome={grupo.nome}
        itens={itens}
        moeda={moeda}
        readOnly={readOnly}
        categorias={categorias}
        aberto={aberto}
        bvsPorItem={bvsPorItem}
        fornecedores={fornecedores}
        versaoLabel={versaoLabel}
        cabecalhoGrupo={cabecalho}
        acoesGrupo={acoes}
        abreCard={!error}
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
