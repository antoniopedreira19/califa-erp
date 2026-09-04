"use client";

/** O agrupamento dentro da tabela única da planilha do orçamento.
 *
 *  Até 24/08/2026 isto era um CARD: cada grupo tinha moldura própria,
 *  cabeçalho de colunas próprio e subtotal próprio no `tfoot`. O handoff
 *  "Planilha Interna - Grupos Unificados" acabou com a repetição — agora
 *  a planilha inteira é uma tabela só e o grupo é uma linha dela.
 *
 *  O que sobrou aqui são as duas peças que MUDAM de tela para tela e por
 *  isso não podiam morar dentro da tabela:
 *
 *  - `NomeDoGrupo` — o nome e o renomear. Aqui ele grava por Server
 *    Action e pede confirmação; no rascunho (`_rascunho`) o mesmo lugar
 *    edita estado local, sem confirmação.
 *  - `AcoesDoGrupo` — a lixeira, que vai para a calha à direita, na
 *    altura da linha do grupo (decisão do Tiago, 24/08/2026: o lápis
 *    fica na linha, a lixeira na calha).
 *
 *  O chevron de recolher e o contador de itens NÃO estão aqui: são
 *  iguais em toda planilha e saem de dentro da própria tabela.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import type { GrupoDaPlanilha } from "./itens-table";
import { removerGrupo, renomearGrupo } from "../actions";

/** O nome do grupo na linha dele, com o lápis que abre o renomear. */
export function NomeDoGrupo({
  grupo,
  readOnly,
}: {
  grupo: GrupoDaPlanilha;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [renomeando, setRenomeando] = React.useState(false);
  const [nome, setNome] = React.useState(grupo.nome);
  const [erro, setErro] = React.useState<string | null>(null);

  // O nome pode mudar por fora (recarregar depois de salvar, importar
  // planilha): sem isto o campo guardaria para sempre o texto antigo.
  React.useEffect(() => {
    if (!renomeando) setNome(grupo.nome);
  }, [grupo.nome, renomeando]);

  function sair() {
    setNome(grupo.nome);
    setRenomeando(false);
    setErro(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await renomearGrupo(grupo.id, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setRenomeando(false);
      router.refresh();
    });
  }

  if (renomeando) {
    return (
      <form onSubmit={handleSubmit} className="flex min-w-0 items-center gap-2">
        <Input
          name="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          required
          className="h-7 max-w-[240px]"
          onKeyDown={(e) => {
            if (e.key === "Escape") sair();
          }}
        />
        <button
          type="submit"
          disabled={pending}
          title="Salvar"
          className="rounded-md bg-california-red p-1 text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={sair}
          disabled={pending}
          title="Cancelar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {/* O aviso fica na própria linha: sem card por grupo, não há mais
            faixa acima da tabela onde encaixá-lo. A calha mede a linha,
            então crescer aqui não desalinha nada. */}
        {erro && (
          <span className="whitespace-nowrap text-[11px] text-california-red">
            {erro}
          </span>
        )}
      </form>
    );
  }

  return (
    <>
      <TruncateTooltip
        text={grupo.nome}
        className="text-[13.5px] font-bold tracking-[-0.01em] text-foreground"
      />
      {!readOnly && (
        <button
          type="button"
          onClick={() => setRenomeando(true)}
          title="Renomear grupo"
          className="flex-none rounded-md p-1 text-muted-foreground transition-colors hover:bg-white hover:text-california-red"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </>
  );
}

/** A lixeira do grupo — vive na calha, fora do frame da tabela. */
export function AcoesDoGrupo({ grupo }: { grupo: GrupoDaPlanilha }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [perguntando, setPerguntando] = React.useState(false);

  function confirmar() {
    startTransition(async () => {
      const res = await removerGrupo(grupo.id);
      if (!res.ok) alert(res.message);
      setPerguntando(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPerguntando(true)}
        disabled={pending}
        title={`Remover ${grupo.nome}`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-50"
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
              e os {grupo.itens.length}{" "}
              {grupo.itens.length === 1 ? "item" : "itens"} dentro dele saem da
              planilha. Essa ação não pode ser desfeita.
            </>
          ) : (
            <>
              Remover <strong className="text-foreground">{grupo.nome}</strong>?
              O grupo está vazio e essa ação não pode ser desfeita.
            </>
          )
        }
        confirmLabel={
          grupo.itens.length > 0
            ? `Remover grupo e ${grupo.itens.length} ${grupo.itens.length === 1 ? "item" : "itens"}`
            : "Remover"
        }
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={confirmar}
      />
    </>
  );
}
