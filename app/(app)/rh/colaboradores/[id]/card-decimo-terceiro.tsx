import Link from "next/link";
import { Gift, ArrowRight } from "lucide-react";

export interface HistoricoDecimoTerceiro {
  ano: number;
  avos: number;
  total_bruto: number;
  total_adiantado: number;
  total_liquido: number;
  status_folha: string;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function statusLabel(status: string): string {
  switch (status) {
    case "rascunho":
      return "Em rascunho";
    case "fechada_parcial_1":
      return "1ª enviada";
    case "fechada_parcial_2":
      return "2ª enviada";
    case "concluida":
      return "Concluída";
    default:
      return status;
  }
}

export function CardDecimoTerceiro({
  historico,
}: {
  historico: HistoricoDecimoTerceiro[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
            <Gift className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">13º Salário</h3>
            <p className="text-xs text-muted-foreground">
              Histórico anual
            </p>
          </div>
        </div>
      </div>

      {historico.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Este colaborador ainda não recebeu 13º pelo sistema.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {historico.map((h) => (
            <Link
              key={h.ano}
              href={`/rh/decimo-terceiro/${h.ano}`}
              prefetch={false}
              className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-muted/40"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{h.ano}</span>
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
                    {statusLabel(h.status_folha)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {h.avos} {h.avos === 1 ? "avo" : "avos"}
                  {h.total_adiantado > 0 && (
                    <> · adiantado {brl.format(h.total_adiantado)}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-california-red">
                    {brl.format(h.total_liquido)}
                  </div>
                  <div className="text-xs text-muted-foreground">líquido</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
