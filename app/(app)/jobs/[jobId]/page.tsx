import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { nomeVersao } from "@/lib/nome-versao";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import { contatosDeCobrancaDoJob } from "@/lib/data/contatos-cobranca";
import type { Job, JobStatus, Regional } from "@/lib/types";
import {
  jobStatusLabel,
  JOB_STATUS_TRANSICOES,
  areaDoPapel,
  jobEstaCongelado,
  jobAceitaRealizado,
  jobAceitaAcoesPlanilha,
  PP_STATUS_EM_ABERTO,
  BV_SITUACAO_EM_ABERTO,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ResumoResultado } from "@/components/resumo-resultado";
import { cn } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularTotaisRealizado,
} from "@/lib/calculos/versao-totais";
import { JobEditorDrawer } from "./job-editor-drawer";
import type { ResumoEncerramento } from "./encerrar-dialog";
import { ReenviarAprovacaoButton } from "./reenviar-aprovacao-button";
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

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "encerrado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
    case "aguardando_abertura":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "rejeitado_financeiro":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: { jobId: string };
  searchParams?: { from?: string; aba?: string };
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
    transicoes,
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
    totaisJob,
    custoPlanejadoJob,
    custoRealizadoJob,
    bvPlanejadoJob,
    bvRealizadoJob,
    resumoEncerramento,
    podeEditarRealizado,
    podeAcoesPlanilha,
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

  // Mais largo que o padrão do app (max-w-7xl = 1280px): a Planilha Interna
  // tem tabela de 15 colunas que não cabia em 1280 depois da calha reservada
  // pra trilha de BV/PP. 1452 resolve com folga, sem ir ao máximo de 1600 que
  // o layout permite.
  //
  // 1452 e não 1440: quando o "+BV" quadrado virou a pílula "Adicionar BV" a
  // calha cresceu 12px, e esses 12px vieram da folga da página — não da
  // tabela. A planilha tem exatamente a mesma largura útil de antes.
  //
  // O `mr-6` só entra a partir de 1600px, que é onde passa a sobrar folga dos
  // dois lados: encosta um pouco mais na direita e afasta da sidebar. Abaixo
  // disso segue centralizado — aplicar a margem ali roubaria 24px da tabela e
  // ela voltaria a cortar.
  return (
    <div className="space-y-6 max-w-[1452px] mx-auto min-[1600px]:mr-6">
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
              {/* Encerrado e cancelado são histórico: sem edição. */}
              {!jobEstaCongelado(job.status) && (
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
                imposto={totaisJob.imposto}
                custoPlanejado={custoPlanejadoJob}
                custoRealizado={custoRealizadoJob}
                bvPlanejado={bvPlanejadoJob}
                bvRealizado={bvRealizadoJob}
                moeda={versaoAprovada.moeda}
              />
            </div>
          )}
        </div>
      </div>

      {job.status === "rejeitado_financeiro" && job.motivo_rejeicao && (
        <div className="rounded-2xl border border-california-red/30 bg-california-red/5 p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wider text-california-red mb-2">
            Motivo da rejeição pelo financeiro
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{job.motivo_rejeicao}</p>
          <div className="mt-4">
            <ReenviarAprovacaoButton jobId={job.id} />
          </div>
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
                produto: job.produto,
                regionalNome: raw.regional?.nome ?? null,
                cidade: job.cidade,
                competenciaTrimestre: job.competencia_trimestre,
                competenciaAno: job.competencia_ano,
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
                // Categoria do projeto (`categorias_dominio`, escopo
                // 'projeto'). Não confundir com a categoria do job, que sai
                // do mesmo catálogo mas do escopo 'orcamento'.
                tipoNome: raw.projeto?.categoria?.nome ?? null,
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
            }}
            grupos={grupos}
            itens={itens}
            realizadosMap={realizadosMap}
            categoriasMap={categoriasMap}
            podeAcoes={podeAcoesPlanilha}
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
            editable={podeAcoesPlanilha}
          />
        }
        ppsChat={
          <JobPPsChatFab
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={threadChatPPs}
            minhaArea={areaDoPapel(session.activeRole)}
            naoLidasIniciais={naoLidasPPs}
          />
        }
        chatCount={naoLidas}
        chat={
          <JobChatSection
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={threadChat}
            naoLidas={naoLidas}
            minhaArea={areaDoPapel(session.activeRole)}
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
        transicoes={transicoes}
        envioFaturamento={envioFaturamento}
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
        resumoEncerramento={resumoEncerramento}
      />
    </div>
  );
}
