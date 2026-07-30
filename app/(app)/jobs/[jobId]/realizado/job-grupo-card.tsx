import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
} from "@/lib/types";
import { JobItemRealizadoTable } from "./job-item-realizado-table";

interface Props {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  moeda: string;
  editable: boolean;
  jobId: string;
}

export function JobGrupoCard({
  grupo,
  itens,
  realizadosMap,
  moeda,
  editable,
  jobId,
}: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-muted/40 px-6 py-4">
        <h3 className="text-base font-semibold text-foreground truncate">
          {grupo.nome}
        </h3>
        <span className="text-xs text-muted-foreground">
          {itens.length} {itens.length === 1 ? "item" : "itens"}
        </span>
      </div>
      <JobItemRealizadoTable
        jobId={jobId}
        itens={itens}
        realizadosMap={realizadosMap}
        moeda={moeda}
        editable={editable}
      />
    </div>
  );
}
