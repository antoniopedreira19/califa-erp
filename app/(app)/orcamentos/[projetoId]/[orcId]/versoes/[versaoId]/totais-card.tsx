import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { LegendaFechamento } from "@/components/legenda-fechamento";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularResultadoOperacional,
  LINHAS_FECHAMENTO_POR_TIPO,
  somarLinhaFechamento,
} from "@/lib/calculos/versao-totais";
import {
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
} from "@/lib/types";
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

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
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
  } = calcularTotaisVersao(itens, percentualHonorarios, percentualImposto);

  const {
    totalPlanejado,
    rentabilidade,
    percentualRentabilidade,
  } = calcularTotaisPlanejados(itens);

  const linhas = agruparPorGrupo(grupos, itens);

  const temPlanejado = totalPlanejado > 0;

  // Resultado operacional = o que sobra depois de pagar imposto e o custo
  // que a agência realmente espera desembolsar (planejado). Sem planejado
  // lançado a conta não existe — mostra travessão em vez de número inflado.
  // A base é o VALOR DO JOB, não o faturamento previsto: o custo planejado
  // inclui os itens pagos direto ao fornecedor, então a receita comparada
  // precisa incluí-los também.
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    valorJob,
    imposto,
    totalPlanejado,
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
            LARGURA_MINIMA,
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
                Total
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
                  "px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold",
                  PLANEJADO.subtotalValor,
                )}
              >
                {formatCurrency(totalPlanejado, moeda)}
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
            {LINHAS_FECHAMENTO_POR_TIPO.map((linha) => (
              <Linha
                key={linha.chave}
                label={linha.label}
                value={somarLinhaFechamento(subtotaisPorTipo, linha.tipos)}
                moeda={moeda}
              />
            ))}
            <Linha
              label="Total dos custos"
              value={subtotalGeral}
              moeda={moeda}
              destaque
            />
            <Linha
              label={`Honorários (${formatPct(percentualHonorarios)}%)`}
              value={honorarios}
              moeda={moeda}
            />
            <Linha
              label={`Impostos (${formatPct(percentualImposto)}%)`}
              value={imposto}
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
              value={totalPlanejado}
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
): LinhaAgrupamento[] {
  const porGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const it of itens) {
    const lista = porGrupo.get(it.grupo_id);
    if (lista) lista.push(it);
    else porGrupo.set(it.grupo_id, [it]);
  }

  return grupos.map((g) => {
    const { totalOrcado, totalPlanejado, rentabilidade, percentualRentabilidade } =
      calcularTotaisPlanejados(porGrupo.get(g.id) ?? []);
    return {
      id: g.id,
      nome: g.nome,
      orcado: totalOrcado,
      planejado: totalPlanejado,
      rentabilidade,
      percentual: percentualRentabilidade,
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
