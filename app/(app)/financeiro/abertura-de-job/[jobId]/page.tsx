import { notFound, redirect } from "next/navigation";
import { ClipboardCheck, Landmark, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { AREA_FINANCEIRO, jobStatusBadgeClasses } from "@/lib/types";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { FluxoCaixaJobs } from "@/components/financeiro/fluxo-caixa-jobs";
import { carregarDetalheDoJob } from "@/app/(app)/jobs/[jobId]/carregar-detalhe";
import { FichaJob } from "@/app/(app)/jobs/[jobId]/ficha-job";
import { AlteracoesFinanceiroCard } from "@/app/(app)/jobs/[jobId]/alteracoes-financeiro-card";
import { JobRealizadoSection } from "@/app/(app)/jobs/[jobId]/realizado/job-realizado-section";
import { JobChatSection } from "@/app/(app)/jobs/[jobId]/comunicacao/job-chat-section";
import { carregarJobParaAbertura } from "../dados";
import { listarProjetosFinanceiro } from "@/lib/data/projetos-financeiro";
import { listarContasBancarias } from "@/lib/data/contas-bancarias";
import { servicosDoLado, servicosDoOrcamentoQuery } from "@/lib/data/servicos";
import { formatDataHoraBr } from "../formatos";
import { sugerirCurva, sugerirRecebimento, trimestreDe } from "../curva";
import { AberturaForm } from "./abertura-form";
import { lerFaturamentoMensalPeloJob } from "@/lib/data/faturamento-mensal";
import { impostoDoJob } from "../imposto-previsto";
import { JobFinanceiroTabs } from "../../jobs/[jobId]/job-financeiro-tabs";
import { abaDaUrl } from "../../jobs/[jobId]/abas";
import {
  carregarLinhasDeFluxo,
  carregarPrazosDosJobs,
} from "../../jobs/[jobId]/fluxo-do-job";

export const dynamic = "force-dynamic";

/**
 * Abrir job no financeiro — o formulário da abertura dentro das mesmas
 * cinco abas do job aberto (decisão 111): Abertura do Job, Informações,
 * Planilha Interna, Fluxo de Caixa e Comunicação.
 *
 * Trocar de aba não descarta o que foi preenchido: as abas escondem o
 * conteúdo em vez de desmontá-lo, e o formulário fica vivo na primeira.
 * O que sai da página (menu, Voltar, links das abas) pergunta antes.
 *
 * Informações, Planilha e Comunicação são os MESMOS componentes da página
 * do job aberto, alimentados pelo mesmo `carregarDetalheDoJob` — a regra
 * de não duplicar tela cara de manter (decisão do Tiago, 20/08/2026).
 */
export default async function AbrirJobNoFinanceiroPage({
  params,
  searchParams,
}: {
  params: { jobId: string };
  /** `?aba=` escolhe a aba (o clique na aba grava ali); `?mes=` é o mês
   *  da planilha no modelo mensal (decisão 078). */
  searchParams?: { aba?: string; mes?: string };
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

  // Uma onda só, em paralelo (`docs/PERFORMANCE.md`). O que depende do job
  // da fila — os projetos do combo, que são os do mesmo cliente (agrupar
  // clientes diferentes sob um projeto faria o total somar dinheiro de
  // dois), e o faturamento de cada mês no Fee e no Always On (decisão 078)
  // — encadeia atrás dele sem segurar o resto. O save consumido e o
  // imposto só precisam do id. As três últimas são das abas de consulta
  // (decisão 111). Até 27/09/2026 eram três ondas em série.
  const jobDaFila = carregarJobParaAbertura(tenantId, params.jobId).then(
    async (carregado) => {
      if (!carregado) return null;
      const [projetos, faturamentoMensal, ultimoDoProjetoRes] =
        await Promise.all([
          listarProjetosFinanceiro(tenantId, carregado.job.cliente_id),
          carregado.job.modelo_planilha_orcamento === "mensal"
            ? lerFaturamentoMensalPeloJob(
                supabase,
                tenantId,
                carregado.job.id,
                [],
              )
            : Promise.resolve(null),
          // A sugestão do campo Projeto (decisão 111, revisão de 28/09): o projeto do
          // financeiro do último job aberto no mesmo projeto da produção.
          // Na maioria dos casos os jobs de um projeto da produção caem no
          // mesmo projeto do financeiro (Tiago, 28/09/2026).
          supabase
            .from("jobs")
            .select(
              "codigo, projeto_financeiro_id, projeto_financeiro:projetos_financeiro(nome, codigo)",
            )
            .eq("tenant_id", tenantId)
            .eq("projeto_id", carregado.job.projeto_id)
            .neq("id", carregado.job.id)
            .not("projeto_financeiro_id", "is", null)
            .order("data_abertura_financeiro", {
              ascending: false,
              nullsFirst: false,
            })
            .limit(1),
        ]);
      if (ultimoDoProjetoRes.error) {
        console.error(
          "[abertura-job.sugestao-projeto]",
          ultimoDoProjetoRes.error.message,
        );
      }
      const ultimo = (ultimoDoProjetoRes.data ?? [])[0] as any;
      // Só sugere o que o combo oferece: projeto encerrado ou de outro
      // cliente não aparece na lista, e a busca não o acharia.
      const sugestaoDeProjeto =
        ultimo &&
        projetos.some((p) => p.id === ultimo.projeto_financeiro_id)
          ? {
              nome: (ultimo.projeto_financeiro?.nome as string) ?? "",
              codigo: (ultimo.projeto_financeiro?.codigo as string) ?? "",
              jobCodigo: ultimo.codigo as string,
            }
          : null;
      return { carregado, projetos, faturamentoMensal, sugestaoDeProjeto };
    },
  );

  const [
    daFila,
    categoriasRes,
    contas,
    servicosRes,
    { data: consumoRes },
    imposto,
    detalhe,
    linhasDeFluxo,
    prazosDoJob,
  ] = await Promise.all([
    jobDaFila,
    // Escopo 'orcamento': a categoria do job é a que a produção escolheu
    // no orçamento — o financeiro confere e pode trocar, mas dentro do
    // mesmo vocabulário. Não existe lista de categoria só do financeiro.
    supabase
      .from("categorias_dominio")
      // `modelo_planilha` entra para o filtro logo abaixo — a categoria do
      // job tem que usar o mesmo modelo do orçamento (decisão 072). Vem no
      // select, e não numa query própria, porque esta roda em paralelo com
      // o job e ainda não se sabe qual é o modelo aqui.
      .select("id, nome, modelo_planilha")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    listarContasBancarias(tenantId),
    // Serviços (escopo 'projeto'): o mesmo vocabulário do orçamento. O
    // campo chega pré-preenchido com o do orçamento de origem e pode ser
    // trocado sem alterá-lo (decisão 055).
    servicosDoOrcamentoQuery(supabase, tenantId),
    // Quanto deste job é pago com crédito de outro (decisão 028). Quando o
    // faturamento previsto é zero, é isto que distingue "o cliente paga o
    // fornecedor direto" de "o cliente já pagou, num job anterior".
    supabase
      .from("jobs_itens_orcado")
      .select("save_consumido")
      .eq("tenant_id", tenantId)
      .eq("job_id", params.jobId),
    // O imposto previsto (decisão 100) vem do mesmo fechamento da planilha
    // interna.
    impostoDoJob(supabase, tenantId, params.jobId),
    carregarDetalheDoJob(session, params.jobId),
    // O fluxo do job antes da abertura costuma vir vazio — as previsões só
    // nascem ao confirmar. Lido mesmo assim: o que já existir (uma PP
    // gerada antes da abertura) aparece.
    carregarLinhasDeFluxo(tenantId, [params.jobId]),
    carregarPrazosDosJobs(tenantId, [params.jobId]),
  ]);

  if (!daFila || !detalhe) notFound();
  const { carregado, projetos, faturamentoMensal, sugestaoDeProjeto } = daFila;

  // Quem chegou por link antigo (ou por outra aba que já resolveu o job)
  // vai para onde o job está agora, e não para um formulário que não
  // grava. Sem sair do financeiro (decisão 099, item 20): até 22/09/2026 o
  // desvio ia para `/jobs`, a página da produção. O job aberto tem página
  // própria no financeiro; o devolvido e o cancelado não têm registro, e o
  // lugar de quem os procurava é a fila.
  if (carregado.status !== "aguardando_abertura") {
    redirect(
      carregado.status === "rejeitado_financeiro" ||
        carregado.status === "cancelado"
        ? "/financeiro/abertura-de-job?aba=aguardando"
        : `/financeiro/jobs/${params.jobId}`,
    );
  }

  if (categoriasRes.error) {
    console.error("[abertura-job.categorias]", categoriasRes.error.message);
  }

  // O job fecha pela cadeia do ORÇAMENTO (decisão 072), então a categoria
  // dele precisa usar o mesmo modelo de planilha. Filtrar aqui é o que
  // impede o Select de oferecer uma opção que a server action vai recusar
  // — ela recusa de qualquer jeito, porque a regra não pode depender só
  // da tela.
  const categoriasDoModelo = (categoriasRes.data ?? []).filter(
    (c) => c.modelo_planilha === carregado.job.modelo_planilha_orcamento,
  );
  if (servicosRes.error) {
    console.error("[abertura-job.servicos]", servicosRes.error.message);
  }

  const { job, enviadoPorNome } = carregado;
  const { versaoAprovada, podeExportarInterna } = detalhe;
  // O job como a página do job aberto o lê (colunas de `jobs`); `job`
  // acima é o da fila, com os campos que o formulário usa.
  const jobDoDetalhe = detalhe.job;

  const agora = new Date();
  const hojeIso = agora.toISOString().slice(0, 10);

  // Custo previsto = planejado dos itens de calha PP — só o que a
  // California de fato desembolsa (docs/decisions/004). A Server Action
  // relê esse mesmo número do banco antes de gravar — o que vai daqui é
  // só o que a tela precisa mostrar. Zero é legítimo: job 100% A/D abre
  // sem curva.
  const custoPrevisto = Math.round(job.planilha_desembolso * 100) / 100;

  // Faturamento previsto = o que a California prevê receber do cliente.
  // É contra ele que as parcelas de recebimento fecham — e não contra o
  // valor total, que inclui o que o cliente paga direto ao fornecedor.
  // A Server Action também relê este número do banco antes de gravar.
  const faturamentoPrevisto =
    Math.round(Number(job.faturamento_previsto ?? 0) * 100) / 100;

  const saveConsumido =
    Math.round(
      ((consumoRes ?? []) as any[]).reduce(
        (s, i) => s + Number(i.save_consumido ?? 0),
        0,
      ) * 100,
    ) / 100;

  const impostoPrevisto = imposto?.impostoPrevisto ?? 0;
  // Resultado operacional planejado — a mesma conta do card de Totais.
  const resultadoPlanilha =
    imposto && job.planilha_planejado > 0
      ? Math.round(
          (imposto.valorJob -
            imposto.deducoesDoResultado -
            job.planilha_planejado) *
            100,
        ) / 100
      : null;

  const baseCompetencia = job.data_inicio_prevista ?? hojeIso;
  const anoSugerido = Number(baseCompetencia.slice(0, 4));
  const anoAtual = Number(hojeIso.slice(0, 4));
  const anos = Array.from(
    new Set([anoAtual, anoSugerido, anoSugerido + 1]),
  ).sort((a, b) => a - b);

  // Jobs do projeto da PRODUÇÃO: antes da abertura o job ainda não tem
  // projeto no financeiro, e a ficha mostra o da produção. Ficam os que já
  // chegaram ao financeiro — o devolvido e o cancelado não têm página lá.
  const jobsDoProjeto = detalhe.jobsDoProjeto.filter(
    (j) => j.status !== "rejeitado_financeiro" && j.status !== "cancelado",
  );

  return (
    <div className="space-y-5">
      {/* O cabeçalho da abertura, acima das abas (decisão 111). O Voltar
          fica marcado: a proteção de saída do formulário deixa o clique
          dele passar, porque ele pergunta pela própria (decisão 108). */}
      <div>
        <div data-voltar-da-pagina>
          <BotaoVoltar reserva="/financeiro/abertura-de-job?aba=aguardando" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Landmark className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-[26px] font-bold tracking-tight">
            Abrir job no financeiro
          </h1>
          <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[12.5px] font-bold">
            {job.codigo}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            <ClipboardCheck className="h-3 w-3" />
            Em conferência
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Confira os dados da produção ao lado — e a planilha interna do job —
          e complete o registro financeiro: nome, projeto, categoria, serviço,
          competência e as previsões de recebimento e de custos.
        </p>
      </div>

      <JobFinanceiroTabs
        abaInicial={abaDaUrl(searchParams?.aba) ?? "abertura"}
        chatCount={detalhe.naoLidas}
        lembrarRolagem
        abertura={
          <AberturaForm
            job={job}
            categorias={categoriasDoModelo}
            servicos={servicosDoLado(servicosRes.data ?? [], job)}
            projetos={projetos}
            sugestaoDeProjeto={sugestaoDeProjeto}
            contas={contas}
            custoPrevisto={custoPrevisto}
            faturamentoPrevisto={faturamentoPrevisto}
            impostoPrevisto={impostoPrevisto}
            aliquotaImposto={imposto?.aliquotaImposto ?? 0}
            aliquotaIntTaxes={imposto?.aliquotaIntTaxes ?? null}
            resultadoPlanilha={resultadoPlanilha}
            saveConsumido={saveConsumido}
            enviadoPorNome={enviadoPorNome}
            curvaInicial={sugerirCurva(
              custoPrevisto,
              job.data_inicio_prevista,
              job.data_fim_prevista,
              hojeIso,
            )}
            impostosIniciais={[]}
            recebimentoInicial={sugerirRecebimento(
              faturamentoPrevisto,
              job.data_prevista_faturamento,
              hojeIso,
            )}
            faturamentoPorMes={
              faturamentoMensal?.mensal ? faturamentoMensal.meses : null
            }
            trimestreSugerido={trimestreDe(baseCompetencia)}
            anoSugerido={anoSugerido}
            anos={anos}
            hojeIso={hojeIso}
            agoraLabel={formatDataHoraBr(agora)}
            // A aprovação de save é da página do job aberto (decisão 099).
            aprovacaoSave={null}
          />
        }
        info={
          <div className="space-y-4">
            <FichaJob
              descritivo={jobDoDetalhe.observacoes}
              antesDaAbertura
              job={{
                codigo: jobDoDetalhe.codigo,
                codigoAnterior: jobDoDetalhe.codigo_anterior,
                nome: job.nome,
                // Antes da abertura a categoria do job ainda é a do
                // orçamento: `jobs.categoria_id` só é gravado ao confirmar.
                categoriaNome:
                  job.categoria_nome ?? detalhe.raw.categoria?.nome ?? null,
                // O serviço do job, com o do orçamento como fallback —
                // `dados.ts` já resolve (decisão 055).
                servicoNome: job.servico_nome,
                produto: jobDoDetalhe.produto,
                regionalNome: detalhe.raw.regional?.nome ?? null,
                cidade: jobDoDetalhe.cidade,
                competenciaTrimestre: null,
                competenciaAno: null,
                competencias: [],
                dataInicio: jobDoDetalhe.data_inicio_prevista,
                dataFim: jobDoDetalhe.data_fim_prevista,
                dataAbertura: null,
                abertoPorNome: null,
                dataPrevistaFaturamento: jobDoDetalhe.data_prevista_faturamento,
                semFaturamento: faturamentoPrevisto <= 0.004,
              }}
              projeto={{
                // Ainda sem projeto no financeiro: o da produção, e o link
                // dele pergunta antes de sair para Orçamentos (decisão 108).
                id: detalhe.raw.projeto_id,
                codigo: detalhe.raw.projeto?.codigo ?? "—",
                nome: detalhe.raw.projeto?.nome ?? "—",
                clienteNome: detalhe.raw.projeto?.cliente?.nome_fantasia ?? null,
                dataInicio: detalhe.raw.projeto?.data_inicio_prevista ?? null,
                dataFim: detalhe.raw.projeto?.data_fim_prevista ?? null,
              }}
              jobsDoProjeto={jobsDoProjeto}
              jobAtualId={job.id}
              // Os irmãos abrem na ficha, como em "Visualizar Jobs" (decisão
              // do Tiago, 08/09/2026).
              jobLinkSuffix="?aba=info"
              jobHrefBase="/financeiro/jobs/"
              confirmarSaidaParaOrcamento
              gpNome={detalhe.raw.responsavel?.nome ?? null}
              produtorNome={detalhe.raw.produtor?.nome ?? null}
              origem={{
                projetoHref: `/orcamentos/${detalhe.raw.projeto_id}`,
                orcamentoHref: `/orcamentos/${detalhe.raw.projeto_id}/${detalhe.raw.orcamento_id}/versoes/${detalhe.raw.versao_orcamento_aprovada_id}`,
                versaoLabel: detalhe.versaoLabel,
              }}
              contatos={detalhe.contatosCobranca}
              statusBadgeClasses={jobStatusBadgeClasses}
            />
            {/* O que o financeiro já editou no orçado durante a conferência
                (decisão 115). Some enquanto não houver alteração. */}
            <AlteracoesFinanceiroCard
              alteracoes={detalhe.alteracoesFinanceiro}
              moeda={versaoAprovada.moeda}
            />
          </div>
        }
        planilha={
          /* Em leitura, como na página do job aberto: quem edita realizado,
             BV e PP é a produção. `saldosDeSave` vazio porque, sem edição,
             não há de onde escolher origem. O financeiro edita os VALORES
             do orçado pelo "Editar orçado" já aqui, na abertura (decisão
             115): ainda sem previsão, envio ou nota, o que acompanha é o
             formulário da aba Abertura do Job. */
          <JobRealizadoSection
            confirmarSaidaParaOrcamento
            edicaoDoFinanceiro={
              pode(session.activeRole, "jobs.editar_orcado_financeiro")
                ? { travadoPor: null, mesesComNota: [], recebimento: [], envios: [] }
                : null
            }
            interno={detalhe.interno}
            savePorItem={detalhe.savePorItem}
            saldosDeSave={[]}
            clienteNome={detalhe.clienteNome}
            destacarItens={[]}
            job={{
              id: jobDoDetalhe.id,
              codigo: jobDoDetalhe.codigo,
              nome: jobDoDetalhe.nome,
              status: jobDoDetalhe.status,
              projeto_id: jobDoDetalhe.projeto_id,
              orcamento_id: jobDoDetalhe.orcamento_id,
              versao_orcamento_aprovada_id: jobDoDetalhe.versao_orcamento_aprovada_id,
              empresa_id: jobDoDetalhe.empresa_id,
              responsavel_id: jobDoDetalhe.responsavel_id,
            }}
            nomeJob={job.nome}
            versao={{
              id: versaoAprovada.id,
              numero_versao: versaoAprovada.numero_versao,
              moeda: versaoAprovada.moeda,
              percentual_honorarios: Number(
                versaoAprovada.percentual_honorarios,
              ),
              percentual_imposto: Number(versaoAprovada.percentual_imposto),
              percentual_int_taxes: Number(
                versaoAprovada.percentual_int_taxes ?? 0,
              ),
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
            // Modelo mensal (decisão 078): trocar de mês fica nesta página
            // e nesta aba — a abertura continua preenchida.
            meses={detalhe.meses}
            faturamentoMensal={detalhe.faturamentoMensal}
            mesPedido={searchParams?.mes}
            hrefPlanilha={`/financeiro/abertura-de-job/${job.id}?aba=planilha`}
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
        }
        fluxo={
          linhasDeFluxo.length > 0 ? (
            <FluxoCaixaJobs
              linhas={linhasDeFluxo}
              jobs={[{ id: job.id, codigo: job.codigo, nome: job.nome }]}
              contas={contas.map((c) => ({ id: c.id, rotulo: c.rotulo }))}
              prazos={prazosDoJob}
              hoje={hojeIso}
              moeda={versaoAprovada.moeda}
              descricao="Só o que passa por este job: o realizado (movimentos das contas) mais o previsto (títulos em aberto e as previsões da abertura)."
            />
          ) : (
            <FluxoAntesDaAbertura />
          )
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

/**
 * A aba Fluxo de Caixa de um job que ainda não foi aberto: não há
 * movimento, título nem previsão gravada, e a tela diz quando isso muda
 * em vez de mostrar uma matriz vazia (decisão 111).
 */
function FluxoAntesDaAbertura() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-4 w-4 text-california-red" />
          <h2 className="text-base font-bold tracking-tight">
            Fluxo de caixa do job
          </h2>
        </div>
        <p className="min-w-[260px] flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Só o que passa por este job: o realizado (movimentos das contas) mais
          o previsto (títulos em aberto e as previsões da abertura).
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center shadow-soft">
        <p className="text-sm font-semibold">
          O fluxo de caixa do job começa na abertura
        </p>
        <p className="mx-auto mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
          Antes de o job ser aberto no financeiro não há movimento, título nem
          previsão gravada. As previsões que você preencher na aba Abertura do
          Job aparecem aqui depois da confirmação.
        </p>
      </div>
    </div>
  );
}
