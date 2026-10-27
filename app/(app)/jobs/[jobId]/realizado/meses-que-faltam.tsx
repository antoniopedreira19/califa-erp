"use client";

/** Os meses do trimestre que o job de Fee ou Always On ainda não tem, na
 *  régua "Meses do job" — só com a errata ligada (decisão 219).
 *
 *  Cada mês que falta aparece tracejado ao lado dos outros, no tamanho dos
 *  blocos da régua. O clique pergunta como ele entra: com os itens do
 *  último mês do job ou vazio. O mês só passa a existir quando a errata é
 *  registrada (`registrar_errata_do_job` o inclui na versão aprovada); o
 *  mês deixado vazio não entra. */

import * as React from "react";
import { Copy, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { nomeDoMes, rotuloMesCurto } from "@/lib/calculos/meses-trimestre";

export function MesesQueFaltam({
  faltam,
  fonte,
  onAdicionar,
}: {
  /** `YYYY-MM-01` dos meses do trimestre que o job não tem. */
  faltam: string[];
  /** O mês de onde os itens podem ser copiados — o último do job. */
  fonte: string;
  onAdicionar: (mes: string, copiarItens: boolean) => void;
}) {
  return (
    <>
      {faltam.map((mes) => (
        <MesQueFalta key={mes} mes={mes} fonte={fonte} onAdicionar={onAdicionar} />
      ))}
    </>
  );
}

function MesQueFalta({
  mes,
  fonte,
  onAdicionar,
}: {
  mes: string;
  fonte: string;
  onAdicionar: (mes: string, copiarItens: boolean) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const nome = nomeDoMes(mes);

  function escolher(copiarItens: boolean) {
    setAberto(false);
    onAdicionar(mes, copiarItens);
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-[190px] min-w-0 flex-col gap-[3px] self-stretch rounded-xl border border-dashed border-border bg-transparent px-3 py-2.5 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/[0.03]"
        >
          <span className="text-[10px] font-bold uppercase leading-3 tracking-[0.08em] text-muted-foreground">
            {rotuloMesCurto(mes)}
          </span>
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold leading-4 text-california-red">
            <Plus className="h-3.5 w-3.5" />
            Adicionar mês
          </span>
          <span className="whitespace-nowrap text-[11px] leading-[14px] text-muted-foreground">
            Entra com esta errata
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Adicionar {nome} ao job</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            O mês entra com esta errata e vai à revisão do financeiro.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          <button
            type="button"
            onClick={() => escolher(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-california-red bg-california-red/5 px-3 py-1.5 text-xs font-semibold text-california-red transition-colors hover:bg-california-red/10"
          >
            <Copy className="h-3.5 w-3.5" />
            Com os itens de {nomeDoMes(fonte)}
          </button>
          <button
            type="button"
            onClick={() => escolher(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
          >
            <Plus className="h-3.5 w-3.5" />
            Vazio
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
