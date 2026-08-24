"use client";

/** O agrupamento dentro da planilha de um orçamento do RASCUNHO.
 *
 *  Mesma divisão de `grupo-linha.tsx` na tela da versão, e pelo mesmo
 *  motivo: desde 24/08/2026 a planilha é uma tabela só, e o grupo é uma
 *  linha dela. O que sobra aqui são as duas peças que mudam de tela para
 *  tela — o nome e a lixeira.
 *
 *  A diferença para a versão está no destino da escrita: lá é Server
 *  Action, aqui é o estado em memória do editor. Nada existe no banco
 *  até o "Salvar orçamentos", e por isso o nome é editado direto no
 *  campo, sem passo de confirmação: nesta tela o usuário monta vários
 *  orçamentos em sequência e cada clique a mais é atrito.
 */

import * as React from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { GrupoRascunho } from "./tipos";

/** O nome do grupo na linha dele — campo aberto, sem confirmar. */
export function NomeDoGrupoRascunho({
  grupo,
  readOnly,
  onRenomear,
}: {
  grupo: GrupoRascunho;
  readOnly?: boolean;
  onRenomear: (nome: string) => void;
}) {
  if (readOnly) {
    return (
      <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-foreground">
        {grupo.nome}
      </span>
    );
  }

  return (
    <input
      value={grupo.nome}
      onChange={(e) => onRenomear(e.target.value)}
      placeholder="Nome do grupo"
      aria-label="Nome do grupo"
      className="w-full min-w-0 max-w-[260px] rounded-md bg-transparent px-1.5 py-0.5 text-[13.5px] font-bold tracking-[-0.01em] text-foreground outline-none transition-colors hover:bg-white focus:bg-white focus:ring-2 focus:ring-california-red/15"
    />
  );
}

/** A lixeira do grupo — vive na calha, fora do frame da tabela. */
export function AcoesDoGrupoRascunho({
  grupo,
  onRemover,
}: {
  grupo: GrupoRascunho;
  onRemover: () => void;
}) {
  const [perguntando, setPerguntando] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setPerguntando(true)}
        title={`Remover ${grupo.nome}`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <ConfirmDialog
        open={perguntando}
        onOpenChange={setPerguntando}
        title="Remover grupo?"
        description={
          grupo.itens.length > 0 ? (
            <>
              O grupo <strong className="text-foreground">{grupo.nome}</strong>{" "}
              e seus {grupo.itens.length}{" "}
              {grupo.itens.length === 1 ? "item" : "itens"} saem do rascunho.
              Nada foi gravado ainda, então nada some do banco.
            </>
          ) : (
            <>
              Remover <strong className="text-foreground">{grupo.nome}</strong>?
              O grupo está vazio.
            </>
          )
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        onConfirm={() => {
          setPerguntando(false);
          onRemover();
        }}
      />
    </>
  );
}
