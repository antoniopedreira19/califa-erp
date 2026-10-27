import Link from "next/link";
import { FaixaDoProjeto } from "@/components/faixa-do-projeto";
import { itensDeJobs } from "@/lib/faixa-do-projeto";
import { notFound, redirect } from "next/navigation";
import { Undo2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { nomeVersao } from "@/lib/nome-versao";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { listActiveMembers } from "@/lib/data/members";
import { contatosDeCobrancaDoJob } from "@/lib/data/contatos-cobranca";
import type { Job, JobStatus, Regional } from "@/lib/types";
import { nomeDoCartaoCorporativo, rotuloDaVerba, tipoDaVerba } from "@/lib/types";
import {
  jobStatusLabel,
  jobStatusExibido,
  AREA_PRODUCAO,
  jobEstaCongelado,
  jobAceitaRealizado,
  jobAceitaAcoesPlanilha,
  PP_STATUS_EM_ABERTO,
  BV_SITUACAO_EM_ABERTO, jobStatusBadgeClasses } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ResumoResultado } from "@/components/resumo-resultado";
import { cn } from "@/lib/utils";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularTotaisRealizado,
} from "@/lib/calculos/versao-totais";
import { BotaoEquipe } from "../_equipe/equipe-dialog";
import { carregarEquipeDoJob } from "@/lib/data/equipe-do-projeto";
import { BarraAcoesJob } from "./barra-acoes-job";
import { FichaJob } from "./ficha-job";
import { JobRealizadoSection } from "./realizado/job-realizado-section";
import { JobPPsSection } from "./pps/job-pps-section";
import { JobTabs } from "./job-tabs";
import { ErratasCard } from "./erratas-card";
import { AlteracoesFinanceiroCard } from "./alteracoes-financeiro-card";
import { JobChatSection } from "./comunicacao/job-chat-section";
import { carregarDetalheDoJob } from "./carregar-detalhe";
import { cancelamentoDoJob, travaDoCancelamento } from "@/lib/data/cancelamentos";
import { MenuDoJob } from "./cancelamento/menu-do-job";
import type { PPDoPedido } from "./cancelamento/solicitar-cancelamento-dialog";
import {
  FaixaCancelamentoRecusado,
  FaixaCancelamentoSolicitado,
} from "./cancelamento/faixas-do-cancelamento";

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
import { SeloMidiaSystem } from "../_midia-system/midia-system";

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

  // O pedido de cancelamento (decisão 169) corre junto do detalhe: são
  // leituras independentes. A trava só interessa a quem pode pedir.
  const supabaseDoPedido = createClient();
  const podePedirCancelamento = pode(session.activeRole, "jobs.solicitar_cancelamento");
  const [detalhe, cancelamento, travaDoPedido, equipe] = await Promise.all([
    carregarDetalheDoJob(session, params.jobId),
    cancelamentoDoJob(supabaseDoPedido, session.activeTenant.id, params.jobId),
    podePedirCancelamento
      ? travaDoCancelamento(supabaseDoPedido, params.jobId)
      : Promise.resolve(null),
    // O botão "Equipe" (decisão 174).
    carregarEquipeDoJob(supabaseDoPedido, session.activeTenant.id, params.jobId),
  ]);
  if (!detalhe) notFound();

  // Job cancelado não existe no módulo de Jobs (decisões 113 e 163). Antes
  // da abertura, o orçamento voltou a "aprovado"; depois dela, o orçamento
  // aparece como "Cancelado". Quem chega por link antigo vai para lá.
  if (detalhe.job.status === "cancelado") {
    redirect(`/orcamentos/${detalhe.raw.projeto_id}/${detalhe.raw.orcamento_id}`);
  }

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
    responsaveis,
    contatosCobranca,
    ppsDoJob,
    ppsPorItemId,
    aEmitirPorItemId,
    tomadoresDaNf,
    tomadorPorEmpresa,
    cnpjPadraoDaPP,
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
    podeMexerNoSave,
    podeExportarInterna,
    podeGerarPP,
    podeCadastrarFornecedor,
    podeEditarFornecedor,
    podeEnviarPP,
    linhasComEnvioTravado,
    papelEnviaPP,
    papelCorrigeNf,
    etapasDoJob,
    podeConfirmarBv,
    ppsQuePossoPrestarContas,
    papelNaErrata,
    errataPronta,
  } = detalhe;


  // Sem "Voltar para aprovações" desde a decisão 099 (22/09/2026): a
  // produção não tem link para o financeiro — os módulos são isolados.
  // Desde a decisão 106 o voltar mora na faixa do projeto, e desde a 108
  // ele leva à página anterior. Isto é só a reserva, para quando não há
  // página anterior (link colado, aba nova): a lista para quem veio com
  // `?from=jobs`, o orçamento para os outros.
  const reservaDoVoltar =
    fromParam === "jobs" ? "/jobs" : `/orcamentos/${raw.projeto_id}/${raw.orcamento_id}`;

  // Sem largura própria: tela principal ocupa a largura do layout (decisão 085).
  // O selo do cabeçalho: "Em faturamento" é o aberto com o envio completo
  // (decisão 094). As travas continuam lendo `job.status`.
  // Com o pedido de cancelamento no financeiro (decisão 169) o job fica
  // parado: o selo diz isso, e nada novo nasce nele — as portas abaixo se
  // fecham na tela, e os gatilhos do banco as fecham de novo.
  const jobAberto = job.status === "aberto" || job.status === "em_producao";
  const comPedido = cancelamento.pendente !== null && jobAberto;
  const statusExibido = jobStatusExibido(job.status, job.faturamento_enviado_em, comPedido);
  // O menu "⋯" do pedido: GP e administrador, job já aberto pelo financeiro
  // e sem pedido no ar.
  const mostraMenuDoJob =
    podePedirCancelamento && jobAberto && !comPedido && job.data_abertura_financeiro !== null;
  const ppsDoPedido: PPDoPedido[] = ppsDoJob
    .filter((pp) => pp.status !== "cancelada")
    .map((pp) => ({
      id: pp.id,
      codigo: pp.codigo,
      quem: pp.verba_producao
        ? rotuloDaVerba(tipoDaVerba(pp) ?? "producao")
        : pp.cartao_corporativo
          ? nomeDoCartaoCorporativo(pp.cartao_plataforma)
          : (pp.fornecedor_id ? fornecedoresPorId[pp.fornecedor_id] : null) ?? "—",
      valor: Number(pp.valor ?? 0),
      status: pp.status as PPDoPedido["status"],
    }));

  return (
    <div className="space-y-6">
      <div>
        {/* Faixa do projeto (decisão 106): a agregada e os jobs do projeto,
            os mesmos da agregada — sem os cancelados, menos este. */}
        <FaixaDoProjeto
          modulo="jobs"
          reservaDoVoltar={reservaDoVoltar}
          projeto={{
            nome: raw.projeto?.nome ?? "",
          }}
          agregadaHref={`/jobs/projeto/${raw.projeto_id}`}
          itens={itensDeJobs(
            "/jobs/",
            jobsDoProjeto,
            job.id,
            (status) => status !== "cancelado",
          )}
          ativo={job.id}
        />
        {/* O resumo tem largura fixa e fica ancorado à direita. O título
            cede espaço quebrando dentro da própria coluna, mas nunca abaixo
            de 18rem: sem esse piso (era `min-w-0` com `flex-1`, base 0)
            a linha nunca quebrava e, com a janela estreita, o card cobria
            o nome. Com o piso, quando os dois não cabem, o resumo desce
            para a linha de baixo — como na agregada de Orçamentos. */}
        <div className="mt-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-[18rem] flex-1">
            <p className="font-mono text-xs font-semibold text-muted-foreground">{job.codigo}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{job.nome}</h1>
              <Badge className={cn("border", statusBadgeClasses(statusExibido))}>
                {jobStatusLabel(statusExibido)}
              </Badge>
              {/* Decisão 216: o job auditado pelo cliente. */}
              <SeloMidiaSystem midia={detalhe.midiaSystem} />
              {/* O "Editar" saiu na decisão 174: depois da abertura, o job
                  não muda. No lugar dele, a Equipe — membros do projeto,
                  responsáveis do job e a chave do envio de PP pelo
                  Produtor Responsável. */}
              {equipe && (
                <BotaoEquipe
                  equipe={equipe}
                  jobId={job.id}
                  podeMudarMembros={pode(session.activeRole, "projetos.editar_equipe")}
                  podeMudarChave={pode(session.activeRole, "jobs.liberar_envio_pp_produtor")}
                  podeTrocarResponsaveis={pode(session.activeRole, "jobs.trocar_responsaveis")}
                />
              )}
              {mostraMenuDoJob && (
                <MenuDoJob
                  jobId={job.id}
                  jobCodigo={job.codigo}
                  pps={ppsDoPedido}
                  travaForaDasPPs={travaDoPedido}
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
                // Só o valor do job de hoje (volta atrás da decisão 151, em
                // 15/10/2026): o da abertura fica no card de Erratas e no
                // histórico da planilha.
                abertura={null}
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
          {/* Quando, sem o nome de quem devolveu (decisão 136, pedido do
              Tiago): a produção fala com o financeiro, não com a pessoa. */}
          {job.devolvido_em && (
            <p className="mb-2 text-[13px] text-muted-foreground">
              Devolvido pelo Financeiro em {formatDataAsHoraBr(job.devolvido_em)}
            </p>
          )}
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {job.motivo_rejeicao?.trim() || "— sem motivo informado"}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            A abertura é revisada e reenviada pelo orçamento: o formulário
            abre preenchido com o que foi enviado desta vez.
          </p>
          {pode(session.activeRole, "jobs.enviar_abertura") && (
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

      {/* O pedido de cancelamento no ar e a recusa ainda não lida (decisão
          169), no mesmo lugar da devolução da abertura. */}
      {comPedido && cancelamento.pendente && (
        <FaixaCancelamentoSolicitado
          pedido={cancelamento.pendente}
          podeRetirar={podePedirCancelamento}
        />
      )}
      {!comPedido && jobAberto && cancelamento.recusaNaoVista && (
        <FaixaCancelamentoRecusado
          pedido={cancelamento.recusaNaoVista}
          podeDispensar={
            session.activeRole === "administrador" ||
            session.activeRole === "gerente_producao" ||
            session.activeRole === "produtor"
          }
        />
      )}

      <JobTabs
        abaInicial={abaInicial}
        info={
          <div className="space-y-4">
            <FichaJob
              descritivo={job.observacoes}
              etapas={etapasDoJob}
              job={{
                codigo: job.codigo,
                nome: job.nome,
                // O cliente do job (decisão 215): o do orçamento, do
                // cadastro de clientes.
                clienteNome: raw.cliente?.nome_fantasia ?? null,
                // Categoria do job = `jobs.categoria_id`, que só é gravado
                // quando o financeiro abre o job (e a abertura a exige).
                // Na fila, ou devolvido, vale a do orçamento — a mesma
                // regra da aba Informações da abertura (decisão 111). Job
                // aberto nunca cai no fallback: a dele já está gravada.
                categoriaNome:
                  raw.categoria?.nome ?? raw.orcamento?.categoria?.nome ?? null,
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
                semFaturamento: Number(job.faturamento_previsto ?? 0) <= 0.004,
              }}
              projeto={{
                id: raw.projeto_id,
                nome: raw.projeto?.nome ?? "—",
                dataInicio: raw.projeto?.data_inicio_prevista ?? null,
                dataFim: raw.projeto?.data_fim_prevista ?? null,
                apresentacoes: detalhe.apresentacoesDoProjeto,
              }}
              jobsDoProjeto={
                comPedido
                  ? jobsDoProjeto.map((j) => (j.id === job.id ? { ...j, status: statusExibido } : j))
                  : jobsDoProjeto
              }
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
              // A errata pronta para envio (decisão 159) entra no topo.
              pronta={errataPronta}
            />

            {/* As edições do orçado feitas pelo financeiro (decisão 115):
                a produção vê o que mudou e quem mudou. O card só existe
                depois da primeira. */}
            <AlteracoesFinanceiroCard
              alteracoes={detalhe.alteracoesFinanceiro}
              moeda={versaoAprovada.moeda}
            />
          </div>
        }
        planilha={
          <JobRealizadoSection
            confirmarSaidaParaOrcamento={false}
            // O "Editar orçado" é do financeiro (decisão 115); aqui a
            // produção corrige pela errata.
            edicaoDoFinanceiro={null}
            // O Totais fecha sobre o job de hoje (15/10/2026).
            aberturaDoJob={null}
            // Decisão 159: o GP registra a errata; o produtor a deixa
            // pronta para envio.
            papelNaErrata={comPedido ? null : papelNaErrata}
            errataPronta={errataPronta}
            midia={detalhe.midia}
            // O histórico de versões da planilha (decisão 186).
            comHistorico
            interno={detalhe.interno}
            podeCadastrarFornecedor={podeCadastrarFornecedor}
            podeEditarFornecedor={podeEditarFornecedor}
            savePorItem={detalhe.savePorItem}
            saldosDeSave={detalhe.saldosDeSave}
            clienteNome={detalhe.clienteNome}
            // O destaque é da planilha do financeiro, na aprovação de save
            // (decisão 099): a produção não destaca linha nenhuma.
            destacarItens={[]}
            linhasDaRevisao={[]}
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
            podeAcoes={podeAcoesPlanilha && !comPedido}
            podeMexerNoSave={podeMexerNoSave && !comPedido}
            podeExportarInterna={podeExportarInterna}
            podeGerarPP={podeGerarPP && !comPedido}
            podeGerarAcimaDoOrcado={session.activeRole === "administrador"}
            papelEnviaPP={papelEnviaPP && !comPedido}
            papelCorrigeNf={papelCorrigeNf}
            ppsQuePossoPrestarContas={ppsQuePossoPrestarContas}
            midiaSystem={detalhe.midiaSystem}
            podeConfirmarBv={podeConfirmarBv && !comPedido}
            jaEnviadoParaFaturamento={envioFaturamento !== null}
            linhasComEnvioTravado={linhasComEnvioTravado}
            ppsPorItemId={ppsPorItemId}
            aEmitirPorItemId={aEmitirPorItemId}
            tomadoresDaNf={tomadoresDaNf}
            tomadorPorEmpresa={tomadorPorEmpresa}
            cnpjPadraoDaPP={cnpjPadraoDaPP}
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
            editable={podeGerarPP && !comPedido}
            podeEnviar={podeEnviarPP && !comPedido}
            papelEnviaPP={papelEnviaPP && !comPedido}
            podePrestarContas={ppsQuePossoPrestarContas}
            midiaSystem={detalhe.midiaSystem}
            // Decisão 160: o envio, o formulário e a PP ao lado dos
            // documentos também pela aba — com o que o painel do item usa.
            statusDoJob={job.status}
            // Decisão 185: a revisão da abertura trava só as linhas que a
            // errata mudou — aqui pelo realizado, que é a chave da PP.
            realizadosComEnvioTravado={linhasComEnvioTravado.flatMap((id) => {
              const realizado = realizadosMap.get(id);
              return realizado ? [realizado.id] : [];
            })}
            tomadoresDaNf={tomadoresDaNf}
            tomadorPorEmpresa={tomadorPorEmpresa}
            empresas={empresas}
            planejadoPorItem={Object.fromEntries(
              itens.flatMap((it) => {
                const realizado = realizadosMap.get(it.id);
                return realizado ? [[realizado.id, Number(it.total_planejado ?? 0)]] : [];
              }),
            )}
            // Decisão 173: a PP gerada se edita também pela aba, no mesmo
            // formulário do painel do item — com o que o painel recebe.
            edicaoDaPP={
              podeGerarPP && !comPedido
                ? {
                    podeGerarAcimaDoOrcado: session.activeRole === "administrador",
                    jobId: job.id,
                    jobEmpresaId: job.empresa_id ?? "",
                    fornecedores,
                    empresas,
                    podeCadastrarFornecedor,
                    podeEditarFornecedor,
                    cnpjPadraoDaPP,
                    // Revisão da 153 (19/10/2026): o "Reemitir PP" da aba
                    // abre o formulário na PP a emitir que voltou.
                    aEmitirReemitidas: [...aEmitirPorItemId.values()]
                      .flat()
                      .filter((a) => a.refaz !== null),
                    itens: Object.fromEntries(
                      itens.flatMap((it) => {
                        const realizado = realizadosMap.get(it.id);
                        return realizado
                          ? [
                              [
                                realizado.id,
                                {
                                  nome: it.item,
                                  orcado: Number(it.total_orcado ?? 0),
                                  realizado: Number(realizado.total_realizado ?? 0),
                                  planejado: Number(it.total_planejado ?? 0),
                                  unitario: Number(it.valor_unitario_planejado ?? 0),
                                  quantidade: Number(it.quantidade_planejada ?? 0),
                                  diasMeses: Number(it.dias_meses_planejado ?? 0),
                                  concluido: realizado.pps_concluidas_em != null,
                                },
                              ],
                            ]
                          : [];
                      }),
                    ),
                  }
                : null
            }
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
        podeEnviarFaturamento={podeEnviarFaturamento && !comPedido}
        aberturaEmRevisao={job.abertura_em_revisao}
        // Errata pronta parada trava o envio para faturamento (decisão 159).
        errataProntaParada={errataPronta !== null}
        faturamentoPrevisto={totaisJob.faturamentoPrevisto}
        // Dos itens, e não da coluna `jobs.faturamento_save_previsto`: a
        // coluna é espelho denormalizado, e o drawer não pode divergir da
        // planilha que está logo acima dele.
        faturamentoSavePrevisto={totaisJob.save.receita}
        pagoSoPorSave={pagoSoPorSave}
        dataPrevistaFaturamento={job.data_prevista_faturamento}
        portais={portaisDoCliente}
        contextoDoEnvio={{
          tenantId: job.tenant_id,
          cnpjCliente: detalhe.cnpjCliente,
          contatosCobranca,
        }}
        moeda={versaoAprovada.moeda}
        // Fee, Always On e Mídia Off faturam mês a mês (decisões 078 e 167).
        faturamentoPorMes={
          detalhe.modeloPlanilha === "mensal" || detalhe.modeloPlanilha === "midia_off"
        }
        // Mídia Off (decisão 167): o envio do último mês encerra o job.
        encerraComOUltimoMes={detalhe.midia !== null}
        faturamentoMensal={detalhe.faturamentoMensal}
        podeEnviarFaturamentoMensal={detalhe.podeEnviarFaturamentoMensal}
        faturamentoEnvioUnico={detalhe.faturamentoEnvioUnico}
        fechamento={detalhe.fechamento}
        podeEncerrar={detalhe.podeEncerrar && !comPedido}
        cancelamentoPendente={comPedido}
        // Os pedidos de save que seguram faturamento e encerramento
        // (decisão 099) saem do mesmo save da Planilha Interna.
        savePorItem={detalhe.savePorItem}
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
          // Mídia Off: o card de Totais do encerramento é o da mídia.
          midia: detalhe.midia?.params ?? null,
        }}
      />
    </div>
  );
}
