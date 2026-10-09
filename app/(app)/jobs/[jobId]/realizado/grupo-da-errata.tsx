"use client";

/** O agrupamento na errata do job (09/10/2026).
 *
 *  A errata organiza a planilha: o agrupamento se renomeia, nasce e — vazio
 *  — sai. As peças têm a MESMA forma das da planilha do orçamento
 *  (`grupo-linha.tsx` e `novo-grupo-inline.tsx`): lápis ao lado do nome,
 *  campo de 28px com ✓ vermelho e ✕, Esc cancela, erro na própria linha, e
 *  o "Novo grupo" tracejado no pé do corpo da tabela. A diferença é que
 *  aqui nada grava: tudo vai para o rascunho da errata, que tem Desfazer e
 *  só chega ao banco quando a errata é confirmada.
 */

import * as React from "react";
import { Check, FolderPlus, Pencil, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { BOTAO_NOVO_GRUPO, ERRATA } from "@/app/(app)/_planilha/blocos";

/** O nome do agrupamento na linha dele, com o lápis que abre o renomear. */
export function NomeDoGrupoNaErrata({
  nome,
  nomeSalvo,
  onRenomear,
}: {
  nome: string;
  /** O nome gravado; `null` no agrupamento criado nesta errata. */
  nomeSalvo: string | null;
  /** Devolve o erro, ou `null` quando renomeou. */
  onRenomear: (nome: string) => string | null;
}) {
  const [renomeando, setRenomeando] = React.useState(false);
  const [valor, setValor] = React.useState(nome);
  const [erro, setErro] = React.useState<string | null>(null);

  // O Desfazer da errata pode trocar o nome por fora.
  React.useEffect(() => {
    if (!renomeando) setValor(nome);
  }, [nome, renomeando]);

  function sair() {
    setValor(nome);
    setRenomeando(false);
    setErro(null);
  }

  function confirmar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A planilha mora dentro do card que recebe as teclas: o submit não
    // pode subir até ele.
    e.stopPropagation();
    const falha = onRenomear(valor);
    if (falha) {
      setErro(falha);
      return;
    }
    setRenomeando(false);
    setErro(null);
  }

  if (renomeando) {
    return (
      <form onSubmit={confirmar} className="flex min-w-0 items-center gap-2">
        <Input
          name="nome"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          autoFocus
          aria-label="Nome do grupo"
          className="h-7 w-[200px] flex-none bg-white"
          onKeyDown={(e) => {
            // As setas e o Enter são do campo, não da seleção da planilha.
            e.stopPropagation();
            if (e.key === "Escape") sair();
          }}
        />
        <button
          type="submit"
          title="Renomear"
          className="rounded-md bg-california-red p-1 text-white transition-colors hover:bg-california-red-hover"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={sair}
          title="Cancelar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {erro && (
          <span title={erro} className="min-w-0 truncate text-[11px] text-california-red">
            {erro}
          </span>
        )}
      </form>
    );
  }

  const renomeado = nomeSalvo !== null && nome !== nomeSalvo;
  return (
    <>
      <TruncateTooltip
        text={nome}
        className="text-[13.5px] font-bold tracking-[-0.01em] text-foreground"
      />
      <button
        type="button"
        onClick={() => setRenomeando(true)}
        title="Renomear grupo"
        className="flex-none rounded-md p-1 text-muted-foreground transition-colors hover:bg-white hover:text-california-red"
      >
        <Pencil className="h-3 w-3" />
      </button>
      {nomeSalvo === null && <span className={`${ERRATA.tagNova} flex-none`}>novo</span>}
      {renomeado && (
        <span title={`Era ${nomeSalvo}`} className={`${ERRATA.tagAlterada} flex-none`}>
          renomeado
        </span>
      )}
    </>
  );
}

/** "Novo grupo" no pé do corpo da tabela — o gatilho vira o campo no
 *  próprio lugar, como no orçamento. O grupo nasce no fim da ordem. */
export function NovoGrupoNaErrata({
  onCriar,
}: {
  onCriar: (nome: string) => string | null;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [nome, setNome] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  function sair() {
    setAberto(false);
    setNome("");
    setErro(null);
  }

  function confirmar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    const falha = onCriar(nome);
    if (falha) {
      setErro(falha);
      return;
    }
    sair();
  }

  if (aberto) {
    return (
      <form onSubmit={confirmar} className="flex min-w-0 items-center gap-2">
        <Input
          name="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          aria-label="Nome do novo agrupamento"
          placeholder="Nomeie o agrupamento"
          className="h-7 w-[240px] flex-none bg-white"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") sair();
          }}
        />
        <button
          type="submit"
          title="Criar agrupamento"
          className="rounded-md bg-california-red p-1 text-white transition-colors hover:bg-california-red-hover"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={sair}
          title="Cancelar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {erro && (
          <span title={erro} className="min-w-0 truncate text-[11px] text-california-red">
            {erro}
          </span>
        )}
      </form>
    );
  }

  return (
    <button type="button" onClick={() => setAberto(true)} className={BOTAO_NOVO_GRUPO}>
      <FolderPlus className="h-3.5 w-3.5" />
      Novo grupo
    </button>
  );
}
