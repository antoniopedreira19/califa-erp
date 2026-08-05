"use client";

import * as React from "react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularRentabilidade,
  calcularResultadoOperacional,
} from "@/lib/calculos/versao-totais";

interface Props {
  /** Custos + honorários + impostos. */
  faturamento: number;
  imposto: number;
  /** Total dos custos orçados — base da rentabilidade. */
  orcado: number;
  custoPlanejado: number;
  custoRealizado: number;
  honorarios: number;
  /**
   * Taxa exibida ao lado dos honorários em "Composto por". Fica de fora
   * quando não existe taxa única — na visão do projeto cada versão aprovada
   * tem a sua.
   */
  taxaHonorarios?: string;
  moeda: string;
}

type Visao = "planejada" | "realizada";

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/** Linha "rótulo ......... valor". */
function LinhaValor({
  rotulo,
  valor,
}: {
  rotulo: React.ReactNode;
  valor: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className="whitespace-nowrap font-mono text-sm">{valor}</span>
    </div>
  );
}

/**
 * Painel de Resultado do card de Totais — do job e da visão agregada do
 * projeto. O seletor troca a ótica inteira (custo, resultado operacional,
 * rentabilidade e resultado geral) entre planejada e realizada; faturamento
 * e impostos não dependem dela.
 *
 * Abre em "Realizada": é a leitura que interessa depois que o job está
 * rodando, e é o padrão do design.
 */
export function PainelResultado({
  faturamento,
  imposto,
  orcado,
  custoPlanejado,
  custoRealizado,
  honorarios,
  taxaHonorarios,
  moeda,
}: Props) {
  const [visao, setVisao] = React.useState<Visao>("realizada");
  const planejada = visao === "planejada";

  const custo = planejada ? custoPlanejado : custoRealizado;
  const temCusto = custo > 0;

  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    faturamento,
    imposto,
    custo,
  );
  const { rentabilidade, percentual: rentabilidadePct } = calcularRentabilidade(
    orcado,
    custo,
  );

  const sufixo = planejada ? "planejado" : "realizado";

  return (
    <div className="p-6">
      <div className="mb-3.5 flex items-center justify-between gap-4">
        <p className="text-[13px] font-bold uppercase tracking-wider">
          Resultado
        </p>
        <div className="inline-flex gap-0.5 rounded-full bg-[#f1f0ec] p-[3px]">
          <BotaoVisao
            ativo={planejada}
            onClick={() => setVisao("planejada")}
          >
            Planejada
          </BotaoVisao>
          <BotaoVisao
            ativo={!planejada}
            onClick={() => setVisao("realizada")}
          >
            Realizada
          </BotaoVisao>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <LinhaValor
          rotulo="Faturamento previsto"
          valor={formatCurrency(faturamento, moeda)}
        />
        <LinhaValor rotulo="− Impostos" valor={formatCurrency(imposto, moeda)} />
        <LinhaValor
          rotulo={planejada ? "− Custo planejado" : "− Custo realizado"}
          valor={temCusto ? formatCurrency(custo, moeda) : "—"}
        />
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm font-semibold">
            Resultado operacional {sufixo}
          </span>
          <span
            className={cn(
              "whitespace-nowrap font-mono text-[15px] font-bold",
              resultadoOperacional === null
                ? "text-muted-foreground"
                : resultadoOperacional >= 0
                  ? "text-emerald-700"
                  : "text-california-red",
            )}
          >
            {resultadoOperacional === null
              ? "—"
              : formatCurrency(resultadoOperacional, moeda)}
          </span>
        </div>
      </div>

      <div className="mt-2.5 rounded-xl border border-border bg-muted/40 px-3.5 pb-3 pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Composto por
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-3 py-1">
          <span className="text-sm font-medium">Honorários</span>
          <span className="whitespace-nowrap font-mono text-[13px] font-semibold">
            {formatCurrency(honorarios, moeda)}
            {taxaHonorarios ? ` · ${taxaHonorarios}` : ""}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
          <span className="text-sm font-medium">
            Rentabilidade{" "}
            <span className="font-normal text-muted-foreground">
              (orçado × {planejada ? "planejado" : "realizado"})
            </span>
          </span>
          <span className="whitespace-nowrap font-mono text-[13px] font-semibold">
            {temCusto ? (
              <>
                {formatCurrency(rentabilidade, moeda)}
                {rentabilidadePct !== null &&
                  ` · ${formatarPercentual(rentabilidadePct)}`}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </div>
      </div>

      <div
        className={cn(
          "mt-2.5 flex items-baseline justify-between gap-3 rounded-xl border px-4 py-3.5",
          resultadoGeral === null
            ? "border-border bg-muted/85"
            : resultadoGeral >= 0
              ? "border-emerald-200 bg-emerald-50"
              : "border-california-red/30 bg-california-red/[0.06]",
        )}
      >
        <div>
          <p
            className={cn(
              "text-sm font-semibold",
              resultadoGeral === null
                ? "text-muted-foreground"
                : resultadoGeral >= 0
                  ? "text-emerald-900"
                  : "text-california-red",
            )}
          >
            Resultado geral {sufixo}
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              resultadoGeral === null
                ? "text-muted-foreground"
                : resultadoGeral >= 0
                  ? "text-emerald-700"
                  : "text-california-red/80",
            )}
          >
            Resultado operacional ÷ faturamento previsto
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
          {resultadoGeral === null ? "—" : formatarPercentual(resultadoGeral)}
        </span>
      </div>
    </div>
  );
}

function BotaoVisao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "rounded-full px-3.5 py-[5px] text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/30",
        ativo
          ? "bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          : "bg-transparent font-medium text-[#8a8a8a] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
