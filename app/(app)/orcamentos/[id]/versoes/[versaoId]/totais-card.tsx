import { Calculator, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoItem,
} from "@/lib/types";

interface Props {
  itens: VersaoOrcamentoItem[];
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

export function TotaisCard({
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

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Visão Orçado da versão · valores calculados a partir dos itens.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Coluna 1: subtotais por tipo */}
        <div className="p-6 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Subtotal por tipo de custo
          </p>
          {TIPOS.map((t) => (
            <div key={t} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{tipoCustoLabel(t)}</span>
              <span className="tabular-nums font-medium">
                {formatCurrency(subtotaisPorTipo[t], moeda)}
              </span>
            </div>
          ))}
          <div className="pt-3 border-t border-border flex items-center justify-between">
            <span className="text-sm font-semibold">Subtotal geral</span>
            <span className="tabular-nums font-semibold">
              {formatCurrency(subtotalGeral, moeda)}
            </span>
          </div>
        </div>

        {/* Coluna 2: honorários, imposto, faturamento */}
        <div className="p-6 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Composição da fatura
          </p>
          <Line
            label={`Honorários (${formatPct(percentualHonorarios)}%)`}
            value={honorarios}
            moeda={moeda}
          />
          <Line
            label={`Impostos (${formatPct(percentualImposto)}%)`}
            value={imposto}
            moeda={moeda}
          />
          <div className="pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Faturamento previsto</span>
              <span className="tabular-nums font-bold text-california-red text-lg">
                {formatCurrency(faturamento, moeda)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-muted/30 px-6 py-4 flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div className="space-y-1.5">
          <p>
            <strong className="text-foreground">Como o cálculo funciona:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 marker:text-california-red">
            <li>
              <strong>Honorários</strong> incidem sobre a soma dos custos{" "}
              <strong>A + B + D</strong>. Tipo C fica de fora (contrato sem
              honorários da agência).
            </li>
            <li>
              <strong>Impostos</strong> incidem sobre a base{" "}
              <strong>B + C + Honorários</strong>, no regime{" "}
              <em>gross-up</em>{" "}
              (<span className="font-mono">base × taxa ÷ (1 − taxa)</span>) —
              a agência fatura o suficiente para que, depois do imposto
              descontado, sobre a base líquida.
            </li>
            <li>
              <strong>Faturamento</strong> = soma de todos os custos +
              honorários + impostos.
            </li>
          </ul>
          <p className="pt-1 text-muted-foreground/80">
            Regras poderão ser refinadas em iterações futuras com o time
            comercial/financeiro.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatPct(n: number): string {
  return n.toString().replace(".", ",");
}

function Line({
  label,
  value,
  moeda,
}: {
  label: string;
  value: number;
  moeda: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium">
        {formatCurrency(value, moeda)}
      </span>
    </div>
  );
}
