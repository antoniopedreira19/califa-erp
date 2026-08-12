import { Info } from "lucide-react";

/**
 * Legenda das fórmulas do card de Totais.
 *
 * Fonte única das quatro telas que fecham orçado: versão do orçamento,
 * visão agregada de orçamentos, planilha do job e visão agregada de jobs.
 * O texto já esteve copiado em cada uma delas e divergiu — a regra mudou
 * num arquivo e continuou errada nos outros três.
 *
 * A conta em si mora em `REGRAS_TIPO_CUSTO`
 * (lib/calculos/versao-totais.ts); aqui é só a descrição para o usuário.
 */
export function LegendaFechamento({
  /** Rótulo do custo descontado no resultado. A versão do orçamento só tem
   *  planejado; o job alterna entre planejado e realizado. */
  custo = "custo planejado",
}: {
  custo?: string;
}) {
  return (
    <div className="flex items-start gap-2 border-t border-border bg-muted/30 px-6 py-4 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        <strong className="text-foreground">Honorários</strong> sobre A · Direto
        + A · Repasse + B + D + F · Externo ·{" "}
        <strong className="text-foreground">Impostos</strong> sobre B + C +
        honorários em <em>gross-up</em> ·{" "}
        <strong className="text-foreground">Faturamento previsto</strong> = o
        que a California emite nota (A · Repasse + B + C) + honorários +
        impostos · <strong className="text-foreground">Valor do Job</strong> = o
        compromisso total do cliente, somando o que ele paga direto ao
        fornecedor (tudo menos D) + honorários + impostos ·{" "}
        <strong className="text-foreground">Resultado operacional</strong> =
        valor do job − impostos − {custo} ·{" "}
        <strong className="text-foreground">Resultado geral</strong> = resultado
        operacional ÷ valor do job.
      </p>
    </div>
  );
}
