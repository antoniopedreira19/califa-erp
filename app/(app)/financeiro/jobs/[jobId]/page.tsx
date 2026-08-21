import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  areaDoPapel,
  jobStatusLabel,
  nomeDoJobNoFinanceiro,
  type JobStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ResumoResultado } from "@/components/resumo-resultado";
import { classificarFaturamento } from "@/lib/calculos/esteira-faturamento";
import { listarProjetosFinanceiro } from "@/lib/data/projetos-financeiro";
import { listarContasBancarias } from "@/lib/data/contas-bancarias";
import { carregarDetalheDoJob } from "@/app/(app)/jobs/[jobId]/carregar-detalhe";
import { FichaJob } from "@/app/(app)/jobs/[jobId]/ficha-job";
import { ErratasCard } from "@/app/(app)/jobs/[jobId]/erratas-card";
import { JobRealizadoSection } from "@/app/(app)/jobs/[jobId]/realizado/job-realizado-section";
import { JobChatSection } from "@/app/(app)/jobs/[jobId]/comunicacao/job-chat-section";
import { AberturaForm } from "../../abertura-de-job/[jobId]/abertura-form";
import { carregarJobParaAbertura } from "../../abertura-de-job/dados";
import { consumoDasPrevisoes, previsoesGravadas } from "../../abertura-de-job/consumo";
import { trimestreDe } from "../../abertura-de-job/curva";
import { formatDataHoraBr } from "../../abertura-de-job/formatos";
import { SITUACAO_META } from "../../abertura-de-job/situacao-faturamento";
import { carregarFluxoDoJob } from "./fluxo-do-job";
import { FluxoCaixaDoJob, type PrazoDoJob } from "./fluxo-caixa-job";
import { JobFinanceiroTabs } from "./job-financeiro-tabs";

export const dynamic = "force-dynamic";

/** Dias corridos entre duas datas ISO. Null quando falta alguma ponta. */
function diasEntre(de: string | null, ate: string | null): number | null {
  if (!de || !ate) return null;
  const d1 = new Date(`${de.slice(0, 10)}T00:00:00Z`).getTime();
  const d2 = new Date(`${ate.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(d1) || Number.isNaN(d2)) return null;
  return Math.round((d2 - d1) / 86_400_000);
}

function formatDataBr(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}

/**
 * O job aberto na visão do financeiro — as cinco abas do protótipo
 * "Abertura de Job — Financeiro".
 *
 * A tela deixou de ser um resumo em cards e virou a casca de abas do
 * design: Abertura do Job (o registro que o financeiro confirmou, em
 * leitura, com o botão de editar), Informações, Planilha Interna, Fluxo
 * de Caixa do Job e Comunicação.
 *
 * Informações, Planilha e Comunicação são os MESMOS componentes de
 * `/jobs/[jobId]`, alimentados pelo mesmo `carregarDetalheDoJob`. A
 * decisão anterior desta página — "não duplicar tela cara de manter" —
 * continua valendo; o que mudou é que agora ela é atendida por reuso, e
 * não por link para outra rota (decisão do Tiago, 20/08/2026).
 */
export default async function JobNoFinanceiroPage({
  params,
}: {
  params: { jobId: string };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Todas independentes entre si — em paralelo, nunca em série
  // (`docs/PERFORMANCE.md`).
  const [
    detalhe,
    carregadoParaAbertura,
    contas,
    fluxo,
    previsoes,
    consumo,
    notaRes,
    categoriasRes,
  ] = await Promise.all([
    carregarDetalheDoJob(session, params.jobId),
    carregarJobParaAbertura(tenantId, params.jobId),
    listarContasBancarias(tenantId),
    carregarFluxoDoJob(tenantId, params.jobId),
    previsoesGravadas(supabase, tenantId, params.jobId),
    consumoDasPrevisoes(supabase, tenantId, params.jobId),
    // Nota emitida do job: decide o badge de faturamento e datou o prazo
    // de recebimento.
    supabase
      .from("faturamentos")
      .select("id, valor_total, data_emissao")
      .eq("tenant_id", tenantId)
      .eq("origem_tipo", "job")
      .eq("origem_id", params.jobId)
      .eq("status", "emitido")
      .maybeSingle(),
    // Vocabulário do combo de categoria do formulário de abertura: o
    // mesmo escopo 'orcamento' que a fila usa. Não existe lista de
    // categoria só do financeiro.
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (!detalhe || !carregadoParaAbertura) notFound();

  const { job, versaoAprovada, totaisJob, custoPlanejadoJob, custoRealizadoJob } =
    detalhe;

  // Job que ainda não passou pela abertura não tem registro para mostrar —
  // o lugar dele é a fila.
  if (job.status === "aguardando_abertura") {
    redirect(`/financeiro/abertura-de-job/${job.id}`);
  }

  const jobNaFila = carregadoParaAbertura.job;

  const [projetos, irmaosRes] = await Promise.all([
    listarProjetosFinanceiro(tenantId, jobNaFila.cliente_id),
    // Irmãos no projeto do FINANCEIRO — não os do projeto da produção,
    // que é outro agrupamento. Sem projeto do financeiro (job aberto
    // antes da migration 20260820000011) a lista fica vazia em vez de
    // cair na da produção, que seria mentira nesta tela.
    jobNaFila.projeto_financeiro_id
      ? supabase
          .from("jobs")
          .select("id, codigo, nome, nome_financeiro, status")
          .eq("tenant_id", tenantId)
          .eq("projeto_financeiro_id", jobNaFila.projeto_financeiro_id)
          .order("codigo", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const jobsDoProjetoFinanceiro = ((irmaosRes.data ?? []) as any[]).map((j) => ({
    id: j.id as string,
    codigo: j.codigo as string,
    nome: nomeDoJobNoFinanceiro(j),
    status: j.status as JobStatus,
  }));

  // ---- Badge de faturamento: mesma classificação da lista ----
  const nota = notaRes.data as {
    id: string;
    valor_total: number | string;
    data_emissao: string | null;
  } | null;

  const titulosRes = nota
    ? await supabase
        .from("titulos_receber")
        .select("valor, data_vencimento, status, pago_em")
        .eq("tenant_id", tenantId)
        .eq("faturamento_id", nota.id)
        .neq("status", "cancelado")
    : { data: [], error: null };

  const titulos = ((titulosRes.data ?? []) as any[]).map((t) => ({
    valor: Number(t.valor ?? 0),
    vencimento: t.data_vencimento as string,
    status: t.status as string,
  }));

  const hoje = new Date().toISOString().slice(0, 10);
  const situacao = classificarFaturamento(
    Boolean(nota),
    detalhe.envioFaturamento !== null,
    titulos,
    hoje,
  );
  const situacaoMeta = SITUACAO_META[situacao];

  // ---- Prazos do job ----
  // Todos saem de data real. Sem a ponta que fecha o prazo, o card mostra
  // travessão — número inventado aqui viraria indicador de gestão.
  const dataAbertura = job.data_abertura_financeiro?.slice(0, 10) ?? null;
  const dataFaturamento =
    nota?.data_emissao?.slice(0, 10) ?? job.data_prevista_faturamento;
  const ultimoRecebimento =
    titulos
      .map((t) => t.vencimento)
      .sort()
      .at(-1) ??
    previsoes.recebimento
      .map((p) => p.data)
      .sort()
      .at(-1) ??
    null;

  const prazos: PrazoDoJob[] = [
    {
      rotulo: "Prazo de faturamento",
      dias: diasEntre(dataAbertura, dataFaturamento),
      detalhe: `abertura ${formatDataBr(dataAbertura)} → faturamento ${formatDataBr(dataFaturamento)}`,
    },
    {
      rotulo: "Prazo de recebimento (do faturamento)",
      dias: diasEntre(dataFaturamento, ultimoRecebimento),
      detalhe: nota
        ? "nota emitida → último vencimento"
        : "faturamento previsto → último recebimento previsto",
    },
    {
      rotulo: "Prazo de recebimento do job",
      dias: diasEntre(dataAbertura, ultimoRecebimento),
      detalhe: "abertura → último recebimento",
    },
  ];

  // ---- Formulário de abertura em leitura ----
  const custoPrevisto = Math.round((job.custo_previsto_total ?? 0) * 100) / 100;
  const faturamentoPrevisto =
    Math.round(Number(job.faturamento_previsto ?? 0) * 100) / 100;

  const baseCompetencia = job.data_inicio_prevista ?? hoje;
  const anoAtual = Number(hoje.slice(0, 4));
  const anoDoJob = job.competencia_ano ?? Number(baseCompetencia.slice(0, 4));
  const anos = Array.from(
    new Set([anoAtual, anoDoJob, anoDoJob + 1]),
  ).sort((a, b) => a - b);

  const aguardandoEncerramento =
    job.status === "aberto" && detalhe.envioFaturamento !== null;

  return (
    <div className="mx-auto max-w-[1452px] space-y-5 min-[1600px]:mr-6">
      <div>
        <Link
          href="/financeiro/abertura-de-job"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para Visualizar Jobs
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-semibold text-muted-foreground">
              {job.codigo}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {/* O nome do FINANCEIRO — é a tela dele. A produção continua
                  vendo o nome que cadastrou (`nome_financeiro` vs `nome`). */}
              <h1 className="text-2xl font-bold tracking-tight">
                {jobNaFila.nome}
              </h1>
              <Badge className="border border-blue-200 bg-blue-50 text-blue-700">
                {jobStatusLabel(job.status as JobStatus)}
              </Badge>
              <Badge className={cn("border", situacaoMeta.classes)}>
                {situacaoMeta.rotulo}
              </Badge>
              {aguardandoEncerramento && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                  Aguardando encerramento
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                <Lock className="h-3 w-3" />
                Somente leitura
              </span>
            </div>
          </div>

          {/* Mesmo resumo do cabeçalho da página de Jobs: valor do job,
              custo planejado e realizado com o resultado de cada um. Um
              componente só para os dois lados não divergirem. */}
          {detalhe.itens.length > 0 && (
            <div className="mt-[10px]">
              <ResumoResultado
                valorJob={totaisJob.valorJob}
                imposto={totaisJob.imposto}
                custoPlanejado={custoPlanejadoJob}
                custoRealizado={custoRealizadoJob}
                moeda={versaoAprovada.moeda}
              />
            </div>
          )}
        </div>
      </div>

      <JobFinanceiroTabs
        chatCount={detalhe.naoLidas}
        abertura={
          <AberturaForm
            job={jobNaFila}
            modo="leitura"
            categorias={categoriasRes.data ?? []}
            projetos={projetos}
            contas={contas}
            custoPrevisto={custoPrevisto}
            faturamentoPrevisto={faturamentoPrevisto}
            enviadoPorNome={carregadoParaAbertura.enviadoPorNome}
            curvaInicial={previsoes.curva}
            recebimentoInicial={previsoes.recebimento}
            trimestreSugerido={
              job.competencia_trimestre ?? trimestreDe(baseCompetencia)
            }
            anoSugerido={anoDoJob}
            anos={anos}
            hojeIso={hoje}
            agoraLabel={formatDataHoraBr(new Date())}
            consumo={consumo}
            abertoEmLabel={formatDataHoraBr(job.data_abertura_financeiro)}
            abertoPorNome={detalhe.abertoPorNome}
          />
        }
        info={
          <div className="space-y-4">
            <FichaJob
              descritivo={job.observacoes}
              job={{
                codigo: job.codigo,
                nome: jobNaFila.nome,
                categoriaNome: detalhe.raw.categoria?.nome ?? null,
                produto: job.produto,
                regionalNome: detalhe.raw.regional?.nome ?? null,
                cidade: job.cidade,
                competenciaTrimestre: job.competencia_trimestre,
                competenciaAno: job.competencia_ano,
                dataInicio: job.data_inicio_prevista,
                dataFim: job.data_fim_prevista,
                dataAbertura: job.data_abertura_financeiro,
                abertoPorNome: detalhe.abertoPorNome,
                dataPrevistaFaturamento: job.data_prevista_faturamento,
              }}
              projeto={{
                // O projeto do FINANCEIRO, com fallback no da produção
                // para job anterior à migration 20260820000011. Datas e
                // tipo continuam vindo do projeto da produção: são dados
                // que só existem lá.
                id: jobNaFila.projeto_financeiro_id ?? detalhe.raw.projeto_id,
                codigo:
                  jobNaFila.projeto_financeiro_codigo ??
                  detalhe.raw.projeto?.codigo ??
                  "—",
                nome:
                  jobNaFila.projeto_financeiro_nome ??
                  detalhe.raw.projeto?.nome ??
                  "—",
                clienteNome:
                  detalhe.raw.projeto?.cliente?.nome_fantasia ?? null,
                tipoNome: detalhe.raw.projeto?.categoria?.nome ?? null,
                dataInicio: detalhe.raw.projeto?.data_inicio_prevista ?? null,
                dataFim: detalhe.raw.projeto?.data_fim_prevista ?? null,
              }}
              jobsDoProjeto={jobsDoProjetoFinanceiro}
              jobAtualId={job.id}
              jobLinkSuffix=""
              jobHrefBase="/financeiro/jobs/"
              confirmarSaidaParaOrcamento
              gpNome={detalhe.raw.responsavel?.nome ?? null}
              produtorNome={detalhe.raw.produtor?.nome ?? null}
              origem={{
                // Visão agregada DO FINANCEIRO, não a lista de orçamentos
                // do projeto da produção.
                projetoHref: jobNaFila.projeto_financeiro_id
                  ? `/financeiro/projetos/${jobNaFila.projeto_financeiro_id}`
                  : `/orcamentos/${detalhe.raw.projeto_id}`,
                orcamentoHref: `/orcamentos/${detalhe.raw.projeto_id}/${detalhe.raw.orcamento_id}/versoes/${detalhe.raw.versao_orcamento_aprovada_id}`,
                orcamentoCodigo: detalhe.raw.orcamento?.codigo ?? null,
                versaoLabel: detalhe.versaoLabel,
              }}
              contatos={detalhe.contatosCobranca}
              statusBadgeClasses={() =>
                "bg-blue-50 text-blue-700 border-blue-200"
              }
            />

            <ErratasCard
              erratas={detalhe.erratas}
              valorJobAbertura={job.valor_job_abertura}
              faturamentoPrevistoAbertura={job.faturamento_previsto_abertura}
              valorJobAtual={totaisJob.valorJob}
              faturamentoPrevistoAtual={totaisJob.faturamentoPrevisto}
              moeda={versaoAprovada.moeda}
            />
          </div>
        }
        planilha={
          /* Sempre em leitura: quem edita realizado, BV e PP é a produção,
             na página de Jobs. O financeiro confere. */
          <JobRealizadoSection
            job={{
              id: job.id,
              status: job.status,
              projeto_id: job.projeto_id,
              orcamento_id: job.orcamento_id,
              versao_orcamento_aprovada_id: job.versao_orcamento_aprovada_id,
              empresa_id: job.empresa_id,
              responsavel_id: job.responsavel_id,
            }}
            nomeJob={jobNaFila.nome}
            versao={{
              id: versaoAprovada.id,
              numero_versao: versaoAprovada.numero_versao,
              moeda: versaoAprovada.moeda,
              percentual_honorarios: Number(
                versaoAprovada.percentual_honorarios,
              ),
              percentual_imposto: Number(versaoAprovada.percentual_imposto),
            }}
            grupos={detalhe.grupos}
            itens={detalhe.itens}
            realizadosMap={detalhe.realizadosMap}
            categoriasMap={detalhe.categoriasMap}
            editable={false}
            podeAcoes={false}
            ppsPorItemId={detalhe.ppsPorItemId}
            fornecedores={detalhe.fornecedores}
            empresas={detalhe.empresas}
            bvsPorItem={detalhe.bvsPorItem}
          />
        }
        fluxo={
          <FluxoCaixaDoJob
            fluxo={fluxo}
            prazos={prazos}
            moeda={versaoAprovada.moeda}
          />
        }
        chat={
          <JobChatSection
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={detalhe.threadChat}
            naoLidas={detalhe.naoLidas}
            minhaArea={areaDoPapel(session.activeRole)}
          />
        }
      />
    </div>
  );
}
