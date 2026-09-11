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
  type FechamentoLado,
  type ParametrosInternacionais,
} from "@/lib/calculos/versao-totais";
import {
  emMoedaEstrangeira,
  formatarTaxa,
  type MoedaEstrangeira,
} from "@/app/(app)/_planilha/moeda-estrangeira";
import {
  type CategoriaModeloPlanilha,
  type ItemBv,
  type VersaoOrcamentoItem,
} from "@/lib/types";
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
  bvsPorItem: Record<string, ItemBv[]>;
  /** Bruto ou Líquido (− BV). Tem que ser a MESMA dos grupos acima. */
  visao: VisaoBv;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
  /** Qual fechamento esta versão usa — vem do `modelo_planilha` da
   *  categoria do orçamento, nunca do nome dela (decisão 072). */
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Os parâmetros da cadeia internacional, ou `null` no nacional. */
  internacional: ParametrosInternacionais | null;
  /** Moeda estrangeira da coluna da esquerda da cadeia. `null` no
   *  nacional, e aí a cadeia inteira não é renderizada. */
  moedaEstrangeira: MoedaEstrangeira | null;
}

export function TotaisCard({
  itens,
  bvsPorItem,
  visao,
  percentualHonorarios,
  percentualImposto,
  moeda,
  modeloPlanilha,
  internacional,
  moedaEstrangeira,
}: Props) {
  const {
    subtotaisPorTipo,
    subtotalGeral,
    honorarios,
    imposto,
    intTaxes,
    intTransactionCosts,
    deducoesDoResultado,
    faturamentoPrevisto,
    valorJob,
    save,
    faturamento,
    job,
  } = calcularTotaisVersao(
    itens,
    percentualHonorarios,
    percentualImposto,
    internacional,
  );

  // A cadeia internacional substitui o rodapé do fechamento (honorários →
  // impostos → faturamento → valor do job) por sete linhas que se somam
  // uma na outra. O resto do card — a quebra por tipo de custo, o
  // Resultado — é o mesmo das demais categorias (decisão 072).
  const ehInternacional =
    modeloPlanilha === "internacional" && internacional !== null;
  /** Nesta categoria os honorários se chamam FEE — mesmo lugar na cadeia,
   *  outro nome na tela do time. */
  const rotuloHonorarios = ehInternacional ? "Fee" : "Honorários";

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

  // O planejado passa pela MESMA função que os grupos somaram — duas
  // implementações da mesma conta é como o subtotal e o total começam a
  // divergir. Desde 08/09/2026 (decisão 062) o planejado é sempre o custo
  // digitado, e o BV não desconta nada aqui: ele vive no realizado, que
  // esta tela nem mostra.
  const blocosPorItem = new Map(
    itens.map((it) => [it.id, blocosDoItem(it, bvsPorItem[it.id] ?? [], 0)]),
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
  // ⚠️ O BV saiu desta conta em 08/09/2026 (decisão 062). Ele entrava
  // como redução do custo planejado e reaparecia como linha "+ BVs" — as
  // duas escritas da mesma operação. Com o BV fora do planejado, somá-lo
  // aqui faria o painel discordar da coluna PLANEJADO logo ao lado.
  // `deducoesDoResultado`, e não `imposto`: no internacional saem do
  // valor do job também as int. taxes (retidas lá fora) e os custos de
  // transação. No nacional o campo VALE `imposto`, então este número é o
  // mesmo de sempre nas demais categorias (decisão 072).
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    valorJob,
    deducoesDoResultado,
    totais.planejado.bruto,
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
            {ehInternacional
              ? "Fechamento internacional · valores calculados a partir dos itens."
              : "Orçado × Planejado · valores calculados a partir dos itens."}
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
                deixaria um dos dois totais sem explicação na tela.

                No internacional elas saem daqui: a cadeia logo abaixo
                mostra as MESMAS parcelas, mais as duas que só existem lá,
                e cada linha dela soma na seguinte até o invoice. Repetir
                honorários e impostos aqui em cima seria mostrar dois
                caminhos para o mesmo total. */}
            {!ehInternacional && (
              <>
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
              </>
            )}
            {/* Os dois fechamentos: o que a California emite nota e o que o
                cliente se compromete a gastar no total. Diferem pelos
                principais pagos direto ao fornecedor (A · Direto, D e F).

                No internacional eles são as três últimas linhas da cadeia
                logo abaixo, onde o caminho até o invoice está inteiro. */}
            {!ehInternacional && (
              <>
                <div className="mt-3 pt-3.5 border-t border-border flex items-baseline justify-between gap-3">
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
              </>
            )}
          </div>

          {/* Sem `moedaEstrangeira` a cadeia continua: ela é o ÚNICO lugar
              onde o faturamento previsto e o valor do job aparecem nesta
              categoria. Exigir a taxa aqui deixava o card sem os dois
              totais até alguém preencher o câmbio — e o que falta é só a
              coluna convertida, não a conta. */}
          {ehInternacional && internacional && (
            <CadeiaInternacional
              faturamento={faturamento}
              valorJob={valorJob}
              saveGerado={temSave ? save.totalSaveGerado : null}
              moeda={moeda}
              moedaEstrangeira={moedaEstrangeira}
              percentualHonorarios={percentualHonorarios}
              percentualIntTaxes={internacional.percentualIntTaxes}
              percentualImposto={percentualImposto}
            />
          )}
        </div>

        {/* Resultado */}
        <div className="p-6">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
            Resultado
          </p>
          <div className="space-y-1.5">
            <Linha label="Valor do Job" value={valorJob} moeda={moeda} />
            <Linha
              label={ehInternacional ? "− Impostos BR" : "− Impostos"}
              value={imposto}
              moeda={moeda}
            />
            {/* As duas deduções que só existem no internacional. Ficam
                explícitas, e não somadas ao imposto, porque são coisas
                diferentes: uma é retenção lá fora, a outra é custo de
                mover o dinheiro. */}
            {ehInternacional && (
              <>
                <Linha
                  label="− Int. taxes (retidas no exterior)"
                  value={intTaxes}
                  moeda={moeda}
                />
                <Linha
                  label="− Int. transaction costs"
                  value={intTransactionCosts}
                  moeda={moeda}
                />
              </>
            )}
            <Linha
              label="− Custo planejado"
              value={totais.planejado.bruto}
              moeda={moeda}
            />
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
              <span className="text-sm font-medium">{rotuloHonorarios}</span>
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
          internacional={ehInternacional}
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

/**
 * A cadeia de faturamento do orçamento internacional (decisão 072).
 *
 * Sete linhas, cada uma somando na seguinte até o **invoice** — é o
 * caminho que a planilha "Modelo de planilha interna - Internacional
 * 2026" percorre nas células G5 → G11, e a ordem importa: as int. taxes
 * são retidas LÁ FORA, então o que chega ao Brasil já as contém, e é
 * sobre esse total que o imposto daqui corre.
 *
 * Duas colunas de valor: a moeda estrangeira (BRL ÷ taxa de compra) e o
 * BRL. Aqui a moeda vem COM o código na frente — ao contrário da
 * planilha, onde o cabeçalho da coluna já o diz —, porque as duas ficam
 * lado a lado e sem prefixo virariam dois números sem dono.
 */
function CadeiaInternacional({
  faturamento,
  valorJob,
  saveGerado,
  moeda,
  moedaEstrangeira,
  percentualHonorarios,
  percentualIntTaxes,
  percentualImposto,
}: {
  faturamento: FechamentoLado;
  valorJob: number;
  /** `null` quando a versão não tem save — a linha nem aparece. */
  saveGerado: number | null;
  moeda: string;
  /** `null` enquanto a taxa de compra não foi preenchida: a cadeia roda
   *  igual, só sem a coluna convertida. */
  moedaEstrangeira: MoedaEstrangeira | null;
  percentualHonorarios: number;
  percentualIntTaxes: number;
  percentualImposto: number;
}) {
  // O total recebido no exterior é a soma das três primeiras linhas — não
  // um campo à parte. Calcular aqui, a partir das mesmas parcelas que a
  // tela mostra, é o que garante que a coluna feche na vertical.
  const totalRecebidoExterior =
    faturamento.principal + faturamento.honorarios + faturamento.intTaxes;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
        Cadeia internacional · faturamento
      </p>
      <div
        className={cn(
          "grid items-baseline gap-x-4 gap-y-1.5",
          moedaEstrangeira
            ? "grid-cols-[minmax(0,1fr)_auto_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        <span />
        {moedaEstrangeira && (
          <span className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {moedaEstrangeira.codigo}
          </span>
        )}
        <span className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          BRL
        </span>

        <LinhaCadeia
          label="Sub-total faturável"
          valor={faturamento.principal}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label={`Fee (${formatPct(percentualHonorarios)}%)`}
          valor={faturamento.honorarios}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label={`Int. taxes (${formatPct(percentualIntTaxes)}% · gross-up)`}
          valor={faturamento.intTaxes}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label="Total recebido no exterior"
          valor={totalRecebidoExterior}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
          somatorio
        />
        <LinhaCadeia
          label="Int. transaction costs"
          valor={faturamento.intTransactionCosts}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label={`Impostos BR (${formatPct(percentualImposto)}% · gross-up)`}
          valor={faturamento.imposto}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
        />
        <LinhaCadeia
          label="Faturamento previsto (Invoice)"
          valor={faturamento.total}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
          destaque
        />
        <LinhaCadeia
          label="Valor do Job"
          valor={valorJob}
          moeda={moeda}
          moedaEstrangeira={moedaEstrangeira}
          forte
        />
        {saveGerado !== null && (
          <LinhaCadeia
            label="Save gerado"
            valor={saveGerado}
            moeda={moeda}
            moedaEstrangeira={moedaEstrangeira}
            forte
            cor="text-[#5f5d57]"
          />
        )}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        Fee sobre o sub-total da base · int. taxes em gross-up sobre
        sub-total&nbsp;+&nbsp;fee · impostos BR em gross-up sobre o total
        recebido no exterior · os custos de transação entram depois dele e
        não compõem base de imposto.{" "}
        {moedaEstrangeira ? (
          <>
            Conversão para{" "}
            <strong className="text-foreground">
              {moedaEstrangeira.codigo}
            </strong>{" "}
            pela taxa de compra ({formatarTaxa(moedaEstrangeira.compra)}).
          </>
        ) : (
          <strong className="text-foreground">
            Preencha a taxa de compra em &quot;Editar&quot;, no cabeçalho da
            versão, para ver os valores na moeda estrangeira e a coluna dela
            na planilha.
          </strong>
        )}
      </p>
    </div>
  );
}

/** Uma linha da cadeia: rótulo, valor na moeda estrangeira, valor em BRL.
 *
 *  Fragmento de três células, e não um `<div>` próprio: as três colunas
 *  são do grid do pai, e envolvê-las quebraria o alinhamento vertical que
 *  faz a coluna somar na vertical. */
function LinhaCadeia({
  label,
  valor,
  moeda,
  moedaEstrangeira,
  somatorio,
  destaque,
  forte,
  cor,
}: {
  label: string;
  valor: number;
  moeda: string;
  moedaEstrangeira: MoedaEstrangeira | null;
  /** Fecha um trecho da cadeia (o total recebido no exterior). */
  somatorio?: boolean;
  /** O invoice — o número que a nota cobra. */
  destaque?: boolean;
  /** Valor do job e save gerado: negrito, sem a borda do somatório. */
  forte?: boolean;
  cor?: string;
}) {
  const borda = somatorio || destaque ? "mt-1 border-t border-border pt-2" : "";
  const peso = destaque || forte || somatorio ? "font-semibold" : "";
  return (
    <>
      <span
        className={cn(
          "text-sm",
          borda,
          peso || "text-muted-foreground",
          cor,
        )}
      >
        {label}
      </span>
      {moedaEstrangeira && (
        <span
          className={cn(
            "whitespace-nowrap text-right font-mono text-[13px] text-muted-foreground",
            borda,
            peso,
            cor,
          )}
        >
          {emMoedaEstrangeira(valor, moedaEstrangeira)}
        </span>
      )}
      <span
        className={cn(
          "whitespace-nowrap text-right font-mono text-[13px]",
          borda,
          peso,
          destaque && "text-base font-bold text-california-red",
          cor,
        )}
      >
        {formatCurrency(valor, moeda)}
      </span>
    </>
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
