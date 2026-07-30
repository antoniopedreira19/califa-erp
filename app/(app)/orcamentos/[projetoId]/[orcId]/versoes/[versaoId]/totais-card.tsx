import { Calculator, Info } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
} from "@/lib/calculos/versao-totais";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
} from "@/lib/types";
import { ColunasFixas, LARGURA_MINIMA } from "./grade-colunas";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

// Mesmas bandas de cor da grade de itens — a vista de Totais precisa
// "rimar" com a tela de edição. As duas primeiras vestem as células
// vazias que ocupam as colunas de detalhe (unitário, QT, D/M).
const CELULA_ORCADO = "border-l-2 border-l-[#e4e2dd] bg-black/[0.015]";
const CELULA_PLANEJADO = "border-l-2 border-l-[#cfe0f7] bg-[#f7fbff]";
const CELULA_RENTAB =
  "border-l-2 border-l-[#e4e2dd] border-r border-r-[#d9efe3]";

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
    faturamento,
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
  const resultadoOperacional = temPlanejado
    ? faturamento - imposto - totalPlanejado
    : null;
  const resultadoGeral =
    resultadoOperacional !== null && faturamento > 0
      ? (resultadoOperacional / faturamento) * 100
      : null;

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
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] text-foreground bg-[#f1f0ec] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#d7d7d7]"
              >
                ORÇADO
              </th>
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]"
              >
                PLANEJADO
              </th>
              <th
                colSpan={2}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.08em] text-emerald-700 bg-emerald-50 border-b-[3px] border-b-emerald-600 border-l-2 border-l-[#d7d7d7]"
              >
                RENTABILIDADE
              </th>
            </tr>

            {/* Linha 2 — sub-cabeçalho */}
            <tr className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th colSpan={3} className="text-left px-3 py-2">
                Agrupamento
              </th>
              <th colSpan={3} className="border-l-2 border-l-[#e4e2dd]" />
              <th className="text-right px-3 py-2">Total</th>
              <th
                colSpan={3}
                className="bg-[#f2f7fe] border-l-2 border-l-[#cfe0f7]"
              />
              <th className="text-right px-3 py-2 text-[#5a76a8] bg-[#f2f7fe]">
                Total
              </th>
              <th className="text-right px-3 py-2 bg-emerald-50/50 text-emerald-800/70 border-l border-l-border border-r border-r-[#d9efe3]">
                Rentab.
              </th>
              <th className="text-right px-3 py-2 bg-emerald-50/50 text-emerald-800/70">
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
                  <td colSpan={3} className={CELULA_ORCADO} />
                  <td className="px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px] text-foreground bg-black/[0.015]">
                    {formatCurrency(l.orcado, moeda)}
                  </td>
                  <td colSpan={3} className={CELULA_PLANEJADO} />
                  <td className="px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px] text-foreground bg-[#f7fbff]">
                    {formatCurrency(l.planejado, moeda)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px]",
                      CELULA_RENTAB,
                      corRentabilidade(l.rentabilidade),
                    )}
                  >
                    {formatCurrency(l.rentabilidade, moeda)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-[11px] text-right whitespace-nowrap font-mono text-[13px]",
                      corRentabilidade(l.rentabilidade),
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
              <td
                colSpan={3}
                className="bg-[#f1f0ec] border-l-2 border-l-[#d7d7d7] border-t-2 border-t-[#282828]"
              />
              <td className="px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold text-foreground bg-[#f1f0ec] border-t-2 border-t-[#282828]">
                {formatCurrency(subtotalGeral, moeda)}
              </td>
              <td
                colSpan={3}
                className="bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t-2 border-t-[#2f6fdb]"
              />
              <td className="px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold text-[#1e4fa3] bg-[#e8f0fd] border-t-2 border-t-[#2f6fdb]">
                {formatCurrency(totalPlanejado, moeda)}
              </td>
              <td
                className={cn(
                  "px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold bg-emerald-50 border-l-2 border-l-[#d7d7d7] border-t-2 border-t-emerald-600 border-r border-r-[#d9efe3]",
                  corRentabilidade(rentabilidade),
                )}
              >
                {formatCurrency(rentabilidade, moeda)}
              </td>
              <td
                className={cn(
                  "px-3 py-[13px] text-right whitespace-nowrap font-mono text-sm font-bold bg-emerald-50 border-t-2 border-t-emerald-600",
                  corRentabilidade(rentabilidade),
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
            {TIPOS.map((t) => (
              <Linha
                key={t}
                label={tipoCustoLabel(t)}
                value={subtotaisPorTipo[t]}
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
            <div className="mt-3 pt-3.5 border-t border-border flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">Faturamento previsto</span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-california-red">
                {formatCurrency(faturamento, moeda)}
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
            <Linha
              label="Faturamento previsto"
              value={faturamento}
              moeda={moeda}
            />
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
                    : "Resultado operacional ÷ faturamento previsto"}
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

      <div className="border-t border-border bg-muted/30 px-6 py-4 flex items-start gap-2 text-xs text-muted-foreground leading-relaxed rounded-b-2xl">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <p>
          <strong className="text-foreground">Honorários</strong> sobre A + B +
          D · <strong className="text-foreground">Impostos</strong> sobre B + C
          + honorários em <em>gross-up</em> ·{" "}
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
