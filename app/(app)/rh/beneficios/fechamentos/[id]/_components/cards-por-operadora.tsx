import Link from "next/link";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { FechamentoDetalhe } from "@/lib/types";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function CardsPorOperadora(props: {
  operadoras: FechamentoDetalhe["por_operadora"];
}) {
  if (props.operadoras.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Avulsas geradas por operadora
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {props.operadoras.map((op) => (
          <div
            key={op.operadora}
            className="rounded-xl border border-border bg-card p-4 shadow-soft space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{op.operadora}</h3>
                <p className="text-xs text-muted-foreground">
                  {op.qtd_vinculos} vínculo{op.qtd_vinculos === 1 ? "" : "s"}
                </p>
              </div>
              {op.avulsa_pago_em && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 border border-emerald-200">
                  <CheckCircle2 className="h-3 w-3" />
                  Pago
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Integral:</dt>
              <dd className="text-right font-medium">
                {brl.format(op.valor_integral)}
              </dd>
              <dt className="text-muted-foreground">Empresa:</dt>
              <dd className="text-right">{brl.format(op.valor_empresa)}</dd>
              <dt className="text-muted-foreground">Colaborador:</dt>
              <dd className="text-right">{brl.format(op.valor_colaborador)}</dd>
              <dt className="text-muted-foreground">Vencimento:</dt>
              <dd className="text-right">{formatarData(op.avulsa_vencimento)}</dd>
            </dl>
            {op.avulsa_id && (
              <Link
                href={`/financeiro/contas-a-pagar/avulsa/${op.avulsa_id}`}
                prefetch={false}
                className="inline-flex items-center gap-1 text-xs text-california-red hover:underline mt-2"
              >
                Ver avulsa {op.avulsa_codigo ? `(${op.avulsa_codigo})` : ""}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
