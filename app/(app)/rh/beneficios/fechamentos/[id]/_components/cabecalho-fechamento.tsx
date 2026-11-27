import { CheckCircle2, Undo2 } from "lucide-react";

export function CabecalhoFechamento(props: {
  reabertoEm: string | null;
}) {
  const aplicado = props.reabertoEm === null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-soft">
      <div>
        {aplicado ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Aplicado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground border border-border">
            <Undo2 className="h-3.5 w-3.5" />
            Reaberto em {new Date(props.reabertoEm as string).toLocaleString("pt-BR")}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground max-w-xs text-right">
        Pra desaplicar, use o botão na página da folha mensal.
      </p>
    </div>
  );
}
