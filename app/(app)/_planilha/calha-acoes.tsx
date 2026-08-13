"use client";

/** Pílulas de ação da calha — a faixa que vive FORA do frame da planilha.
 *
 *  Regra que não se negocia: a calha nunca invade a tabela. Ela é
 *  posicionada em `absolute left-full` ao lado das linhas, e a página
 *  reserva essa largura com um `pr-` do mesmo tamanho. Nada aqui pode
 *  crescer sem que a reserva cresça junto — por isso a largura é uma
 *  constante exportada, e não um número solto no JSX.
 *
 *  Uma linha pode ter uma ou duas ações. Até 13/08/2026 sempre foi uma
 *  só: o tipo de custo decidia entre BV (cliente paga o fornecedor) e PP
 *  (a California paga). O A · Repasse quebrou isso — nele o principal
 *  passa pela California, que repassa ao fornecedor, e ainda há comissão
 *  a negociar com esse mesmo fornecedor. A linha precisa das duas.
 *
 *  A saída, do handoff "Job - A com Repasse - BV e PP": nas linhas de
 *  duas ações a pílula se DIVIDE em duas metades separadas por um fio de
 *  1px, dentro da mesma moldura e da mesma largura de calha. O rótulo
 *  encurta para a sigla (o ícone já diz o verbo) e o texto completo vive
 *  no tooltip. Sem coluna nova, sem largura extra, sem nada escondido.
 *  As linhas de ação única continuam exatamente como estavam.
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Largura da calha que recebe as pílulas.
 *
 *  "Adicionar BV" é o rótulo mais longo da trilha — mais que "Gerar PP" e
 *  "Ver PP" —, então é ele quem define o número. A pílula dividida cabe
 *  folgada aqui dentro (duas metades de sigla ≈ 103px), que é justamente
 *  o motivo de o handoff ter escolhido dividir em vez de alargar.
 *
 *  Quem reserva o espaço na página (o `pr-` da seção) tem que usar este
 *  mesmo número, senão a trilha é cortada na borda direita. */
export const LARGURA_CALHA = "w-[116px]";

/** Moldura comum às duas formas — a de ação única e a dividida. */
const MOLDURA = "rounded-lg border border-border bg-white";

/** Corpo do texto, idêntico nas duas formas: mudar aqui muda as duas. */
const CORPO =
  "inline-flex items-center whitespace-nowrap text-[11px] font-semibold transition-colors disabled:opacity-50";

/** Pílula de ação única — a forma de sempre, com o rótulo por extenso. */
export const PILULA_CALHA = cn(CORPO, MOLDURA, "gap-1.5 px-2.5 py-1");

/** Criar é vermelho California; consultar é neutro. A cor é o que separa
 *  "isto ainda não existe" de "isto já existe e você vai abrir". */
const COR_CRIAR = "text-california-red";
const COR_CONSULTAR = "text-foreground";

const HOVER_CRIAR = "hover:bg-california-red/[0.06]";
const HOVER_CONSULTAR = "hover:bg-muted";

/** Só a forma de ação única tem borda própria, então só ela reage nela. */
const BORDA_HOVER_CRIAR = "hover:border-california-red/30";
const BORDA_HOVER_CONSULTAR = "hover:border-[#d7d7d7]";

export interface AcaoCalha {
  /** Identidade estável da ação na linha — "bv" ou "pp". */
  chave: string;
  /** Rótulo por extenso: "Adicionar BV", "Gerar PP". Usado quando a ação
   *  é a única da linha. */
  rotulo: string;
  /** Sigla de duas letras, usada quando a linha tem as duas ações e o
   *  rótulo inteiro não caberia sem alargar a calha. */
  sigla: string;
  /** Conteúdo do tooltip — sempre o texto completo, nas duas formas. É o
   *  que devolve ao usuário o que a sigla tirou. */
  titulo: React.ReactNode;
  icone: LucideIcon;
  /** `true` cria o documento (vermelho); `false` consulta o que já existe
   *  (neutro). */
  criar: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

/** Ícone da consulta em cinza, como na pílula de hoje: o verbo é do
 *  texto, não do ícone. Na criação o ícone acompanha a cor do rótulo. */
function classeIcone(criar: boolean) {
  return cn("h-3.5 w-3.5 flex-none", !criar && "text-muted-foreground");
}

function Meia({ acao }: { acao: AcaoCalha }) {
  const Icone = acao.icone;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={acao.onClick}
          disabled={acao.disabled}
          aria-label={acao.rotulo}
          className={cn(
            CORPO,
            "gap-1 px-2 py-1",
            acao.criar ? COR_CRIAR : COR_CONSULTAR,
            acao.criar ? HOVER_CRIAR : HOVER_CONSULTAR,
          )}
        >
          <Icone className={classeIcone(acao.criar)} />
          {acao.sigla}
        </button>
      </TooltipTrigger>
      <TooltipContent>{acao.titulo}</TooltipContent>
    </Tooltip>
  );
}

function Inteira({ acao }: { acao: AcaoCalha }) {
  const Icone = acao.icone;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={acao.onClick}
          disabled={acao.disabled}
          aria-label={acao.rotulo}
          className={cn(
            PILULA_CALHA,
            acao.criar ? COR_CRIAR : COR_CONSULTAR,
            acao.criar ? HOVER_CRIAR : HOVER_CONSULTAR,
            acao.criar ? BORDA_HOVER_CRIAR : BORDA_HOVER_CONSULTAR,
          )}
        >
          <Icone className={classeIcone(acao.criar)} />
          {acao.rotulo}
        </button>
      </TooltipTrigger>
      <TooltipContent>{acao.titulo}</TooltipContent>
    </Tooltip>
  );
}

/** Renderiza a calha de UMA linha da planilha.
 *
 *  Sem ações devolve `null` — quem chama é que mantém a altura da linha,
 *  porque é ela que precisa continuar batendo com a linha da tabela. */
export function CalhaAcoes({ acoes }: { acoes: AcaoCalha[] }) {
  if (acoes.length === 0) return null;

  if (acoes.length === 1) return <Inteira acao={acoes[0]} />;

  return (
    <span className={cn(MOLDURA, "inline-flex items-stretch overflow-hidden")}>
      {acoes.map((acao, i) => (
        <React.Fragment key={acao.chave}>
          {i > 0 && (
            <span className="w-px flex-none bg-border" aria-hidden />
          )}
          <Meia acao={acao} />
        </React.Fragment>
      ))}
    </span>
  );
}
