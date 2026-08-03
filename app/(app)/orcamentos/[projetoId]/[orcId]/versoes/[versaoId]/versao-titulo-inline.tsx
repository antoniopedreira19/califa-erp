"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { atualizarVersao } from "../actions";

interface Props {
  versaoId: string;
  nome: string | null;
  numeroVersao: number;
  /** Versão aprovada não aceita renomear — o título vira texto puro. */
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Título da versão editável no lugar: clicar no nome abre um campo ali
 * mesmo, sem passar pelo drawer. O drawer continua sendo o caminho dos
 * outros campos (moeda, câmbio, honorários, impostos, status).
 *
 * Reaproveita `atualizarVersao`: o FormData leva só `nome`, e a action
 * preserva os demais campos quando eles não vêm no formulário.
 */
export function VersaoTituloInline({
  versaoId,
  nome,
  numeroVersao,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState(false);
  const [valor, setValor] = React.useState(nome ?? "");
  const [erro, setErro] = React.useState<string | null>(null);

  const rotulo = nome ?? `Versão ${numeroVersao}`;

  // Renomear no drawer também muda o nome — sem isso o campo guardaria
  // o valor antigo até a próxima montagem.
  React.useEffect(() => {
    if (!editando) setValor(nome ?? "");
  }, [nome, editando]);

  function cancelar() {
    setValor(nome ?? "");
    setEditando(false);
    setErro(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    if (valor.trim() === (nome ?? "")) {
      setEditando(false);
      return;
    }

    const formData = new FormData();
    formData.set("nome", valor.trim());

    startTransition(async () => {
      const res = await atualizarVersao(versaoId, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setEditando(false);
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <h1 className="text-3xl font-bold tracking-tight" title={disabledReason}>
        {rotulo}
      </h1>
    );
  }

  return (
    <div className="relative">
      {editando ? (
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          {/* Campo do tamanho do texto: um input de largura fixa empurraria
              o resumo de rentabilidade para a linha de baixo só por entrar
              em modo de edição. O span invisível divide a mesma célula do
              grid e dita a largura. */}
          <span className="inline-grid min-w-[9rem] max-w-[min(28rem,50vw)] items-center">
            <span
              aria-hidden
              className="col-start-1 row-start-1 invisible whitespace-pre px-3 text-3xl font-bold tracking-tight"
            >
              {valor || `Versão ${numeroVersao}`}
            </span>
            <input
              name="nome"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelar();
              }}
              autoFocus
              disabled={pending}
              aria-label="Nome da versão"
              placeholder={`Versão ${numeroVersao}`}
              // size=1 zera a largura intrínseca do input: sem isso ele
              // dita o tamanho da coluna do grid em vez do span medidor.
              size={1}
              className="col-start-1 row-start-1 h-11 w-full min-w-0 rounded-xl border border-california-red bg-white px-3 text-3xl font-bold tracking-tight text-foreground outline-none ring-2 ring-california-red/15 placeholder:font-normal placeholder:text-muted-foreground disabled:opacity-60"
            />
          </span>
          <button
            type="submit"
            disabled={pending}
            title="Salvar nome"
            className="p-1.5 rounded-md text-white bg-california-red hover:bg-california-red-hover transition-colors disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={cancelar}
            disabled={pending}
            title="Cancelar"
            className="p-1.5 rounded-md text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <h1 className="text-3xl font-bold tracking-tight">
          <button
            type="button"
            onClick={() => setEditando(true)}
            title="Clique para renomear a versão"
            className="group -mx-2 inline-flex items-center gap-2 rounded-xl px-2 py-0.5 text-left hover:bg-accent transition-colors"
          >
            {rotulo}
            <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </h1>
      )}

      {/* Fora do fluxo: erro não pode empurrar o badge e os botões da
          mesma linha do título. */}
      {erro && (
        <p className="absolute left-0 top-full mt-1 whitespace-nowrap text-xs text-california-red">
          {erro}
        </p>
      )}
    </div>
  );
}
