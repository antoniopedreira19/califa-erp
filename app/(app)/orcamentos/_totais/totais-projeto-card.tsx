"use client";

import { Calculator, Info } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import { PainelResultado } from "@/components/painel-resultado";
import { tipoCustoLabel, type TipoCusto } from "@/lib/types";

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

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
  faturamento: number;
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
  const faturamento = linhas.reduce((s, l) => s + l.faturamento, 0);

  const subtotaisPorTipo = TIPOS.reduce<Record<TipoCusto, number>>(
    (acc, t) => {
      acc[t] = linhas.reduce((s, l) => s + l.subtotaisPorTipo[t], 0);
      return acc;
    },
    { A: 0, B: 0, C: 0, D: 0 },
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
        <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
          {/* Sem larguras fixas a coluna de rótulo engole a tabela: as
              células vazias dos blocos não têm conteúdo para disputar
              espaço, e os dois blocos ficariam espremidos à direita. */}
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[4%]" />
            <col className="w-[4%]" />
            <col className="w-[5%]" />
            <col className="w-[20%]" />
            <col className="w-[4%]" />
            <col className="w-[4%]" />
            <col className="w-[5%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={3} className="border-b border-border bg-muted/40" />
              <th
                colSpan={4}
                className="border-b-[3px] border-l-2 border-b-[#282828] border-l-[#d7d7d7] bg-[#f1f0ec] px-3 py-2 text-center text-[11px] font-extrabold tracking-[0.1em] text-foreground"
              >
                ORÇADO
              </th>
              <th
                colSpan={4}
                className="border-b-[3px] border-l-2 border-b-[#2f6fdb] border-l-[#b9d1f4] bg-[#e8f0fd] px-3 py-2 text-center text-[11px] font-extrabold tracking-[0.1em] text-[#1e4fa3]"
              >
                PLANEJADO
              </th>
            </tr>
            <tr className="bg-muted/40">
              <th
                colSpan={3}
                className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Orçamento
              </th>
              <th colSpan={3} className="border-l-2 border-l-[#e4e2dd]" />
              <th className="min-w-[132px] px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total
              </th>
              <th
                colSpan={3}
                className="border-l-2 border-l-[#cfe0f7] bg-blue-50/60"
              />
              <th className="min-w-[132px] bg-blue-50/60 px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[#5a76a8]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr className="border-b border-border">
                <td
                  colSpan={11}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Nenhum orçamento de job ainda.
                </td>
              </tr>
            ) : (
              linhas.map((l) => (
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
                  <td
                    colSpan={3}
                    className="border-l-2 border-l-[#e4e2dd] bg-black/[0.015]"
                  />
                  <td className="whitespace-nowrap bg-black/[0.015] p-3 text-right font-mono text-[13px]">
                    {formatCurrency(l.orcado, moeda)}
                  </td>
                  <td
                    colSpan={3}
                    className="border-l-2 border-l-[#cfe0f7] bg-blue-50/40"
                  />
                  <td className="whitespace-nowrap bg-blue-50/40 p-3 text-right font-mono text-[13px]">
                    {l.planejado > 0
                      ? formatCurrency(l.planejado, moeda)
                      : "—"}
                  </td>
                </tr>
              ))
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
              <td
                colSpan={3}
                className="border-l-2 border-t-2 border-l-[#d7d7d7] border-t-[#282828] bg-[#f1f0ec]"
              />
              <td className="whitespace-nowrap border-t-2 border-t-[#282828] bg-[#f1f0ec] p-3 text-right font-mono text-[13px] font-bold">
                {formatCurrency(totalOrcado, moeda)}
              </td>
              <td
                colSpan={3}
                className="border-l-2 border-t-2 border-l-[#b9d1f4] border-t-[#2f6fdb] bg-[#e8f0fd]"
              />
              <td className="whitespace-nowrap border-t-2 border-t-[#2f6fdb] bg-[#e8f0fd] p-3 text-right font-mono text-[13px] font-bold text-[#1e4fa3]">
                {totalPlanejado > 0 ? formatCurrency(totalPlanejado, moeda) : "—"}
              </td>
            </tr>
            <tr>
              <td
                colSpan={3}
                className="border-t border-t-border px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground"
              >
                Rentabilidade
              </td>
              <td
                colSpan={4}
                className="border-l-2 border-t border-l-[#d7d7d7] border-t-[#e4e2dd] bg-[#f1f0ec]"
              />
              <td
                colSpan={3}
                className="border-l-2 border-t border-l-[#b9d1f4] border-t-[#cfe0f7] bg-[#e8f0fd]"
              />
              <td className="whitespace-nowrap border-t border-t-[#cfe0f7] bg-[#e8f0fd] px-3 py-2.5 text-right">
                <CelulaRentabilidade
                  orcado={totalOrcado}
                  custo={totalPlanejado}
                  moeda={moeda}
                />
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
            {TIPOS.map((t) => (
              <LinhaValor
                key={t}
                rotulo={tipoCustoLabel(t)}
                valor={formatCurrency(subtotaisPorTipo[t], moeda)}
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
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
              <span className="text-sm font-semibold">Faturamento previsto</span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-california-red">
                {formatCurrency(faturamento, moeda)}
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
          faturamento={faturamento}
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

      <div className="flex items-start gap-2 rounded-b-2xl border-t border-border bg-muted/40 px-6 py-4 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          <strong className="text-foreground">Honorários</strong> sobre A + B + D
          · <strong className="text-foreground">Impostos</strong> sobre B + C +
          honorários em <em>gross-up</em> ·{" "}
          <strong className="text-foreground">Faturamento</strong> = custos +
          honorários + impostos ·{" "}
          <strong className="text-foreground">Resultado operacional</strong> =
          faturamento − impostos − custo planejado ·{" "}
          <strong className="text-foreground">Resultado geral</strong> =
          resultado operacional ÷ faturamento.
        </p>
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

function CelulaRentabilidade({
  orcado,
  custo,
  moeda,
}: {
  orcado: number;
  custo: number;
  moeda: string;
}) {
  const { rentabilidade, percentual } = calcularRentabilidade(orcado, custo);

  if (custo <= 0) {
    return <span className="font-mono text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-[12.5px] font-bold text-[#1e4fa3]">
        {formatCurrency(rentabilidade, moeda)}
      </span>
      {percentual !== null && (
        <span className="font-mono text-[10.5px] text-[#5a76a8]">
          {formatarPercentual(percentual)}
        </span>
      )}
    </div>
  );
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
