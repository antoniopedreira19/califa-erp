import { CalendarClock, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { PrevisaoDoJob } from "./dados";

function formatDataBr(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * A curva de desembolso como foi gravada na abertura.
 *
 * Sem coluna de "Situação" de propósito. O design marcava a parcela como
 * "Pago" quando a data já tinha passado — mas data que passa não paga
 * nada. Pela decisão 004, a previsão é abatida quando a PP do item é
 * emitida; enquanto esse abatimento não existir de verdade, a tela
 * mostra o que sabe (data e valor) em vez de inventar um estado.
 */
export function PrevisoesCard({
  previsoes,
  custoPrevisto,
  valorJob,
  moeda,
}: {
  previsoes: PrevisaoDoJob[];
  custoPrevisto: number | null;
  valorJob: number;
  moeda: string;
}) {
  const soma = previsoes.reduce((s, p) => s + p.valor, 0);
  const pctDoJob = valorJob > 0 ? (soma / valorJob) * 100 : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border px-[22px] py-5">
        <CalendarClock className="h-4 w-4 text-california-red" />
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em]">
          Previsões de pagamento
        </h2>
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          {previsoes.length === 1
            ? "1 data prevista"
            : `${previsoes.length} datas previstas`}
        </span>
      </header>

      {previsoes.length === 0 ? (
        <div className="flex items-start gap-2.5 px-[22px] py-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {custoPrevisto !== null && custoPrevisto <= 0
              ? "Sem desembolso previsto: os custos deste job são pagos diretamente pelo cliente ao fornecedor (itens de calha BV)."
              : "Nenhuma data de desembolso registrada na abertura."}
          </p>
        </div>
      ) : (
        <>
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-[22px] py-2.5 font-semibold">Data prevista</th>
                <th className="px-3 py-2.5 text-right font-semibold">Valor</th>
                <th className="px-[22px] py-2.5 text-right font-semibold">
                  % do total
                </th>
              </tr>
            </thead>
            <tbody>
              {previsoes.map((p) => (
                <tr key={p.id} className="border-b border-b-[#f4f2f2]">
                  <td className="px-[22px] py-3 font-mono text-[12.5px]">
                    {formatDataBr(p.data_prevista)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-[12.5px] font-semibold">
                    {formatCurrency(p.valor, moeda)}
                  </td>
                  <td className="px-[22px] py-3 text-right font-mono text-[12px] text-muted-foreground">
                    {soma > 0
                      ? `${((p.valor / soma) * 100).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="border-t border-border px-[22px] py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                  Custo previsto total
                </td>
                <td className="border-t border-border px-3 py-3 text-right font-mono text-[13.5px] font-bold">
                  {formatCurrency(soma, moeda)}
                </td>
                <td className="border-t border-border px-[22px] py-3 text-right font-mono text-[12px] text-muted-foreground">
                  {valorJob > 0
                    ? `${pctDoJob.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}% do valor do job`
                    : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
          <div className="border-t border-border bg-muted/40 px-[22px] py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Gravado na abertura, a partir do planejado dos itens que geram
              PP. À medida que as PPs forem emitidas, elas abatem esta
              previsão no fluxo de caixa.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
