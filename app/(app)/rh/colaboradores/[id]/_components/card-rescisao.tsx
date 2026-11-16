import { FileX2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface Props {
  dataEncerramento: string | null;
}

export function CardRescisao({ dataEncerramento }: Props) {
  const encerrado = !!dataEncerramento;

  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <FileX2 className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          Rescisão
        </h3>
      </div>

      {encerrado ? (
        <div className="space-y-2">
          <p className="text-sm text-foreground">
            Colaborador encerrado em{" "}
            <span className="font-semibold tabular-nums">
              {formatDate(dataEncerramento)}
            </span>
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Documentos da rescisão (TRCT, exame demissional, comprovantes) serão
            listados aqui numa próxima etapa.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma rescisão registrada. Esta seção reunirá TRCT, exame
          demissional e comprovantes quando o colaborador for encerrado.
        </p>
      )}
    </div>
  );
}
