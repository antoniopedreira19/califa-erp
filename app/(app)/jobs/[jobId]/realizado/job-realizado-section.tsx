import Link from "next/link";
import { AlertCircle, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Job,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompra,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import { JobGrupoCard } from "./job-grupo-card";
import { JobTotaisCard } from "./job-totais-card";
import { AlterarOrcadoButton } from "./alterar-orcado-button";

interface Props {
  job: Pick<
    Job,
    | "id"
    | "status"
    | "projeto_id"
    | "orcamento_id"
    | "versao_orcamento_aprovada_id"
    | "empresa_id"
    | "responsavel_id"
  >;
  versao: Pick<VersaoOrcamento, "id" | "numero_versao" | "nome" | "moeda" | "percentual_honorarios" | "percentual_imposto">;
  grupos: VersaoOrcamentoGrupo[];
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  categoriasMap: Map<string, string>;
  editable: boolean;
  ppsPorItemId: Map<string, PedidoCompra>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  /** BV por id do item da versão. Só existe em item tipo A ou D. */
  bvsPorItem: Record<string, ItemBv>;
}

export function JobRealizadoSection({
  job,
  versao,
  grupos,
  itens,
  realizadosMap,
  categoriasMap,
  editable,
  ppsPorItemId,
  fornecedores,
  empresas,
  bvsPorItem,
}: Props) {
  // Status onde nem mostramos a planilha
  if (
    job.status === "aguardando_abertura" ||
    job.status === "rejeitado_financeiro"
  ) {
    return (
      <div className="rounded-2xl border border-border bg-muted/20 p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Realizado indisponível
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Aguarde a aprovação do financeiro para lançar valores realizados.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const itensPorGrupo = new Map<string, ItemPlanilhaJob[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) {
    const list = itensPorGrupo.get(it.grupo_id);
    if (list) list.push(it);
  }

  return (
    // Quando dá pra gerar PP, reserva a calha da direita: a trilha de
    // "Adicionar BV" / "Abrir BV" / "Gerar PP" / "Ver PP" é posicionada
    // fora do card, e sem esse espaço ela era cortada na borda da página.
    //
    // 116px e não 126: a trilha tem 116px de botão ("Adicionar BV" é o
    // rótulo mais longo) + 10px de respiro, e esses 10px podem invadir o
    // padding do layout (32px) sem encostar na borda. Devolver os 10px ao
    // card é o que faz a tabela caber inteira — as bordas de 2px entre os
    // blocos somam ~5px que as porcentagens das colunas não preveem.
    // Os 12px a mais que a calha antiga foram devolvidos à página (o
    // max-w de JobDetalhe cresceu junto): a planilha não encolheu.
    <div className={cn("space-y-4", editable && "pr-[116px]")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha do job · v{versao.numero_versao}
            {versao.nome ? ` · ${versao.nome}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {editable && (
            <AlterarOrcadoButton
              jobId={job.id}
              itens={itens}
              grupos={grupos}
              percentualHonorarios={versao.percentual_honorarios}
              percentualImposto={versao.percentual_imposto}
              moeda={versao.moeda}
            />
          )}
          <Link
            href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
            prefetch={false}
            className="text-xs text-california-red hover:underline"
          >
            Ver versão aprovada →
          </Link>
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            A versão aprovada não tem grupos.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {grupos.map((g) => (
              <JobGrupoCard
                key={g.id}
                grupo={g}
                itens={itensPorGrupo.get(g.id) ?? []}
                realizadosMap={realizadosMap}
                categoriasMap={categoriasMap}
                moeda={versao.moeda}
                editable={editable}
                jobId={job.id}
                ppsPorItemId={ppsPorItemId}
                fornecedores={fornecedores}
                empresas={empresas}
                jobEmpresaId={job.empresa_id ?? ""}
                jobResponsavelId={job.responsavel_id ?? ""}
                bvsPorItem={bvsPorItem}
                versaoLabel={`v${versao.numero_versao}`}
              />
            ))}
          </div>
          <JobTotaisCard
            grupos={grupos}
            itens={itens}
            realizadosMap={realizadosMap}
            percentualHonorarios={versao.percentual_honorarios}
            percentualImposto={versao.percentual_imposto}
            moeda={versao.moeda}
          />
        </>
      )}
    </div>
  );
}
