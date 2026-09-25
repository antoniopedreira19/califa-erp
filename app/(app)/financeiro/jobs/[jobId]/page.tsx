import Link from "next/link";
import { FaixaDoProjeto } from "@/components/faixa-do-projeto";
import { itensDeJobs } from "@/lib/faixa-do-projeto";
import { STATUS_NA_LISTA } from "../../abertura-de-job/dados-abertos";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, FilePenLine, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import {
  AREA_FINANCEIRO,
  jobStatusBadgeClasses,
  jobStatusExibido,
  jobStatusLabel,
  nomeDoJobNoFinanceiro,
  type JobStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { SAVE } from "@/app/(app)/_planilha/blocos";
import { Badge } from "@/components/ui/badge";
import { ResumoResultado } from "@/components/resumo-resultado";
import {
  FATURAMENTO_VAZIO,
  faturamentoPorJob,
} from "@/lib/data/faturamento-por-job";
import { listarProjetosFinanceiro } from "@/lib/data/projetos-financeiro";
import { listarContasBancarias } from "@/lib/data/contas-bancarias";
import { carregarDetalheDoJob } from "@/app/(app)/jobs/[jobId]/carregar-detalhe";
import { FichaJob } from "@/app/(app)/jobs/[jobId]/ficha-job";
import { ErratasCard } from "@/app/(app)/jobs/[jobId]/erratas-card";
import { JobRealizadoSection } from "@/app/(app)/jobs/[jobId]/realizado/job-realizado-section";
import { JobChatSection } from "@/app/(app)/jobs/[jobId]/comunicacao/job-chat-section";
import { AberturaForm } from "../../abertura-de-job/[jobId]/abertura-form";
import { lerFaturamentoMensalPeloJob } from "@/lib/data/faturamento-mensal";
import {
  carregarJobParaAbertura,
  revisaoPendenteDoJob,
} from "../../abertura-de-job/dados";
import { fotosDaAbertura } from "../../abertura-de-job/fotos";
import {
  carregarAprovacaoDeSave,
  custoPrevistoDoFinanceiro,
  resumoComoOFinanceiroVe,
} from "../../abertura-de-job/aprovacao-save";
import {
  competenciasGravadas,
  previsoesGravadas,
} from "../../abertura-de-job/consumo";
import { servicosDoLado, servicosDoOrcamentoQuery } from "@/lib/data/servicos";
import { trimestreDe } from "../../abertura-de-job/curva";
import { formatDataHoraBr } from "../../abertura-de-job/formatos";
import { SITUACAO_META } from "../../abertura-de-job/situacao-faturamento";
import { carregarLinhasDeFluxo, carregarPrazosDosJobs } from "./fluxo-do-job";
import { FluxoCaixaJobs } from "@/components/financeiro/fluxo-caixa-jobs";
import { JobFinanceiroTabs } from "./job-financeiro-tabs";
import { abaDaUrl } from "./abas";
import { impostoDoJob } from "../../abertura-de-job/imposto-previsto";

export const dynamic = "force-dynamic";

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
  searchParams,
}: {
  params: { jobId: string };
  /**
   * `?aba=` escolhe em qual das cinco abas a página abre. Sem ela, abre
   * em "Abertura do Job", que é de onde vem quem clica na fila e na
   * lista de "Visualizar Jobs".
   *
   * Quem usa: o Calendário de Jobs, que manda `?aba=info` — lá a pessoa
   * está procurando QUE job é aquele na agenda, não o registro da
   * abertura (decisão do Tiago, 07/09/2026).
   *
   * `?aprovarSave=<id>` (decisão 099): o pop-up "Aprovar save" da fila traz
   * para cá. A aba da abertura abre no formulário da revisão, com a faixa
   * "Aprovação de save · revisão da abertura" e os números de depois da
   * aprovação; registrar a revisão é o que aprova.
   */
  searchParams?: { aba?: string; mes?: string; aprovarSave?: string };
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
  const hoje = new Date().toISOString().slice(0, 10);

  // Todas independentes entre si — em paralelo, nunca em série
  // (`docs/PERFORMANCE.md`).
  const [
    detalhe,
    carregadoParaAbertura,
    contas,
    linhasDeFluxo,
    prazosDoJob,
    previsoes,
    esteira,
    categoriasRes,
    servicosRes,
    competencias,
    fotos,
    faturamentoMensalDoJob,
    aprovacaoLida,
    custoLido,
    impostoLido,
    resumoFinanceiro,
  ] = await Promise.all([
    carregarDetalheDoJob(session, params.jobId),
    carregarJobParaAbertura(tenantId, params.jobId),
    listarContasBancarias(tenantId),
    carregarLinhasDeFluxo(tenantId, [params.jobId]),
    carregarPrazosDosJobs(tenantId, [params.jobId]),
    previsoesGravadas(supabase, tenantId, params.jobId),
    // O selo de faturamento: a esteira de "Visualizar Jobs", só deste job.
    faturamentoPorJob(tenantId, hoje, [params.jobId]),
    // Vocabulário do combo de categoria do formulário de abertura: o
    // mesmo escopo 'orcamento' que a fila usa. Não existe lista de
    // categoria só do financeiro.
    supabase
      .from("categorias_dominio")
      // `modelo_planilha`: o combo só oferece categorias do modelo do
      // orçamento (decisões 072 e 105), como a abertura.
      .select("id, nome, modelo_planilha")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    // Serviços (escopo 'projeto') do combo, e o rateio de competência
    // gravado na abertura (decisão 055).
    servicosDoOrcamentoQuery(supabase, tenantId),
    competenciasGravadas(supabase, tenantId, params.jobId),
    // As fotos do registro: a abertura e cada revisão (decisão 059).
    fotosDaAbertura(supabase, tenantId, params.jobId),
    // Fee e Always On (decisão 078): a previsão de recebimento é por mês.
    // Na aprovação de save, a parte de save do mês já conta o pedido que a
    // revisão aprova (decisão 099).
    lerFaturamentoMensalPeloJob(
      supabase,
      tenantId,
      params.jobId,
      searchParams?.aprovarSave ? [searchParams.aprovarSave] : [],
    ),
    // O pedido de save que esta visita aprova (decisão 099). `null` sem
    // `?aprovarSave=` — aí nada é lido.
    carregarAprovacaoDeSave(
      supabase,
      tenantId,
      params.jobId,
      searchParams?.aprovarSave,
    ),
    // O custo previsto que o formulário mostra e a revisão valida, na
    // conta do financeiro (decisão 099): o pedido de save que ele ainda
    // não conta volta com o planejado de antes do save. O pedido que esta
    // visita aprova fica de fora — ele já conta como save. Id que não é de
    // pedido aguardando deste job não muda nada.
    custoPrevistoDoFinanceiro(
      supabase,
      tenantId,
      params.jobId,
      searchParams?.aprovarSave ?? null,
    ),
    // O imposto previsto (decisão 100) na mesma conta do financeiro
    // (decisão 099): a action relê este mesmo número ao salvar.
    impostoDoJob(
      supabase,
      tenantId,
      params.jobId,
      searchParams?.aprovarSave ? [searchParams.aprovarSave] : [],
    ),
    // O cabeçalho e o card de Erratas na conta do financeiro (decisão 099):
    // durante um pedido de save, os números oficiais até a aprovação.
    resumoComoOFinanceiroVe(supabase, tenantId, params.jobId),
  ]);

  if (!detalhe || !carregadoParaAbertura) notFound();
  if (servicosRes.error) {
    console.error("[job-financeiro.servicos]", servicosRes.error.message);
  }

  const {
    job,
    versaoAprovada,
    totaisJob,
    custoPlanejadoJob,
    custoRealizadoJob,
    bvPlanejadoJob,
    bvRealizadoJob,
    podeExportarInterna,
  } =
    detalhe;

  // Job que ainda não passou pela abertura não tem registro para mostrar —
  // o lugar dele é a fila.
  if (job.status === "aguardando_abertura") {
    redirect(`/financeiro/abertura-de-job/${job.id}`);
  }

  // Só aprova quem abre job no financeiro (a página já barrou os outros
  // papéis; a action e a RPC conferem de novo). Pedido que não aguarda
  // mais — link velho, ou decidido por outra pessoa — não abre a
  // aprovação: a página fica no modo de sempre, com um aviso.
  const aprovacaoSave =
    aprovacaoLida?.ok && pode(session.activeRole, "jobs.abrir_financeiro")
      ? aprovacaoLida.aprovacao
      : null;
  const aprovacaoIndisponivel = aprovacaoLida !== null && aprovacaoSave === null;
  // A linha que a planilha destaca na aprovação (decisão 099). Sem linha
  // (removida depois do pedido) não há o que destacar nem faixa.
  const linhaEmAprovacao = aprovacaoSave?.linhaId ?? null;

  // Na aprovação, o formulário mostra e valida os números de DEPOIS dela
  // (os espelhos com o pedido contado) — é isso que a revisão confere.
  const jobNaFila = aprovacaoSave
    ? {
        ...carregadoParaAbertura.job,
        valor_total: aprovacaoSave.depois.valor_total,
        faturamento_previsto: aprovacaoSave.depois.faturamento_previsto,
      }
    : carregadoParaAbertura.job;

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

  // ---- Selo de faturamento: a MESMA conta da lista ----
  // Até 15/09/2026 a página refazia a classificação numa cópia própria,
  // que lia os meses do job mensal pela planilha enquanto a lista os lê
  // pela previsão de recebimento — as duas podiam discordar do mesmo job.
  // Agora é `faturamentoPorJob` com o filtro deste job: notas pelos itens
  // (decisão 075), envios por mês e o mensal que não liquida com mês por
  // faturar (decisão 078), e o job pago só por save (decisão 028 §11).
  const situacao = (esteira.get(params.jobId) ?? FATURAMENTO_VAZIO).situacao;
  const situacaoMeta = SITUACAO_META[situacao];

  // ---- Formulário de abertura em leitura (ou em revisão) ----
  // O custo previsto é o da PLANILHA DE HOJE, não o que a abertura gravou
  // em `custo_previsto_total`. Era o gravado até 08/09/2026, e por isso o
  // job aberto só com custo A ("nenhum item de calha PP") continuava sem
  // curva depois de uma errata trazer uma linha B: a tela lia zero, o
  // servidor lia a planilha, e a revisão não tinha como incluir o
  // desembolso novo (decisão 059). `planilha_desembolso` é a mesma conta
  // da fila e da action: planejado dos tipos que geram PP.
  // Falha de leitura cai no agregado da planilha, que é o número de antes
  // da decisão 099 — melhor um custo sem a correção do save do que uma
  // tela sem custo.
  const custoPrevisto = custoLido.ok
    ? custoLido.custo
    : Math.round((jobNaFila.planilha_desembolso ?? 0) * 100) / 100;

  // As erratas que devolveram o job ao mural — TODAS as que ainda não
  // foram revisadas (decisão do Tiago, 14/09/2026): o formulário abre em
  // revisão, editável, e mostra as erratas e a abertura anterior no topo.
  const emRevisao = job.abertura_em_revisao === true;
  // A aprovação de save É uma revisão da abertura — com o job em revisão
  // (errata de save) ou não (save que veio do orçamento).
  const formularioEmRevisao = emRevisao || aprovacaoSave !== null;
  const revisao = emRevisao
    ? await revisaoPendenteDoJob(
        params.jobId,
        job.data_abertura_financeiro ?? null,
        tenantId,
      )
    : null;
  const faturamentoPrevisto =
    Math.round(Number(jobNaFila.faturamento_previsto ?? 0) * 100) / 100;

  const baseCompetencia = job.data_inicio_prevista ?? hoje;
  const anoAtual = Number(hoje.slice(0, 4));
  const anoDoJob = job.competencia_ano ?? Number(baseCompetencia.slice(0, 4));
  // As pílulas de ano precisam alcançar todo ano do rateio gravado —
  // senão um job rateado em 2027 mostraria a segunda competência sem
  // pílula acesa.
  const anos = Array.from(
    new Set([
      anoAtual,
      anoDoJob,
      anoDoJob + 1,
      ...competencias.map((c) => c.ano),
    ]),
  ).sort((a, b) => a - b);

  // Desde 16/09/2026 (decisão 087) faturamento e encerramento correm
  // separados. "Aguardando encerramento" é o job que já foi todo faturado e
  // só falta a produção encerrar — antes era qualquer job já enviado.
  // O selo de status é o mesmo da produção: "Em faturamento" para o aberto
  // com o envio completo (decisão 094).
  const statusExibido = jobStatusExibido(
    job.status as JobStatus,
    job.faturamento_enviado_em,
  );
  const aguardandoEncerramento =
    job.status === "aberto" && detalhe.faturamentoCompleto;

  return (
    <div className="space-y-5">
      <div>
        {/* Faixa do projeto (decisão 106), no projeto do FINANCEIRO: a
            agregada e os jobs da lista "Visualizar Jobs", os mesmos da
            agregada. Job sem projeto do financeiro (anterior à migration
            20260820000011) não tem agregada, e fica o voltar de antes. */}
        {jobNaFila.projeto_financeiro_id ? (
          <FaixaDoProjeto
            modulo="financeiro"
            voltar={{
              href: "/financeiro/abertura-de-job?aba=abertos",
              rotulo: "Visualizar Jobs",
              titulo: "Voltar para Visualizar Jobs",
            }}
            projeto={{
              codigo: jobNaFila.projeto_financeiro_codigo ?? "—",
              nome: jobNaFila.projeto_financeiro_nome ?? "—",
            }}
            agregadaHref={`/financeiro/projetos/${jobNaFila.projeto_financeiro_id}`}
            itens={itensDeJobs(
              "/financeiro/jobs/",
              jobsDoProjetoFinanceiro,
              job.id,
              (status) => (STATUS_NA_LISTA as readonly string[]).includes(status),
            )}
            ativo={job.id}
          />
        ) : (
          <Link
            href="/financeiro/abertura-de-job?aba=abertos"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Voltar para Visualizar Jobs
          </Link>
        )}
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-x-6 gap-y-3",
            jobNaFila.projeto_financeiro_id ? "mt-5" : "mt-3",
          )}
        >
          <div className="min-w-[18rem] flex-1">
            <p className="font-mono text-xs font-semibold text-muted-foreground">
              {job.codigo}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {/* O nome do FINANCEIRO — é a tela dele. A produção continua
                  vendo o nome que cadastrou (`nome_financeiro` vs `nome`). */}
              <h1 className="text-2xl font-bold tracking-tight">
                {jobNaFila.nome}
              </h1>
              <Badge className={cn("border", jobStatusBadgeClasses(statusExibido))}>
                {jobStatusLabel(statusExibido)}
              </Badge>
              <Badge className={cn("border", situacaoMeta.classes)}>
                {situacaoMeta.rotulo}
              </Badge>
              {aguardandoEncerramento && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                  Aguardando encerramento
                </span>
              )}
              {/* Em revisão a aba de abertura está EDITÁVEL — dizer
                  "somente leitura" no cabeçalho seria mentira (decisão 059). */}
              {formularioEmRevisao ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-california-red/30 bg-california-red/[0.06] px-3 py-1 text-[11px] font-semibold text-california-red">
                  <FilePenLine className="h-3 w-3" />
                  Revisão da abertura pendente
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  Somente leitura
                </span>
              )}
            </div>
          </div>

          {/* Mesmo resumo do cabeçalho da página de Jobs: valor do job,
              custo planejado e realizado com o resultado de cada um. Um
              componente só para os dois lados não divergirem. */}
          {detalhe.itens.length > 0 && (
            <div className="mt-[10px]">
              <ResumoResultado
                // Na conta do financeiro (24/09/2026): um pedido de save que
                // aguarda ainda não mexe no valor do job nem no planejado.
                // Leitura que falha volta aos números da planilha.
                valorJob={resumoFinanceiro?.valorJob ?? totaisJob.valorJob}
                // No internacional são impostos BR + int. taxes + custos de
                // transação (decisão 072) — o mesmo campo da página de Jobs.
                deducoes={
                  resumoFinanceiro?.deducoesDoResultado ??
                  totaisJob.deducoesDoResultado
                }
                custoPlanejado={
                  custoPlanejadoJob + (resumoFinanceiro?.planejadoDosPedidos ?? 0)
                }
                custoRealizado={custoRealizadoJob}
                bvRealizado={bvRealizadoJob}
                moeda={versaoAprovada.moeda}
              />
            </div>
          )}
        </div>
      </div>

      {aprovacaoIndisponivel && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Este pedido de save não está mais aguardando aprovação: ele já foi
            decidido ou cancelado. Confira a faixa Saves da fila.
          </span>
        </div>
      )}

      <JobFinanceiroTabs
        // Sem `?aba=` a página abre na aba da abertura — inclusive na
        // aprovação de save, que acontece lá. Com `?aba=` explícito, a aba
        // pedida manda também na aprovação: é assim que o "Visualizar
        // planilha interna" da revisão abre a planilha em destaque sem
        // perder o `aprovarSave` (achado da revisão de 22/09/2026 — até
        // ali a aprovação forçava a aba da abertura, e o link da planilha
        // saía sem o pedido).
        abaInicial={abaDaUrl(searchParams?.aba) ?? "abertura"}
        chatCount={detalhe.naoLidas}
        abertura={
          <AberturaForm
            job={jobNaFila}
            modo={formularioEmRevisao ? "revisao" : "leitura"}
            fotos={fotos}
            revisao={revisao}
            aprovacaoSave={aprovacaoSave}
            categorias={(categoriasRes.data ?? []).filter(
              (c) =>
                c.modelo_planilha === jobNaFila.modelo_planilha_orcamento ||
                c.id === jobNaFila.categoria_id,
            )}
            servicos={servicosDoLado(servicosRes.data ?? [], jobNaFila)}
            projetos={projetos}
            contas={contas}
            custoPrevisto={custoPrevisto}
            faturamentoPrevisto={faturamentoPrevisto}
            impostoPrevisto={
              impostoLido
                ? impostoLido.impostoPrevisto
                : Math.round(
                    (totaisJob.faturamento.imposto +
                      totaisJob.faturamento.intTaxes) *
                      100,
                  ) / 100
            }
            aliquotaImposto={Number(versaoAprovada.percentual_imposto)}
            aliquotaIntTaxes={
              detalhe.internacional
                ? detalhe.internacional.percentualIntTaxes
                : null
            }
            resultadoPlanilha={
              custoPlanejadoJob > 0
                ? Math.round(
                    (totaisJob.valorJob -
                      totaisJob.deducoesDoResultado -
                      custoPlanejadoJob) *
                      100,
                  ) / 100
                : null
            }
            enviadoPorNome={carregadoParaAbertura.enviadoPorNome}
            curvaInicial={previsoes.curva}
            recebimentoInicial={previsoes.recebimento}
            impostosIniciais={previsoes.impostos}
            faturamentoPorMes={
              faturamentoMensalDoJob?.mensal ? faturamentoMensalDoJob.meses : null
            }
            trimestreSugerido={
              job.competencia_trimestre ?? trimestreDe(baseCompetencia)
            }
            anoSugerido={anoDoJob}
            competenciasIniciais={competencias}
            anos={anos}
            hojeIso={hoje}
            agoraLabel={formatDataHoraBr(new Date())}
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
                // O serviço do JOB, com o do orçamento como fallback —
                // `dados.ts` da abertura já resolve (decisão 055).
                servicoNome: jobNaFila.servico_nome,
                produto: job.produto,
                regionalNome: detalhe.raw.regional?.nome ?? null,
                cidade: job.cidade,
                competenciaTrimestre: job.competencia_trimestre,
                competenciaAno: job.competencia_ano,
                competencias,
                dataInicio: job.data_inicio_prevista,
                dataFim: job.data_fim_prevista,
                dataAbertura: job.data_abertura_financeiro,
                abertoPorNome: detalhe.abertoPorNome,
                dataPrevistaFaturamento: job.data_prevista_faturamento,
                semFaturamento: Number(job.faturamento_previsto ?? 0) <= 0.004,
              }}
              projeto={{
                // O projeto do FINANCEIRO, com fallback no da produção
                // para job anterior à migration 20260820000011. As datas
                // continuam vindo do projeto da produção: só existem lá.
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
                dataInicio: detalhe.raw.projeto?.data_inicio_prevista ?? null,
                dataFim: detalhe.raw.projeto?.data_fim_prevista ?? null,
              }}
              jobsDoProjeto={jobsDoProjetoFinanceiro}
              jobAtualId={job.id}
              // Os jobs irmãos do box "Jobs do projeto" abrem na ficha,
              // não no registro da abertura: o box mora DENTRO da ficha,
              // e quem pula de um irmão para o outro está comparando os
              // jobs do projeto (decisão do Tiago, 08/09/2026 — a mesma
              // regra do calendário e de "Visualizar Jobs").
              jobLinkSuffix="?aba=info"
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
              statusBadgeClasses={jobStatusBadgeClasses}
            />

            <ErratasCard
              erratas={detalhe.erratas}
              valorJobAbertura={job.valor_job_abertura}
              faturamentoPrevistoAbertura={job.faturamento_previsto_abertura}
              valorJobAtual={resumoFinanceiro?.valorJob ?? totaisJob.valorJob}
              faturamentoPrevistoAtual={
                resumoFinanceiro?.faturamentoPrevisto ??
                totaisJob.faturamentoPrevisto
              }
              moeda={versaoAprovada.moeda}
            />
          </div>
        }
        planilha={
          /* Sempre em leitura: quem edita realizado, BV e PP é a produção,
             na página de Jobs. O financeiro confere.

             O save entra por inteiro na visualização — coluna, estados e
             rastro —, e `podeAcoes={false}` fecha a porta da edição, aqui
             como no resto da planilha. `saldosDeSave` vem vazio porque,
             sem edição, não há de onde escolher origem.

             Na aprovação de save (decisão 099) a planilha abre em modo
             destaque: a faixa âmbar diz qual linha está em aprovação e
             leva de volta à revisão com o mesmo pedido, e a linha do
             pedido vem destacada. Do protótipo `prototipo-save-v2`
             (`SecaoPlanilha`, `destaque`). */
          <div className="space-y-4">
            {linhaEmAprovacao && aprovacaoSave && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                <span className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-[3px] h-2 w-2 flex-none rounded-sm",
                      SAVE.marcaEmAprovacao,
                    )}
                  />
                  <span>
                    Em aprovação na Abertura de Job:{" "}
                    <strong className="font-semibold">
                      {[aprovacaoSave.grupoNome, aprovacaoSave.itemDescricao]
                        .filter(Boolean)
                        .join(" · ")}
                    </strong>{" "}
                    — linha destacada abaixo.
                  </span>
                </span>
                <Link
                  href={`/financeiro/jobs/${job.id}?aba=abertura&aprovarSave=${aprovacaoSave.pedidoId}`}
                  prefetch={false}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar para a aprovação
                </Link>
              </div>
            )}
            <JobRealizadoSection
              interno={detalhe.interno}
              savePorItem={detalhe.savePorItem}
              saldosDeSave={[]}
              clienteNome={detalhe.clienteNome}
              destacarItens={linhaEmAprovacao ? [linhaEmAprovacao] : []}
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
              nomeJob={jobNaFila.nome}
              versao={{
                id: versaoAprovada.id,
                numero_versao: versaoAprovada.numero_versao,
                moeda: versaoAprovada.moeda,
                percentual_honorarios: Number(
                  versaoAprovada.percentual_honorarios,
                ),
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
              // Modelo mensal (decisão 078): a mesma régua de meses da tela do
              // GP, trocando de mês pela URL sem sair da aba da planilha.
              meses={detalhe.meses}
              faturamentoMensal={detalhe.faturamentoMensal}
              mesPedido={searchParams?.mes}
              // Na aprovação, trocar de mês não tira a página da aprovação.
              hrefPlanilha={
                aprovacaoSave
                  ? `/financeiro/jobs/${job.id}?aba=planilha&aprovarSave=${aprovacaoSave.pedidoId}`
                  : `/financeiro/jobs/${job.id}?aba=planilha`
              }
              grupos={detalhe.grupos}
              itens={detalhe.itens}
              realizadosMap={detalhe.realizadosMap}
              categoriasMap={detalhe.categoriasMap}
              podeAcoes={false}
              podeMexerNoSave={false}
              podeExportarInterna={podeExportarInterna}
              podeConfirmarBv={false}
              ppsPorItemId={detalhe.ppsPorItemId}
              fornecedores={detalhe.fornecedores}
              empresas={detalhe.empresas}
              responsaveis={detalhe.responsaveis}
              bvsPorItem={detalhe.bvsPorItem}
            />
          </div>
        }
        fluxo={
          <FluxoCaixaJobs
            linhas={linhasDeFluxo}
            jobs={[
              { id: job.id, codigo: job.codigo, nome: jobNaFila.nome },
            ]}
            contas={contas.map((c) => ({ id: c.id, rotulo: c.rotulo }))}
            prazos={prazosDoJob}
            hoje={hoje}
            moeda={versaoAprovada.moeda}
            descricao="Só o que passa por este job: o realizado (movimentos das contas) mais o previsto (títulos em aberto e as previsões da abertura)."
          />
        }
        chat={
          <JobChatSection
            jobId={job.id}
            jobCodigo={job.codigo}
            itens={detalhe.threadChat}
            naoLidas={detalhe.naoLidas}
            minhaArea={AREA_FINANCEIRO}
            podeEnviar={pode(session.activeRole, "chat.enviar_financeiro")}
          />
        }
      />
    </div>
  );
}
