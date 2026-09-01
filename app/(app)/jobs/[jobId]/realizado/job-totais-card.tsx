"use client";

// Client por causa do liga-desliga das colunas de save. Os consumidores
// (`JobRealizadoSection` e a conferência do financeiro) já são client.

import * as React from "react";
import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularTotaisVersao,
  LINHAS_FECHAMENTO_POR_TIPO,
  somarLinhaFechamento,
} from "@/lib/calculos/versao-totais";
import { PainelResultado } from "@/components/painel-resultado";
import { LegendaFechamento } from "@/components/legenda-fechamento";
import {
  BotaoColunasSave,
  CabecalhoColunasSave,
  LinhaQuebradaPorSave,
} from "@/components/fechamento-por-save";
import {
  type ItemPlanilhaJob,
  type ItemBv,
  type JobItemRealizado,
} from "@/lib/types";
import { blocosDoItem, somarBlocosDosItens } from "@/lib/calculos/bv-planilha";

interface Props {
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  /** BV por id do item da versão — a dedução da vista Líquido e a linha
   *  "+ BVs" do painel Resultado saem daqui. */
  bvsPorItem: Record<string, ItemBv>;
  /** Job já aberto pelo financeiro. Falso zera o REALIZADO — inclusive o
   *  dos tipos `A` e `D`, que fora isso espelhariam o orçado. */
  jobAberto: boolean;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

/** Taxa configurada na versão: 12 -> "12%", 19.53 -> "19,53%". */
function formatarTaxa(p: number): string {
  return `${String(p).replace(".", ",")}%`;
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


export function JobTotaisCard({
  itens,
  realizadosMap,
  bvsPorItem,
  jobAberto,
  percentualHonorarios,
  percentualImposto,
  moeda,
}: Props) {
  const {
    subtotaisPorTipo,
    subtotalGeral,
    honorarios,
    imposto,
    faturamentoPrevisto,
    valorJob,
    save,
    faturamento,
    job,
  } = calcularTotaisVersao(itens, percentualHonorarios, percentualImposto);

  // Com save, o fechamento abre em três colunas — o mesmo bloco da tela da
  // versão do orçamento. Sem ele os dois totais de baixo divergiriam sem
  // explicação nenhuma nesta tela (decisão 028 §3).
  const temSave = save.totalSaveGerado > 0 || save.totalSaveUsado > 0;

  // Mesma divisão e mesmo padrão FECHADO do card da versão do orçamento —
  // as duas telas mostram o mesmo fechamento e não podem se ler diferente.
  const [colunasSave, setColunasSave] = React.useState(false);
  const quebrarPorSave = temSave && colunasSave;

  // Planejado e realizado passam pelos blocos com BV: o número que o card
  // mostra tem que ser o MESMO que os grupos acima somaram, e a única
  // forma de garantir isso é a conta ser a mesma função.
  const blocosPorItem = new Map(
    itens.map((it) => [
      it.id,
      blocosDoItem(
        it,
        bvsPorItem[it.id] ?? null,
        Number(realizadosMap.get(it.id)?.total_realizado ?? 0),
        percentualImposto,
        jobAberto,
      ),
    ]),
  );
  const totais = somarBlocosDosItens([...blocosPorItem.values()]);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-3 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Orçado × Planejado × Realizado · valores calculados a partir dos
            itens.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="border-b border-border p-6 md:border-b-0 md:border-r">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <p className="text-[13px] font-bold uppercase tracking-wider">
              Fechamento do orçado · por tipo de custo
            </p>
            {temSave && (
              <BotaoColunasSave
                aberto={colunasSave}
                onAlternar={() => setColunasSave((v) => !v)}
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {quebrarPorSave && <CabecalhoColunasSave />}
            {LINHAS_FECHAMENTO_POR_TIPO.map((linha) =>
              quebrarPorSave ? (
                <LinhaQuebradaPorSave
                  key={linha.chave}
                  label={linha.label}
                  usado={somarLinhaFechamento(save.saveUsado, linha.tipos)}
                  gerado={somarLinhaFechamento(save.saveGerado, linha.tipos)}
                  custos={somarLinhaFechamento(save.custosDoJob, linha.tipos)}
                  moeda={moeda}
                />
              ) : (
                <LinhaValor
                  key={linha.chave}
                  rotulo={linha.label}
                  valor={formatCurrency(
                    somarLinhaFechamento(subtotaisPorTipo, linha.tipos),
                    moeda,
                  )}
                />
              ),
            )}
            {quebrarPorSave ? (
              <LinhaQuebradaPorSave
                label="Total dos custos"
                usado={save.totalSaveUsado}
                gerado={save.totalSaveGerado}
                custos={save.totalCustosDoJob}
                moeda={moeda}
                destaque
              />
            ) : (
              <div className="mt-3 border-t border-border pt-3">
                <LinhaValor
                  rotulo="Total dos custos"
                  valor={formatCurrency(subtotalGeral, moeda)}
                  destaque
                />
              </div>
            )}
            {/* Com save, estas duas são as do FATURAMENTO: são elas que
                levam ao "Faturamento previsto" logo abaixo. */}
            <LinhaValor
              rotulo={`Honorários (${formatarTaxa(percentualHonorarios)})`}
              valor={formatCurrency(
                temSave ? faturamento.honorarios : honorarios,
                moeda,
              )}
            />
            <LinhaValor
              rotulo={`Impostos (${formatarTaxa(percentualImposto)})`}
              valor={formatCurrency(
                temSave ? faturamento.imposto : imposto,
                moeda,
              )}
            />
            {/* Os dois fechamentos: o que a California emite nota e o que o
                cliente se compromete a gastar no total. Diferem pelos
                principais pagos direto ao fornecedor (A · Direto, D e F). */}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
              <span className="text-sm font-semibold">
                Faturamento previsto
              </span>
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
            {/* A explicação das duas bases saiu daqui e virou o segundo
                tópico da legenda, no pé do card — igual ao da versão. */}
            {temSave && (
              <div className="flex items-baseline justify-between gap-3 pt-1">
                <span className="text-sm font-semibold text-[#5f5d57]">
                  Save gerado
                </span>
                <span className="whitespace-nowrap font-mono text-lg font-bold text-[#5f5d57]">
                  {formatCurrency(save.totalSaveGerado, moeda)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* O Resultado usa o custo BRUTO e mostra o BV como linha própria
            — por isso ele dá o mesmo número nas duas vistas. Ver o
            comentário de `bvPlanejado` em PainelResultado. */}
        <PainelResultado
          valorJob={valorJob}
          imposto={imposto}
          orcado={totais.orcadoRentabilidade}
          custoPlanejado={totais.planejado.bruto}
          custoRealizado={totais.realizado.bruto}
          bvPlanejado={totais.planejado.deducaoBv}
          bvRealizado={totais.realizado.deducaoBv}
          honorarios={honorarios}
          taxaHonorarios={formatarTaxa(percentualHonorarios)}
          moeda={moeda}
        />
      </div>

      <LegendaFechamento
        custo="custo (planejado ou realizado)"
        extra={
          temSave ? (
            <>
              Os honorários e impostos do fechamento correm sobre{" "}
              <strong className="text-foreground">
                save gerado + custos do job
              </strong>{" "}
              ({formatCurrency(faturamento.base, moeda)}) — é o que esta nota
              cobra. O{" "}
              <strong className="text-foreground">Valor do Job</strong> repete
              a mesma conta sobre{" "}
              <strong className="text-foreground">
                save usado + custos do job
              </strong>{" "}
              ({formatCurrency(job.base, moeda)}): honorários{" "}
              {formatCurrency(job.honorarios, moeda)}, impostos{" "}
              {formatCurrency(job.imposto, moeda)}.
            </>
          ) : undefined
        }
      />
    </div>
  );
}

/** Linha do fechamento repartida em save usado / save gerado / custos do
 *  job. Mesma forma do card de Totais da versão do orçamento — as duas
 *  telas mostram a MESMA quebra, e o design é um só. */
