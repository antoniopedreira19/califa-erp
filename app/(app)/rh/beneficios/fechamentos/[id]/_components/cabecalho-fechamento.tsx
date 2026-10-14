import { CheckCircle2, Undo2 } from "lucide-react";
import { BotaoDesaplicarBeneficios } from "../../../../folhas/_components/botao-desaplicar-beneficios";

export function CabecalhoFechamento(props: {
  fechamentoId: string;
  reabertoEm: string | null;
  avulsaPaga: boolean;
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
      {aplicado && !props.avulsaPaga && (
        <BotaoDesaplicarBeneficios fechamentoId={props.fechamentoId} />
      )}
      {aplicado && props.avulsaPaga && (
        <p className="text-xs text-muted-foreground max-w-xs text-right">
          Alguma avulsa deste fechamento já foi paga. Pra desaplicar, estorne a
          avulsa pelo financeiro antes.
        </p>
      )}
    </div>
  );
}
