/** A rentabilidade que mora DENTRO do bloco, no vão à esquerda do total.
 *
 *  Do handoff "Planilha Interna - Grupos Unificados": na linha do grupo e
 *  na do total, as colunas R$ Unit. / QT / D/M de PLANEJADO e REALIZADO
 *  ficam vazias — não há unitário de um agrupamento. O handoff usa esse
 *  vão para a rentabilidade daquele bloco, em vez de abrir uma sublinha
 *  "Rentabilidade" embaixo, que era o que a planilha do job fazia até
 *  24/08/2026 e custava uma linha inteira por grupo.
 *
 *  No ORÇADO ela não existe: ele é a BASE da comparação, não tem contra o
 *  que render.
 *
 *  A cor é grafite nos dois blocos, positiva ou negativa (`RENTAB_VALOR`,
 *  decisão do time de 11/08/2026): o sinal já está no número, e pintar de
 *  verde brigaria com o verde do PLANEJADO. Só o rótulo "rentab." usa o
 *  tom suave do bloco, para dizer a qual deles a conta pertence.
 *
 *  Sem "use client": é presentacional pura, e tanto a planilha (client)
 *  quanto os cards de Totais (server) a usam.
 */

import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import { RENTAB_VALOR } from "./blocos";

/** Mesmo formato do card de Totais: uma casa decimal, vírgula decimal. */
function formatarPercentual(percentual: number): string {
  return `${percentual.toFixed(1).replace(".", ",")}%`;
}

export function RentabilidadeNoVao({
  orcado,
  custo,
  moeda,
  corRotulo,
}: {
  /** A base da comparação — o total orçado do mesmo recorte. */
  orcado: number;
  /** O custo do bloco: o planejado ou o realizado, já na vista escolhida. */
  custo: number;
  moeda: string;
  /** Tom suave do bloco a que a conta pertence. Vem de `blocos.ts`. */
  corRotulo: string;
}) {
  const { rentabilidade, percentual } = calcularRentabilidade(orcado, custo);

  // Bloco ainda sem custo lançado: não há rentabilidade a mostrar, e um
  // "R$ 0,00 · 0%" diria que ela é zero, que é outra coisa.
  if (custo <= 0) {
    return (
      <span className="font-mono text-[10.5px] text-muted-foreground">—</span>
    );
  }

  // Rótulo em cima, número embaixo — e não os dois na mesma linha como no
  // handoff. Lá a tabela tem 1560px e o vão sobra; aqui ela fecha em
  // 1160px (`LARGURA_MINIMA_JOB`) e o vão vira ~157px, em que
  // "rentab. R$ 526.500,00 · 3,0%" não cabe: numa tabela `table-fixed` o
  // texto não encolhe a célula, ele TRANSBORDA por cima do total do lado.
  // Empilhado, o número mais largo mede ~120px e sobra folga.
  return (
    <span className="flex flex-col items-end overflow-hidden leading-[1.15]">
      <span
        className={cn(
          "text-[9.5px] font-bold uppercase tracking-[0.08em]",
          corRotulo,
        )}
      >
        rentab.
      </span>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-[10.5px] font-semibold",
          RENTAB_VALOR,
        )}
      >
        {formatCurrency(rentabilidade, moeda)}
        {percentual !== null && ` · ${formatarPercentual(percentual)}`}
      </span>
    </span>
  );
}
