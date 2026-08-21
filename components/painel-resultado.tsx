"use client";

import * as React from "react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularRentabilidade,
  calcularResultadoOperacional,
} from "@/lib/calculos/versao-totais";

interface Props {
  /**
   * Valor do job: o compromisso total do cliente (o que passa pela agência
   * mais o que ele paga direto ao fornecedor) + honorários + impostos.
   *
   * É esta a base do resultado, e não o faturamento previsto: o custo
   * descontado abaixo é o do job inteiro, então a receita comparada precisa
   * ser a do job inteiro também.
   */
  valorJob: number;
  imposto: number;
  /** Total dos custos orçados — base da rentabilidade. */
  orcado: number;
  /** Custo BRUTO — com o BV ainda embutido. O BV entra logo abaixo, como
   *  linha própria. */
  custoPlanejado: number;
  custoRealizado: number;
  /**
   * BV líquido a somar de volta, por ótica.
   *
   * A conta é `Valor do Job − Impostos − Custo bruto + BVs`, e ela é
   * ALGEBRICAMENTE a mesma coisa que `− Custo líquido`: o BV que a
   * planilha desconta do custo é o mesmo que aqui volta como receita. A
   * diferença é só de leitura — aqui a comissão aparece, em vez de
   * desaparecer dentro de um custo menor.
   *
   * Consequência de propósito: o Resultado dá o MESMO número nas duas
   * vistas da chave Bruto ⇄ Líquido. Ele não segue a chave.
   *
   * Na ótica planejada somam todos os BVs ativos (é projeção); na
   * realizada, só os confirmados. Quem filtra é quem monta os blocos.
   */
  bvPlanejado?: number;
  bvRealizado?: number;
  honorarios: number;
  /**
   * Taxa exibida ao lado dos honorários em "Composto por". Fica de fora
   * quando não existe taxa única — na visão do projeto cada versão aprovada
   * tem a sua.
   */
  taxaHonorarios?: string;
  /**
   * Esconde o seletor e trava a ótica em planejada. É o caso do orçamento:
   * ali o realizado ainda não existe, e um seletor que abre em "Realizada"
   * mostraria uma coluna de travessões como se fosse resultado.
   */
  somentePlanejada?: boolean;
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
  valorJob,
  imposto,
  orcado,
  custoPlanejado,
  custoRealizado,
  bvPlanejado = 0,
  bvRealizado = 0,
  honorarios,
  taxaHonorarios,
  somentePlanejada,
  moeda,
}: Props) {
  const [visao, setVisao] = React.useState<Visao>(
    somentePlanejada ? "planejada" : "realizada",
  );
  const planejada = somentePlanejada || visao === "planejada";

  const custo = planejada ? custoPlanejado : custoRealizado;
  const bv = planejada ? bvPlanejado : bvRealizado;
  const temCusto = custo > 0;

  // O BV entra como REDUÇÃO do custo na conta, e como linha somando na
  // leitura. É a mesma operação escrita dos dois lados do sinal.
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    valorJob,
    imposto,
    custo - bv,
  );
  const { rentabilidade, percentual: rentabilidadePct } = calcularRentabilidade(
    orcado,
    custo - bv,
  );

  // Sem o seletor não há duas óticas para distinguir — o rótulo fica igual
  // ao da tela da versão do orçamento, sem sufixo.
  const sufixo = somentePlanejada ? "" : planejada ? "planejado" : "realizado";

  return (
    <div className="p-6">
      <div className="mb-3.5 flex items-center justify-between gap-4">
        <p className="text-[13px] font-bold uppercase tracking-wider">
          Resultado
        </p>
        {!somentePlanejada && (
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
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <LinhaValor
          rotulo="Valor do Job"
          valor={formatCurrency(valorJob, moeda)}
        />
        <LinhaValor rotulo="− Impostos" valor={formatCurrency(imposto, moeda)} />
        <LinhaValor
          rotulo={planejada ? "− Custo planejado" : "− Custo realizado"}
          valor={temCusto ? formatCurrency(custo, moeda) : "—"}
        />
        {bv > 0 && (
          <LinhaValor
            rotulo={
              <>
                + BVs{" "}
                <span className="text-xs">
                  ({planejada ? "planejados" : "confirmados"}, líquidos)
                </span>
              </>
            }
            valor={formatCurrency(bv, moeda)}
          />
        )}
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm font-semibold">
            {`Resultado operacional ${sufixo}`.trim()}
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
            {`Resultado geral ${sufixo}`.trim()}
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
            Resultado operacional ÷ valor do job
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
