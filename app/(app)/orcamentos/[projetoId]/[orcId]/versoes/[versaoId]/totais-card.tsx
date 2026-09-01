"use client";

// Client por causa do liga-desliga das colunas de save no fechamento. O
// único consumidor (`PlanilhaVersao`) já é client; a diretiva aqui é para
// a regra ficar explícita se alguém renderizar este card de um server
// component amanhã.

import * as React from "react";
import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { LegendaFechamento } from "@/components/legenda-fechamento";
import {
  BotaoColunasSave,
  CabecalhoColunasSave,
  LinhaQuebradaPorSave,
} from "@/components/fechamento-por-save";
import {
  calcularTotaisVersao,
  calcularRentabilidade,
  calcularResultadoOperacional,
  LINHAS_FECHAMENTO_POR_TIPO,
  somarLinhaFechamento,
} from "@/lib/calculos/versao-totais";
import { type ItemBv, type VersaoOrcamentoItem } from "@/lib/types";
import {
  blocosDoItem,
  somarBlocosDosItens,
  valorNaVisao,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";

interface Props {
  itens: VersaoOrcamentoItem[];
  /** BV por id do item — a dedução da vista Líquido e a linha "+ BVs" do
   *  Resultado saem daqui. */
  bvsPorItem: Record<string, ItemBv>;
  /** Bruto ou Líquido (− BV). Tem que ser a MESMA dos grupos acima. */
  visao: VisaoBv;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

export function TotaisCard({
  itens,
  bvsPorItem,
  visao,
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

  // Com save, o fechamento abre em três colunas: o mesmo subtotal por tipo
  // repartido entre o que é pago por crédito de fora, o que vira crédito e
  // o que este job de fato entrega. As três somam o subtotal, por
  // construção — é a quebra que explica por que os dois números de baixo
  // deixaram de ser iguais (docs/decisions/028-save-entre-jobs.md §3).
  const temSave = save.totalSaveGerado > 0 || save.totalSaveUsado > 0;

  // Divisão dos tipos de custo por função do save (usado / gerado / custos
  // do job). Nasce FECHADA, como no design: a divisão é leitura de
  // conferência, e o número do dia a dia é a coluna única.
  const [colunasSave, setColunasSave] = React.useState(false);
  const quebrarPorSave = temSave && colunasSave;

  // O planejado passa pelos blocos com BV: em `A` e `D` ele espelha o
  // orçado, e na vista Líquido a comissão sai fora. O número aqui tem que
  // ser o MESMO que os grupos somaram — por isso é a mesma função.
  const blocosPorItem = new Map(
    itens.map((it) => [
      it.id,
      blocosDoItem(it, bvsPorItem[it.id] ?? null, 0, percentualImposto),
    ]),
  );
  const totais = somarBlocosDosItens([...blocosPorItem.values()]);

  const totalPlanejado = valorNaVisao(totais.planejado, visao);
  const { rentabilidade, percentual: percentualRentabilidade } =
    // `orcadoRentabilidade`, não `orcado`: a coluna ORÇADO mostra o valor
    // cheio (ele está sendo faturado), mas a linha em save fica fora da
    // comparação com o custo (decisão 028 §9).
    calcularRentabilidade(totais.orcadoRentabilidade, totalPlanejado);

  const temPlanejado = totalPlanejado > 0;

  // Resultado operacional = o que sobra depois de pagar imposto e o custo
  // que a agência realmente espera desembolsar (planejado). Sem planejado
  // lançado a conta não existe — mostra travessão em vez de número inflado.
  // A base é o VALOR DO JOB, não o faturamento previsto: o custo planejado
  // inclui os itens pagos direto ao fornecedor, então a receita comparada
  // precisa incluí-los também.
  // O BV entra como REDUÇÃO do custo na conta, e como linha somando na
  // leitura — as duas escritas da mesma operação. Consequência de
  // propósito: o Resultado dá o mesmo número nas duas vistas da chave.
  const bvNoResultado = totais.planejado.deducaoBv;
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    valorJob,
    imposto,
    totais.planejado.bruto - bvNoResultado,
  );

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Orçado × Planejado · valores calculados a partir dos itens.
          </p>
        </div>
      </div>

      {/* Fechamento contábil e resultado */}
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Fechamento do orçado */}
        <div className="p-6">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <p className="text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
              Fechamento do orçado · por tipo de custo
            </p>
            {/* Só aparece quando há save: sem ele não existe o que dividir. */}
            {temSave && (
              <BotaoColunasSave
                aberto={colunasSave}
                onAlternar={() => setColunasSave((v) => !v)}
              />
            )}
          </div>
          <div className="space-y-1.5">
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
                <Linha
                  key={linha.chave}
                  label={linha.label}
                  value={somarLinhaFechamento(subtotaisPorTipo, linha.tipos)}
                  moeda={moeda}
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
              <Linha
                label="Total dos custos"
                value={subtotalGeral}
                moeda={moeda}
                destaque
              />
            )}
            {/* Com save, estas duas são as do FATURAMENTO: são elas que
                levam ao "Faturamento previsto" logo abaixo. As do valor do
                job saem na nota, porque a conta é outra e mostrar só uma
                deixaria um dos dois totais sem explicação na tela. */}
            <Linha
              label={`Honorários (${formatPct(percentualHonorarios)}%)`}
              value={temSave ? faturamento.honorarios : honorarios}
              moeda={moeda}
            />
            <Linha
              label={`Impostos (${formatPct(percentualImposto)}%)`}
              value={temSave ? faturamento.imposto : imposto}
              moeda={moeda}
            />
            {/* Os dois fechamentos: o que a California emite nota e o que o
                cliente se compromete a gastar no total. Diferem pelos
                principais pagos direto ao fornecedor (A · Direto, D e F). */}
            <div className="mt-3 pt-3.5 border-t border-border flex items-baseline justify-between gap-3">
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
            {/* A explicação das duas bases saiu daqui e virou o segundo
                tópico da legenda, no pé do card. */}
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

        {/* Resultado */}
        <div className="p-6">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
            Resultado
          </p>
          <div className="space-y-1.5">
            <Linha label="Valor do Job" value={valorJob} moeda={moeda} />
            <Linha label="− Impostos" value={imposto} moeda={moeda} />
            <Linha
              label="− Custo planejado"
              value={totais.planejado.bruto}
              moeda={moeda}
            />
            {bvNoResultado > 0 && (
              <Linha
                label="+ BVs (planejados, líquidos)"
                value={bvNoResultado}
                moeda={moeda}
              />
            )}
            <div className="mt-3 pt-3 border-t border-border flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">
                Resultado operacional
              </span>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-base font-bold",
                  resultadoOperacional === null
                    ? "text-muted-foreground"
                    : corRentabilidade(resultadoOperacional),
                )}
              >
                {resultadoOperacional === null
                  ? "—"
                  : formatCurrency(resultadoOperacional, moeda)}
              </span>
            </div>
          </div>

          <div className="mt-2.5 rounded-xl border border-border bg-muted/30 px-3.5 pt-2.5 pb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Composto por
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-3 py-1">
              <span className="text-sm font-medium">Honorários</span>
              <span className="whitespace-nowrap font-mono text-sm font-semibold">
                {formatCurrency(honorarios, moeda)} ·{" "}
                {formatarPercentual(percentualHonorarios)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
              <span className="text-sm font-medium">
                Rentabilidade{" "}
                <span className="font-normal text-muted-foreground">
                  (orçado × planejado)
                </span>
              </span>
              {/* Preto como a linha de honorários — as duas parcelas do
                  resultado operacional se leem juntas. Prejuízo continua
                  em vermelho. */}
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-sm font-semibold",
                  !temPlanejado && "text-muted-foreground",
                  temPlanejado && rentabilidade < 0 && "text-california-red",
                )}
              >
                {temPlanejado
                  ? `${formatCurrency(rentabilidade, moeda)}${
                      percentualRentabilidade === null
                        ? ""
                        : ` · ${formatarPercentual(percentualRentabilidade)}`
                    }`
                  : "—"}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "mt-2.5 rounded-xl border p-4",
              resultadoGeral === null
                ? "border-border bg-muted/30"
                : resultadoGeral >= 0
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-rose-200 bg-rose-50",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    resultadoGeral === null
                      ? "text-muted-foreground"
                      : resultadoGeral >= 0
                        ? "text-emerald-800"
                        : "text-california-red",
                  )}
                >
                  Resultado geral
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-[11.5px]",
                    resultadoGeral === null
                      ? "text-muted-foreground"
                      : resultadoGeral >= 0
                        ? "text-emerald-700"
                        : "text-california-red",
                  )}
                >
                  {resultadoGeral === null
                    ? "Preencha o planejado dos itens para ver o resultado."
                    : "Resultado operacional ÷ valor do job"}
                </p>
              </div>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-[26px] font-bold leading-none",
                  resultadoGeral === null
                    ? "text-muted-foreground"
                    : resultadoGeral >= 0
                      ? "text-emerald-700"
                      : "text-california-red",
                )}
              >
                {resultadoGeral === null
                  ? "—"
                  : formatarPercentual(resultadoGeral)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-b-2xl">
        <LegendaFechamento
          extra={
            temSave ? (
              <>
                Os honorários e impostos do fechamento correm sobre{" "}
                <strong className="text-foreground">
                  save gerado + custos do job
                </strong>{" "}
                ({formatCurrency(faturamento.base, moeda)}) — é o que esta
                nota cobra. O <strong className="text-foreground">Valor do
                Job</strong> repete a mesma conta sobre{" "}
                <strong className="text-foreground">
                  save usado + custos do job
                </strong>{" "}
                ({formatCurrency(job.base, moeda)}): honorários{" "}
                {formatCurrency(job.honorarios, moeda)}, impostos{" "}
                {formatCurrency(job.imposto, moeda)}. Sem nenhuma linha em
                save os dois totais voltam a ser iguais:{" "}
                {frasePorQueDivergem(
                  save.itensEmSave,
                  save.itensConsumindoSave,
                )}
                .
              </>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

function corRentabilidade(valor: number): string {
  return valor >= 0 ? "text-emerald-700" : "text-california-red";
}

function formatarPercentual(percentual: number): string {
  return `${percentual.toFixed(1).replace(".", ",")}%`;
}

function formatPct(n: number): string {
  return n.toString().replace(".", ",");
}

function Linha({
  label,
  value,
  moeda,
  destaque,
}: {
  label: string;
  value: number;
  moeda: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        destaque && "mt-3 pt-3 border-t border-border",
      )}
    >
      <span
        className={cn(
          "text-sm",
          destaque ? "font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-[13px]",
          destaque ? "text-sm font-semibold" : "",
        )}
      >
        {formatCurrency(value, moeda)}
      </span>
    </div>
  );
}

/** Linha do fechamento repartida em save usado / save gerado / custos do
 *  job. Do design `Orcamento - Versao com Save.dc.html`. */

/**
 * Por que os dois totais divergem, em português inteiro.
 *
 * O texto precisa fechar a frase "…voltam a ser iguais: X". Montado aqui e
 * não inline porque a versão inline perdia o substantivo quando só havia
 * consumo — saía "2 consomem", sem dizer o quê.
 */
function frasePorQueDivergem(gera: number, consome: number): string {
  const partes: string[] = [];
  if (gera > 0) {
    partes.push(
      gera === 1 ? "1 linha gera crédito" : `${gera} linhas geram crédito`,
    );
  }
  if (consome > 0) {
    // Com as duas metades, "consome crédito" repetiria a palavra na mesma
    // frase; sozinha, ela é o que dá sentido ao número.
    if (partes.length > 0) {
      partes.push(consome === 1 ? "1 consome" : `${consome} consomem`);
    } else {
      partes.push(
        consome === 1
          ? "1 linha é paga com crédito de outro job"
          : `${consome} linhas são pagas com crédito de outro job`,
      );
    }
  }
  return partes.join(" e ");
}
