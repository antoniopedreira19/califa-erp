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
 * Fora daqui, por enquanto: a PP do repasse (entrega 3), AP e PI
 * (entrega 4), e a errata e o realizado — inserção que não foi ao ar,
 * compensação, cancelamento da veiculação (entrega 5).
 */

import type { ReactNode } from "react";
import { ClipboardList } from "lucide-react";
import { nomeVersao } from "@/lib/nome-versao";
import { PlanilhaMidiaOff } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/midia/planilha-midia";
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
        doJob={{ hrefBase: hrefPlanilha, detalheDoMes, detalheCampanha }}
      />
    </div>
  );
}
