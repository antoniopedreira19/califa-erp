"use client";

/** "Concluir PPs" — o marco da decisão 052 aplicado à planilha inteira.
 *
 *  Design: `Planilha Interna - Item com Todas as PPs.dc.html` (04/09/2026).
 *  São dois alcances para o mesmo marco: o painel resolve UM item, esta
 *  barra resolve TODOS os que ainda estão em aberto. O chip da linha
 *  mostra o resultado dos dois.
 *
 *  O aviso antes de gravar não é formalidade: marcar tira o saldo do
 *  planejado da previsão de custo de cada item, e num job de trinta
 *  linhas ninguém tem de cabeça quais estão em aberto. Por isso ele
 *  conta, e o "Ver quais" lista item a item com a situação de cada um.
 *
 *  Quem já está marcado não é tocado — nem aqui, nem no servidor, que
 *  refaz a lista antes de gravar.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { concluirPPsDoJob } from "./actions-conclusao";

export interface ItemEmAberto {
  itemRealizadoId: string;
  nome: string;
  /** "2 PPs · R$ 12.000,00" ou "nenhuma PP" — o que o item tem hoje. */
  situacao: string;
}

export function ConcluirPPsButton({
  jobId,
  itensEmAberto,
  onConcluido,
}: {
  jobId: string;
  /** Itens que geram PP e ainda não disseram que pararam. Vazio = todos
   *  concluídos, e o botão vira um selo apagado. */
  itensEmAberto: ItemEmAberto[];
  onConcluido?: (marcados: number) => void;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [listaVisivel, setListaVisivel] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const quantos = itensEmAberto.length;
  const temPendentes = quantos > 0;
  const contagem = quantos === 1 ? "1 item" : `${quantos} itens`;

  function confirmar() {
    setErro(null);
    startTransition(async () => {
      const res = await concluirPPsDoJob(jobId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAberto(false);
      setListaVisivel(false);
      onConcluido?.(res.marcados);
      router.refresh();
    });
  }

  const botao = (
    <button
      type="button"
      disabled={!temPendentes}
      title={
        temPendentes
          ? `Concluir as PPs dos ${contagem} em aberto da planilha`
          : "Todos os itens que geram PP já estão concluídos"
      }
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-[11px] py-1.5 text-xs font-semibold transition-colors",
        temPendentes
          ? "text-foreground hover:bg-muted"
          : "cursor-default text-muted-foreground",
      )}
    >
      <CheckCircle2 className="h-[13px] w-[13px] text-emerald-700" />
      {temPendentes ? "Concluir PPs" : "PPs concluídas"}
    </button>
  );

  if (!temPendentes) return botao;

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (!o) {
          setListaVisivel(false);
          setErro(null);
        }
      }}
    >
      <PopoverTrigger asChild>{botao}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={7}
        className="w-[404px] p-0"
      >
        <div className="flex flex-col gap-2.5 px-[17px] pb-3.5 pt-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-[15px] w-[15px] flex-none text-california-red" />
            <span className="text-[14.5px] font-bold tracking-tight">
              Concluir as PPs de {contagem}?
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            A previsão de custo desses itens deixa de usar o planejado e passa
            a usar o realizado — as PPs de cada item. Quem já está marcado não
            muda.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-muted/40 px-[11px] py-2.5">
            <span className="flex items-baseline gap-[7px]">
              <span className="font-mono text-base font-bold leading-none">
                {quantos}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {quantos === 1 ? "item" : "itens"} em aberto
              </span>
            </span>
            <button
              type="button"
              onClick={() => setListaVisivel((v) => !v)}
              className="flex-none text-[11.5px] font-bold text-california-red hover:underline"
            >
              {listaVisivel ? "Esconder" : "Ver quais"}
            </button>
          </div>

          {listaVisivel && (
            <div className="flex max-h-[172px] flex-col gap-1.5 overflow-auto rounded-[10px] border border-border bg-white px-[11px] py-2.5">
              {itensEmAberto.map((item) => (
                <span
                  key={item.itemRealizadoId}
                  className="flex items-baseline justify-between gap-2.5"
                >
                  <span className="truncate text-[11.5px] font-semibold">
                    {item.nome}
                  </span>
                  <span className="flex-none font-mono text-[10.5px] text-muted-foreground">
                    {item.situacao}
                  </span>
                </span>
              ))}
            </div>
          )}

          <p className="text-[11px] leading-snug text-muted-foreground">
            Custo A e D não entram: eles não geram PP. Um item pode ser
            reaberto depois, gerando nova PP nele.
          </p>

          {erro && (
            <p className="text-[11.5px] font-medium text-california-red">
              {erro}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border bg-muted/30 px-[17px] py-3">
          <button
            type="button"
            onClick={() => setAberto(false)}
            disabled={pending}
            className="rounded-[9px] border border-border bg-white px-[13px] py-2 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="whitespace-nowrap rounded-[9px] bg-california-red px-[14px] py-2 text-[12.5px] font-bold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            {pending
              ? "Marcando…"
              : quantos === 1
                ? "Sim, marcar 1 item"
                : `Sim, marcar ${quantos} itens`}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
