import { Receipt, ArrowRight, Hourglass } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const TIPO_LABEL: Record<string, string> = {
  salario: "Salário",
  ferias: "Férias",
  decimo_terceiro_1a_parcela: "13º · 1ª parcela",
  decimo_terceiro_2a_parcela: "13º · 2ª parcela",
  decimo_terceiro_adiantamento: "13º · adiantamento",
};

const STATUS_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  rascunho: {
    label: "Rascunho",
    chip: "bg-slate-50 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  },
  enviada: {
    label: "Enviada",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "bg-sky-500",
  },
  aprovada: {
    label: "Aprovada",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  paga: {
    label: "Paga",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  pendente_correcao: {
    label: "Pendente",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  reprovada: {
    label: "Reprovada",
    chip: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
  },
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export interface FolhaRecente {
  id: string;
  competencia_ano: number;
  competencia_mes: number;
  tipo: string;
  status: string;
  salario_base: number;
  origem: "california" | "contabilidade";
  /** TRUE quando a linha é sintetizada no front — folha CLT de um
   *  CLT+RECIBO que ainda não chegou pelo PDF da contabilidade. */
  aguardando?: boolean;
}

const ORIGEM_LABEL: Record<FolhaRecente["origem"], string> = {
  california: "Recibo",
  contabilidade: "CLT",
};

interface Props {
  folhas: FolhaRecente[];
}

export function CardFolha({ folhas }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
            <Receipt className="h-3.5 w-3.5" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
            Folha de pagamento
          </h3>
        </div>
        <Link
          href="/rh/folha-pagamento"
          prefetch={false}
          className="inline-flex items-center gap-1 text-xs font-medium text-california-red hover:underline"
        >
          Abrir módulo <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {folhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma folha registrada para este colaborador.
        </p>
      ) : (
        <ul className="space-y-2">
          {folhas.map((f) => {
            const tipoLabel = TIPO_LABEL[f.tipo] ?? f.tipo;
            const aguardando = f.aguardando === true;
            const style = aguardando
              ? {
                  label: "Aguardando contabilidade",
                  chip: "bg-amber-50 text-amber-700 border-amber-200",
                  dot: "bg-amber-500",
                }
              : STATUS_STYLE[f.status] ?? {
                  label: f.status,
                  chip: "bg-slate-50 text-slate-700 border-slate-200",
                  dot: "bg-slate-400",
                };
            return (
              <li
                key={f.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                  aguardando
                    ? "border-dashed border-border bg-muted/20"
                    : "border-border bg-background",
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {tipoLabel}
                    <span className="text-muted-foreground font-normal">
                      {" · "}
                      {MESES[f.competencia_mes - 1]}/{f.competencia_ano}
                    </span>
                  </p>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    {aguardando ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground italic">
                        <Hourglass className="h-3 w-3" />
                        PDF da contabilidade ainda não importado
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {brl.format(f.salario_base)}
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {ORIGEM_LABEL[f.origem]}
                    </span>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold shrink-0",
                    style.chip,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                  {style.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
