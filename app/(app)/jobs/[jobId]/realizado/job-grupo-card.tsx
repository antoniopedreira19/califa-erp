import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import type {
  VersaoOrcamentoGrupo,
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompra,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { VisaoBv } from "@/lib/calculos/bv-planilha";
import { JobItemRealizadoTable } from "./job-item-realizado-table";

interface Props {
  saveVisivel?: boolean;
  savePorItem?: Record<string, EstadoSaveDaLinha>;
  onAbrirSave?: (item: ItemPlanilhaJob) => void;
  grupo: VersaoOrcamentoGrupo;
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  categoriasMap: Map<string, string>;
  moeda: string;
  /** Alíquota do job, que vira o BV líquido descontado na vista Líquido. */
  percentualImposto: number;
  /** Bruto ou Líquido (− BV) — decidida uma vez por página. */
  visao: VisaoBv;
  /** Grupo recolhido esconde as linhas; subtotal e rentabilidade ficam. */
  aberto: boolean;
  onAlternar: () => void;
  /** Trilha lateral de BV e Pedido de Produção — só com o job aberto. */
  podeAcoes: boolean;
  /** Job ainda não aberto pelo financeiro: a trilha some por inteiro,
   *  inclusive o BV já lançado. */
  preAbertura: boolean;
  jobId: string;
  ppsPorItemId: Map<string, PedidoCompra[]>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  jobEmpresaId: string;
  jobResponsavelId: string;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  /** Cartões de crédito ativos do tenant — buscados pelo server component pai. */
  cartoes: CartaoOption[];
}

export function JobGrupoCard({
  saveVisivel,
  savePorItem,
  onAbrirSave,
  grupo,
  itens,
  realizadosMap,
  categoriasMap,
  moeda,
  percentualImposto,
  visao,
  aberto,
  onAlternar,
  podeAcoes,
  preAbertura,
  jobId,
  ppsPorItemId,
  fornecedores,
  empresas,
  jobEmpresaId,
  jobResponsavelId,
  bvsPorItem,
  versaoLabel,
  cartoes,
}: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      {/* A tabela abre o card: o nome do agrupamento vive na faixa dela,
          ao lado de ORÇADO / PLANEJADO / REALIZADO, e o contador foi para
          a calha à direita. A barra de título de antes só segurava esses
          dois e custava uma linha inteira de altura. */}
      <JobItemRealizadoTable
        saveVisivel={saveVisivel}
        savePorItem={savePorItem}
        onAbrirSave={onAbrirSave}
        jobId={jobId}
        itens={itens}
        realizadosMap={realizadosMap}
        categoriasMap={categoriasMap}
        moeda={moeda}
        percentualImposto={percentualImposto}
        visao={visao}
        aberto={aberto}
        podeAcoes={podeAcoes}
        preAbertura={preAbertura}
        ppsPorItemId={ppsPorItemId}
        fornecedores={fornecedores}
        empresas={empresas}
        jobEmpresaId={jobEmpresaId}
        jobResponsavelId={jobResponsavelId}
        bvsPorItem={bvsPorItem}
        versaoLabel={versaoLabel}
        cartoes={cartoes}
        grupoNome={grupo.nome}
        cabecalhoGrupo={
          // Mesma pastilha do cabeçalho de grupo do orçamento: o leitor
          // aprende o gesto uma vez e ele vale nas duas planilhas.
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onAlternar}
              title={
                aberto ? "Ocultar itens do grupo" : "Mostrar itens do grupo"
              }
              aria-expanded={aberto}
              className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-150",
                  !aberto && "-rotate-90",
                )}
              />
            </button>
            <TruncateTooltip
              as="h3"
              text={grupo.nome}
              className="text-base font-semibold text-foreground"
            />
          </div>
        }
        acoesGrupo={
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {itens.length} {itens.length === 1 ? "item" : "itens"}
            {!aberto && itens.length > 0 && " ocultos"}
          </span>
        }
      />
    </div>
  );
}
