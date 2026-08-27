import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileStack, FolderTree, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import { listarCidadesIniciais, type CidadeOpcao } from "@/lib/data/cidades";
import {
  orcamentoStatusLabel,
  versaoStatusLabel,
  type Categoria,
  type CategoriaDominio,
  type ItemBv,
  type Orcamento,
  type Profile,
  type Regional,
  type VersaoOrcamento,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { HONORARIOS_PADRAO_FALLBACK } from "@/lib/validations/clientes";
import {
  calcularTotaisVersao,
  calcularResultadoOperacional,
} from "@/lib/calculos/versao-totais";
import { bvContaNoPlanejado, bvLiquido } from "@/lib/calculos/bv-planilha";
import { OrcamentoEditorDrawer } from "../orcamento-editor-drawer";
import { AbasVersoes, type VersaoAba } from "./abas-versoes";
import { AcoesVersao } from "./acoes-versao";
import { MetaVersao } from "./meta-versao";
import { ImportarPlanilhaDrawer } from "./versoes/importar-drawer";
import { NovaVersaoDrawer } from "./versoes/nova-versao-drawer";
import { PlanilhaVersao } from "./versoes/[versaoId]/planilha-versao";
import {
  saldosDeSaveDoCliente,
  saveDaVersao,
  type SaldoDeSave,
} from "@/lib/data/saves";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import { ResumoRentabilidade } from "./versoes/[versaoId]/resumo-rentabilidade";
import { AprovacaoActions } from "./versoes/[versaoId]/aprovacao-actions";
import {
  BannersEstado,
  FluxoAbertura,
  type JobExistente,
} from "./versoes/[versaoId]/fluxo-abertura";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: Orcamento["status"]): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviado_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "job_criado":
      return "bg-california-red/10 text-california-red border-california-red/20";
    case "recusado":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function statusVersaoBadgeClasses(status: VersaoOrcamento["status"]): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviada_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovada":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "reprovada":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "substituida":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Qual aba abre.
 *
 * `?v=` manda, desde que aponte para uma versão deste orçamento — link
 * velho, versão deletada ou id de outro orçamento cai no default em vez de
 * dar 404. Sem `?v=`, abre a versão aprovada; sem aprovada, a mais recente
 * (a lista vem ordenada do maior número para o menor, que é a mesma ordem
 * das abas). É a versão que o resto do sistema entende como "a" versão do
 * orçamento.
 */
function escolherVersaoAtiva(
  versoes: VersaoOrcamento[],
  pedida: string | undefined,
): VersaoOrcamento | null {
  if (versoes.length === 0) return null;
  const porId = pedida ? versoes.find((v) => v.id === pedida) : undefined;
  if (porId) return porId;
  return versoes.find((v) => v.status === "aprovada") ?? versoes[0];
}

/**
 * Orçamento e versões numa tela só.
 *
 * Até 21/08/2026 eram duas páginas: esta listava as versões num card e
 * cada linha levava para `versoes/[versaoId]`, onde ficava a planilha.
 * O handoff "Orcamento - Versoes em Abas" fundiu as duas — as versões
 * viraram abas e a planilha da aba selecionada mora aqui. A rota antiga
 * continua existindo só como redirect, porque job e financeiro apontam
 * para a versão aprovada.
 */
export default async function OrcamentoDetailPage({
  params,
  searchParams,
}: {
  params: { projetoId: string; orcId: string };
  searchParams?: { v?: string | string[] };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const versaoPedida = Array.isArray(searchParams?.v)
    ? searchParams?.v[0]
    : searchParams?.v;

  // ONDA 1 — tudo que não depende de qual aba está selecionada. As
  // versões vêm com `select("*")`: a lista alimenta as abas e a linha da
  // aba ativa é o registro completo da versão, sem uma segunda ida ao
  // banco.
  const [
    orcRes,
    projRes,
    versoesRes,
    categoriasOrcRes,
    jobRes,
    regionaisProjRes,
    respProjRes,
    cidadesIniciais,
    produtores,
    categoriasRes,
    fornecedoresRes,
    regionaisRes,
    jobsCountRes,
  ] = await Promise.all([
    supabase
      .from("orcamentos")
      .select(
        "id, tenant_id, projeto_id, codigo, nome, status, categoria_id, regional_id, cidade_id, gp_responsavel_id, produtor_id, data_inicio_prevista, data_fim_prevista, versao_aprovada_id, created_by, created_at, updated_at, " +
          "categoria:categorias_dominio(nome), regional:regionais(nome), cidade:cidades(id, nome), " +
          "gp:profiles!gp_responsavel_id(nome), produtor:profiles!produtor_id(nome)",
      )
      .eq("id", params.orcId)
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("projetos")
      .select(
        "id, codigo, nome, campanha, cliente_id, cliente:clientes(id, nome_fantasia, percentual_honorarios_padrao), responsavel:profiles!responsavel_id(id, nome), empresa:empresas(nome_fantasia, razao_social), produto:cliente_produtos(nome)",
      )
      .eq("id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("versoes_orcamento")
      .select("*")
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .order("numero_versao", { ascending: false })
      .returns<VersaoOrcamento[]>(),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, produto, cidade, regional_id, data_inicio_prevista, data_fim_prevista, data_prevista_faturamento, observacoes",
      )
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .maybeSingle<JobExistente>(),
    // Opções de Regional e GP do orçamento: saem do cadastro do projeto.
    supabase
      .from("projeto_regionais")
      .select("regional:regionais(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id),
    supabase
      .from("projeto_responsaveis")
      .select("profile:profiles(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id),
    // Só as primeiras cidades, e as mesmas para os dois consumidores desta
    // tela: o editor do orçamento e o combobox do modal de abertura. O
    // cadastro comporta o Brasil inteiro — o resto vem do servidor a cada
    // digitação (`buscarCidades`, mesmo limite).
    listarCidadesIniciais(session.activeTenant.id),
    listActiveMembers(session.activeTenant.id),
    supabase
      .from("categorias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<Categoria[]>(),
    // Alimenta só o select do formulário de BV: id + nome, nada do
    // cadastro completo do fornecedor.
    supabase
      .from("fornecedores")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome")
      .returns<{ id: string; nome: string }[]>(),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (orcRes.error) console.error("[orcamentos.detail]", orcRes.error.message);
  if (projRes.error) console.error("[projetos.detail]", projRes.error.message);
  if (versoesRes.error) console.error("[versoes.list]", versoesRes.error.message);

  const orcamentoRaw = orcRes.data as any;
  const projetoRaw = projRes.data as any;
  if (!orcamentoRaw || !projetoRaw) notFound();

  const orcamento = orcamentoRaw as Orcamento;
  const job = jobRes.data ?? null;
  const temJobAtivo = job !== null;

  const orcamentoCategoriaNome: string | null = orcamentoRaw.categoria?.nome ?? null;
  const clienteNome: string | null = projetoRaw.cliente?.nome_fantasia ?? null;
  // Honorários de toda versão nova sai daqui — o drawer só exibe, travado.
  const honorariosCliente = Number(
    projetoRaw.cliente?.percentual_honorarios_padrao ?? HONORARIOS_PADRAO_FALLBACK,
  );
  const responsavelNome: string | null = projetoRaw.responsavel?.nome ?? null;
  const empresaNome: string | null =
    projetoRaw.empresa?.nome_fantasia ?? projetoRaw.empresa?.razao_social ?? null;
  const categoriasOrcamento = (categoriasOrcRes.data ?? []) as Pick<
    CategoriaDominio,
    "id" | "nome"
  >[];
  // A cidade gravada no orçamento entra por fora da lista: com o combobox
  // limitado a 30, ela pode não estar entre as primeiras, e o editor
  // precisa exibi-la mesmo assim.
  const cidadeAtual: CidadeOpcao | null = orcamentoRaw.cidade
    ? { id: orcamentoRaw.cidade.id as string, nome: orcamentoRaw.cidade.nome as string }
    : null;
  const categorias = (categoriasRes.data ?? []) as Categoria[];
  const fornecedores = (fornecedoresRes.data ?? []) as {
    id: string;
    nome: string;
  }[];
  const regionais = (regionaisRes.data ?? []) as { id: string; nome: string }[];

  const regionaisDoProjeto = ((regionaisProjRes.data ?? []) as any[])
    .filter((v) => v.regional)
    .map((v) => ({ id: v.regional.id, nome: v.regional.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<
    Regional,
    "id" | "nome"
  >[];

  const gpsDoProjeto = ((respProjRes.data ?? []) as any[])
    .filter((v) => v.profile)
    .map((v) => ({ id: v.profile.id, nome: v.profile.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<
    Profile,
    "id" | "nome"
  >[];

  const versoesTodas = (versoesRes.data ?? []) as VersaoOrcamento[];
  const versaoAtiva = escolherVersaoAtiva(versoesTodas, versaoPedida);

  const protegido =
    orcamento.status === "aprovado" || orcamento.status === "job_criado";
  const podeCriarVersao =
    orcamento.status !== "job_criado" && orcamento.status !== "cancelado";
  const motivoBloqueio = podeCriarVersao
    ? undefined
    : `Orçamento ${orcamentoStatusLabel(orcamento.status).toLowerCase()} não aceita novas versões.`;

  // ONDA 2 — depende da aba selecionada (e do job, já conhecido).
  // `agregado` cobre TODAS as versões: é o resumo "N itens · R$ X" que o
  // submenu "copiar uma versão existente" mostra para cada aba.
  const versaoIds = versoesTodas.map((v) => v.id);
  const [gruposRes, itensRes, bvsRes, agregadoRes, contatosRes] = await Promise.all([
    versaoAtiva
      ? supabase
          .from("versoes_orcamento_grupos")
          .select("*")
          .eq("versao_orcamento_id", versaoAtiva.id)
          .eq("tenant_id", session.activeTenant.id)
          .order("ordem", { ascending: true })
          .returns<VersaoOrcamentoGrupo[]>()
      : Promise.resolve({ data: [], error: null }),
    versaoAtiva
      ? supabase
          .from("versoes_orcamento_itens")
          .select("*")
          .eq("versao_orcamento_id", versaoAtiva.id)
          .eq("tenant_id", session.activeTenant.id)
          .order("ordem", { ascending: true })
          .returns<VersaoOrcamentoItem[]>()
      : Promise.resolve({ data: [], error: null }),
    // BVs ATIVOS da versão. Cancelado fica no banco como histórico, mas
    // some da planilha. O `!inner` serve de filtro, não de embed.
    versaoAtiva
      ? supabase
          .from("itens_bv")
          .select(
            "id, tenant_id, item_versao_id, fornecedor_id, valor, prazo_repasse, " +
              "situacao, created_by, created_at, updated_at, " +
              "item:versoes_orcamento_itens!inner(versao_orcamento_id)",
          )
          .eq("item.versao_orcamento_id", versaoAtiva.id)
          .eq("tenant_id", session.activeTenant.id)
          .neq("situacao", "cancelado")
      : Promise.resolve({ data: [], error: null }),
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_itens")
          .select("versao_orcamento_id, total_orcado")
          .in("versao_orcamento_id", versaoIds)
          .eq("tenant_id", session.activeTenant.id)
      : Promise.resolve({ data: [], error: null }),
    // Contatos de cobrança do job já enviado — quem os lê é o modo
    // somente leitura do modal ("Ver dados do job").
    job
      ? supabase
          .from("jobs_contatos")
          .select("nome, numero, email")
          .eq("job_id", job.id)
          .eq("tenant_id", session.activeTenant.id)
          .eq("tipo", "cobranca")
          .order("ordem", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (gruposRes.error) console.error("[versao.grupos]", gruposRes.error.message);
  if (itensRes.error) console.error("[versao.itens]", itensRes.error.message);
  if (bvsRes.error) console.error("[versao.bvs]", (bvsRes.error as any).message);
  if (agregadoRes.error) console.error("[versoes.agg]", (agregadoRes.error as any).message);
  if (contatosRes.error) {
    console.error("[versao.contatos_job]", (contatosRes.error as any).message);
  }

  // ONDA 3 — o SAVE (docs/decisions/023-save-entre-jobs.md). Depende dos
  // itens da versão, que só existem depois da onda 2. As duas leituras são
  // independentes entre si e vão juntas: em série apareceriam no TTFB da
  // tela mais pesada do produto.
  const itensDaVersaoParaSave = ((itensRes.data ?? []) as any[]).map((it) => ({
    id: it.id as string,
    em_save: it.em_save === true,
    save_consumido: Number(it.save_consumido ?? 0),
  }));
  const [saldosDeSave, savePorItem]: [
    SaldoDeSave[],
    Record<string, EstadoSaveDaLinha>,
  ] =
    versaoAtiva && projetoRaw.cliente_id
      ? await Promise.all([
          saldosDeSaveDoCliente(
            supabase,
            session.activeTenant.id,
            projetoRaw.cliente_id as string,
          ),
          saveDaVersao(
            supabase,
            session.activeTenant.id,
            versaoAtiva.id,
            itensDaVersaoParaSave,
          ),
        ])
      : [[], {}];

  const agregadoPorVersao = new Map<string, { count: number; total: number }>();
  for (const it of (agregadoRes.data ?? []) as any[]) {
    const atual = agregadoPorVersao.get(it.versao_orcamento_id) ?? {
      count: 0,
      total: 0,
    };
    atual.count += 1;
    atual.total += Number(it.total_orcado ?? 0);
    agregadoPorVersao.set(it.versao_orcamento_id, atual);
  }

  const abas: VersaoAba[] = versoesTodas.map((v) => {
    const agg = agregadoPorVersao.get(v.id) ?? { count: 0, total: 0 };
    return {
      id: v.id,
      numero_versao: v.numero_versao,
      status: v.status,
      itens_count: agg.count,
      itens_total: agg.total,
      percentual_honorarios: Number(v.percentual_honorarios ?? 0),
      moeda: v.moeda ?? "BRL",
    };
  });

  const proximoNumero =
    versoesTodas.reduce((maior, v) => Math.max(maior, v.numero_versao), 0) + 1;

  const periodo =
    orcamento.data_inicio_prevista || orcamento.data_fim_prevista
      ? `${formatDate(orcamento.data_inicio_prevista)} → ${formatDate(orcamento.data_fim_prevista)}`
      : null;

  // 1370 e não max-w-7xl (1280): quando o "+BV" quadrado virou a pílula
  // "Adicionar BV" a calha da direita passou de 64px para 154px, e os 90px
  // a mais vieram da folga que sobrava nas laterais da tela — não da
  // planilha.
  return (
    <div className="space-y-6 max-w-[1370px] mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}`}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {projetoRaw.codigo} · {projetoRaw.nome}
        </Link>

        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            {orcamento.codigo}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{orcamento.nome}</h1>
            <Badge className={cn("border", statusBadgeClasses(orcamento.status))}>
              {orcamentoStatusLabel(orcamento.status)}
            </Badge>
            <OrcamentoEditorDrawer
              projetoId={params.projetoId}
              orcamento={orcamento}
              categorias={categoriasOrcamento}
              regionaisDoProjeto={regionaisDoProjeto}
              cidadesIniciais={cidadesIniciais}
              cidadeAtual={cidadeAtual}
              gpsDoProjeto={gpsDoProjeto}
              produtores={produtores}
              disabled={protegido}
              disabledReason={
                protegido
                  ? `Bloqueado em ${orcamentoStatusLabel(orcamento.status).toLowerCase()} — alterações via fluxo de aprovação/job.`
                  : undefined
              }
            />
            {/* Exportar / Duplicar / Cancelar incidem sobre a ABA
                selecionada — por isso só existem quando há uma. */}
            {versaoAtiva && (
              <AcoesVersao
                projetoId={params.projetoId}
                orcamentoId={orcamento.id}
                versaoId={versaoAtiva.id}
                numeroVersao={versaoAtiva.numero_versao}
                status={versaoAtiva.status}
                nomeJob={orcamento.nome}
                proximoNumero={proximoNumero}
                qtdGrupos={(gruposRes.data ?? []).length}
                qtdItens={(itensRes.data ?? []).length}
                qtdBvs={(bvsRes.data ?? []).length}
                totalVersoes={versoesTodas.length}
                podeCriarVersao={podeCriarVersao}
                motivoBloqueio={motivoBloqueio}
              />
            )}
            {orcamento.status === "job_criado" && job && (
              <Link
                href={`/jobs/${job.id}`}
                prefetch={false}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
              >
                Ver job {job.codigo}
              </Link>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-foreground/60">Cliente:</span>{" "}
              <span className="text-foreground font-medium">{clienteNome ?? "—"}</span>
            </span>
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Responsável:</span>{" "}
              <span className="text-foreground font-medium">{responsavelNome ?? "—"}</span>
            </span>
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Empresa:</span>{" "}
              <span className="text-foreground font-medium">{empresaNome ?? "—"}</span>
            </span>
            {periodo && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Período:</span>{" "}
                  <span className="text-foreground font-medium">{periodo}</span>
                </span>
              </>
            )}
            {projetoRaw.campanha && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Campanha:</span>{" "}
                  <span className="text-foreground font-medium">{projetoRaw.campanha}</span>
                </span>
              </>
            )}
            {orcamentoCategoriaNome && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Categoria:</span>{" "}
                  <span className="text-foreground font-medium">{orcamentoCategoriaNome}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {protegido && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex items-start gap-3">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Este orçamento está em estado protegido (
            <strong className="text-foreground">{orcamentoStatusLabel(orcamento.status)}</strong>
            ). Os dados do orçamento e a criação de novas versões ficaram
            bloqueados — as abas continuam abertas para consulta.
          </p>
        </div>
      )}

      <AbasVersoes
        projetoId={params.projetoId}
        orcamentoId={orcamento.id}
        nomeJob={orcamento.nome}
        versoes={abas}
        ativaId={versaoAtiva?.id ?? null}
        podeCriarVersao={podeCriarVersao}
        motivoBloqueio={motivoBloqueio}
        honorariosCliente={honorariosCliente}
        clienteNome={clienteNome}
      />

      {versaoAtiva ? (
        <VersaoSelecionada
          params={params}
          session={session}
          orcamento={orcamento}
          orcamentoRaw={orcamentoRaw}
          projetoRaw={projetoRaw}
          versao={versaoAtiva}
          grupos={(gruposRes.data ?? []) as VersaoOrcamentoGrupo[]}
          itensBrutos={(itensRes.data ?? []) as any[]}
          bvsBrutos={(bvsRes.data ?? []) as any[]}
          contatosBrutos={(contatosRes.data ?? []) as any[]}
          categorias={categorias}
          fornecedores={fornecedores}
          regionais={regionais}
          regionaisDoProjeto={regionaisDoProjeto}
          cidadesIniciais={cidadesIniciais}
          clienteNome={clienteNome ?? "—"}
          savePorItem={savePorItem}
          saldosDeSave={saldosDeSave}
          job={job}
          temJobAtivo={temJobAtivo}
          jobsCount={jobsCountRes.count ?? 0}
          podeCriarVersao={podeCriarVersao}
          motivoBloqueio={motivoBloqueio}
        />
      ) : (
        <SemVersoes
          projetoId={params.projetoId}
          orcamentoId={orcamento.id}
          honorariosCliente={honorariosCliente}
          clienteNome={clienteNome}
          podeCriarVersao={podeCriarVersao}
          motivoBloqueio={motivoBloqueio}
        />
      )}
    </div>
  );
}

/**
 * O conteúdo da aba selecionada — o que antes era a página inteira de
 * `versoes/[versaoId]`. Fica numa função à parte só para o corpo da
 * página não virar um único bloco de 400 linhas; roda no mesmo request,
 * sem query própria.
 */
function VersaoSelecionada({
  params,
  session,
  orcamento,
  orcamentoRaw,
  projetoRaw,
  versao,
  grupos,
  itensBrutos,
  bvsBrutos,
  contatosBrutos,
  categorias,
  fornecedores,
  regionais,
  regionaisDoProjeto,
  cidadesIniciais,
  clienteNome,
  savePorItem,
  saldosDeSave,
  job,
  temJobAtivo,
  jobsCount,
  podeCriarVersao,
  motivoBloqueio,
}: {
  params: { projetoId: string; orcId: string };
  session: Awaited<ReturnType<typeof requireSession>>;
  orcamento: Orcamento;
  orcamentoRaw: any;
  projetoRaw: any;
  versao: VersaoOrcamento;
  grupos: VersaoOrcamentoGrupo[];
  itensBrutos: any[];
  bvsBrutos: any[];
  contatosBrutos: any[];
  categorias: Categoria[];
  fornecedores: { id: string; nome: string }[];
  regionais: { id: string; nome: string }[];
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  cidadesIniciais: CidadeOpcao[];
  clienteNome: string;
  /** Estado do save por id do item, e os saldos que este cliente tem para
   *  gastar (docs/decisions/023-save-entre-jobs.md). */
  savePorItem: Record<string, EstadoSaveDaLinha>;
  saldosDeSave: SaldoDeSave[];
  job: JobExistente | null;
  temJobAtivo: boolean;
  jobsCount: number;
  podeCriarVersao: boolean;
  motivoBloqueio?: string;
}) {
  const itens: VersaoOrcamentoItem[] = itensBrutos.map((it: any) => ({
    ...it,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
    // O save vem do banco como boolean e numeric; normalizar aqui evita
    // que nulo de um select antigo vire NaN na conta.
    em_save: it.em_save === true,
    save_consumido: Number(it.save_consumido ?? 0),
  }));

  // Agrupa itens por grupo_id: a planilha recebe os pares já montados.
  const itensPorGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) {
    const list = itensPorGrupo.get(it.grupo_id);
    if (list) list.push(it);
  }

  // Indexado por item: a calha consulta uma chave por linha. Objeto, e
  // não Map, porque só objeto atravessa a fronteira server → client.
  const bvsPorItem: Record<string, ItemBv> = {};
  for (const raw of bvsBrutos) {
    const { item: _joinFiltro, ...bv } = raw;
    bvsPorItem[bv.item_versao_id] = { ...bv, valor: Number(bv.valor ?? 0) };
  }

  const readOnly = versao.status === "aprovada" || versao.status === "cancelada";
  const temBv = Object.keys(bvsPorItem).length > 0;

  const totais = calcularTotaisVersao(
    itens,
    Number(versao.percentual_honorarios),
    Number(versao.percentual_imposto),
  );
  const custoPlanejado = itens.reduce(
    (s, it) => s + Number(it.total_planejado ?? 0),
    0,
  );

  // O BV volta para a agência, então ele REDUZ o custo na conta do
  // resultado — a mesma operação que o card de Totais escreve como linha
  // "+ BVs" (docs/decisions/022). O bloco "Custo planejado" do resumo
  // segue mostrando o BRUTO, como o card.
  const bvLiquidoDaVersao = Object.values(bvsPorItem).reduce(
    (s, bv) =>
      bvContaNoPlanejado(bv.situacao)
        ? s + bvLiquido(Number(bv.valor ?? 0), Number(versao.percentual_imposto))
        : s,
    0,
  );
  const { resultadoGeral } = calcularResultadoOperacional(
    totais.valorJob,
    totais.imposto,
    custoPlanejado - bvLiquidoDaVersao,
  );

  // Preview do código: o definitivo é gerado no insert. Serve só pra tela
  // não mostrar campo vazio — se outro job entrar antes, o número muda.
  const proximoCodigoJob = `JOB-${(jobsCount + 1).toString().padStart(4, "0")}`;

  const contatosDoJob = contatosBrutos.map((c) => ({
    nome: (c.nome as string | null) ?? "",
    numero: (c.numero as string | null) ?? "",
    email: (c.email as string | null) ?? "",
  }));

  const inicialModal = {
    nome: job?.nome ?? orcamento.nome,
    // Cidade e regional são editáveis no modal: entram pré-preenchidas
    // com o que está hoje no orçamento.
    cidadeId: orcamento.cidade_id ?? "",
    cidadeNome: orcamentoRaw.cidade?.nome ?? "",
    regionalId: orcamento.regional_id ?? "",
    dataInicio: job?.data_inicio_prevista ?? orcamento.data_inicio_prevista ?? "",
    dataFim: job?.data_fim_prevista ?? orcamento.data_fim_prevista ?? "",
    dataFaturamento: job?.data_prevista_faturamento ?? "",
    observacoes: job?.observacoes ?? "",
    // Job já enviado mostra o que foi gravado (lista vazia nos jobs
    // anteriores a 17/08/2026, que não tinham contato).
    contatos:
      contatosDoJob.length > 0
        ? contatosDoJob
        : job
          ? []
          : [{ nome: "", numero: "", email: "" }],
  };

  // Herdados: com job já aberto valem os valores congelados nele; antes
  // disso, o que está cadastrado hoje no projeto e no orçamento.
  const herdados = {
    produtoNome: job?.produto ?? projetoRaw?.produto?.nome ?? null,
    cidadeNome: job?.cidade ?? orcamentoRaw.cidade?.nome ?? null,
    regionalNome: job
      ? regionais.find((r) => r.id === job.regional_id)?.nome ?? null
      : orcamentoRaw.regional?.nome ?? null,
    gpNome: orcamentoRaw.gp?.nome ?? null,
    produtorNome: orcamentoRaw.produtor?.nome ?? null,
    // Categoria do job = a do orçamento, sempre.
    categoriaNome: orcamentoRaw.categoria?.nome ?? null,
  };

  return (
    <>
      {/* Parâmetros da aba à esquerda, rentabilidade à direita — o resumo
          tem largura fixa e fica ancorado na borda. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <Badge className={cn("border", statusVersaoBadgeClasses(versao.status))}>
            {versaoStatusLabel(versao.status)}
          </Badge>
          <MetaVersao
            versaoId={versao.id}
            moeda={versao.moeda}
            taxaCambio={Number(versao.taxa_cambio)}
            percentualHonorarios={Number(versao.percentual_honorarios)}
            percentualImposto={Number(versao.percentual_imposto)}
            // Honorários nasce do cadastro do cliente; divergir dele nesta
            // versão é ato de administrador (decisão de 11/08/2026).
            podeEditarHonorarios={session.activeRole === "administrador"}
            clienteNome={clienteNome}
            readOnly={versao.status === "aprovada"}
            readOnlyReason="Versão aprovada não pode ser editada."
          />
          <AprovacaoActions
            versaoId={versao.id}
            status={versao.status}
            temJobAtivo={temJobAtivo}
          />
        </div>

        <ResumoRentabilidade
          valorJob={totais.valorJob}
          custoPlanejado={custoPlanejado}
          resultadoGeral={resultadoGeral}
          moeda={versao.moeda}
        />
      </div>

      <BannersEstado
        versaoLabel={`v${versao.numero_versao}`}
        aprovada={versao.status === "aprovada"}
        job={job}
        jobHref={job ? `/jobs/${job.id}` : null}
      />

      {/* Barra de ação — "Novo grupo" saiu daqui em 24/08/2026: ele agora
          vive na linha tracejada do pé da planilha, que é onde o grupo
          novo de fato nasce (handoff "Grupos Unificados"). */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderTree className="h-4 w-4 text-california-red" />
          <span>
            {grupos.length} {grupos.length === 1 ? "grupo" : "grupos"} ·{" "}
            {itens.length} {itens.length === 1 ? "item" : "itens"} no total
          </span>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {/* Ao lado do Novo grupo, como o time pediu: quem percebeu que
                importou a planilha errada troca por aqui mesmo, sem sair
                da aba. Em versão congelada some — lá não há o que
                substituir. */}
            <ImportarPlanilhaDrawer
              projetoId={params.projetoId}
              orcamentoId={params.orcId}
              modo="sobrescrever"
              versaoId={versao.id}
              conteudoAtual={{
                grupos: grupos.length,
                itens: itens.length,
                bvs: Object.keys(bvsPorItem).length,
              }}
              disabled={temJobAtivo || !podeCriarVersao}
              disabledReason={
                temJobAtivo
                  ? versao.status === "aprovada"
                    ? "Esta versão já gerou um job e não pode ser sobrescrita."
                    : "O orçamento já gerou um job — nenhuma versão dele aceita ser sobrescrita."
                  : motivoBloqueio
              }
            />
          </div>
        )}
      </div>

      {/* Grupos + Totais dividem a mesma calha: é o que faz as colunas
          Total / Rentab. / % do card de Totais caírem exatamente sob as
          mesmas colunas dos cards de grupo. O pr reserva a trilha de ações
          que fica fora do frame de cada card. */}
      <div
        className={cn(
          "space-y-6",
          !readOnly ? "pr-[154px]" : temBv && "pr-[124px]",
        )}
      >
        {/* Grupos e Totais sob a MESMA chave Bruto ⇄ Líquido — por isso os
            dois saem de um componente client só. */}
        <PlanilhaVersao
          grupos={grupos}
          itens={itens}
          secoes={grupos.map((g) => ({
            grupo: g,
            itens: itensPorGrupo.get(g.id) ?? [],
          }))}
          moeda={versao.moeda}
          readOnly={readOnly}
          categorias={categorias}
          bvsPorItem={bvsPorItem}
          fornecedores={fornecedores}
          versaoLabel={`v${versao.numero_versao}`}
          percentualHonorarios={Number(versao.percentual_honorarios)}
          percentualImposto={Number(versao.percentual_imposto)}
          versaoId={versao.id}
          clienteNome={clienteNome}
          savePorPadrao={versao.save_por_padrao === true}
          savePorItem={savePorItem}
          saldosDeSave={saldosDeSave}
          nomeDoGrupo={Object.fromEntries(grupos.map((g) => [g.id, g.nome]))}
        />
      </div>

      <FluxoAbertura
        versaoId={versao.id}
        versaoLabel={`v${versao.numero_versao}`}
        versaoStatus={versao.status}
        orcamentoCodigo={orcamento.codigo}
        jobHref={job ? `/jobs/${job.id}` : null}
        qtdGrupos={grupos.length}
        qtdItens={itens.length}
        qtdItensComValor={itens.filter((i) => i.total_orcado > 0).length}
        qtdItensOrcadoZerado={
          itens.filter((i) => Number(i.valor_unitario_orcado) === 0).length
        }
        percentualImposto={Number(versao.percentual_imposto)}
        custoPlanejado={custoPlanejado}
        faturamentoPrevisto={totais.faturamentoPrevisto}
        valorJob={totais.valorJob}
        moeda={versao.moeda}
        clienteNome={clienteNome}
        proximoCodigoJob={proximoCodigoJob}
        projetoNome={projetoRaw?.nome ?? "—"}
        projetoCodigo={projetoRaw?.codigo ?? "—"}
        herdados={herdados}
        regionaisDoProjeto={regionaisDoProjeto}
        // Já vêm limitadas de `listarCidadesIniciais`; o resto do Brasil
        // vem do servidor a cada digitação.
        cidadesIniciais={cidadesIniciais}
        inicial={inicialModal}
        job={job}
      />
    </>
  );
}

/** Orçamento recém-criado, sem nenhuma versão ainda. */
function SemVersoes({
  projetoId,
  orcamentoId,
  honorariosCliente,
  clienteNome,
  podeCriarVersao,
  motivoBloqueio,
}: {
  projetoId: string;
  orcamentoId: string;
  honorariosCliente: number;
  clienteNome: string | null;
  podeCriarVersao: boolean;
  motivoBloqueio?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-14 text-center">
      <FileStack className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm font-semibold text-foreground">
        Nenhuma versão ainda
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Crie a primeira versão ou importe uma planilha para começar a montar
        este orçamento.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <NovaVersaoDrawer
          orcamentoId={orcamentoId}
          honorariosCliente={honorariosCliente}
          clienteNome={clienteNome}
          disabled={!podeCriarVersao}
          disabledReason={motivoBloqueio}
        />
        <ImportarPlanilhaDrawer
          projetoId={projetoId}
          orcamentoId={orcamentoId}
          disabled={!podeCriarVersao}
          disabledReason={motivoBloqueio}
        />
      </div>
    </div>
  );
}
