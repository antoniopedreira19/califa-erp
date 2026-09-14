"use client";

/** A régua dos meses do orçamento mensal — Fee e Always On (decisão 078).
 *
 *  Um bloco "Trimestre" e um bloco por mês, cada um com o faturamento e o
 *  resultado geral. O bloco é um link: o mês selecionado mora na URL
 *  (`?mes=2026-07`, `?mes=trimestre`), no mesmo espírito do `?v=` das abas
 *  de versão — recarregar ou compartilhar o link abre no mesmo lugar.
 *
 *  "Editar meses" apaga e adiciona meses do trimestre. Design aprovado em
 *  14/09/2026 (canvas "Planilha Fee e Always On").
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarDays, Plus, Trash2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { adicionarMesNaVersao, removerMesDaVersao } from "../meses-actions";

export interface BlocoDaRegua {
  /** `"trimestre"` ou o id do mês. */
  chave: string;
  rotulo: string;
  faturamento: number;
  /** `null` sem planejado lançado — a conta não existe. */
  resultadoGeral: number | null;
  /** Substitui a linha do resultado geral. Na planilha do job é a
   *  situação do faturamento do mês. */
  detalhe?: string;
  href: string;
}

export interface MesEditavel {
  id: string;
  rotulo: string;
  qtdItens: number;
}

interface Props {
  /** "Meses do orçamento" (padrão) ou "Meses do job". */
  titulo?: string;
  moeda: string;
  /** "Julho a setembro de 2026, pelo período do orçamento". */
  descricao: string;
  trimestre: BlocoDaRegua;
  meses: BlocoDaRegua[];
  selecionado: string;
  /** `null` em versão travada: a régua só navega. */
  editar: {
    versaoId: string;
    trimestreRotulo: string;
    meses: MesEditavel[];
    disponiveis: { mes: string; rotulo: string }[];
  } | null;
}

function formatarPct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}

export function ReguaMeses({
  titulo = "Meses do orçamento",
  moeda,
  descricao,
  trimestre,
  meses,
  selecionado,
  editar,
}: Props) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
          {titulo}
        </span>
        <span className="text-xs text-muted-foreground">{descricao}</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        <Bloco
          bloco={trimestre}
          moeda={moeda}
          ativo={selecionado === trimestre.chave}
          trimestre
        />
        {meses.map((m) => (
          <Bloco
            key={m.chave}
            bloco={m}
            moeda={moeda}
            ativo={selecionado === m.chave}
          />
        ))}
        {editar && (
          <div className="flex items-center pl-1">
            <EditarMeses {...editar} />
          </div>
        )}
      </div>
    </div>
  );
}

function Bloco({
  bloco,
  moeda,
  ativo,
  trimestre = false,
}: {
  bloco: BlocoDaRegua;
  moeda: string;
  ativo: boolean;
  trimestre?: boolean;
}) {
  return (
    <Link
      href={bloco.href}
      prefetch={false}
      scroll={false}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex w-[190px] min-w-0 flex-col gap-[3px] rounded-xl border px-3 py-2.5 transition-colors",
        ativo
          ? "border-california-red bg-white shadow-[0_0_0_3px_rgba(231,75,86,0.18)]"
          : trimestre
            ? "border-border bg-muted/60 hover:border-california-red/40"
            : "border-border bg-white hover:border-california-red/40",
      )}
    >
      <span
        className={cn(
          "text-[10px] font-bold uppercase leading-3 tracking-[0.08em]",
          ativo
            ? "text-california-red"
            : trimestre
              ? "text-foreground"
              : "text-muted-foreground",
        )}
      >
        {bloco.rotulo}
      </span>
      <span className="whitespace-nowrap font-mono text-[13px] font-bold leading-4 text-foreground">
        {formatCurrency(bloco.faturamento, moeda)}
      </span>
      <span className="whitespace-nowrap text-[11px] leading-[14px] text-muted-foreground">
        {bloco.detalhe ??
          (bloco.resultadoGeral === null
            ? "Sem planejado"
            : `Resultado geral ${formatarPct(bloco.resultadoGeral)}`)}
      </span>
    </Link>
  );
}

function EditarMeses({
  versaoId,
  trimestreRotulo,
  meses,
  disponiveis,
}: {
  versaoId: string;
  trimestreRotulo: string;
  meses: MesEditavel[];
  disponiveis: { mes: string; rotulo: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [apagar, setApagar] = React.useState<MesEditavel | null>(null);

  function adicionar(mes: string) {
    setErro(null);
    startTransition(async () => {
      const r = await adicionarMesNaVersao(versaoId, mes);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  function confirmarApagar() {
    if (!apagar) return;
    const alvo = apagar;
    setErro(null);
    startTransition(async () => {
      const r = await removerMesDaVersao(alvo.id);
      setApagar(null);
      if (!r.ok) {
        setErro(r.message);
        setAberto(true);
        return;
      }
      router.refresh();
    });
  }

  const ultimo = meses.length <= 1;

  return (
    <>
      <Popover
        open={aberto}
        onOpenChange={(o) => {
          setAberto(o);
          if (!o) setErro(null);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Editar meses
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Meses deste orçamento</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {trimestreRotulo} · o período do orçamento acompanha os meses
            </p>
          </div>
          <ul>
            {meses.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <CalendarDays className="h-4 w-4 flex-none text-muted-foreground" />
                  <span className="truncate">{m.rotulo}</span>
                  <span className="flex-none text-xs font-normal text-muted-foreground">
                    {m.qtdItens === 1 ? "1 item" : `${m.qtdItens} itens`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={ultimo || pending}
                  title={
                    ultimo
                      ? "O orçamento precisa ter pelo menos um mês."
                      : `Apagar ${m.rotulo}`
                  }
                  aria-label={`Apagar ${m.rotulo}`}
                  onClick={() => {
                    setAberto(false);
                    setApagar(m);
                  }}
                  className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2 px-4 py-3">
            {disponiveis.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {disponiveis.map((d) => (
                  <button
                    key={d.mes}
                    type="button"
                    disabled={pending}
                    onClick={() => adicionar(d.mes)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-california-red bg-california-red/5 px-3 py-1.5 text-xs font-semibold text-california-red transition-colors hover:bg-california-red/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar {d.rotulo.toLowerCase()}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Os três meses do trimestre já estão no orçamento.
              </p>
            )}
            {erro && (
              <p className="flex items-start gap-1.5 text-xs text-california-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                {erro}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={apagar !== null}
        onOpenChange={(o) => !o && setApagar(null)}
        title={apagar ? `Apagar ${apagar.rotulo.toLowerCase()}?` : "Apagar mês?"}
        description={
          apagar && apagar.qtdItens > 0 ? (
            <>
              Os <strong>{apagar.qtdItens === 1 ? "1 item" : `${apagar.qtdItens} itens`}</strong>{" "}
              e os grupos deste mês serão apagados. O período do orçamento passa a
              acompanhar os meses que ficarem. Não dá para desfazer.
            </>
          ) : (
            "O mês não tem itens. O período do orçamento passa a acompanhar os meses que ficarem."
          )
        }
        confirmLabel="Sim, apagar"
        variant="destructive"
        pending={pending}
        onConfirm={confirmarApagar}
      />
    </>
  );
}
