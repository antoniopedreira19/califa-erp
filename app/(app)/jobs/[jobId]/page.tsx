import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, Info, Circle } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { nomeVersao } from "@/lib/nome-versao";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Job, JobStatus, Regional } from "@/lib/types";
import { jobStatusLabel, JOB_STATUS_TRANSICOES, areaDoPapel } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ResumoResultado } from "@/components/resumo-resultado";
import { cn } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularTotaisRealizado,
} from "@/lib/calculos/versao-totais";
import { JobEditorDrawer } from "./job-editor-drawer";
import { StatusActions } from "./status-actions";
import { ReenviarAprovacaoButton } from "./reenviar-aprovacao-button";
import { AprovarRejeitarButtons } from "./aprovar-rejeitar-buttons";
import { JobRealizadoSection } from "./realizado/job-realizado-section";
import { JobPPsSection } from "./pps/job-pps-section";
import { JobTabs } from "./job-tabs";
import { ErratasCard } from "./erratas-card";
import { JobChatSection } from "./comunicacao/job-chat-section";

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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: { jobId: string };
  searchParams?: { from?: string; aba?: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

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

  const [jobRes, regionaisRes, responsaveis] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, tenant_id, empresa_id, codigo, nome, produto, cidade, data_inicio_prevista, data_fim_prevista, data_prevista_faturamento, observacoes, responsavel_id, produtor_id, valor_total, faturamento_previsto, valor_job_abertura, faturamento_previsto_abertura, status, motivo_rejeicao, projeto_id, orcamento_id, versao_orcamento_aprovada_id, regional_id, created_at, updated_at, responsavel:profiles!responsavel_id(id, nome), regional:regionais(id, nome), orcamento:orcamentos(id, codigo, nome, projeto_id), versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome, moeda, percentual_honorarios, percentual_imposto), projeto:projetos(id, codigo, nome)",
      )
      .eq("id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (jobRes.error) console.error("[job.detail]", jobRes.error.message);
  const raw = jobRes.data as any;
  if (!raw) notFound();

  // Queries de Realizado (paralelas, dependem de raw ja carregado)
  const versaoAprovadaId = raw.versao_orcamento_aprovada_id as string;

  const [
    gruposRes,
    itensRes,
    realizadosRes,
    ppsRes,
    fornecedoresRes,
    empresasRes,
    categoriasRes,
    erratasRes,
    mensagensRes,
    leituraRes,
    bvsRes,
    mensagensPPsRes,
    leituraPPsRes,
  ] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    // Orçado vem da CÓPIA do job, não da versão: a errata altera a cópia e
    // a versão aprovada continua sendo o que o cliente aprovou.
    supabase
      .from("jobs_itens_orcado")
      .select("*")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_itens_realizado")
      .select("*")
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .returns<JobItemRealizado[]>(),
    // Sem filtro de status: a trilha da Planilha Interna usa só as ativas,
    // mas a aba de Pedidos de Produção lista as canceladas também. Uma
    // query só em vez de duas.
    supabase
      .from("pedidos_compra")
      .select(
        "*, emitido:profiles!emitida_por(nome), anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes)",
      )
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social, status")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia, ativo, principal")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("principal", { ascending: false })
      .order("razao_social"),
    supabase
      .from("categorias")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .returns<Pick<Categoria, "id" | "nome">[]>(),
    supabase
      .from("jobs_erratas")
      .select(
        "*, autor:profiles!created_by(nome), itens:jobs_erratas_itens(*)",
      )
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "geral")
      .order("created_at", { ascending: true }),
    supabase
      .from("jobs_chat_leituras")
      .select("lida_ate")
      .eq("job_id", params.jobId)
      .eq("profile_id", session.profile.id)
      .eq("escopo", "geral")
      .maybeSingle(),
    // BVs ATIVOS da versão aprovada. O BV é chaveado pelo item da VERSÃO,
    // que é a mesma chave que `jobs_itens_orcado.item_versao_id` usa —
    // por isso este é literalmente o mesmo registro que a tela de
    // Orçamentos abre. O `!inner` serve de filtro, não de embed.
    supabase
      .from("itens_bv")
      .select(
        "id, tenant_id, item_versao_id, fornecedor_id, valor, prazo_repasse, " +
          "situacao, created_by, created_at, updated_at, " +
          "item:versoes_orcamento_itens!inner(versao_orcamento_id)",
      )
      .eq("item.versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("situacao", "cancelado"),
    // Mensagens do chat de PPs (escopo='pps'), separadas do chat geral.
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "pps")
      .order("created_at", { ascending: true }),
    // Leitura do usuário no chat de PPs.
    supabase
      .from("jobs_chat_leituras")
      .select("lida_ate")
      .eq("job_id", params.jobId)
      .eq("profile_id", session.profile.id)
      .eq("escopo", "pps")
      .maybeSingle(),
  ]);

  const grupos = (gruposRes.data ?? []) as VersaoOrcamentoGrupo[];
  if (itensRes.error) console.error("[job.orcado]", itensRes.error.message);
  if (bvsRes.error) console.error("[job.bvs]", bvsRes.error.message);

  // Indexado por item da versão: a calha consulta uma chave por linha.
  // Objeto, e não Map, porque só objeto atravessa a fronteira server →
  // client.
  const bvsPorItem: Record<string, ItemBv> = {};
  for (const raw of (bvsRes.data ?? []) as any[]) {
    const { item: _joinFiltro, ...bv } = raw;
    bvsPorItem[bv.item_versao_id] = { ...bv, valor: Number(bv.valor ?? 0) };
  }
  // `id` segue sendo o id do item na versão: é a chave que o realizado e a
  // PP usam. `orcado_id` é o que a errata altera.
  const itens: ItemPlanilhaJob[] = (itensRes.data ?? []).map((it: any) => ({
    id: it.item_versao_id,
    orcado_id: it.id,
    grupo_id: it.grupo_id,
    ordem: Number(it.ordem ?? 0),
    item: it.item,
    tipo_custo: it.tipo_custo,
    categoria_id: it.categoria_id ?? null,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
  }));
  const realizados = (realizadosRes.data ?? []).map((r: any) => ({
    ...r,
    valor_unitario_realizado: Number(r.valor_unitario_realizado ?? 0),
    quantidade_realizada: Number(r.quantidade_realizada ?? 0),
    dias_meses_realizado: Number(r.dias_meses_realizado ?? 0),
    total_realizado: Number(r.total_realizado ?? 0),
  })) as JobItemRealizado[];

  const realizadosMap = new Map<string, JobItemRealizado>();
  for (const r of realizados) realizadosMap.set(r.item_id, r);

  if (ppsRes.error) console.error("[job.pps]", ppsRes.error.message);

  // Nome do grupo por item realizado: o realizado aponta pro item da versão,
  // que aponta pro grupo. A aba de PPs mostra "{grupo} · emitida em ...".
  const grupoNomePorId = new Map(grupos.map((g) => [g.id, g.nome]));
  const grupoPorItemRealizadoId = new Map<string, string>();
  for (const r of realizados) {
    const item = itens.find((i) => i.id === r.item_id);
    const nome = item ? grupoNomePorId.get(item.grupo_id) : undefined;
    if (nome) grupoPorItemRealizadoId.set(r.id, nome);
  }

  const ppsDoJob: PedidoCompraNaLista[] = (ppsRes.data ?? []).map((pp: any) => ({
    ...pp,
    quantidade: Number(pp.quantidade),
    valor: Number(pp.valor),
    emitida_por_nome: pp.emitido?.nome ?? null,
    grupo_nome: grupoPorItemRealizadoId.get(pp.item_realizado_id) ?? null,
    anexos: (pp.anexos ?? []).map((a: any) => ({
      id: a.id,
      arquivo_nome_original: a.arquivo_nome_original,
      arquivo_tamanho_bytes: Number(a.arquivo_tamanho_bytes ?? 0),
    })),
  }));

  // A trilha da planilha só enxerga PP ativa: cancelada libera o item pra
  // gerar de novo, então tem que voltar a mostrar "Gerar PP".
  const ppsPorItemId = new Map<string, PedidoCompra>();
  for (const pp of ppsDoJob) {
    if (pp.status !== "cancelada") ppsPorItemId.set(pp.item_realizado_id, pp);
  }

  const fornecedores = (fornecedoresRes.data ?? []) as any[];
  const empresas = (empresasRes.data ?? []) as any[];

  if (categoriasRes.error)
    console.error("[job.categorias]", categoriasRes.error.message);
  const categoriasMap = new Map<string, string>();
  for (const c of categoriasRes.data ?? []) categoriasMap.set(c.id, c.nome);

  if (erratasRes.error) console.error("[job.erratas]", erratasRes.error.message);
  const erratas: JobErrataComItens[] = (erratasRes.data ?? []).map((e: any) => ({
    ...e,
    custo_orcado_antes: Number(e.custo_orcado_antes ?? 0),
    custo_orcado_depois: Number(e.custo_orcado_depois ?? 0),
    valor_job_antes: Number(e.valor_job_antes ?? 0),
    valor_job_depois: Number(e.valor_job_depois ?? 0),
    faturamento_previsto_antes:
      e.faturamento_previsto_antes !== null &&
      e.faturamento_previsto_antes !== undefined
        ? Number(e.faturamento_previsto_antes)
        : null,
    faturamento_previsto_depois:
      e.faturamento_previsto_depois !== null &&
      e.faturamento_previsto_depois !== undefined
        ? Number(e.faturamento_previsto_depois)
        : null,
    autor_nome: e.autor?.nome ?? null,
    itens: (e.itens ?? []).map((i: any) => ({
      ...i,
      valor_unitario_de: Number(i.valor_unitario_de ?? 0),
      valor_unitario_para: Number(i.valor_unitario_para ?? 0),
      total_de: Number(i.total_de ?? 0),
      total_para: Number(i.total_para ?? 0),
      efeito_valor_job: Number(i.efeito_valor_job ?? 0),
      efeito_faturamento_previsto:
        i.efeito_faturamento_previsto !== null &&
        i.efeito_faturamento_previsto !== undefined
          ? Number(i.efeito_faturamento_previsto)
          : null,
    })),
  }));

  const versaoAprovada = raw.versao as {
    id: string;
    numero_versao: number;
    nome: string | null;
    moeda: string;
    percentual_honorarios: number;
    percentual_imposto: number;
  };

  const transicoes = JOB_STATUS_TRANSICOES[raw.status as JobStatus];

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];

  const job: Job = {
    id: raw.id,
    tenant_id: raw.tenant_id,
    empresa_id: raw.empresa_id,
    codigo: raw.codigo,
    projeto_id: raw.projeto_id,
    orcamento_id: raw.orcamento_id,
    versao_orcamento_aprovada_id: raw.versao_orcamento_aprovada_id,
    nome: raw.nome,
    produto: raw.produto,
    regional_id: raw.regional_id,
    cidade: raw.cidade,
    data_inicio_prevista: raw.data_inicio_prevista,
    data_fim_prevista: raw.data_fim_prevista,
    responsavel_id: raw.responsavel_id,
    produtor_id: raw.produtor_id,
    valor_total: raw.valor_total !== null ? Number(raw.valor_total) : null,
    faturamento_previsto:
      raw.faturamento_previsto !== undefined &&
      raw.faturamento_previsto !== null
        ? Number(raw.faturamento_previsto)
        : null,
    valor_job_abertura:
      raw.valor_job_abertura !== undefined && raw.valor_job_abertura !== null
        ? Number(raw.valor_job_abertura)
        : null,
    faturamento_previsto_abertura:
      raw.faturamento_previsto_abertura !== undefined &&
      raw.faturamento_previsto_abertura !== null
        ? Number(raw.faturamento_previsto_abertura)
        : null,
    data_prevista_faturamento: raw.data_prevista_faturamento ?? null,
    observacoes: raw.observacoes ?? null,
    status: raw.status,
    motivo_rejeicao: raw.motivo_rejeicao ?? null,
    // Registro financeiro da abertura. Esta página não exibe nenhum
    // deles ainda (a visão financeira do job é entrega própria), mas o
    // tipo `Job` os declara — o select acima não os traz, então caem
    // em null em vez de undefined.
    nome_financeiro: raw.nome_financeiro ?? null,
    categoria_id: raw.categoria_id ?? null,
    competencia_trimestre: raw.competencia_trimestre ?? null,
    competencia_ano: raw.competencia_ano ?? null,
    custo_previsto_total:
      raw.custo_previsto_total !== undefined &&
      raw.custo_previsto_total !== null
        ? Number(raw.custo_previsto_total)
        : null,
    data_abertura_financeiro: raw.data_abertura_financeiro ?? null,
    aberto_por: raw.aberto_por ?? null,
    created_by: null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };

  // ---- Comunicação: thread e contador de não lidas ----
  if (mensagensRes.error)
    console.error("[job.mensagens]", mensagensRes.error.message);

  const mensagens = (mensagensRes.data ?? []).map((m: any) => ({
    ...m,
    autor_nome: m.autor?.nome ?? null,
  }));

  const totalOrcadoJob = itens.reduce(
    (s, i) => s + Number(i.total_orcado ?? 0),
    0,
  );

  // Resumo do cabeçalho: mesmas funções do card de Totais da Planilha
  // Interna, pra header e rodapé nunca divergirem.
  const totaisJob = calcularTotaisVersao(
    itens,
    Number(versaoAprovada.percentual_honorarios),
    Number(versaoAprovada.percentual_imposto),
  );
  const { totalPlanejado: custoPlanejadoJob } = calcularTotaisPlanejados(itens);
  const { totalRealizado: custoRealizadoJob } = calcularTotaisRealizado(
    itens.map((it) => ({
      total_realizado: Number(realizadosMap.get(it.id)?.total_realizado ?? 0),
    })),
  );

  const threadChat = montarThreadChat(
    {
      criadoEm: raw.created_at,
      orcamentoCodigo: raw.orcamento?.codigo ?? null,
      versaoNumero: raw.versao?.numero_versao ?? null,
      versaoNome: raw.versao?.nome ?? null,
      valorJobAbertura:
        raw.valor_job_abertura !== null && raw.valor_job_abertura !== undefined
          ? Number(raw.valor_job_abertura)
          : null,
      totalOrcado: totalOrcadoJob,
      qtdItens: itens.length,
      qtdGrupos: grupos.length,
      responsavelNome: raw.responsavel?.nome ?? null,
      dataInicio: raw.data_inicio_prevista,
      dataFim: raw.data_fim_prevista,
    },
    erratas,
    mensagens,
    versaoAprovada.moeda,
  );

  // Não lidas = o que chegou de outra pessoa depois da última leitura.
  // Errata conta junto: é o evento que o outro time mais precisa ver.
  const lidaAte = (leituraRes.data as { lida_ate: string } | null)?.lida_ate ?? null;
  const naoLidas =
    mensagens.filter(
      (m: any) =>
        m.autor_id !== session.profile.id &&
        (!lidaAte || m.created_at > lidaAte),
    ).length +
    erratas.filter(
      (e) => e.created_by !== session.profile.id && (!lidaAte || e.created_at > lidaAte),
    ).length;

  // ---- Chat de PPs: thread e contador de não lidas ----
  if (mensagensPPsRes.error)
    console.error("[job.mensagens_pps]", mensagensPPsRes.error.message);

  const mensagensPPs = (mensagensPPsRes.data ?? []).map((m: any) => ({
    ...m,
    autor_nome: m.autor?.nome ?? null,
  }));

  const fornecedoresPorId: Record<string, string> = Object.fromEntries(
    fornecedores.map((f) => [f.id, f.razao_social ?? f.nome]),
  );

  const threadChatPPs = montarThreadChatPPs(
    ppsDoJob,
    mensagensPPs,
    versaoAprovada.moeda,
    fornecedoresPorId,
  );

  const lidaAtePPs =
    (leituraPPsRes.data as { lida_ate: string } | null)?.lida_ate ?? null;
  const naoLidasPPs = mensagensPPs.filter(
    (m: any) =>
      m.autor_id !== session.profile.id &&
      (!lidaAtePPs || m.created_at > lidaAtePPs),
  ).length;

  const podeAprovarRejeitar =
    session.activeRole === "administrador" ||
    session.activeRole === "financeiro";

  const podeEditarRealizado =
    (session.activeRole === "administrador" ||
      job.responsavel_id === session.profile.id) &&
    (job.status === "aberto" || job.status === "em_producao");

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
              {job.status !== "cancelado" && (
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
          <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <Info className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Metadata</h2>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Cliente</dt>
            <dd className="font-medium">{raw.projeto?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Produto</dt>
            <dd>{job.produto ?? "—"}</dd>
            <dt className="text-muted-foreground">Regional</dt>
            <dd>{raw.regional?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Cidade</dt>
            <dd>{job.cidade ?? "—"}</dd>
            <dt className="text-muted-foreground">Data início</dt>
            <dd>{formatDate(job.data_inicio_prevista)}</dd>
            <dt className="text-muted-foreground">Data fim</dt>
            <dd>{formatDate(job.data_fim_prevista)}</dd>
            <dt className="text-muted-foreground">Responsável</dt>
            <dd>{raw.responsavel?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Valor total</dt>
            <dd className="font-semibold">{formatMoney(job.valor_total)}</dd>
          </dl>
        </div>

        {/* Ao lado do Metadata, como no design — não em largura total. */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <Briefcase className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Origem</h2>
          </div>
          {/* Label estreito e valor amplo: os valores aqui são links longos
              ("PEVETE-0002/26 · Novo Teste rqada"), diferente do Metadata. */}
          <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Projeto</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono">{raw.projeto?.codigo}</span> · {raw.projeto?.nome}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Orçamento</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono">{raw.orcamento?.codigo}</span> · {raw.orcamento?.nome}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Versão aprovada</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}/versoes/${raw.versao_orcamento_aprovada_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                {raw.versao
                  ? nomeVersao(
                      raw.orcamento?.nome ?? job.nome,
                      raw.versao.numero_versao,
                    )
                  : "—"}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Valor de faturamento</dt>
            <dd className="font-mono font-semibold">
              {formatMoney(job.valor_total)}
              {erratas.length > 0 && (
                <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">
                  (após {erratas.length}{" "}
                  {erratas.length === 1 ? "errata" : "erratas"})
                </span>
              )}
            </dd>
          </dl>
        </div>

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
          // coluna é um espelho denormalizado e o card não pode divergir da
          // planilha logo acima.
          valorJobAtual={totaisJob.valorJob}
          faturamentoPrevistoAtual={totaisJob.faturamentoPrevisto}
          moeda={versaoAprovada.moeda}
        />

        {(transicoes.length > 0 ||
          (job.status === "aguardando_abertura" && podeAprovarRejeitar)) && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Circle className="h-4 w-4 text-california-red" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Status</h2>
            </div>
            {job.status === "aguardando_abertura" && podeAprovarRejeitar && (
              <div className="mb-4 pb-4 border-b border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Aprovação financeira
                </p>
                <AprovarRejeitarButtons jobId={job.id} />
              </div>
            )}
            {transicoes.length > 0 && (
              <StatusActions
                jobId={job.id}
                transicoes={transicoes}
                mostrarEncerramento={
                  job.status === "aberto" || job.status === "em_producao"
                }
              />
            )}
          </div>
        )}
          </div>
        }
        planilha={
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
            editable={podeEditarRealizado}
            ppsPorItemId={ppsPorItemId}
            fornecedores={fornecedores}
            empresas={empresas}
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
            editable={podeEditarRealizado}
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
    </div>
  );
}
