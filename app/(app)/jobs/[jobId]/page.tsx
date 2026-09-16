import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Undo2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { nomeVersao } from "@/lib/nome-versao";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { listActiveMembers } from "@/lib/data/members";
import { contatosDeCobrancaDoJob } from "@/lib/data/contatos-cobranca";
import type { Job, JobStatus, Regional } from "@/lib/types";
import {
  jobStatusLabel,
  JOB_STATUS_TRANSICOES,
  AREA_PRODUCAO,
  jobEstaCongelado,
  jobAceitaRealizado,
  jobAceitaAcoesPlanilha,
  PP_STATUS_EM_ABERTO,
  BV_SITUACAO_EM_ABERTO, jobStatusBadgeClasses } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ResumoResultado } from "@/components/resumo-resultado";
import { cn } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularTotaisRealizado,
} from "@/lib/calculos/versao-totais";
import { JobEditorDrawer } from "./job-editor-drawer";
import { BarraAcoesJob } from "./barra-acoes-job";
import { FichaJob } from "./ficha-job";
import { JobRealizadoSection } from "./realizado/job-realizado-section";
import { JobPPsSection } from "./pps/job-pps-section";
import { JobTabs } from "./job-tabs";
import { ErratasCard } from "./erratas-card";
import { JobChatSection } from "./comunicacao/job-chat-section";
import { carregarDetalheDoJob } from "./carregar-detalhe";

import { montarThreadChat } from "@/lib/data/job-chat";
import { montarThreadChatPPs } from "@/lib/data/job-chat-pps";
import { JobPPsChatFab } from "./pps/job-pps-chat-fab";
import type {
  VersaoOrcamentoGrupo,
  ItemPlanilhaJob,
  JobItemRealizado,
  JobErrataComItens,
  PedidoCompra,
  PedidoCompraNaLista,
  Categoria,
  ItemBv,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const statusBadgeClasses = jobStatusBadgeClasses;

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: { jobId: string };
  searchParams?: { from?: string; aba?: string; mes?: string };
}) {
  const session = await requireSession();
  const fromParam = searchParams?.from;
  const jobLinkSuffix =
    fromParam === "jobs" || fromParam === "financeiro"
      ? `?from=${fromParam}`
      : "";

  // Quem chega de fora pode apontar para uma aba específica — a
  // conferência do financeiro manda direto para a Planilha Interna.
  const abaInicial =
    searchParams?.aba === "planilha" ||
    searchParams?.aba === "pps" ||
    searchParams?.aba === "chat"
      ? searchParams.aba
      : "info";

  const detalhe = await carregarDetalheDoJob(session, params.jobId);
  if (!detalhe) notFound();

  const {
    raw,
    job,
    grupos,
    itens,
    realizadosMap,
    categoriasMap,
    erratas,
    versaoAprovada,
    versaoLabel,
    regionais,
    responsaveis,
    contatosCobranca,
    ppsDoJob,
    ppsPorItemId,
    fornecedores,
    fornecedoresPorId,
    empresas,
    bvsPorItem,
    threadChat,
    naoLidas,
    threadChatPPs,
    naoLidasPPs,
    envioFaturamento,
    podeEnviarFaturamento,
    pagoSoPorSave,
    portaisDoCliente,
    jobsDoProjeto,
    abertoPorNome,
    competencias,
    totaisJob,
    custoPlanejadoJob,
    custoRealizadoJob,
    bvPlanejadoJob,
    bvRealizadoJob,
    podeEditarRealizado,
    podeAcoesPlanilha,
    podeGerarPP,
    podeEnviarPP,
    podeConfirmarBv,
    ppsQuePossoPrestarContas,
  } = detalhe;


  const backLink =
    fromParam === "jobs"
      ? { href: "/jobs", label: "Voltar para jobs" }
      : fromParam === "financeiro"
        ? {
            href: "/financeiro/abertura-de-job",
            label: "Voltar para aprovações",
          }
        : {
            href: `/orcamentos/${raw.projeto_id}/${raw.orcamento_id}`,
            label: `Voltar para orçamento ${raw.orcamento?.codigo}`,
          };

  // Sem largura própria: tela principal ocupa a largura do layout (decisão 085).
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backLink.href}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          {backLink.label}
        </Link>
        {/* O resumo tem largura fixa e fica ancorado à direita: quem cede
            espaço para nome longo é a coluna do título, que quebra dentro
            de si mesma (min-w-0 permite o encolhimento). */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-semibold text-muted-foreground">{job.codigo}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{job.nome}</h1>
              <Badge className={cn("border", statusBadgeClasses(job.status))}>
                {jobStatusLabel(job.status)}
              </Badge>
              {/* Encerrado e cancelado sao historico: sem edicao. Papeis
                  sem `jobs.editar_metadata` (Financeiro, Freelancer) tambem
                  nao veem o botao. */}
              {!jobEstaCongelado(job.status) &&
                pode(session.activeRole, "jobs.editar_metadata") && (
                  <JobEditorDrawer
                    job={job}
                    regionais={regionais}
                    responsaveis={responsaveis}
                  />
                )}
            </div>
          </div>

          {/* Alinha o topo do resumo com o topo das LETRAS do nome do job,
              não com o topo do bloco: 16px da linha do código + 4px do mt-1
              + 7px de folga entre a caixa de linha do h1 (text-3xl/36px) e
              o topo das maiúsculas da Inter. Medido no navegador. */}
          {itens.length > 0 && (
            <div className="mt-[27px]">
              <ResumoResultado
                valorJob={totaisJob.valorJob}
                deducoes={totaisJob.deducoesDoResultado}
                custoPlanejado={custoPlanejadoJob}
                custoRealizado={custoRealizadoJob}
                bvRealizado={bvRealizadoJob}
                moeda={versaoAprovada.moeda}
              />
            </div>
          )}
        </div>
      </div>

      {/* Devolvido pelo financeiro. A revisão e o reenvio acontecem no
          ORÇAMENTO, onde o formulário de abertura mora (decisão 057) — o
          antigo "Reenviar pra aprovação", que só trocava o status daqui,
          saiu em 08/09/2026. */}
      {job.status === "rejeitado_financeiro" && (
        <div className="rounded-2xl border border-california-red/30 bg-california-red/5 p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wider text-california-red mb-2">
            Motivo da rejeição pelo financeiro
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {job.motivo_rejeicao?.trim() || "— sem motivo informado"}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            A abertura é revisada e reenviada pelo orçamento: o formulário
            abre preenchido com o que foi enviado desta vez.
          </p>
          {pode(session.activeRole, "jobs.editar_metadata") && (
            <div className="mt-4">
              <Link
                href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}?v=${job.versao_orcamento_aprovada_id}&abertura=revisar`}
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
              >
                <Undo2 className="h-4 w-4" />
                Revisar abertura
              </Link>
            </div>
          )}
        </div>
      )}

      <JobTabs
        abaInicial={abaInicial}
        info={
          <div className="space-y-4">
            <FichaJob
              descritivo={job.observacoes}
              job={{
                codigo: job.codigo,
                nome: job.nome,
                categoriaNome: raw.categoria?.nome ?? null,
                // Serviço do job = `jobs.servico_id` (gravado na abertura,
                // decisão 055), com o do orçamento como fallback. Antes
                // esta ficha lia a categoria do PROJETO, que virou legada
                // em 02/09/2026 e fica vazia em projeto novo.
                servicoNome:
                  raw.servico?.nome ?? raw.orcamento?.servico?.nome ?? null,
                produto: job.produto,
                regionalNome: raw.regional?.nome ?? null,
                cidade: job.cidade,
                competenciaTrimestre: job.competencia_trimestre,
                competenciaAno: job.competencia_ano,
                competencias,
                dataInicio: job.data_inicio_prevista,
                dataFim: job.data_fim_prevista,
                dataAbertura: job.data_abertura_financeiro,
                abertoPorNome,
                dataPrevistaFaturamento: job.data_prevista_faturamento,
              }}
              projeto={{
                id: raw.projeto_id,
                codigo: raw.projeto?.codigo ?? "—",
                nome: raw.projeto?.nome ?? "—",
                // Cliente de verdade, do cadastro — antes desta tela o card
                // rotulava "Cliente" e mostrava o nome do PROJETO.
                clienteNome: raw.projeto?.cliente?.nome_fantasia ?? null,
                dataInicio: raw.projeto?.data_inicio_prevista ?? null,
                dataFim: raw.projeto?.data_fim_prevista ?? null,
              }}
              jobsDoProjeto={jobsDoProjeto}
              jobAtualId={job.id}
              jobLinkSuffix={jobLinkSuffix}
              gpNome={raw.responsavel?.nome ?? null}
              produtorNome={raw.produtor?.nome ?? null}
              origem={{
                projetoHref: `/orcamentos/${raw.projeto_id}`,
                // Aponta para a VERSÃO, não para o orçamento: o rótulo é
                // "Orçamento aprovado", e o que foi aprovado é a versão. A
                // tela da versão tem o caminho de volta ao orçamento.
                orcamentoHref: `/orcamentos/${raw.projeto_id}/${raw.orcamento_id}/versoes/${raw.versao_orcamento_aprovada_id}`,
                orcamentoCodigo: raw.orcamento?.codigo ?? null,
                versaoLabel,
              }}
              contatos={contatosCobranca}
              statusBadgeClasses={statusBadgeClasses}
            />

            <ErratasCard
              erratas={erratas}
              valorJobAbertura={
                raw.valor_job_abertura !== null &&
                raw.valor_job_abertura !== undefined
                  ? Number(raw.valor_job_abertura)
                  : null
              }
              faturamentoPrevistoAbertura={
                raw.faturamento_previsto_abertura !== null &&
                raw.faturamento_previsto_abertura !== undefined
                  ? Number(raw.faturamento_previsto_abertura)
                  : null
              }
              // Recalculados dos itens, não lidos de `jobs.valor_total`: a
              // coluna é um espelho denormalizado e o card não pode divergir
              // da planilha logo acima.
              valorJobAtual={totaisJob.valorJob}
              faturamentoPrevistoAtual={totaisJob.faturamentoPrevisto}
              moeda={versaoAprovada.moeda}
            />
          </div>
        }
        planilha={
          <JobRealizadoSection
            savePorItem={detalhe.savePorItem}
            saldosDeSave={detalhe.saldosDeSave}
            clienteNome={detalhe.clienteNome}
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
            nomeJob={raw.orcamento?.nome ?? job.nome}
            versao={{
              id: versaoAprovada.id,
              numero_versao: versaoAprovada.numero_versao,
              moeda: versaoAprovada.moeda,
              percentual_honorarios: Number(versaoAprovada.percentual_honorarios),
              percentual_imposto: Number(versaoAprovada.percentual_imposto),
              percentual_int_taxes: Number(versaoAprovada.percentual_int_taxes ?? 0),
              int_transaction_costs: Number(
                versaoAprovada.int_transaction_costs ?? 0,
              ),
              moeda_estrangeira: versaoAprovada.moeda_estrangeira ?? null,
              cambio_compra:
                versaoAprovada.cambio_compra === null ||
                versaoAprovada.cambio_compra === undefined
                  ? null
                  : Number(versaoAprovada.cambio_compra),
            }}
            modeloPlanilha={detalhe.modeloPlanilha}
            // Modelo mensal (decisão 078): a régua de meses troca de mês
            // pela URL, sempre na aba da planilha.
            meses={detalhe.meses}
            faturamentoMensal={detalhe.faturamentoMensal}
            mesPedido={searchParams?.mes}
            hrefPlanilha={`/jobs/${job.id}?aba=planilha${
              fromParam === "jobs" || fromParam === "financeiro"
                ? `&from=${fromParam}`
                : ""
            }`}
            grupos={grupos}
            itens={itens}
            realizadosMap={realizadosMap}
            categoriasMap={categoriasMap}
            podeAcoes={podeAcoesPlanilha}
            podeGerarPP={podeGerarPP}
            podeConfirmarBv={podeConfirmarBv}
            jaEnviadoParaFaturamento={envioFaturamento !== null}
            aberturaEmRevisao={job.abertura_em_revisao}
            ppsPorItemId={ppsPorItemId}
            fornecedores={fornecedores}
            empresas={empresas}
            responsaveis={responsaveis}
            bvsPorItem={bvsPorItem}
          />
        }
        ppsCount={ppsDoJob.filter((p) => p.status !== "cancelada").length}
        pps={
          <JobPPsSection
            pps={ppsDoJob}
            fornecedoresPorId={fornecedoresPorId}
            fornecedores={fornecedores}
            empresas={empresas}
            responsaveis={responsaveis}
            editable={podeGerarPP}
            podeEnviar={podeEnviarPP}
            podePrestarContas={ppsQuePossoPrestarContas}
          />
        }
        ppsChat={
          <JobPPsChatFab
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={threadChatPPs}
            minhaArea={AREA_PRODUCAO}
            naoLidasIniciais={naoLidasPPs}
            podeEnviar={pode(session.activeRole, "chat.enviar")}
          />
        }
        chatCount={naoLidas}
        chat={
          <JobChatSection
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={threadChat}
            naoLidas={naoLidas}
            minhaArea={AREA_PRODUCAO}
            podeEnviar={pode(session.activeRole, "chat.enviar")}
          />
        }
      />

      {/* Fora das abas de propósito: as ações são do job, não da aba de
          Informações. Substitui o card "Status", que vivia no corpo da aba
          — ver <BarraAcoesJob>. */}
      <BarraAcoesJob
        jobId={job.id}
        jobCodigo={job.codigo}
        status={job.status}
        orcamentoHref={`/orcamentos/${job.projeto_id}/${job.orcamento_id}?v=${job.versao_orcamento_aprovada_id}`}
        podeEnviarFaturamento={podeEnviarFaturamento}
        aberturaEmRevisao={job.abertura_em_revisao}
        faturamentoPrevisto={totaisJob.faturamentoPrevisto}
        // Dos itens, e não da coluna `jobs.faturamento_save_previsto`: a
        // coluna é espelho denormalizado, e o drawer não pode divergir da
        // planilha que está logo acima dele.
        faturamentoSavePrevisto={totaisJob.save.receita}
        pagoSoPorSave={pagoSoPorSave}
        dataPrevistaFaturamento={job.data_prevista_faturamento}
        portais={portaisDoCliente}
        moeda={versaoAprovada.moeda}
        faturamentoPorMes={detalhe.modeloPlanilha === "mensal"}
        faturamentoMensal={detalhe.faturamentoMensal}
        podeEnviarFaturamentoMensal={detalhe.podeEnviarFaturamentoMensal}
        faturamentoEnvioUnico={detalhe.faturamentoEnvioUnico}
        fechamento={detalhe.fechamento}
        podeEncerrar={detalhe.podeEncerrar}
        // O card de Totais do fechamento (decisão 087) usa os mesmos dados
        // da Planilha Interna — nenhuma consulta nova.
        totais={{
          itens,
          realizadosMap,
          bvsPorItem,
          jobAberto:
            job.status !== "aguardando_abertura" &&
            job.status !== "rejeitado_financeiro",
          percentualHonorarios: Number(versaoAprovada.percentual_honorarios),
          percentualImposto: Number(versaoAprovada.percentual_imposto),
          moeda: versaoAprovada.moeda,
          modeloPlanilha: detalhe.modeloPlanilha,
          internacional: detalhe.internacional,
          moedaEstrangeira: detalhe.moedaEstrangeira,
        }}
      />
    </div>
  );
}
