"use client";

/** O agrupamento dentro da planilha de um orçamento do RASCUNHO.
 *
 *  Mesma divisão de `grupo-linha.tsx` na tela da versão, e pelo mesmo
 *  motivo: desde 24/08/2026 a planilha é uma tabela só, e o grupo é uma
 *  linha dela. O que sobra aqui são as duas peças que mudam de tela para
 *  tela — o nome e a lixeira.
 *
 *  O nome é editado direto no campo, sem passo de confirmação: nesta
 *  tela o usuário monta vários orçamentos em sequência e cada clique a
 *  mais é atrito. Desde a decisão 148 o nome grava ao sair do campo (ou
 *  no Enter), pela mesma action da tela da versão (`renomearGrupo`) — e
 *  não a cada tecla. Esc desfaz o que foi digitado.
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
  // O que está sendo digitado. Volta ao nome gravado quando ele muda por
  // fora (a gravação recusada desfaz o nome).
  const [valor, setValor] = React.useState(grupo.nome);
  React.useEffect(() => setValor(grupo.nome), [grupo.nome]);

  if (readOnly) {
    return (
      <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-foreground">
        {grupo.nome}
      </span>
    );
  }

  function confirmar() {
    const nome = valor.trim();
    // Grupo sem nome não existe no banco: o campo vazio volta ao de antes.
    if (!nome) {
      setValor(grupo.nome);
      return;
    }
    if (nome !== grupo.nome) onRenomear(nome);
  }

  return (
    <input
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setValor(grupo.nome);
          // O blur depois do Esc grava o nome de antes: nada muda.
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
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
  // A linha em branco que ainda não tem descrição não está no banco.
  const itens = grupo.itens.filter((it) => it.item.trim() !== "").length;

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
          itens > 0 ? (
            <>
              O grupo <strong className="text-foreground">{grupo.nome}</strong>{" "}
              e {itens === 1 ? "o item dele saem" : `os ${itens} itens dele saem`}{" "}
              do orçamento, e os BVs desses itens junto.
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
