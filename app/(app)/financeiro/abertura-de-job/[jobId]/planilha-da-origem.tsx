import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { SessionContext } from "@/lib/types";
import { carregarDetalheDoJob } from "@/app/(app)/jobs/[jobId]/carregar-detalhe";
import { JobRealizadoSection } from "@/app/(app)/jobs/[jobId]/realizado/job-realizado-section";

/**
 * A Planilha Interna de um job de ORIGEM do consumo de save, em leitura —
 * o conteúdo do pop-up "Visualizar planilha do {código}" do formulário da
 * abertura e do job aberto (decisão 155, 07/10/2026).
 *
 * Vem com `Suspense`: a página monta o formulário sem esperar por ela, e a
 * planilha do outro job chega em seguida, no mesmo carregamento. Só existe
 * quando o job consome save — os outros não pagam esta leitura.
 */
export function PlanilhaDaOrigem({
  session,
  jobId,
  codigo,
}: {
  session: SessionContext;
  jobId: string;
  codigo: string;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 px-1 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando a planilha do {codigo}…
        </div>
      }
    >
      <PlanilhaDaOrigemCarregada session={session} jobId={jobId} codigo={codigo} />
    </Suspense>
  );
}

async function PlanilhaDaOrigemCarregada({
  session,
  jobId,
  codigo,
}: {
  session: SessionContext;
  jobId: string;
  codigo: string;
}) {
  const detalhe = await carregarDetalheDoJob(session, jobId);
  if (!detalhe) {
    return (
      <p className="px-1 py-10 text-sm text-muted-foreground">
        Não foi possível carregar a planilha do {codigo}.
      </p>
    );
  }
  const { versaoAprovada, podeExportarInterna } = detalhe;
  const job = detalhe.job;

  // As mesmas props da aba Planilha Interna da página do job no financeiro,
  // em leitura e sem o "Editar orçado": aqui só se confere de onde veio o
  // saldo. Trocar de mês leva à página do job de origem.
  return (
    <JobRealizadoSection
      papelEnviaPP={false}
      confirmarSaidaParaOrcamento
      edicaoDoFinanceiro={null}
      // A planilha da origem é anterior à abertura (decisão 151).
      aberturaDoJob={null}
      interno={detalhe.interno}
      savePorItem={detalhe.savePorItem}
      saldosDeSave={[]}
      clienteNome={detalhe.clienteNome}
      destacarItens={[]}
      job={{
        id: job.id,
        codigo: job.codigo,
        nome: job.nome,
        status: job.status,
        projeto_id: job.projeto_id,
        orcamento_id: job.orcamento_id,
        versao_orcamento_aprovada_id: job.versao_orcamento_aprovada_id,
        empresa_id: job.empresa_id,
        responsavel_id: job.responsavel_id,
      }}
      nomeJob={job.nome}
      versao={{
        id: versaoAprovada.id,
        numero_versao: versaoAprovada.numero_versao,
        moeda: versaoAprovada.moeda,
        percentual_honorarios: Number(versaoAprovada.percentual_honorarios),
        percentual_imposto: Number(versaoAprovada.percentual_imposto),
        percentual_int_taxes: Number(versaoAprovada.percentual_int_taxes ?? 0),
        int_transaction_costs: Number(versaoAprovada.int_transaction_costs ?? 0),
        moeda_estrangeira: versaoAprovada.moeda_estrangeira ?? null,
        cambio_compra:
          versaoAprovada.cambio_compra === null || versaoAprovada.cambio_compra === undefined
            ? null
            : Number(versaoAprovada.cambio_compra),
      }}
      modeloPlanilha={detalhe.modeloPlanilha}
      meses={detalhe.meses}
      faturamentoMensal={detalhe.faturamentoMensal}
      mesPedido={undefined}
      hrefPlanilha={`/financeiro/jobs/${job.id}?aba=planilha`}
      grupos={detalhe.grupos}
      itens={detalhe.itens}
      realizadosMap={detalhe.realizadosMap}
      categoriasMap={detalhe.categoriasMap}
      podeAcoes={false}
      podeMexerNoSave={false}
      podeExportarInterna={podeExportarInterna}
      podeConfirmarBv={false}
      ppsPorItemId={detalhe.ppsPorItemId}
      aEmitirPorItemId={detalhe.aEmitirPorItemId}
      tomadoresDaNf={detalhe.tomadoresDaNf}
      tomadorPorEmpresa={detalhe.tomadorPorEmpresa}
      fornecedores={detalhe.fornecedores}
      empresas={detalhe.empresas}
      responsaveis={detalhe.responsaveis}
      bvsPorItem={detalhe.bvsPorItem}
    />
  );
}
