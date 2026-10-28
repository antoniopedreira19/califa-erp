// As linhas do quadro do motivo (decisão 223): funções puras, sem estado,
// para a página do servidor e os componentes do navegador montarem o mesmo
// quadro. O quadro e o pop-up moram em `motivo-do-caso.tsx`.
import * as React from "react";
import { formatCurrency } from "@/lib/utils";
import { formatarPercentualDoComite } from "@/lib/calculos/limites-orcamento";

const brl = (n: number) => formatCurrency(n, "BRL");

export interface LinhaDoMotivo {
  rotulo: string;
  valor: React.ReactNode;
}

export interface ItemAcimaDoOrcado {
  item: string;
  orcado: number;
  planejado: number;
}

export function linhasDoMotivoDaVersao(args: {
  pegaResultado: boolean;
  resultadoGeral: number | null;
  resultadoMinimo: number;
  pegaPlanejado: boolean;
  itensAcima: ItemAcimaDoOrcado[];
  /** Decisão 225: as taxas da exceção no fechamento, quando ela pega. */
  excecao: { intTaxes: number; imposto: number; itc: number } | null;
}): LinhaDoMotivo[] {
  const linhas: LinhaDoMotivo[] = [];
  if (args.pegaResultado && args.resultadoGeral !== null) {
    linhas.push({
      rotulo: "Resultado geral abaixo do mínimo",
      valor: (
        <>
          <span className="font-semibold text-red-600">{formatarPercentualDoComite(args.resultadoGeral)}</span>
          <span className="text-muted-foreground"> · mínimo {formatarPercentualDoComite(args.resultadoMinimo)}</span>
        </>
      ),
    });
  }
  if (args.pegaPlanejado) {
    args.itensAcima.forEach((i, n) =>
      linhas.push({
        rotulo: `${i.item || `Item ${n + 1}`}: planejado acima do orçado`,
        valor: (
          <>
            <span className="text-muted-foreground">{brl(i.orcado)} → </span>
            <span className="font-semibold text-red-600">{brl(i.planejado)}</span>
            <span className="text-muted-foreground"> · +{brl(i.planejado - i.orcado)}</span>
          </>
        ),
      }),
    );
  }
  if (args.excecao) {
    const pct = (n: number) => `${String(Number(n)).replace(".", ",")}%`;
    linhas.push({
      rotulo: "Exceção no fechamento do internacional",
      valor: (
        <>
          <span className="text-muted-foreground">int. taxes </span>
          <span className="font-semibold text-amber-700">{pct(args.excecao.intTaxes)}</span>
          <span className="text-muted-foreground"> · Impostos BR </span>
          <span className="font-semibold text-amber-700">{pct(args.excecao.imposto)}</span>
          <span className="text-muted-foreground"> · custo de transação </span>
          <span className="font-semibold text-amber-700">{brl(args.excecao.itc)}</span>
        </>
      ),
    });
  }
  return linhas;
}

export function linhasDoMotivoDaPP(args: {
  item: string;
  linhaVermelha: boolean;
  orcado: number;
  realizadoComAPP: number;
}): LinhaDoMotivo[] {
  return [
    {
      rotulo: args.linhaVermelha
        ? `${args.item} (linha vermelha, orçado zero)`
        : `${args.item}: realizado acima do orçado`,
      valor: (
        <>
          <span className="text-muted-foreground">orçado {brl(args.orcado)} → com a PP </span>
          <span className="font-semibold text-red-600">{brl(args.realizadoComAPP)}</span>
          <span className="text-muted-foreground"> · +{brl(args.realizadoComAPP - args.orcado)}</span>
        </>
      ),
    },
  ];
}

