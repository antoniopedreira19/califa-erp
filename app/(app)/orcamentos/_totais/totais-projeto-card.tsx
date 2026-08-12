"use client";

import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularRentabilidade,
  LINHAS_FECHAMENTO_POR_TIPO,
  somarLinhaFechamento,
  TIPOS_CUSTO,
} from "@/lib/calculos/versao-totais";
import { PainelResultado } from "@/components/painel-resultado";
import { LegendaFechamento } from "@/components/legenda-fechamento";
import { type TipoCusto } from "@/lib/types";
import {
  ColunasFixas,
  LARGURA_MINIMA,
} from "@/app/(app)/_planilha/grade-orcamento";
import {
  ORCADO,
  PLANEJADO,
  RENTABILIDADE,
  FAIXA_ROTULO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";

/**
 * Uma linha do consolidado: o fechamento de UM orçamento de job, já
 * calculado. O card não refaz conta — só soma e formata.
 *
 * Forma neutra de propósito: alimenta tanto o rascunho do orçamento do
 * projeto (onde nada existe no banco ainda) quanto a visão agregada (onde
 * cada linha é a versão vigente de um orçamento gravado).
 */
export interface LinhaTotaisProjeto {
  id: string;
  codigo: string;
  nome: string;
  /** Rótulo curto à direita do nome — "v2 · aprovada", por exemplo. */
  detalhe?: string | null;
  orcado: number;
  planejado: number;
  honorarios: number;
  imposto: number;
  /** O que a California emite nota neste orçamento. */
  faturamentoPrevisto: number;
  /** Compromisso total do cliente neste orçamento. */
  valorJob: number;
  subtotaisPorTipo: Record<TipoCusto, number>;
  percentualHonorarios: number;
  percentualImposto: number;
}

interface Props {
  linhas: LinhaTotaisProjeto[];
  moeda: string;
  /** Texto do subtítulo — muda entre rascunho e visão agregada. */
  descricao?: string;
}

/**
 * Totais consolidados dos orçamentos de um projeto.
 *
 * Mesma estrutura da visão agregada do módulo de Jobs — uma linha por
 * orçamento, fechamento por tipo de custo e painel de resultado — trocando
 * a planilha de acompanhamento pelo orçamento de cada job. Sem o bloco
 * REALIZADO: na fase de orçamento ele ainda não existe.
 */
export function TotaisProjetoCard({ linhas, moeda, descricao }: Props) {
  const totalOrcado = linhas.reduce((s, l) => s + l.orcado, 0);
  const totalPlanejado = linhas.reduce((s, l) => s + l.planejado, 0);
  const honorarios = linhas.reduce((s, l) => s + l.honorarios, 0);
  const imposto = linhas.reduce((s, l) => s + l.imposto, 0);
  const faturamentoPrevisto = linhas.reduce(
    (s, l) => s + l.faturamentoPrevisto,
    0,
  );
  const valorJob = linhas.reduce((s, l) => s + l.valorJob, 0);

  const subtotaisPorTipo = TIPOS_CUSTO.reduce<Record<TipoCusto, number>>(
    (acc, t) => {
      acc[t] = linhas.reduce((s, l) => s + l.subtotaisPorTipo[t], 0);
      return acc;
    },
    Object.fromEntries(TIPOS_CUSTO.map((t) => [t, 0])) as Record<
      TipoCusto,
      number
    >,
  );

  // Cada orçamento tem as suas taxas — a planilha importada traz o % que
  // foi negociado nela, e cada versão gravada guarda as suas. Os valores em
  // R$ são a soma orçamento a orçamento; o percentual exibido é só
  // referência: a média das taxas em uso.
  const taxaHonorarios = formatarTaxa(
    media(linhas.map((l) => l.percentualHonorarios)),
  );
  const taxaImpostos = formatarTaxa(media(linhas.map((l) => l.percentualImposto)));
  const taxasDivergem =
    new Set(linhas.map((l) => l.percentualHonorarios)).size > 1 ||
    new Set(linhas.map((l) => l.percentualImposto)).size > 1;

  const {
    rentabilidade: rentabilidadeProjeto,
    percentual: percentualProjeto,
  } = calcularRentabilidade(totalOrcado, totalPlanejado);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-start gap-3 border-b border-border p-6">
        <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {descricao ??
              "Orçado × Planejado por orçamento de job · valores calculados a partir dos itens de cada planilha."}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* Mesma grade de 13 colunas dos cards de orçamento acima: Total
            orçado, Total planejado, Rentab. e % caem exatamente sob as
            colunas de lá. Sem isso o leitor perde a coluna ao descer. */}
        <table
          className={cn(
            "w-full table-fixed border-collapse text-sm",
            LARGURA_MINIMA,
          )}
        >
          <ColunasFixas />
          <thead>
            <tr>
              <th colSpan={3} className="border-b border-border bg-muted/40" />
              <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                ORÇADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                PLANEJADO
              </th>
              <th colSpan={2} className={cn(FAIXA_ROTULO, RENTABILIDADE.faixa)}>
                RENTABILIDADE
              </th>
            </tr>
            <tr className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th colSpan={3} className="px-3 py-2 text-left">
                Orçamento
              </th>
              <th colSpan={3} className={ORCADO.cabecalhoAbre} />
              <th className={cn("px-3 py-2 text-right", ORCADO.cabecalhoFim)}>
                Total
              </th>
              <th colSpan={3} className={PLANEJADO.cabecalhoAbre} />
              <th
                className={cn("px-3 py-2 text-right", PLANEJADO.cabecalhoFim)}
              >
                Total
              </th>
              <th
                className={cn(
                  "px-3 py-2 text-right",
                  RENTABILIDADE.cabecalhoAbre,
                )}
              >
                Rentab.
              </th>
              <th
                className={cn(
                  "px-3 py-2 text-right",
                  RENTABILIDADE.cabecalhoFim,
                )}
              >
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr className="border-b border-border">
                <td
                  colSpan={13}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Nenhum orçamento de job ainda.
                </td>
              </tr>
            ) : (
              linhas.map((l) => {
                const { rentabilidade, percentual } = calcularRentabilidade(
                  l.orcado,
                  l.planejado,
                );
                const semPlanejado = l.planejado <= 0;
                return (
                  <tr key={l.id} className="border-b border-border">
                    <td colSpan={3} className="p-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-xs font-bold text-california-red">
                          {l.codigo}
                        </span>
                        <span className="text-[13.5px]">{l.nome}</span>
                        {l.detalhe && (
                          <span className="text-[11px] text-muted-foreground">
                            {l.detalhe}
                          </span>
                        )}
                      </div>
                    </td>
                    <td colSpan={3} className={ORCADO.celulaVazia} />
                    <td
                      className={cn(
                        "whitespace-nowrap p-3 text-right font-mono text-[13px]",
                        ORCADO.celulaTotal,
                      )}
                    >
                      {formatCurrency(l.orcado, moeda)}
                    </td>
                    <td colSpan={3} className={PLANEJADO.celulaVazia} />
                    <td
                      className={cn(
                        "whitespace-nowrap p-3 text-right font-mono text-[13px]",
                        PLANEJADO.celulaTotal,
                      )}
                    >
                      {semPlanejado ? "—" : formatCurrency(l.planejado, moeda)}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap p-3 text-right font-mono text-[13px]",
                        RENTABILIDADE.celulaAbre,
                        RENTAB_VALOR,
                      )}
                    >
                      {semPlanejado ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatCurrency(rentabilidade, moeda)
                      )}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap p-3 text-right font-mono text-[13px]",
                        RENTABILIDADE.celulaTotal,
                      )}
                    >
                      {semPlanejado || percentual === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatarPercentual(percentual)
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={3}
                className="border-t border-t-border p-3 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground"
              >
                Total dos custos · projeto
              </td>
              <td colSpan={3} className={ORCADO.subtotalVazio} />
              <td
                className={cn(
                  "whitespace-nowrap p-3 text-right font-mono text-[13px] font-bold",
                  ORCADO.subtotalValor,
                )}
              >
                {formatCurrency(totalOrcado, moeda)}
              </td>
              <td colSpan={3} className={PLANEJADO.subtotalVazio} />
              <td
                className={cn(
                  "whitespace-nowrap p-3 text-right font-mono text-[13px] font-bold",
                  PLANEJADO.subtotalValor,
                )}
              >
                {totalPlanejado > 0 ? formatCurrency(totalPlanejado, moeda) : "—"}
              </td>
              {/* A rentabilidade do projeto agora fecha a própria coluna,
                  no lugar da linha extra que existia embaixo. */}
              <td
                className={cn(
                  "whitespace-nowrap p-3 text-right font-mono text-[13px] font-bold border-r border-r-[#e2e0da]",
                  RENTABILIDADE.bordaAbre,
                  RENTABILIDADE.subtotalValor,
                )}
              >
                {totalPlanejado > 0 ? (
                  formatCurrency(rentabilidadeProjeto, moeda)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap p-3 text-right font-mono text-[13px] font-bold",
                  RENTABILIDADE.subtotalValor,
                )}
              >
                {totalPlanejado > 0 && percentualProjeto !== null ? (
                  formatarPercentual(percentualProjeto)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 border-t border-border md:grid-cols-2">
        <div className="border-b border-border p-6 md:border-b-0 md:border-r">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-wider">
            Fechamento do orçado · por tipo de custo
          </p>
          <div className="flex flex-col gap-1.5">
            {LINHAS_FECHAMENTO_POR_TIPO.map((linha) => (
              <LinhaValor
                key={linha.chave}
                rotulo={linha.label}
                valor={formatCurrency(
                  somarLinhaFechamento(subtotaisPorTipo, linha.tipos),
                  moeda,
                )}
              />
            ))}
            <div className="mt-3 border-t border-border pt-3">
              <LinhaValor
                rotulo="Total dos custos"
                valor={formatCurrency(totalOrcado, moeda)}
                destaque
              />
            </div>
            <LinhaValor
              rotulo={
                <>
                  Honorários <span className="text-xs">({taxaHonorarios})</span>
                </>
              }
              valor={formatCurrency(honorarios, moeda)}
            />
            <LinhaValor
              rotulo={
                <>
                  Impostos <span className="text-xs">({taxaImpostos})</span>
                </>
              }
              valor={formatCurrency(imposto, moeda)}
            />
            {/* Os dois fechamentos: o que a California emite nota e o que o
                cliente se compromete a gastar no total. Diferem pelos
                principais pagos direto ao fornecedor (A · Direto, D e F). */}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
              <span className="text-sm font-semibold">Faturamento previsto</span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-california-red">
                {formatCurrency(faturamentoPrevisto, moeda)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <span className="text-sm font-semibold">Valor do Job</span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-foreground">
                {formatCurrency(valorJob, moeda)}
              </span>
            </div>
            {taxasDivergem && (
              <p className="mt-2.5 text-[11.5px] text-muted-foreground">
                Somatório do fechamento de cada orçamento — os percentuais
                acima são a média das taxas, porque os orçamentos deste
                projeto não usam todos as mesmas.
              </p>
            )}
          </div>
        </div>

        <PainelResultado
          valorJob={valorJob}
          imposto={imposto}
          orcado={totalOrcado}
          custoPlanejado={totalPlanejado}
          custoRealizado={0}
          honorarios={honorarios}
          taxaHonorarios={taxasDivergem ? undefined : taxaHonorarios}
          somentePlanejada
          moeda={moeda}
        />
      </div>

      <div className="overflow-hidden rounded-b-2xl">
        <LegendaFechamento />
      </div>
    </div>
  );
}

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/** 12 → "12%", 19.53 → "19,53%". Arredonda em 2 casas porque o número pode
 *  ser uma média entre jobs, que dizima com facilidade. */
function formatarTaxa(p: number): string {
  return `${String(Math.round(p * 100) / 100).replace(".", ",")}%`;
}

/** Média simples — não ponderada pelo valor de cada job. */
function media(valores: number[]): number {
  if (valores.length === 0) return 0;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

function LinhaValor({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: React.ReactNode;
  valor: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={cn(
          "text-sm",
          destaque ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {rotulo}
      </span>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-sm",
          destaque && "font-semibold",
        )}
      >
        {valor}
      </span>
    </div>
  );
}
