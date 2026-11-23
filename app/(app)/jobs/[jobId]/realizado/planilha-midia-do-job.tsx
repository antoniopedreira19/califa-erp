"use client";

/**
 * A Planilha Interna do job de Mídia Off (decisão 167, entrega 2).
 *
 * É a MESMA planilha do orçamento (`PlanilhaMidiaOff`), só leitura, sobre a
 * cópia das linhas do job: a régua da campanha, os meios de cada mês e os
 * Totais da mídia. Muda a régua — "Meses do job", e cada mês diz em que pé
 * está o faturamento dele (em veiculação até tal dia, a enviar, na fila,
 * faturado).
 *
 * Desde a entrega 3, cada linha A · Repasse tem na calha a PP do repasse
 * (`calha`, desenhada pela tabela do job, que é dona das PPs).
 *
 * Desde a entrega 4, cada mês termina com os veículos dele: AP, PI, a NF e
 * o BV do veículo (`veiculosDoMes`, decisão 274).
 *
 * Desde a entrega 5 (decisão 275) é a visão única: a planilha mostra a
 * campanha como está — a linha que mudou em laranja, com o inicial
 * riscado; a extensão como linha vermelha —, e o card "Planejado e
 * realizado", acima dela, guarda o inicial, as ações e o registro.
 */

import type { ReactNode } from "react";
import { ClipboardList } from "lucide-react";
import { nomeVersao } from "@/lib/nome-versao";
import { PlanilhaMidiaOff } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/midia/planilha-midia";
import type { InfoDoRealizado, LinhaMidia } from "@/lib/calculos/midia-off";
import type { VersaoOrcamentoGrupo, VersaoOrcamentoMes } from "@/lib/types";
import type { MidiaDoDetalhe } from "../carregar-detalhe";

export function PlanilhaMidiaDoJob({
  job,
  nomeJob,
  versao,
  meses,
  grupos,
  midia,
  mesPedido,
  hrefPlanilha,
  linkDaVersao,
  detalheDoMes,
  detalheCampanha,
  noLugar = false,
  calha = null,
  veiculosDoMes = null,
  realizado = null,
  cardDoRealizado = null,
}: {
  job: { id: string; projeto_id: string; orcamento_id: string };
  nomeJob: string;
  versao: { id: string; numero_versao: number };
  meses: VersaoOrcamentoMes[];
  /** Os agrupamentos do job (decisão 162), com o meio da âncora na versão. */
  grupos: VersaoOrcamentoGrupo[];
  midia: MidiaDoDetalhe;
  mesPedido: string | undefined;
  hrefPlanilha: string;
  /** O "Ver versão aprovada" — no financeiro ele avisa que sai do módulo
   *  (decisão 099, item 20), por isso vem pronto de quem chama. */
  linkDaVersao: ReactNode;
  /** A situação do faturamento de cada mês (`YYYY-MM`), para a régua. */
  detalheDoMes: Record<string, string>;
  detalheCampanha: string;
  /** A planilha em pop-up da abertura do job (19/10/2026): a régua troca de
   *  mês aqui mesmo, sem navegar. */
  noLugar?: boolean;
  /** A calha de cada linha: a PP do repasse (entrega 3). */
  calha?: ((l: LinhaMidia) => ReactNode) | null;
  /** Os veículos de cada mês, no pé dele (entrega 4, decisão 274). */
  veiculosDoMes?: ((mes: string) => ReactNode) | null;
  /** Planejado e realizado (entrega 5, decisão 275): o que mudou em cada
   *  linha, e o card com o inicial, o atual, as ações e o registro. */
  realizado?: ((id: string) => InfoDoRealizado | null) | null;
  cardDoRealizado?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>Planilha do job · {nomeVersao(nomeJob, versao.numero_versao)}</span>
        </div>
        <div className="flex items-center gap-3">{linkDaVersao}</div>
      </div>

      {cardDoRealizado}

      <PlanilhaMidiaOff
        projetoId={job.projeto_id}
        orcamentoId={job.orcamento_id}
        versaoId={versao.id}
        numeroVersao={versao.numero_versao}
        meses={meses}
        grupos={grupos}
        itens={midia.linhas}
        veiculos={midia.veiculos}
        params={midia.params}
        mesPedido={mesPedido}
        readOnly
        doJob={{ hrefBase: hrefPlanilha, detalheDoMes, detalheCampanha, noLugar, calha, veiculosDoMes, realizado }}
      />
    </div>
  );
}
