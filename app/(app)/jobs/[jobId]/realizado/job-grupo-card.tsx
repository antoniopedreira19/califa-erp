import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
  PedidoCompra,
  Fornecedor,
  Empresa,
} from "@/lib/types";
import { JobItemRealizadoTable } from "./job-item-realizado-table";

interface Props {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  moeda: string;
  editable: boolean;
  jobId: string;
  ppsPorItemId: Map<string, PedidoCompra>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  jobEmpresaId: string;
  jobResponsavelId: string;
}

export function JobGrupoCard({
  grupo,
  itens,
  realizadosMap,
  moeda,
  editable,
  jobId,
  ppsPorItemId,
  fornecedores,
  empresas,
  jobEmpresaId,
  jobResponsavelId,
}: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-muted/40 px-6 py-4">
        <TruncateTooltip
          as="h3"
          text={grupo.nome}
          className="text-base font-semibold text-foreground"
        />
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
        ppsPorItemId={ppsPorItemId}
        fornecedores={fornecedores}
        empresas={empresas}
        jobEmpresaId={jobEmpresaId}
        jobResponsavelId={jobResponsavelId}
      />
    </div>
  );
}
