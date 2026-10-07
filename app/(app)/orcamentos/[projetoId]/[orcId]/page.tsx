import Link from "next/link";
import { Suspense } from "react";
import { FaixaDoProjeto } from "@/components/faixa-do-projeto";
import { FaixaDosOrcamentos, faixaDoOrcamentoSemItens } from "../faixa-orcamentos";
import { servicosDoOrcamentoQuery, type ServicoOption } from "@/lib/data/servicos";
import { notFound } from "next/navigation";
import { FileStack, FolderTree, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
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
import type { CategoriaModeloPlanilha } from "@/lib/types";
import type { CategoriaParaServico } from "@/lib/categorias-do-servico";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { HONORARIOS_PADRAO_FALLBACK } from "@/lib/validations/clientes";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import {
  calcularTotaisVersao,
  calcularResultadoOperacional,
} from "@/lib/calculos/versao-totais";
import { OrcamentoEditorDrawer } from "../orcamento-editor-drawer";
import { AbasVersoes, type VersaoAba } from "./abas-versoes";
import { AcoesVersao } from "./acoes-versao";
import { MetaVersao } from "./meta-versao";
import { ImportarPlanilhaVersao } from "./versoes/importar-planilha-versao";
import { NovaVersaoDrawer } from "./versoes/nova-versao-drawer";
import { PlanilhaVersao } from "./versoes/[versaoId]/planilha-versao";
import {
  saldosDeSaveDoCliente,
  saveDaVersao,
  type SaldoDeSave,
} from "@/lib/data/saves";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import { ResumoRentabilidade } from "./versoes/[versaoId]/resumo-rentabilidade";
import { mesesDaVersaoQuery, mesesSemItens } from "@/lib/data/meses-versao";
import type { VersaoOrcamentoMes } from "@/lib/types";
import { PlanilhaMensal } from "./planilha-mensal";
import { PlanilhaMidiaOff } from "./midia/planilha-midia";
import type { VeiculoDaLista } from "./midia/secoes";
import {
  fechamentoDosItens,
  meioDoGrupo,
  parametrosDaVersao,
} from "@/lib/calculos/midia-off";
import { AprovacaoActions } from "./versoes/[versaoId]/aprovacao-actions";
import { AvisoArquivado } from "../../aviso-arquivado";
import {
  BannersEstado,
  FluxoAbertura,
  type FechamentoDaCopia,
  type JobExistente,
} from "./versoes/[versaoId]/fluxo-abertura";
import type { PPQueTravaOEnvio } from "./versoes/[versaoId]/pps-que-travam";
import { anoDoCodigoDeJob, proximoCodigoDeJob } from "@/lib/codigos/jobs";
import {
  faturamentoPorMesDoFinanceiro,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
} from "@/lib/data/espelhos-do-job";
import { faturamentoPorMes, type FaturamentoDoMes } from "@/lib/calculos/faturamento-por-mes";

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

/** O job cancelado pelo "Cancelar aprovação" da devolução (decisão 128). */
interface JobReservado {
  id: string;
  codigo: string;
  nome: string;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  data_evento: string | null;
  data_prevista_faturamento: string | null;
  /** Modelo mensal (decisão 149): as datas por mês que ele tinha. */
  recebimento_previsto_por_mes: Record<string, string> | null;
  observacoes: string | null;
  motivo_rejeicao: string | null;
}

/**
 * Lista de pessoas do envio para abertura (decisão 135) com quem está
 * gravado hoje no orçamento, mesmo que essa pessoa tenha saído da lista
 * (um GP tirado da equipe do projeto, um produtor desativado). Antes da
 * 135 o envio copiava os dois do orçamento sem conferir; sem isto, o
 * campo abriria em branco num formulário que ninguém mexeu, e o servidor
 * aceita quem já estava lá.
 */
function comQuemEstaNoOrcamento(
  lista: Pick<Profile, "id" | "nome">[],
  id: string | null | undefined,
  nome: string | null | undefined,
): Pick<Profile, "id" | "nome">[] {
  if (!id || lista.some((p) => p.id === id)) return lista;
  return [...lista, { id, nome: nome ?? "—" }].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR"),
  );
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
  /** `abertura=revisar` chega do botão "Revisar abertura" da página do
   *  job devolvido e abre o formulário de envio já preenchido. */
  searchParams?: {
    v?: string | string[];
    abertura?: string | string[];
    /** Modelo mensal (decisão 078): `2026-07` abre o mês, `trimestre` a
     *  vista dos meses empilhados. */
    mes?: string | string[];
  };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const versaoPedida = Array.isArray(searchParams?.v)
    ? searchParams?.v[0]
    : searchParams?.v;
  const mesPedido = Array.isArray(searchParams?.mes)
    ? searchParams?.mes[0]
    : searchParams?.mes;
  const aberturaPedida = Array.isArray(searchParams?.abertura)
    ? searchParams?.abertura[0]
    : searchParams?.abertura;
  const abrirRevisao = aberturaPedida === "revisar";

  // ONDA 1 — tudo que não depende de qual aba está selecionada. As
  // versões vêm com `select("*")`: a lista alimenta as abas e a linha da
  // aba ativa é o registro completo da versão, sem uma segunda ida ao
  // banco.
  const [
    orcRes,
    projRes,
    versoesRes,
    categoriasOrcRes,
    servicosRes,
    jobRes,
    reservadoRes,
    regionaisProjRes,
    respProjRes,
    cidadesIniciais,
    produtores,
    categoriasRes,
    fornecedoresRes,
    regionaisRes,
    codigosDeJobRes,
  ] = await Promise.all([
    supabase
      .from("orcamentos")
      .select(
        "id, tenant_id, projeto_id, codigo, nome, status, arquivado_em, arquivado_por, categoria_id, servico_id, descritivo, regional_id, cidade_id, gp_responsavel_id, produtor_id, data_inicio_prevista, data_fim_prevista, versao_aprovada_id, created_by, created_at, updated_at, " +
          // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`
          // desde 02/09/2026 (categoria e servico).
          "categoria:categorias_dominio!categoria_id(nome, modelo_planilha), regional:regionais(nome), cidade:cidades(id, nome), " +
          // O serviço Interno muda a planilha (decisão 105). Lido pelo
          // embed, e não pela lista de serviços ativos: um serviço
          // desativado continua valendo para o orçamento que o usa.
          "servico:categorias_dominio!servico_id(nome, investimento_interno), " +
          "gp:profiles!gp_responsavel_id(nome), produtor:profiles!produtor_id(nome)",
      )
      .eq("id", params.orcId)
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("projetos")
      .select(
        // `produto_id` cru além do embed `produto`: é ele que o servidor
        // confere para deixar abrir o job, e é ele que o modal usa para
        // decidir se a Marca está cadastrada (17/09/2026).
        //
        // Decisão 133: `produto` é a marca que o JOB leva — a única do
        // projeto ou, com mais de uma, a geral do cliente. `marcas` traz
        // as escolhidas, só para o modal avisar quando são várias.
        "id, codigo, nome, status, campanha, cliente_id, produto_id, cliente:clientes(id, nome_fantasia, percentual_honorarios_padrao, codigo_curto), responsavel:profiles!responsavel_id(id, nome), empresa:empresas(nome_fantasia, razao_social), produto:cliente_produtos!produto_id(nome), marcas:projeto_marcas(produto_id)",
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
    // Com modelo e serviço exclusivo: é por eles que o editor trava a
    // categoria do Fee e do Always On (decisão 078). `em_breve` é a Mídia
    // Off, que aparece travada na lista (decisão 131).
    supabase
      .from("categorias_dominio")
      .select("id, nome, modelo_planilha, servico_exclusivo_id, aceita_servico_interno, em_breve")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    // Serviço: mesma tabela, escopo `projeto` — a outra lista (037).
    servicosDoOrcamentoQuery(supabase, session.activeTenant.id),
    supabase
      .from("jobs")
      .select(
        // `status` e `motivo_rejeicao` desde 08/09/2026 (decisão 057): é
        // por eles que a tela sabe que o financeiro devolveu o job.
        // `*_abertura`: os números congelados no envio/reenvio — o "Ver
        // dados do job" mostra o que foi gravado (decisão 099).
        "id, codigo, nome, produto, cidade, regional_id, data_inicio_prevista, data_fim_prevista, data_evento, data_prevista_faturamento, recebimento_previsto_por_mes, observacoes, status, motivo_rejeicao, devolvido_em, valor_job_abertura, faturamento_previsto_abertura, " +
          // GP e produtor gravados no job: o "Ver dados do job" os mostra
          // (decisão 135).
          "responsavel:profiles!responsavel_id(nome), produtor:profiles!produtor_id(nome)",
      )
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .maybeSingle<JobExistente>(),
    // O job cancelado pelo "Cancelar aprovação" da devolução (decisão
    // 128): o código dele volta no próximo envio, o motivo do financeiro
    // fica à vista até lá, e o formulário do envio nasce do que ele tinha.
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, data_inicio_prevista, data_fim_prevista, data_evento, data_prevista_faturamento, recebimento_previsto_por_mes, observacoes, motivo_rejeicao",
      )
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "cancelado")
      .eq("codigo_reservado", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<JobReservado>(),
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
    // Alimenta só o campo de fornecedor do formulário de BV: nome e
    // documento, nada do cadastro completo. O documento entra desde
    // 09/09/2026 porque a busca do campo olha os dois (decisão 067).
    supabase
      .from("fornecedores")
      .select("id, nome, cpf_cnpj")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome")
      .returns<{ id: string; nome: string; cpf_cnpj: string | null }[]>(),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    // Prévia do código do próximo job, a mesma conta de `gerarCodigoJob`
    // (decisão 114): os códigos do ano de hoje. A sigla do cliente só se
    // sabe depois do projeto, que vem nesta mesma onda — o filtro por sigla
    // fica para a hora da conta.
    supabase
      .from("jobs")
      .select("codigo")
      .eq("tenant_id", session.activeTenant.id)
      .like("codigo", `%/${anoDoCodigoDeJob()}`),
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
  // Decisão 128: com o job devolvido, os dados do orçamento e o planejado
  // se corrigem sem cancelar a aprovação.
  const jobDevolvido =
    job?.status === "rejeitado_financeiro" && orcamento.status === "job_criado";
  // O código reservado só vale sem job vivo e com a mesma sigla: se o
  // cliente do projeto mudou depois do cancelamento, o envio gera outro.
  const siglaDoCliente: string | null = projetoRaw.cliente?.codigo_curto ?? null;
  const reservado =
    !job &&
    reservadoRes.data &&
    siglaDoCliente &&
    reservadoRes.data.codigo.startsWith(`${siglaDoCliente}-`)
      ? reservadoRes.data
      : null;

  const orcamentoCategoriaNome: string | null = orcamentoRaw.categoria?.nome ?? null;
  const clienteNome: string | null = projetoRaw.cliente?.nome_fantasia ?? null;
  // Honorários de toda versão nova sai daqui — o drawer só exibe, travado.
  const honorariosCliente = Number(
    projetoRaw.cliente?.percentual_honorarios_padrao ?? HONORARIOS_PADRAO_FALLBACK,
  );
  const responsavelNome: string | null = projetoRaw.responsavel?.nome ?? null;
  const empresaNome: string | null =
    projetoRaw.empresa?.nome_fantasia ?? projetoRaw.empresa?.razao_social ?? null;
  const servicos = (servicosRes.data ?? []) as ServicoOption[];
  const categoriasOrcamento = (categoriasOrcRes.data ??
    []) as CategoriaParaServico[];
  // A cidade gravada no orçamento entra por fora da lista: com o combobox
  // limitado a 30, ela pode não estar entre as primeiras, e o editor
  // precisa exibi-la mesmo assim.
  const cidadeAtual: CidadeOpcao | null = orcamentoRaw.cidade
    ? {
        id: orcamentoRaw.cidade.id as string,
        nome: orcamentoRaw.cidade.nome as string,
        uf: (orcamentoRaw.cidade.uf as string | null) ?? null,
      }
    : null;
  const categorias = (categoriasRes.data ?? []) as Categoria[];
  const fornecedores = (fornecedoresRes.data ?? []) as {
    id: string;
    nome: string;
    cpf_cnpj: string | null;
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

  // As mesmas listas do editor do orçamento, para o envio para abertura
  // (decisão 135), com quem já está gravado no orçamento.
  const gpsDoEnvio = comQuemEstaNoOrcamento(
    gpsDoProjeto,
    orcamentoRaw?.gp_responsavel_id,
    orcamentoRaw?.gp?.nome,
  );
  const produtoresDoEnvio = comQuemEstaNoOrcamento(
    produtores,
    orcamentoRaw?.produtor_id,
    orcamentoRaw?.produtor?.nome,
  );

  const versoesTodas = (versoesRes.data ?? []) as VersaoOrcamento[];
  const versaoAtiva = escolherVersaoAtiva(versoesTodas, versaoPedida);

  // Financeiro (e outros papeis sem editar_orcamento) entram no mesmo
  // mecanismo de read-only da versao aprovada: nenhum botao de acao
  // aparece, nenhum campo edita. Task 3 ja fecha o servidor; esta
  // camada tira a UI enganosa. Fonte-verdade: `lib/permissoes.ts`.
  const readOnlyPeloPapel = !pode(session.activeRole, "orcamentos.editar");
  // Decisão 118: orçamento arquivado, ou de projeto arquivado, é só leitura
  // — tudo fica para consulta, e o único caminho de volta é o Reativar do
  // aviso. O banco recusa a escrita também.
  const orcamentoArquivado = Boolean(orcamento.arquivado_em);
  const projetoArquivado = projetoRaw.status === "arquivado";
  const arquivado = orcamentoArquivado || projetoArquivado;
  // O “+” da faixa: as mesmas condições do "Novo orçamento" da página do
  // projeto, mais a permissão que a action de criar confere.
  const podeCriarOrcamento =
    !projetoArquivado && pode(session.activeRole, "orcamentos.criar");
  const protegido =
    orcamento.status === "aprovado" ||
    orcamento.status === "job_criado" ||
    readOnlyPeloPapel ||
    arquivado;
  // Job devolvido (decisão 128): o "Editar" e o planejado abrem para
  // corrigir; o orçado e as versões novas continuam travados.
  const correcaoLiberada = jobDevolvido && !readOnlyPeloPapel && !arquivado;
  const podeCriarVersao =
    orcamento.status !== "job_criado" &&
    orcamento.status !== "cancelado" &&
    !readOnlyPeloPapel &&
    !arquivado;
  const motivoBloqueio = arquivado
    ? orcamentoArquivado
      ? "Orçamento arquivado não aceita novas versões."
      : "Projeto arquivado não aceita novas versões."
    : readOnlyPeloPapel
    ? "Seu papel não permite editar orçamentos."
    : podeCriarVersao
      ? undefined
      : `Orçamento ${orcamentoStatusLabel(orcamento.status).toLowerCase()} não aceita novas versões.`;

  // ONDA 2 — depende da aba selecionada (e do job, já conhecido).
  // `agregado` cobre TODAS as versões: é o resumo "N itens · R$ X" que o
  // submenu "copiar uma versão existente" mostra para cada aba.
  const versaoIds = versoesTodas.map((v) => v.id);
  // Mídia Off (decisão 147): a planilha tem a conta e a lista de veículos
  // dela.
  const modeloDoOrcamento: CategoriaModeloPlanilha =
    orcamentoRaw?.categoria?.modelo_planilha ?? "nacional";
  const midiaOff = modeloDoOrcamento === "midia_off";
  const [gruposRes, itensRes, bvsRes, agregadoRes, contatosRes, mesesRes, reenvioRes, ppsRes, veiculosRes, usoRes] = await Promise.all([
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
              "percentual_imposto, situacao, created_by, created_at, updated_at, " +
              "item:versoes_orcamento_itens!inner(versao_orcamento_id)",
          )
          .eq("item.versao_orcamento_id", versaoAtiva.id)
          .eq("tenant_id", session.activeTenant.id)
          .neq("situacao", "cancelado")
      : Promise.resolve({ data: [], error: null }),
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_itens")
          // `tipo_custo`: na Mídia Off o valor da aba é o da conta da mídia,
          // que separa o A · Repasse.
          .select("versao_orcamento_id, total_orcado, tipo_custo")
          .in("versao_orcamento_id", versaoIds)
          .eq("tenant_id", session.activeTenant.id)
      : Promise.resolve({ data: [], error: null }),
    // Contatos de cobrança do job já enviado — quem os lê é o modo
    // somente leitura do modal ("Ver dados do job"). Sem job vivo, os do
    // job cancelado na devolução preenchem o próximo envio (decisão 128).
    job || reservado
      ? supabase
          .from("jobs_contatos")
          .select("nome, numero, email")
          .eq("job_id", (job ?? reservado)!.id)
          .eq("tenant_id", session.activeTenant.id)
          .eq("tipo", "cobranca")
          .order("ordem", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    // Meses da versão — só existem no modelo mensal (decisão 078). Nos
    // demais a lista vem vazia e ninguém a lê.
    versaoAtiva
      ? mesesDaVersaoQuery(supabase, session.activeTenant.id, versaoAtiva.id)
      : Promise.resolve({ data: [] as VersaoOrcamentoMes[], error: null }),
    // Job devolvido: o reenvio grava os números da CÓPIA do job, onde a
    // produção pode ter mexido no save (decisão 099, §11). O formulário e a
    // confirmação do reenvio mostram esses mesmos números — a mesma conta
    // da action (`lerBaseDosEspelhos` → `totaisDoFinanceiro`). Aguardando
    // abertura, a cópia é o que acabou de ser enviado ("Ver dados do job").
    job?.status === "rejeitado_financeiro" || job?.status === "aguardando_abertura"
      ? lerBaseDosEspelhos(supabase, session.activeTenant.id, job.id, {
          // O mensal pede a data de recebimento de cada mês pelo
          // faturamento da cópia (decisão 149); os outros não leem meses.
          comMeses: modeloDoOrcamento === "mensal",
        })
      : Promise.resolve(null),
    // PPs que travam o "Cancelar aprovação" do job devolvido e o "Cancelar
    // envio à abertura": os dois pop-ups as listam e cancelam (decisão 143).
    job?.status === "rejeitado_financeiro" || job?.status === "aguardando_abertura"
      ? supabase
          .from("pedidos_compra")
          .select("id, codigo, valor, fornecedor:fornecedores(nome)")
          .eq("job_id", job.id)
          .eq("tenant_id", session.activeTenant.id)
          .neq("status", "cancelada")
          .order("codigo", { ascending: true })
          .returns<
            {
              id: string;
              codigo: string;
              valor: number | string | null;
              fornecedor: { nome: string } | null;
            }[]
          >()
      : Promise.resolve({ data: [], error: null }),
    // Os veículos da Mídia Off: os fornecedores ativos marcados como
    // veículo (decisão 147).
    midiaOff && versaoAtiva
      ? supabase
          .from("veiculos_midia")
          .select("fornecedor_id, fornecedor:fornecedores!inner(nome, status)")
          .eq("tenant_id", session.activeTenant.id)
          .eq("fornecedor.status", "ativo")
          .returns<{ fornecedor_id: string; fornecedor: { nome: string; status: string } }[]>()
      : Promise.resolve({ data: [], error: null }),
    // E os meios em que cada um já foi usado nas planilhas (decisão 150):
    // a lista da célula mostra primeiro os já usados no meio da linha.
    midiaOff && versaoAtiva
      ? supabase
          .from("vw_veiculos_meios_usados")
          .select("fornecedor_id, meio")
          .eq("tenant_id", session.activeTenant.id)
          .returns<{ fornecedor_id: string; meio: string }[]>()
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (ppsRes.error) console.error("[versao.pps_do_job]", (ppsRes.error as any).message);
  if (veiculosRes.error) console.error("[versao.veiculos]", (veiculosRes.error as any).message);
  if (usoRes.error) console.error("[versao.veiculos_uso]", (usoRes.error as any).message);
  const meiosUsados = new Map<string, string[]>();
  for (const u of usoRes.data ?? []) {
    meiosUsados.set(u.fornecedor_id, [...(meiosUsados.get(u.fornecedor_id) ?? []), u.meio]);
  }
  const veiculos: VeiculoDaLista[] = (veiculosRes.data ?? [])
    .map((v) => ({
      id: v.fornecedor_id,
      nome: v.fornecedor.nome,
      meios: (meiosUsados.get(v.fornecedor_id) ?? []).sort((a, b) => a.localeCompare(b, "pt-BR")),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const ppsQueTravam: PPQueTravaOEnvio[] = (ppsRes.data ?? []).map((pp) => ({
    id: pp.id,
    codigo: pp.codigo,
    fornecedorNome: pp.fornecedor?.nome ?? "— fornecedor não informado",
    valor: Number(pp.valor ?? 0),
  }));

  let fechamentoDaCopia: FechamentoDaCopia | null = null;
  // Modelo mensal: o faturamento de cada mês na mesma origem do fechamento
  // da cópia (decisão 149). Nulo fora do mensal.
  let porMesDaCopia: FaturamentoDoMes[] | null = null;
  if (reenvioRes && reenvioRes.ok) {
    const t = totaisDoFinanceiro(reenvioRes.base.itens, reenvioRes.base);
    fechamentoDaCopia = {
      faturamentoPrevisto: t.faturamentoPrevisto,
      valorJob: t.valorJob,
      totalGeradoEmSave: t.save.totalSaveGerado,
      totalConsumidoEmSave: t.save.totalSaveUsado,
    };
    porMesDaCopia = faturamentoPorMesDoFinanceiro(reenvioRes.base.itens, reenvioRes.base);
  } else if (reenvioRes) {
    console.error("[versao.reenvio]", reenvioRes.message);
  }

  if (gruposRes.error) console.error("[versao.grupos]", gruposRes.error.message);
  if (itensRes.error) console.error("[versao.itens]", itensRes.error.message);
  if (bvsRes.error) console.error("[versao.bvs]", (bvsRes.error as any).message);
  if (agregadoRes.error) console.error("[versoes.agg]", (agregadoRes.error as any).message);
  if (contatosRes.error) {
    console.error("[versao.contatos_job]", (contatosRes.error as any).message);
  }

  // ONDA 3 — o SAVE (docs/decisions/028-save-entre-jobs.md). Depende dos
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
  const itensPorVersaoMidia = new Map<string, { tipo_custo: any; total_orcado: number }[]>();
  for (const it of (agregadoRes.data ?? []) as any[]) {
    const atual = agregadoPorVersao.get(it.versao_orcamento_id) ?? {
      count: 0,
      total: 0,
    };
    atual.count += 1;
    atual.total += Number(it.total_orcado ?? 0);
    agregadoPorVersao.set(it.versao_orcamento_id, atual);
    if (midiaOff) {
      const lista = itensPorVersaoMidia.get(it.versao_orcamento_id) ?? [];
      lista.push({ tipo_custo: it.tipo_custo, total_orcado: Number(it.total_orcado ?? 0) });
      itensPorVersaoMidia.set(it.versao_orcamento_id, lista);
    }
  }
  // Na Mídia Off o total gravado é o NEGOCIADO; o valor da aba é o do job,
  // pela conta da mídia de cada versão (decisão 147).
  if (midiaOff) {
    for (const v of versoesTodas) {
      const agg = agregadoPorVersao.get(v.id);
      if (!agg) continue;
      agg.total = fechamentoDosItens(
        itensPorVersaoMidia.get(v.id) ?? [],
        parametrosDaVersao(v),
      ).valorJob;
    }
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

  // Sem largura própria: tela principal ocupa a largura do layout (decisão 085).
  return (
    <div className="space-y-6">
      <div>
        {/* Faixa do projeto (decisão 106): o voltar, a agregada e os
            orçamentos irmãos. Os irmãos chegam por streaming; o fallback
            é a mesma faixa sem eles, na mesma altura. */}
        <Suspense
          fallback={
            <FaixaDoProjeto
              {...faixaDoOrcamentoSemItens(
                {
                  id: params.projetoId,
                  codigo: projetoRaw.codigo,
                  nome: projetoRaw.nome,
                },
                podeCriarOrcamento,
              )}
              ativo={orcamento.id}
              itens={null}
            />
          }
        >
          <FaixaDosOrcamentos
            tenantId={session.activeTenant.id}
            projeto={{
              id: params.projetoId,
              codigo: projetoRaw.codigo,
              nome: projetoRaw.nome,
            }}
            orcamentoId={orcamento.id}
            podeCriarOrcamento={podeCriarOrcamento}
          />
        </Suspense>

        {/* Sem a linha do código do orçamento acima do nome: ele é só da
            base de dados e confundia a produção, que fala pelo código do
            job — o "Ver job" ao lado leva a ele (29/09/2026). */}
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{orcamento.nome}</h1>
            <Badge className={cn("border", statusBadgeClasses(orcamento.status))}>
              {orcamentoStatusLabel(orcamento.status)}
            </Badge>
            <OrcamentoEditorDrawer
              projetoId={params.projetoId}
              orcamento={orcamento}
              categorias={categoriasOrcamento}
              modeloPlanilhaAtual={
                orcamentoRaw?.categoria?.modelo_planilha ?? "nacional"
              }
              servicos={servicos}
              regionaisDoProjeto={regionaisDoProjeto}
              cidadesIniciais={cidadesIniciais}
              cidadeAtual={cidadeAtual}
              gpsDoProjeto={gpsDoProjeto}
              produtores={produtores}
              projetoNome={projetoRaw.nome}
              projetoCodigo={projetoRaw.codigo}
              disabled={protegido && !correcaoLiberada}
              arquivavel={!correcaoLiberada}
              disabledReason={
                arquivado
                  ? orcamentoArquivado
                    ? "Orçamento arquivado — reative para editar."
                    : "Projeto arquivado — reative o projeto para editar."
                  : protegido
                    ? `Bloqueado em ${orcamentoStatusLabel(orcamento.status).toLowerCase()} — alterações via fluxo de aprovação/job.`
                    : undefined
              }
            />
            {/* Exportar / Duplicar / Cancelar incidem sobre a ABA
                selecionada — por isso só existem quando há uma. Papeis
                sem `orcamentos.editar` (Financeiro, Freelancer) nao veem. */}
            {versaoAtiva && !readOnlyPeloPapel && (
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
                arquivado={arquivado}
                exportarBloqueado={
                  midiaOff
                    ? "A exportação de planilha da Mídia Off ainda não está disponível."
                    : undefined
                }
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

      {arquivado ? (
        <AvisoArquivado
          tipo="orcamento"
          projetoId={params.projetoId}
          orcamentoId={orcamento.id}
          podeReativar={!readOnlyPeloPapel}
          orcamentoArquivado={orcamentoArquivado}
          projetoArquivado={projetoArquivado}
        />
      ) : correcaoLiberada ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex items-start gap-3">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Job devolvido pelo financeiro: os dados do orçamento e o planejado
            estão abertos para correção. O orçado e a criação de novas versões
            continuam bloqueados.
          </p>
        </div>
      ) : protegido && (
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
        modeloPlanilha={orcamentoRaw?.categoria?.modelo_planilha ?? "nacional"}
        interno={orcamentoRaw?.servico?.investimento_interno === true}
        travarImpostos={
          (orcamentoRaw?.categoria?.modelo_planilha ?? "nacional") === "internacional" &&
          !pode(session.activeRole, "orcamentos.editar_impostos")
        }
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
          gpsDoEnvio={gpsDoEnvio}
          produtoresDoEnvio={produtoresDoEnvio}
          cidadesIniciais={cidadesIniciais}
          clienteNome={clienteNome ?? "—"}
          savePorItem={savePorItem}
          saldosDeSave={saldosDeSave}
          job={job}
          reservado={reservado}
          correcaoLiberada={correcaoLiberada}
          abrirRevisao={abrirRevisao}
          temJobAtivo={temJobAtivo}
          // Cliente sem código curto: o envio recusa com a mensagem que
          // pede o cadastro; a prévia fica em travessão.
          proximoCodigoJob={
            reservado
              ? reservado.codigo
              : projetoRaw.cliente?.codigo_curto
              ? proximoCodigoDeJob({
                  sigla: projetoRaw.cliente.codigo_curto,
                  ano: anoDoCodigoDeJob(),
                  codigos: (
                    (codigosDeJobRes.data ?? []) as { codigo: string }[]
                  ).map((j) => j.codigo),
                })
              : "—"
          }
          podeCriarVersao={podeCriarVersao}
          motivoBloqueio={motivoBloqueio}
          arquivado={arquivado}
          meses={(mesesRes.data ?? []) as VersaoOrcamentoMes[]}
          mesPedido={mesPedido}
          fechamentoDaCopia={fechamentoDaCopia}
          porMesDaCopia={porMesDaCopia}
          ppsQueTravam={ppsQueTravam}
          veiculos={veiculos}
        />
      ) : (
        <SemVersoes
          projetoId={params.projetoId}
          orcamentoId={orcamento.id}
          modeloPlanilha={orcamentoRaw?.categoria?.modelo_planilha ?? "nacional"}
          interno={orcamentoRaw?.servico?.investimento_interno === true}
          travarImpostos={
            (orcamentoRaw?.categoria?.modelo_planilha ?? "nacional") === "internacional" &&
          !pode(session.activeRole, "orcamentos.editar_impostos")
          }
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
  gpsDoEnvio,
  produtoresDoEnvio,
  cidadesIniciais,
  clienteNome,
  savePorItem,
  saldosDeSave,
  job,
  reservado,
  correcaoLiberada,
  abrirRevisao,
  temJobAtivo,
  proximoCodigoJob,
  podeCriarVersao,
  motivoBloqueio,
  arquivado,
  meses,
  mesPedido,
  fechamentoDaCopia,
  porMesDaCopia,
  ppsQueTravam,
  veiculos,
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
  fornecedores: { id: string; nome: string; cpf_cnpj: string | null }[];
  regionais: { id: string; nome: string }[];
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  /** Listas do envio para abertura (decisão 135). */
  gpsDoEnvio: Pick<Profile, "id" | "nome">[];
  produtoresDoEnvio: Pick<Profile, "id" | "nome">[];
  cidadesIniciais: CidadeOpcao[];
  clienteNome: string;
  /** Estado do save por id do item, e os saldos que este cliente tem para
   *  gastar (docs/decisions/028-save-entre-jobs.md). */
  savePorItem: Record<string, EstadoSaveDaLinha>;
  saldosDeSave: SaldoDeSave[];
  job: JobExistente | null;
  /** Sem job vivo: o job cancelado na devolução, cujo código volta no
   *  próximo envio (decisão 128). Já vem filtrado pela sigla do cliente. */
  reservado: JobReservado | null;
  /** Job devolvido: "Editar" e o planejado abertos para correção (128). */
  correcaoLiberada: boolean;
  /** `?abertura=revisar` — ver `FluxoAbertura`. */
  abrirRevisao: boolean;
  temJobAtivo: boolean;
  /** Prévia do código do job — o definitivo é gerado no envio. */
  proximoCodigoJob: string;
  podeCriarVersao: boolean;
  motivoBloqueio?: string;
  /** Orçamento ou projeto arquivado (decisão 118): a aba vira consulta. */
  arquivado: boolean;
  /** Meses da versão (modelo mensal, decisão 078); vazio nos demais. */
  meses: VersaoOrcamentoMes[];
  /** `?mes=` da URL. */
  mesPedido: string | undefined;
  /** Job devolvido ou aguardando abertura: o fechamento da cópia do job. */
  fechamentoDaCopia: FechamentoDaCopia | null;
  /** Modelo mensal: o faturamento de cada mês da cópia, junto do
   *  fechamento acima (decisão 149). Nulo sem cópia ou fora do mensal. */
  porMesDaCopia: FaturamentoDoMes[] | null;
  /** PPs do job vivo de pré-abertura fora de `cancelada` (decisão 143). */
  ppsQueTravam: PPQueTravaOEnvio[];
  /** Mídia Off (decisão 147): os veículos do cadastro; vazio nos demais. */
  veiculos: VeiculoDaLista[];
}) {
  // Orçamento de serviço Interno (decisão 105): tipo F · Interno travado,
  // planejado igual ao orçado e sem save.
  const interno: boolean = orcamentoRaw?.servico?.investimento_interno === true;
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
  //
  // LISTA por item desde 08/09/2026 (decisão 062): um item pode ter vários
  // BVs, cada um com fornecedor, alíquota e situação próprios.
  const bvsPorItem: Record<string, ItemBv[]> = {};
  for (const raw of bvsBrutos) {
    const { item: _joinFiltro, ...bv } = raw;
    (bvsPorItem[bv.item_versao_id] ??= []).push({
      ...bv,
      valor: Number(bv.valor ?? 0),
    });
  }

  // Financeiro cai aqui como se a versao estivesse aprovada (ver `readOnlyPeloPapel`
  // na page): a planilha inteira e os controles secundarios ficam read-only.
  const readOnlyPeloPapel = !pode(session.activeRole, "orcamentos.editar");
  const readOnly =
    versao.status === "aprovada" ||
    versao.status === "cancelada" ||
    readOnlyPeloPapel ||
    arquivado;
  const temBv = Object.keys(bvsPorItem).length > 0;
  // Job devolvido (decisão 128): com a versão aprovada travada, só o
  // planejado abre — na versão que gerou o job.
  const soPlanejado =
    correcaoLiberada &&
    versao.status === "aprovada" &&
    versao.id === orcamento.versao_aprovada_id;

  // De qual modelo é esta planilha. Sai da CATEGORIA do orçamento, pelo
  // campo `modelo_planilha` — nunca pelo nome dela (decisão 072). É o
  // mesmo objeto que desce para a planilha, para o card de Totais e para
  // o cabeçalho da versão: um só lugar decide, e os três concordam.
  const planilha = configDaPlanilha(
    orcamentoRaw.categoria?.modelo_planilha,
    versao,
  );

  const totais = calcularTotaisVersao(
    itens,
    Number(versao.percentual_honorarios),
    Number(versao.percentual_imposto),
    planilha.internacional,
  );
  // Mídia Off (decisão 147): a conta é a da mídia — veículo + honorários,
  // o imposto de dentro dos honorários. O total gravado é o negociado.
  const midiaOff = planilha.modeloPlanilha === "midia_off";
  const paramsMidia = midiaOff ? parametrosDaVersao(versao) : null;
  const fechamentoMidia = paramsMidia ? fechamentoDosItens(itens, paramsMidia) : null;
  // Modelo mensal (decisão 078) e Mídia Off: mês sem item bloqueia a
  // aprovação. A mesma conta roda no servidor, sobre o banco.
  const mesesVazios =
    planilha.modeloPlanilha === "mensal" || midiaOff
      ? mesesSemItens(meses, grupos, itens)
      : null;
  const custoPlanejado = fechamentoMidia
    ? fechamentoMidia.custoPlanejado
    : itens.reduce((s, it) => s + Number(it.total_planejado ?? 0), 0);

  // ⚠️ O BV saiu da conta do resultado PLANEJADO em 08/09/2026 (decisão
  // 062). Até aqui ele era somado de volta como "+ BVs", espelhando a
  // dedução que a planilha fazia no planejado. Sem a dedução, somá-lo
  // aqui faria o painel e a coluna PLANEJADO contarem histórias
  // diferentes sobre o mesmo item.
  //
  // A comissão volta a aparecer no REALIZADO, na planilha do job — que é
  // onde ela de fato acontece.
  // `deducoesDoResultado`, e não `imposto`: no internacional saem do valor
  // do job também as int. taxes e os custos de transação. No nacional o
  // campo vale exatamente `imposto`, então o número não muda lá.
  const resultadoNacional = calcularResultadoOperacional(
    totais.valorJob,
    totais.deducoesDoResultado,
    custoPlanejado,
  );
  const { resultadoOperacional, resultadoGeral } = fechamentoMidia
    ? {
        resultadoOperacional: fechamentoMidia.resultadoOperacional,
        resultadoGeral: fechamentoMidia.resultadoGeral,
      }
    : resultadoNacional;
  const valorDoJob = fechamentoMidia ? fechamentoMidia.valorJob : totais.valorJob;
  const faturamentoPrevisto = fechamentoMidia
    ? fechamentoMidia.faturamentoPrevisto
    : totais.faturamentoPrevisto;

  // Envio para abertura do Fee e do Always On (decisão 149): os meses e o
  // faturamento de cada um, na MESMA origem do fechamento que o formulário
  // mostra — a cópia do job quando ela existe, a versão antes do envio.
  // Nulo fora do mensal: é isso que mantém a Data Evento e a data única.
  const mesesDoEnvio =
    planilha.modeloPlanilha === "mensal"
      ? (
          porMesDaCopia ??
          faturamentoPorMes(
            meses,
            grupos,
            itens,
            Number(versao.percentual_honorarios),
            Number(versao.percentual_imposto),
            planilha.internacional,
          )
        ).map((m) => ({ mes: m.mes, faturamento: m.faturamento }))
      : null;

  // Preview do código: o definitivo é gerado no insert. Serve só pra tela
  // não mostrar campo vazio — se outro job entrar antes, o número muda.

  const contatosDoJob = contatosBrutos.map((c) => ({
    nome: (c.nome as string | null) ?? "",
    numero: (c.numero as string | null) ?? "",
    email: (c.email as string | null) ?? "",
  }));

  // Job devolvido (decisão 128): nome e datas se corrigem pelo "Editar"
  // do orçamento, então o reenvio parte do orçamento — partir do job
  // devolveria ao orçamento o valor de antes da correção. Sem job vivo e
  // com o código reservado, o formulário nasce do job cancelado.
  const devolvido = job?.status === "rejeitado_financeiro";
  const origemDoEnvio = job ?? reservado;
  const inicialModal = {
    nome: (devolvido ? null : job?.nome) ?? orcamento.nome,
    // Cidade e regional são editáveis no modal: entram pré-preenchidas
    // com o que está hoje no orçamento.
    cidadeId: orcamento.cidade_id ?? "",
    cidadeNome: orcamentoRaw.cidade?.nome ?? "",
    regionalId: orcamento.regional_id ?? "",
    // GP e produtor também (decisão 135): partem do orçamento, que o envio
    // atualiza junto com o job.
    gpId: orcamento.gp_responsavel_id ?? "",
    produtorId: orcamento.produtor_id ?? "",
    dataInicio:
      (devolvido ? null : job?.data_inicio_prevista) ??
      orcamento.data_inicio_prevista ??
      "",
    dataFim:
      (devolvido ? null : job?.data_fim_prevista) ?? orcamento.data_fim_prevista ?? "",
    // Só o job tem data de evento — não há de onde pré-preencher antes
    // do envio (o orçamento não guarda o campo).
    dataEvento: origemDoEnvio?.data_evento ?? "",
    dataFaturamento: origemDoEnvio?.data_prevista_faturamento ?? "",
    // Fee e Always On (decisão 149): um mês por linha, com a data que o job
    // já tinha (reenvio, "Ver dados do job", código reservado). Nada é
    // "sugerido" aqui: a sugestão só nasce de escolher o primeiro mês.
    recebimentosPorMes: (mesesDoEnvio ?? []).map((m) => ({
      mes: m.mes,
      data: origemDoEnvio?.recebimento_previsto_por_mes?.[m.mes] ?? "",
      sugerida: false,
    })),
    // O Descritivo do orçamento adianta o do envio (decisão 037): quem
    // escreveu no calor da negociação não reescreve aqui. O job manda
    // quando já existe — ali o texto já foi ajustado neste modal, e
    // sobrescrever com o do orçamento apagaria a edição.
    observacoes: origemDoEnvio?.observacoes ?? orcamento.descritivo ?? "",
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
    // Só o resumo do job já enviado lê estes dois: antes do envio GP e
    // produtor são campos do formulário (decisão 135).
    gpNome: job ? job.responsavel?.nome ?? null : orcamentoRaw.gp?.nome ?? null,
    produtorNome: job
      ? job.produtor?.nome ?? null
      : orcamentoRaw.produtor?.nome ?? null,
    // Categoria e serviço do job = os do orçamento, sempre.
    categoriaNome: orcamentoRaw.categoria?.nome ?? null,
    servicoNome: orcamentoRaw.servico?.nome ?? null,
    // Id: é ele que trava o envio no modal, nunca o nome acima (ver
    // `HerdadosJob`). Vem sempre do cadastro de hoje, que é o que o
    // servidor relê na hora de gravar.
    produtoId: (projetoRaw?.produto_id as string | null) ?? null,
    projetoComVariasMarcas:
      ((projetoRaw?.marcas as { produto_id: string }[] | null) ?? []).length > 1,
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
            percentualHonorarios={Number(versao.percentual_honorarios)}
            percentualImposto={Number(versao.percentual_imposto)}
            // Honorarios nasce do cadastro do cliente; divergir dele nesta
            // versao e ato de quem tem `orcamentos.editar_impostos`
            // (Admin + GP a partir de 03/09/2026 — antes era so admin).
            podeEditarHonorarios={pode(session.activeRole, "orcamentos.editar_impostos")}
            clienteNome={clienteNome}
            readOnly={versao.status === "aprovada" || arquivado}
            readOnlyReason={
              arquivado
                ? "Orçamento arquivado não pode ser editado."
                : "Versão aprovada não pode ser editada."
            }
            internacional={
              planilha.modeloPlanilha === "internacional"
                ? {
                    moedaEstrangeira: versao.moeda_estrangeira ?? "",
                    cambioCotacao:
                      versao.cambio_cotacao === null
                        ? null
                        : Number(versao.cambio_cotacao),
                    cambioCompra:
                      versao.cambio_compra === null
                        ? null
                        : Number(versao.cambio_compra),
                    cambioVenda:
                      versao.cambio_venda === null
                        ? null
                        : Number(versao.cambio_venda),
                    cambioData: versao.cambio_data,
                    percentualIntTaxes: Number(versao.percentual_int_taxes ?? 0),
                    intTransactionCosts: Number(
                      versao.int_transaction_costs ?? 0,
                    ),
                  }
                : null
            }
            midia={
              midiaOff
                ? {
                    percentualVeiculo: Number(versao.percentual_veiculo ?? 80),
                    base: versao.base_honorarios === "liquido" ? "liquido" : "negociado",
                  }
                : null
            }
          />
          {pode(session.activeRole, "orcamentos.aprovar") && !arquivado && (
            <AprovacaoActions
              versaoId={versao.id}
              versaoLabel={`v${versao.numero_versao}`}
              status={versao.status}
              temJobAtivo={temJobAtivo}
              jobDevolvidoCodigo={devolvido && job ? job.codigo : null}
              jobDevolvidoId={devolvido && job ? job.id : null}
              ppsQueTravam={devolvido ? ppsQueTravam : []}
            />
          )}
        </div>

        <ResumoRentabilidade
          valorJob={valorDoJob}
          resultadoOperacional={resultadoOperacional}
          resultadoGeral={resultadoGeral}
          moeda={versao.moeda}
        />
      </div>

      <BannersEstado
        versaoLabel={`v${versao.numero_versao}`}
        aprovada={versao.status === "aprovada"}
        job={job}
        jobHref={job ? `/jobs/${job.id}` : null}
        correcao={
          reservado
            ? { codigo: reservado.codigo, motivo: reservado.motivo_rejeicao }
            : null
        }
      />

      {/* Modelo mensal (decisão 078): régua de meses, planilha do mês ou
          vista do trimestre. O "Importar planilha" da versão fica na régua,
          ao lado do "Editar meses": a planilha troca todos os meses de uma
          vez (15/09/2026). O fluxo de aprovação e abertura, abaixo, é o
          mesmo dos outros. */}
      {midiaOff && paramsMidia ? (
        // Mídia Off (decisão 147): régua da campanha, meios por mês e a
        // conta da mídia.
        <PlanilhaMidiaOff
          projetoId={params.projetoId}
          orcamentoId={params.orcId}
          versaoId={versao.id}
          numeroVersao={versao.numero_versao}
          meses={meses}
          grupos={grupos}
          itens={itens}
          veiculos={veiculos}
          params={paramsMidia}
          mesPedido={mesPedido}
          readOnly={readOnly}
        />
      ) : planilha.modeloPlanilha === "mensal" ? (
        <PlanilhaMensal
          projetoId={params.projetoId}
          orcamentoId={params.orcId}
          versao={versao}
          grupos={grupos}
          itens={itens}
          meses={meses}
          mesPedido={mesPedido}
          inicioPrevisto={orcamento.data_inicio_prevista}
          readOnly={readOnly}
          soPlanejado={soPlanejado}
          podeMarcarSave={pode(session.activeRole, "orcamentos.marcar_em_save")}
          categorias={categorias}
          bvsPorItem={bvsPorItem}
          fornecedores={fornecedores}
          clienteNome={clienteNome}
          savePorItem={savePorItem}
          saldosDeSave={saldosDeSave}
          planilha={planilha}
          interno={interno}
          importacao={{
            disabled: temJobAtivo || !podeCriarVersao,
            disabledReason: temJobAtivo
              ? versao.status === "aprovada"
                ? "Esta versão já gerou um job e não pode ser sobrescrita."
                : "O orçamento já gerou um job — nenhuma versão dele aceita ser sobrescrita."
              : motivoBloqueio,
          }}
        />
      ) : (
      <>
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
            <ImportarPlanilhaVersao
              projetoId={params.projetoId}
              orcamentoId={params.orcId}
              modeloPlanilha={planilha.modeloPlanilha}
              interno={interno}
              modo="sobrescrever"
              versaoId={versao.id}
              numeroVersao={versao.numero_versao}
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
          soPlanejado={soPlanejado}
          podeMarcarSave={pode(session.activeRole, "orcamentos.marcar_em_save")}
          categorias={categorias}
          bvsPorItem={bvsPorItem}
          fornecedores={fornecedores}
          versaoLabel={`v${versao.numero_versao}`}
          percentualHonorarios={Number(versao.percentual_honorarios)}
          percentualImposto={Number(versao.percentual_imposto)}
          versaoId={versao.id}
          clienteNome={clienteNome}
          savePorPadrao={versao.save_por_padrao === true}
          saveConsumoJobId={versao.save_consumo_job_id ?? null}
          savePorItem={savePorItem}
          saldosDeSave={saldosDeSave}
          nomeDoGrupo={Object.fromEntries(grupos.map((g) => [g.id, g.nome]))}
          modeloPlanilha={planilha.modeloPlanilha}
          internacional={planilha.internacional}
          moedaEstrangeira={planilha.moedaEstrangeira}
          interno={interno}
        />
      </div>
      </>
      )}

      {/* Arquivado (decisão 118) não se aprova nem vira job: a barra de
          aprovação e abertura não tem o que oferecer. */}
      {!arquivado && (
      <FluxoAbertura
        versaoId={versao.id}
        versaoLabel={`v${versao.numero_versao}`}
        versaoStatus={versao.status}
        orcamentoNome={orcamento.nome}
        jobHref={job ? `/jobs/${job.id}` : null}
        qtdGrupos={
          // Na Mídia Off a barra conta os meios (meio + formato), e não os
          // grupos de cada mês.
          midiaOff
            ? new Set(grupos.filter((g) => g.meio).map((g) => meioDoGrupo(g).chave)).size
            : grupos.length
        }
        qtdItens={itens.length}
        qtdItensComValor={itens.filter((i) => i.total_orcado > 0).length}
        percentualImposto={Number(versao.percentual_imposto)}
        cambioInternacional={
          planilha.modeloPlanilha === "internacional"
            ? {
                moeda: versao.moeda_estrangeira,
                compra: versao.cambio_compra,
                cotacao: versao.cambio_cotacao,
                venda: versao.cambio_venda,
                data: versao.cambio_data,
              }
            : null
        }
        mesesSemItens={mesesVazios}
        linhasSemVeiculo={midiaOff ? itens.filter((i) => !i.fornecedor_id).length : null}
        midiaOff={midiaOff}
        periodoTravado={planilha.modeloPlanilha === "mensal"}
        servicoInterno={interno}
        mesesDoEnvio={mesesDoEnvio}
        custoPlanejado={custoPlanejado}
        faturamentoPrevisto={faturamentoPrevisto}
        totalGeradoEmSave={midiaOff ? 0 : totais.save.totalSaveGerado}
        // O consumo de save e de quais jobs (decisão 155): o envio mostra
        // o que a abertura vai aprovar.
        totalConsumidoEmSave={midiaOff ? 0 : totais.save.totalSaveUsado}
        origensDoConsumo={[
          ...new Set(
            Object.values(savePorItem)
              .filter((s) => s.saveConsumido > 0)
              .flatMap((s) => s.origens.map((o) => o.codigo)),
          ),
        ]}
        valorJob={valorDoJob}
        fechamentoDaCopia={fechamentoDaCopia}
        moeda={versao.moeda}
        clienteNome={clienteNome}
        proximoCodigoJob={proximoCodigoJob}
        codigoReservado={reservado?.codigo ?? null}
        projetoNome={projetoRaw?.nome ?? "—"}
        herdados={herdados}
        regionaisDoProjeto={regionaisDoProjeto}
        gpsDoProjeto={gpsDoEnvio}
        produtores={produtoresDoEnvio}
        // Já vêm limitadas de `listarCidadesIniciais`; o resto do Brasil
        // vem do servidor a cada digitação.
        cidadesIniciais={cidadesIniciais}
        inicial={inicialModal}
        job={job}
        ppsQueTravam={job?.status === "aguardando_abertura" ? ppsQueTravam : []}
        podeEnviarAbertura={pode(session.activeRole, "jobs.enviar_abertura")}
        abrirRevisao={abrirRevisao}
      />
      )}
    </>
  );
}

/** Orçamento recém-criado, sem nenhuma versão ainda. */
function SemVersoes({
  projetoId,
  orcamentoId,
  modeloPlanilha,
  interno,
  travarImpostos,
  honorariosCliente,
  clienteNome,
  podeCriarVersao,
  motivoBloqueio,
}: {
  projetoId: string;
  orcamentoId: string;
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Orçamento de serviço Interno (decisão 105). */
  interno: boolean;
  travarImpostos: boolean;
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
          travarImpostos={travarImpostos}
          disabled={!podeCriarVersao}
          disabledReason={motivoBloqueio}
        />
        <ImportarPlanilhaVersao
          projetoId={projetoId}
          orcamentoId={orcamentoId}
          modeloPlanilha={modeloPlanilha}
          interno={interno}
          // Mídia Off (decisão 147): a importação ainda não existe para ela.
          disabled={!podeCriarVersao || modeloPlanilha === "midia_off"}
          disabledReason={
            modeloPlanilha === "midia_off"
              ? "A importação de planilha da Mídia Off ainda não está disponível."
              : motivoBloqueio
          }
        />
      </div>
    </div>
  );
}
