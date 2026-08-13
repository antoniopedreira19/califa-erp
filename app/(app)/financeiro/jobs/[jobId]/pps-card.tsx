import Link from "next/link";
import { ArrowRight, Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { PPStatusChip } from "@/app/(app)/jobs/[jobId]/pps/pp-status-chip";
import type { PpDoJob } from "./dados";

/**
 * Os Pedidos de Produção do job, na leitura do financeiro.
 *
 * Somente leitura: emitir, aprovar e dar baixa acontecem em Contas a
 * Pagar e no módulo de Jobs. Aqui é o retrato de quanto do custo já
 * virou compromisso com fornecedor.
 *
 * O rodapé separa o que já saiu do caixa (`pago`) do que está
 * comprometido mas ainda não pago (`em_avaliacao` + `aprovada`).
 * Rejeitada e cancelada não entram em nenhum dos dois: não são
 * compromisso nem desembolso.
 */
export function PpsCard({
  pps,
  custoPrevisto,
  moeda,
}: {
  pps: PpDoJob[];
  custoPrevisto: number | null;
  moeda: string;
}) {
  const vivas = pps.filter(
    (p) => p.status !== "rejeitada" && p.status !== "cancelada",
  );
  const total = vivas.reduce((s, p) => s + p.valor, 0);
  const pago = vivas
    .filter((p) => p.status === "pago")
    .reduce((s, p) => s + p.valor, 0);
  const aPagar = total - pago;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border px-[22px] py-5">
        <Receipt className="h-4 w-4 text-california-red" />
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em]">
          Pedidos de Produção (PPs)
        </h2>
        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-california-red px-1.5 font-mono text-[11px] font-bold text-white">
          {pps.length}
        </span>
      </header>

      {pps.length === 0 ? (
        <p className="px-[22px] py-5 text-[13px] leading-relaxed text-muted-foreground">
          Nenhuma PP emitida para este job ainda. Elas nascem no módulo de
          Jobs, a partir dos itens da planilha interna.
        </p>
      ) : (
        <>
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-[22px] py-2.5 font-semibold">
                  PP · fornecedor
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Valor</th>
                <th className="px-[22px] py-2.5 text-right font-semibold">
                  Situação
                </th>
              </tr>
            </thead>
            <tbody>
              {pps.map((p) => (
                <tr key={p.id} className="border-b border-b-[#f4f2f2]">
                  <td className="px-[22px] py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs font-bold text-[#b3323c]">
                        {p.codigo}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {p.fornecedor_nome ?? "Sem fornecedor"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-[12.5px] font-semibold">
                    {formatCurrency(p.valor, moeda)}
                  </td>
                  <td className="px-[22px] py-3 text-right">
                    <PPStatusChip status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="border-t border-border px-[22px] py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                  Total em PPs ativas
                </td>
                <td className="border-t border-border px-3 py-3 text-right font-mono text-[13.5px] font-bold">
                  {formatCurrency(total, moeda)}
                </td>
                <td className="border-t border-border px-[22px] py-3 text-right font-mono text-[12px] text-muted-foreground">
                  {custoPrevisto && custoPrevisto > 0
                    ? `${((total / custoPrevisto) * 100).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}% do previsto`
                    : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-[22px] py-3">
            <span className="text-xs text-muted-foreground">
              Pagas{" "}
              <strong className="font-mono text-emerald-700">
                {formatCurrency(pago, moeda)}
              </strong>
            </span>
            <span className="text-xs text-muted-foreground">
              A pagar{" "}
              <strong className="font-mono text-foreground">
                {formatCurrency(aPagar, moeda)}
              </strong>
            </span>
            <Link
              href="/financeiro/contas-a-pagar"
              prefetch={false}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-california-red hover:text-california-red/80"
            >
              Contas a pagar
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
