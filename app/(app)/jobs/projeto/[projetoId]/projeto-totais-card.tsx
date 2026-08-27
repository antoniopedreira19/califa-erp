import Link from "next/link";
import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularRentabilidade,
  LINHAS_FECHAMENTO_POR_TIPO,
  somarLinhaFechamento,
  TIPOS_CUSTO,
} from "@/lib/calculos/versao-totais";
import {
  somarBlocosDosItens,
  rotuloColunaTotal,
  valorNaVisao,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";
import { PainelResultado } from "@/components/painel-resultado";
import { LegendaFechamento } from "@/components/legenda-fechamento";
import { type TipoCusto } from "@/lib/types";
import type { JobPlanilhaProjeto } from "./tipos";
import { RentabilidadeNoVao } from "@/app/(app)/_planilha/rentabilidade-inline";
import {
  ColunasJobsProjeto,
  LARGURA_MINIMA_JOBS_PROJETO,
} from "@/app/(app)/_planilha/grade-jobs-projeto";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
} from "@/app/(app)/_planilha/blocos";

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/**
 * Taxa exibida: 12 -> "12%", 19.53 -> "19,53%". Arredonda em 2 casas porque
 * aqui o número costuma ser uma média entre jobs, que dizima com facilidade.
 */
function formatarTaxa(p: number): string {
  return `${String(Math.round(p * 100) / 100).replace(".", ",")}%`;
}

/** Média simples das taxas dos jobs — não ponderada pelo valor de cada um. */
function media(valores: number[]): number {
  if (valores.length === 0) return 0;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

/** Linha "rótulo ......... valor" dos painéis de fechamento e resultado. */
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


export function ProjetoTotaisCard({
  jobs,
  moeda,
  jobHref,
  visao,
}: {
  jobs: JobPlanilhaProjeto[];
  moeda: string;
  /**
   * Para onde o código do job leva. Default é a página de Jobs. O
   * financeiro passa `/financeiro/jobs/[id]`: aquele módulo não
   * encaminha para telas de outros (decisão do Tiago, 20/08/2026).
   */
  jobHref?: (jobId: string) => string;
  /** Bruto ou Líquido (− BV). A mesma dos blocos de job acima. */
  visao: VisaoBv;
}) {
  const totalOrcado = jobs.reduce((s, j) => s + j.orcado, 0);
  // Base da rentabilidade: o orçado sem as linhas em save, que são venda
  // sem execução e não têm custo a comparar (decisão 023 §9).
  const totalOrcadoRentabilidade = jobs.reduce(
    (s, j) => s + j.orcadoRentabilidade,
    0,
  );
  // Blocos, e não números: a linha "+ BVs" do Resultado precisa da
  // dedução separada do bruto.
  const somaDosJobs = somarBlocosDosItens(
    jobs.map((j) => ({
      orcado: j.orcado,
      orcadoRentabilidade: j.orcadoRentabilidade,
      planejado: j.planejado,
      realizado: j.realizado,
    })),
  );
  const totalPlanejado = valorNaVisao(somaDosJobs.planejado, visao);
  const totalRealizado = valorNaVisao(somaDosJobs.realizado, visao);
  const honorarios = jobs.reduce((s, j) => s + j.honorarios, 0);
  const imposto = jobs.reduce((s, j) => s + j.imposto, 0);
  const faturamentoPrevisto = jobs.reduce(
    (s, j) => s + j.faturamentoPrevisto,
    0,
  );
  const valorJob = jobs.reduce((s, j) => s + j.valorJob, 0);

  const subtotaisPorTipo = TIPOS_CUSTO.reduce<Record<TipoCusto, number>>(
    (acc, t) => {
      acc[t] = jobs.reduce((s, j) => s + j.subtotaisPorTipo[t], 0);
      return acc;
    },
    Object.fromEntries(TIPOS_CUSTO.map((t) => [t, 0])) as Record<
      TipoCusto,
      number
    >,
  );

  const temRealizado = totalRealizado > 0;

  // Cada versão aprovada tem as suas taxas. O fechamento do projeto mostra a
  // média delas — os valores em R$ continuam sendo a soma job a job, então o
  // percentual aqui é só referência, não a taxa que gerou aqueles números.
  const taxaHonorarios = formatarTaxa(
    media(jobs.map((j) => j.percentualHonorarios)),
  );
  const taxaImpostos = formatarTaxa(
    media(jobs.map((j) => j.percentualImposto)),
  );

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-start gap-3 border-b border-border p-6">
        <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Orçado × Planejado × Realizado por job · valores calculados a partir
            dos itens de cada planilha.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* Mesma grade da planilha consolidada acima: as colunas Total de
            Orçado, Planejado e Realizado caem exatamente sob as de lá. */}
        <table
          className={cn(
            "w-full table-fixed border-collapse text-sm",
            LARGURA_MINIMA_JOBS_PROJETO,
          )}
        >
          <ColunasJobsProjeto />
          <thead>
            <tr>
              <th colSpan={3} className="border-b border-border bg-muted/40" />
              <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                ORÇADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                PLANEJADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, REALIZADO.faixa)}>
                REALIZADO
              </th>
            </tr>
            <tr className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th colSpan={3} className="px-3 py-2 text-left">
                Job
              </th>
              <th colSpan={3} className={ORCADO.cabecalhoAbre} />
              <th className={cn("px-3 py-2 text-right", ORCADO.cabecalhoFim)}>
                Total
              </th>
              <th colSpan={3} className={PLANEJADO.cabecalhoAbre} />
              <th
                className={cn("px-3 py-2 text-right", PLANEJADO.cabecalhoFim)}
              >
                {rotuloColunaTotal(visao)}
              </th>
              <th colSpan={3} className={REALIZADO.cabecalhoAbre} />
              <th
                className={cn("px-3 py-2 text-right", REALIZADO.cabecalhoFim)}
              >
                {rotuloColunaTotal(visao)}
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-border">
                <td colSpan={3} className="p-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link
                      href={jobHref ? jobHref(j.id) : `/jobs/${j.id}?from=jobs`}
                      prefetch={false}
                      className="font-mono text-xs font-bold text-california-red hover:text-california-red/80"
                    >
                      {j.codigo}
                    </Link>
                    <span className="text-[13.5px]">{j.nome}</span>
                  </div>
                </td>
                <td colSpan={3} className={ORCADO.celulaVazia} />
                <td
                  className={cn(
                    "whitespace-nowrap p-3 text-right font-mono text-[13px]",
                    ORCADO.celulaTotal,
                  )}
                >
                  {formatCurrency(j.orcado, moeda)}
                </td>
                <td
                  colSpan={3}
                  className={cn(
                    "overflow-hidden p-3 text-right",
                    PLANEJADO.celulaVazia,
                  )}
                >
                  <RentabilidadeNoVao
                    orcado={j.orcadoRentabilidade}
                    custo={valorNaVisao(j.planejado, visao)}
                    moeda={moeda}
                    corRotulo={PLANEJADO.textoSuave}
                  />
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap p-3 text-right font-mono text-[13px]",
                    PLANEJADO.celulaTotal,
                  )}
                >
                  {j.planejado.bruto > 0
                    ? formatCurrency(valorNaVisao(j.planejado, visao), moeda)
                    : "—"}
                </td>
                <td
                  colSpan={3}
                  className={cn(
                    "overflow-hidden p-3 text-right",
                    REALIZADO.celulaVazia,
                  )}
                >
                  <RentabilidadeNoVao
                    orcado={j.orcadoRentabilidade}
                    custo={valorNaVisao(j.realizado, visao)}
                    moeda={moeda}
                    corRotulo={REALIZADO.textoSuave}
                  />
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap p-3 text-right font-mono text-[13px]",
                    REALIZADO.celulaTotal,
                  )}
                >
                  {j.realizado.bruto > 0
                    ? formatCurrency(valorNaVisao(j.realizado, visao), moeda)
                    : "—"}
                </td>
              </tr>
            ))}
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
              <td
                colSpan={3}
                className={cn(
                  "overflow-hidden p-3 text-right",
                  PLANEJADO.subtotalVazio,
                )}
              >
                <RentabilidadeNoVao
                  orcado={totalOrcadoRentabilidade}
                  custo={totalPlanejado}
                  moeda={moeda}
                  corRotulo={PLANEJADO.textoSuave}
                />
              </td>
              <td
                className={cn(
                  "whitespace-nowrap p-3 text-right font-mono text-[13px] font-bold",
                  PLANEJADO.subtotalValor,
                )}
              >
                {totalPlanejado > 0 ? formatCurrency(totalPlanejado, moeda) : "—"}
              </td>
              <td
                colSpan={3}
                className={cn(
                  "overflow-hidden p-3 text-right",
                  REALIZADO.subtotalVazio,
                )}
              >
                <RentabilidadeNoVao
                  orcado={totalOrcadoRentabilidade}
                  custo={totalRealizado}
                  moeda={moeda}
                  corRotulo={REALIZADO.textoSuave}
                />
              </td>
              <td
                className={cn(
                  "whitespace-nowrap p-3 text-right font-mono text-[13px] font-bold",
                  REALIZADO.subtotalValor,
                )}
              >
                {temRealizado ? formatCurrency(totalRealizado, moeda) : "—"}
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
            <p className="mt-2.5 text-[11.5px] text-muted-foreground">
              Somatório do fechamento de cada job — cada versão aprovada tem
              suas próprias taxas.
            </p>
          </div>
        </div>

        <PainelResultado
          valorJob={valorJob}
          imposto={imposto}
          orcado={totalOrcadoRentabilidade}
          custoPlanejado={totalPlanejado}
          custoRealizado={totalRealizado}
          honorarios={honorarios}
          moeda={moeda}
        />
      </div>

      <LegendaFechamento custo="custo (planejado ou realizado)" />
    </div>
  );
}
