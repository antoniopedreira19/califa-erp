import Link from "next/link";
import { AlertCircle, ClipboardList } from "lucide-react";
import type {
  Job,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
  PedidoCompra,
  Fornecedor,
  Empresa,
} from "@/lib/types";
import { JobGrupoCard } from "./job-grupo-card";
import { JobTotaisCard } from "./job-totais-card";

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
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  editable: boolean;
  ppsPorItemId: Map<string, PedidoCompra>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
}

export function JobRealizadoSection({
  job,
  versao,
  grupos,
  itens,
  realizadosMap,
  editable,
  ppsPorItemId,
  fornecedores,
  empresas,
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

  const itensPorGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) {
    const list = itensPorGrupo.get(it.grupo_id);
    if (list) list.push(it);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha do job · v{versao.numero_versao}
            {versao.nome ? ` · ${versao.nome}` : ""}
          </span>
        </div>
        <Link
          href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
          prefetch={false}
          className="text-xs text-california-red hover:underline"
        >
          Ver versao aprovada →
        </Link>
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
                moeda={versao.moeda}
                editable={editable}
                jobId={job.id}
                ppsPorItemId={ppsPorItemId}
                fornecedores={fornecedores}
                empresas={empresas}
                jobEmpresaId={job.empresa_id ?? ""}
                jobResponsavelId={job.responsavel_id ?? ""}
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
