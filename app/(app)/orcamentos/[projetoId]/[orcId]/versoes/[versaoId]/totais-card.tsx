import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { LegendaFechamento } from "@/components/legenda-fechamento";
import {
  calcularTotaisVersao,
  calcularRentabilidade,
  calcularResultadoOperacional,
  LINHAS_FECHAMENTO_POR_TIPO,
  somarLinhaFechamento,
} from "@/lib/calculos/versao-totais";
import {
  type ItemBv,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
} from "@/lib/types";
import {
  blocosDoItem,
  rotuloColunaTotal,
  somarBlocosDosItens,
  valorNaVisao,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  ColunasFixas,
  LARGURA_MINIMA,
  LARGURA_MINIMA_SAVE,
} from "@/app/(app)/_planilha/grade-orcamento";
import {
  ORCADO,
  PLANEJADO,
  RENTABILIDADE,
  FAIXA_ROTULO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  /** BV por id do item — a dedução da vista Líquido e a linha "+ BVs" do
   *  Resultado saem daqui. */
  bvsPorItem: Record<string, ItemBv>;
  /** Bruto ou Líquido (− BV). Tem que ser a MESMA dos grupos acima. */
  visao: VisaoBv;
  /** A coluna de Save está aberta na planilha acima? O card NÃO ganha a
   *  coluna (o Item dele absorve Save + Item de lá), mas precisa do MESMO
   *  piso de largura — senão, em janela estreita, uma tabela rola e a
   *  outra não, e as colunas de Total saem do eixo. */
  saveVisivel?: boolean;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

// As bandas de cor vêm do mesmo módulo da grade de itens — a vista de
// Totais precisa "rimar" com a tela de edição, e uma cor só muda em um
// lugar.

export function TotaisCard({
  grupos,
  itens,
  bvsPorItem,
  visao,
  saveVisivel = false,
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
  // deixaram de ser iguais (docs/decisions/023-save-entre-jobs.md §3).
  const temSave = save.totalSaveGerado > 0 || save.totalSaveUsado > 0;

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
    calcularRentabilidade(totais.orcadoRentabilidade, totalPlanejado);

  const linhas = agruparPorGrupo(grupos, itens, blocosPorItem, visao);

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

      {/* Camada 1 — agrupamentos lado a lado.
          Mesma grade de 13 colunas da tabela de itens: as colunas Total,
          Rentab. e % caem exatamente sob as dos cards de grupo acima. As
          colunas de detalhe (unitário, QT, D/M) ficam vazias aqui — o
          Totais não tem o que mostrar nelas. */}
      <div className="overflow-x-auto">
        <table
          className={cn(
            "w-full table-fixed border-collapse text-sm",
            saveVisivel ? LARGURA_MINIMA_SAVE : LARGURA_MINIMA,
          )}
        >
          <ColunasFixas />
          <thead>
            {/* Linha 1 — faixas de bloco */}
            <tr>
              <th colSpan={3} className="bg-muted/40 border-b border-border" />
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

            {/* Linha 2 — sub-cabeçalho */}
            <tr className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th colSpan={3} className="text-left px-3 py-2">
                Agrupamento
              </th>
              <th colSpan={3} className={ORCADO.cabecalhoAbre} />
              <th className={cn("text-right px-3 py-2", ORCADO.cabecalhoFim)}>
                Total
              </th>
              <th colSpan={3} className={PLANEJADO.cabecalhoAbre} />
              <th
                className={cn("text-right px-3 py-2", PLANEJADO.cabecalhoFim)}
              >
                {rotuloColunaTotal(visao)}
              </th>
              <th
                className={cn(
                  "text-right px-3 py-2",
                  RENTABILIDADE.cabecalhoAbre,
                )}
              >
                Rentab.
              </th>
              <th
                className={cn(
                  "text-right px-3 py-2",
                  RENTABILIDADE.cabecalhoFim,
                )}
              >
                %
              </th>
            </tr>
          </thead>

          <tbody>
            {linhas.length === 0 ? (
              <tr className="border-b border-[#f1f1f1]">
                <td
                  colSpan={13}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Nenhum grupo ainda.
                </td>
              </tr>
            ) : (
              linhas.map((l) => (
                <tr key={l.id} className="border-b border-[#f1f1f1]">
                  <td colSpan={3} className="px-3 py-[11px] text-foreground">
                    {l.nome}
                  </td>
                  <td colSpan={3} className={ORCADO.celulaVazia} />
                  <td
                    className={cn(
                      "px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px]",
                      ORCADO.celulaTotal,
                    )}
                  >
                    {formatCurrency(l.orcado, moeda)}
                  </td>
                  <td colSpan={3} className={PLANEJADO.celulaVazia} />
                  <td
                    className={cn(
                      "px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px]",
                      PLANEJADO.celulaTotal,
                    )}
                  >
                    {formatCurrency(l.planejado, moeda)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px]",
                      RENTABILIDADE.celulaAbre,
                      RENTAB_VALOR,
                    )}
                  >
                    {formatCurrency(l.rentabilidade, moeda)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px]",
                      RENTABILIDADE.celulaTotal,
                    )}
                  >
                    {l.percentual === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatarPercentual(l.percentual)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          <tfoot>
            <tr>
              <td
                colSpan={3}
                className="px-3 py-[13px] text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border"
              >
                Total dos custos
              </td>
              <td colSpan={3} className={ORCADO.subtotalVazio} />
              <td
                className={cn(
                  "px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold",
                  ORCADO.subtotalValor,
                )}
              >
                {formatCurrency(subtotalGeral, moeda)}
              </td>
              <td colSpan={3} className={PLANEJADO.subtotalVazio} />
              <td
                className={cn(
                  "px-3 py-[13px] text-right whitespace-nowrap",
                  PLANEJADO.subtotalValor,
                )}
              >
                <div className="flex flex-col items-end">
                  <span className="font-mono text-sm font-bold">
                    {formatCurrency(totalPlanejado, moeda)}
                  </span>
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={totais.planejado.deducaoBv}
                      formatar={(v) => formatCurrency(v, moeda)}
                      cor={PLANEJADO.texto}
                      corRotulo={PLANEJADO.textoSuave}
                    />
                  )}
                </div>
              </td>
              <td
                className={cn(
                  "px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold border-r border-r-[#e2e0da]",
                  RENTABILIDADE.bordaAbre,
                  RENTABILIDADE.subtotalValor,
                )}
              >
                {formatCurrency(rentabilidade, moeda)}
              </td>
              <td
                className={cn(
                  "px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold",
                  RENTABILIDADE.subtotalValor,
                )}
              >
                {percentualRentabilidade === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatarPercentual(percentualRentabilidade)
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Camadas 2 e 3 — fechamento contábil e resultado */}
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border border-t border-border">
        {/* Fechamento do orçado */}
        <div className="p-6">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.07em] text-foreground">
            Fechamento do orçado · por tipo de custo
          </p>
          <div className="space-y-1.5">
            {temSave && (
              <div className="grid grid-cols-[1fr_repeat(3,minmax(84px,auto))] gap-x-3 pb-1 text-right text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                <span />
                <span>Save usado</span>
                <span>Save gerado</span>
                <span>Custos do job</span>
              </div>
            )}
            {LINHAS_FECHAMENTO_POR_TIPO.map((linha) =>
              temSave ? (
                <LinhaQuebrada
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
            {temSave ? (
              <LinhaQuebrada
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
            {temSave && (
              <>
                <div className="flex items-baseline justify-between gap-3 pt-1">
                  <span className="text-sm font-semibold text-[#5f5d57]">
                    Saldo em save
                  </span>
                  <span className="whitespace-nowrap font-mono text-lg font-bold text-[#5f5d57]">
                    {formatCurrency(save.totalSaveGerado, moeda)}
                  </span>
                </div>
                <p className="pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                  Os honorários e impostos acima correm sobre{" "}
                  <strong>save gerado + custos do job</strong> (
                  {formatCurrency(faturamento.base, moeda)}) — é o que esta
                  nota cobra. O Valor do Job repete a mesma conta sobre{" "}
                  <strong>save usado + custos do job</strong> (
                  {formatCurrency(job.base, moeda)}): honorários{" "}
                  {formatCurrency(job.honorarios, moeda)}, impostos{" "}
                  {formatCurrency(job.imposto, moeda)}. Sem nenhuma linha em
                  save os dois totais voltam a ser iguais:{" "}
                  {frasePorQueDivergem(
                    save.itensEmSave,
                    save.itensConsumindoSave,
                  )}
                  .
                </p>
              </>
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
        <LegendaFechamento />
      </div>
    </div>
  );
}

interface LinhaAgrupamento {
  id: string;
  nome: string;
  orcado: number;
  planejado: number;
  rentabilidade: number;
  percentual: number | null;
}

/** Uma passada só pelos itens — a lista pode ter centenas de linhas. */
function agruparPorGrupo(
  grupos: VersaoOrcamentoGrupo[],
  itens: VersaoOrcamentoItem[],
  blocosPorItem: Map<string, ReturnType<typeof blocosDoItem>>,
  visao: VisaoBv,
): LinhaAgrupamento[] {
  const porGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const it of itens) {
    const lista = porGrupo.get(it.grupo_id);
    if (lista) lista.push(it);
    else porGrupo.set(it.grupo_id, [it]);
  }

  return grupos.map((g) => {
    const doGrupo = (porGrupo.get(g.id) ?? [])
      .map((it) => blocosPorItem.get(it.id))
      .filter((b): b is NonNullable<typeof b> => b != null);
    const soma = somarBlocosDosItens(doGrupo);
    const planejado = valorNaVisao(soma.planejado, visao);
    // `orcadoRentabilidade`, não `orcado`: a coluna ORÇADO mostra o valor
    // cheio, mas a linha em save não entra na comparação com o custo.
    const { rentabilidade, percentual } = calcularRentabilidade(
      soma.orcadoRentabilidade,
      planejado,
    );
    return {
      id: g.id,
      nome: g.nome,
      orcado: soma.orcado,
      planejado,
      rentabilidade,
      percentual,
    };
  });
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

/** Linha do fechamento repartida em save usado, save gerado e custos do
 *  job. As três somam o subtotal do tipo, por construção. */
function LinhaQuebrada({
  label,
  usado,
  gerado,
  custos,
  moeda,
  destaque,
}: {
  label: string;
  usado: number;
  gerado: number;
  custos: number;
  moeda: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_repeat(3,minmax(84px,auto))] items-baseline gap-x-3",
        destaque && "mt-3 border-t border-border pt-3",
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
      {[usado, gerado, custos].map((v, i) => (
        <span
          key={i}
          className={cn(
            "whitespace-nowrap text-right font-mono text-[12.5px]",
            destaque ? "font-bold" : "font-semibold",
            v === 0 && "text-muted-foreground/50",
            i < 2 && v !== 0 && "text-[#5f5d57]",
          )}
        >
          {formatCurrency(v, moeda)}
        </span>
      ))}
    </div>
  );
}

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
