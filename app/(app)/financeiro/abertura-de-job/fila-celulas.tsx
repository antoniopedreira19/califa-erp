"use client";

/**
 * As peças comuns às linhas da fila "Jobs aguardando abertura" — job (nova
 * ou errata), save e pedido de cancelamento —, para as três faixas terem a
 * mesma grade (14/10/2026, protótipo aprovado pelo Tiago):
 *
 * - grade fixa (`table-fixed` + `ColunasDaFila`), como a lista de Jobs
 *   (decisão 036). Antes a largura era automática e cada linha tinha uma
 *   altura (71 a 102 px), o código quebrava no hífen ("AMB-" / "1030/26")
 *   e o "Revisar cancelamento" virava botão de duas linhas;
 * - toda célula com no máximo duas linhas, e o texto que não cabe termina
 *   em "…" com a frase inteira ao passar o mouse: a linha fica sempre com
 *   64 px;
 * - botão de uma palavra e largura única, com a ação inteira na dica;
 * - o selo da coluna Job numa pílula de 18 px, com a frase na dica.
 */

import * as React from "react";
import { Ban, ClipboardCheck, FilePenLine, ListRestart, PiggyBank, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A grade da fila. O Job tem 380 px, onde cabe o nome mais longo da fila
 * de 14/10/2026 (348 px), e o Projeto · Cliente fica com a sobra: é a
 * coluna que mais corta texto (nome do projeto e razão social). As fixas
 * somam 1.200 px — daí o `min-w-[1500px]` da tabela.
 */
export function ColunasDaFila() {
  return (
    <colgroup>
      {/* Código */}
      <col className="w-[128px]" />
      {/* Job */}
      <col className="w-[380px]" />
      {/* Projeto · Cliente: absorve a sobra. */}
      <col />
      {/* GP responsável */}
      <col className="w-[208px]" />
      {/* Enviado por */}
      <col className="w-[208px]" />
      {/* Valor total: título, funil e seta da ordem numa linha. */}
      <col className="w-[152px]" />
      {/* Abertura: o botão de 92 px mais o `px-4`. */}
      <col className="w-[124px]" />
    </colgroup>
  );
}

/** A linha da fila: 64 px, toda célula com até duas linhas de texto. */
export const CLASSE_DA_LINHA =
  "h-16 cursor-pointer border-b border-b-[#f4f2f2] transition-colors last:border-0 hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none";
export const CLASSE_DA_CELULA = "px-4 py-2";

export function CelulaCodigo({ codigo }: { codigo: string }) {
  return (
    <span className="whitespace-nowrap font-mono text-xs font-bold text-[#b3323c]">{codigo}</span>
  );
}

/**
 * Job: o nome numa linha; a segunda junta o período (ou a data de
 * abertura, no pedido de cancelamento), o detalhe que pode ser cortado
 * (marca de save, linha do pedido de save) e o selo.
 */
export function CelulaJob({
  nome,
  periodo,
  detalhe,
  selo,
}: {
  nome: string;
  periodo: React.ReactNode;
  detalhe?: { texto: string; icone?: React.ReactNode } | null;
  selo?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <TruncateTooltip as="span" text={nome} className="font-semibold" />
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
        {periodo && <span className="shrink-0 whitespace-nowrap font-mono">{periodo}</span>}
        {detalhe && (
          <>
            {periodo && <span className="shrink-0">·</span>}
            {/* O ícone não encolhe: o chip do job de origem quebrava em
                duas linhas e a linha da tabela crescia. */}
            {detalhe.icone && <span className="flex shrink-0">{detalhe.icone}</span>}
            <TruncateTooltip as="span" text={detalhe.texto} className="min-w-0 font-medium" />
          </>
        )}
        {selo}
      </div>
    </div>
  );
}

export function CelulaProjeto({
  codigo,
  nome,
  cliente,
}: {
  codigo: string | null;
  nome: string | null;
  cliente: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-baseline gap-1 text-[13px]">
        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
          {codigo ?? "—"}
        </span>
        <TruncateTooltip as="span" text={nome ?? ""} className="min-w-0" />
      </span>
      <TruncateTooltip as="span" text={cliente} className="text-xs text-muted-foreground" />
    </div>
  );
}

/** GP: até duas linhas, no corpo do nome de "Enviado por" (13 px). */
export function CelulaGp({ nome }: { nome: string | null }) {
  return (
    <TruncateTooltip text={nome ?? "—"} linhas={2} className="text-[13px] text-muted-foreground" />
  );
}

/** "Enviado por" (decisão 136): quem mandou, numa linha, e quando. */
export function CelulaEnviado({
  nome,
  quando,
  reenvio,
}: {
  nome: string | null;
  quando: string;
  reenvio: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-foreground">
        <TruncateTooltip as="span" text={nome ?? "—"} className="min-w-0" />
        {reenvio && (
          // 18 px: cabe na linha do nome sem empurrar a linha da tabela.
          <span className="inline-flex h-[18px] shrink-0 items-center rounded-md border border-california-red/30 bg-california-red/5 px-1.5 text-[10px] font-bold uppercase leading-none tracking-wider text-california-red">
            Reenvio
          </span>
        )}
      </span>
      <span className="whitespace-nowrap text-[12px] text-muted-foreground">{quando}</span>
    </div>
  );
}

// ---- Botão --------------------------------------------------------------------

export type AcaoDaFila = "cancelamento" | "gera" | "consome" | "errata" | "nova";

const BOTAO: Record<
  AcaoDaFila,
  { rotulo: string; dica: string; icone: React.ComponentType<{ className?: string }> }
> = {
  cancelamento: { rotulo: "Revisar", dica: "Revisar o pedido de cancelamento", icone: Ban },
  // O cofrinho é o save do sistema (o save do orçamento).
  gera: { rotulo: "Revisar", dica: "Revisar o pedido de save", icone: PiggyBank },
  consome: { rotulo: "Revisar", dica: "Revisar o consumo de save", icone: PiggyBank },
  errata: { rotulo: "Revisar", dica: "Revisar a errata", icone: FilePenLine },
  nova: { rotulo: "Abrir job", dica: "Abrir o job", icone: ClipboardCheck },
};

/** O que o filtro do título "Abertura" lista. O botão diz uma palavra só;
 *  o filtro continua separando save de consumo e errata de abertura nova. */
export const ROTULO_DO_FILTRO: Record<Exclude<AcaoDaFila, "cancelamento">, string> = {
  gera: "Revisar save",
  consome: "Revisar consumo",
  errata: "Revisar errata",
  nova: "Abrir job",
};

/** O botão da linha: 92 × 32 px em todas as faixas, centralizado sob o
 *  título "Abertura", com a ação inteira na dica. */
export function BotaoDaFila({ acao, onClick }: { acao: AcaoDaFila; onClick: () => void }) {
  const b = BOTAO[acao];
  const Icone = b.icone;
  return (
    <div className="flex items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="inline-flex h-8 w-[92px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-california-red px-2.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Icone className="h-3.5 w-3.5 shrink-0" />
            {b.rotulo}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{b.dica}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ---- Selo da coluna Job ---------------------------------------------------------

const SELO = {
  cancelamento: {
    rotulo: "Pedido de cancelamento",
    icone: Ban,
    classes: "border-amber-300 bg-amber-50 text-amber-800",
  },
  // Decisão 206: o fechamento do internacional fora do padrão, por exceção
  // do administrador. A dica traz as taxas.
  excecao: {
    rotulo: "Exceção no fechamento",
    icone: ShieldAlert,
    classes: "border-amber-300 bg-amber-50 text-amber-800",
  },
  reorganizada: {
    rotulo: "Nenhum valor alterado",
    icone: ListRestart,
    classes: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
} as const;

/**
 * O selo da coluna Job: pílula de 18 px na segunda linha, com a frase
 * inteira na dica. Antes eram 258 × 43 px ("Pedido de cancelamento · aberto
 * em …", em duas linhas) e 242 × 23 px.
 */
export function SeloDaFila({ tipo, dica }: { tipo: keyof typeof SELO; dica: string }) {
  const s = SELO[tipo];
  const Icone = s.icone;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[10px] font-semibold leading-none",
            s.classes,
          )}
        >
          <Icone className="h-[11px] w-[11px]" />
          {s.rotulo}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{dica}</TooltipContent>
    </Tooltip>
  );
}
