import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import type {
  VersaoOrcamentoGrupo,
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompra,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import { JobItemRealizadoTable } from "./job-item-realizado-table";

interface Props {
  grupo: VersaoOrcamentoGrupo;
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  categoriasMap: Map<string, string>;
  moeda: string;
  editable: boolean;
  jobId: string;
  ppsPorItemId: Map<string, PedidoCompra>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  jobEmpresaId: string;
  jobResponsavelId: string;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
}

export function JobGrupoCard({
  grupo,
  itens,
  realizadosMap,
  categoriasMap,
  moeda,
  editable,
  jobId,
  ppsPorItemId,
  fornecedores,
  empresas,
  jobEmpresaId,
  jobResponsavelId,
  bvsPorItem,
  versaoLabel,
}: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      {/* A tabela abre o card: o nome do agrupamento vive na faixa dela,
          ao lado de ORÇADO / PLANEJADO / REALIZADO, e o contador foi para
          a calha à direita. A barra de título de antes só segurava esses
          dois e custava uma linha inteira de altura. */}
      <JobItemRealizadoTable
        jobId={jobId}
        itens={itens}
        realizadosMap={realizadosMap}
        categoriasMap={categoriasMap}
        moeda={moeda}
        editable={editable}
        ppsPorItemId={ppsPorItemId}
        fornecedores={fornecedores}
        empresas={empresas}
        jobEmpresaId={jobEmpresaId}
        jobResponsavelId={jobResponsavelId}
        bvsPorItem={bvsPorItem}
        versaoLabel={versaoLabel}
        grupoNome={grupo.nome}
        cabecalhoGrupo={
          <TruncateTooltip
            as="h3"
            text={grupo.nome}
            className="text-base font-semibold text-foreground"
          />
        }
        acoesGrupo={
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {itens.length} {itens.length === 1 ? "item" : "itens"}
          </span>
        }
      />
    </div>
  );
}
