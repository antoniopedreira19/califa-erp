import { notFound } from "next/navigation";
import { servicosDoOrcamentoQuery, type ServicoOption } from "@/lib/data/servicos";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { saveDaVersao, saldosDeSaveDoCliente } from "@/lib/data/saves";
import type { SaldoDeSave } from "@/lib/data/saves";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import { listActiveMembers } from "@/lib/data/members";
import { listarCidadesIniciais } from "@/lib/data/cidades";
import { HONORARIOS_PADRAO_FALLBACK } from "@/lib/validations/clientes";
import type {
  Categoria,
  CategoriaDominio,
  Profile,
  Regional,
  TipoCusto,
  VersaoOrcamento,
} from "@/lib/types";
import { EditorAgregado } from "./editor-agregado";
import type { OrcamentoRascunho } from "../../_rascunho/tipos";

export const dynamic = "force-dynamic";

/** Status em que o orçamento saiu da mesa — não somam ao projeto. */
const STATUS_FORA = ["cancelado", "recusado"];

/** Status em que a planilha não se altera mais por aqui, com o motivo. */
function motivoBloqueio(
  statusOrcamento: string,
  statusVersao: string,
): string | null {
  if (statusOrcamento === "job_criado") {
    return "Este orçamento já virou job e foi enviado ao financeiro. A planilha passa a ser tratada na tela do job.";
  }
  if (statusOrcamento === "aprovado" || statusVersao === "aprovada") {
    return "Versão aprovada. Para alterar, cancele a aprovação na tela do orçamento — nesta tela nada é editado depois do aceite.";
  }
  return null;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Visão agregada dos orçamentos do projeto — a continuação do orçamento do
 * projeto.
 *
 * Monta aqui, no servidor, o estado inicial de cada orçamento a partir da
 * versão que vale: a aprovada, e sem ela a mais recente não cancelada. O
 * editor recebe tudo pronto e trabalha em memória até o "Salvar alterações".
 */
export default async function OrcamentosAgregadoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [
    projRes,
    orcsRes,
    categoriasOrcRes,
    servicosRes,
    cidadesIniciais,
    categoriasItemRes,
    fornecedoresRes,
    produtores,
    vinculosRegRes,
    vinculosRespRes,
  ] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, codigo, nome, cliente_id, cliente:clientes(nome_fantasia, percentual_honorarios_padrao), responsavel:profiles!responsavel_id(nome)",
      )
      .eq("id", params.projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("orcamentos")
      .select(
        "id, codigo, nome, status, versao_aprovada_id, categoria_id, servico_id, descritivo, regional_id, " +
          "cidade_id, cidade:cidades(nome), gp_responsavel_id, produtor_id, " +
          "data_inicio_prevista, data_fim_prevista",
      )
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId)
      .not("status", "in", `(${STATUS_FORA.join(",")})`)
      .order("codigo", { ascending: true }),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    // Serviço: mesma tabela, escopo `projeto` — a outra lista (037).
    servicosDoOrcamentoQuery(supabase, tenantId),
    // Só as primeiras cidades: o combobox do formulário busca o resto no
    // servidor a cada digitação. O nome da cidade de cada orçamento já
    // gravado vem no embed acima.
    listarCidadesIniciais(tenantId),
    supabase
      .from("categorias")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("nome")
      .returns<Categoria[]>(),
    supabase
      .from("fornecedores")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .order("nome")
      .returns<{ id: string; nome: string }[]>(),
    listActiveMembers(tenantId),
    supabase
      .from("projeto_regionais")
      .select("regional_id, regional:regionais(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId),
    supabase
      .from("projeto_responsaveis")
      .select("profile_id, profile:profiles(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId),
  ]);

  const projeto = projRes.data as any;
  if (!projeto) notFound();

  const orcamentos = (orcsRes.data ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    nome: string;
    status: string;
    versao_aprovada_id: string | null;
    categoria_id: string | null;
    servico_id: string | null;
    descritivo: string | null;
    regional_id: string;
    cidade_id: string;
    cidade: { nome: string } | null;
    gp_responsavel_id: string;
    produtor_id: string;
    data_inicio_prevista: string | null;
    data_fim_prevista: string | null;
  }>;

  // Versões utilizáveis de todos os orçamentos em uma consulta só — a
  // escolha de qual vale acontece em memória.
  const { data: versoesRaw } =
    orcamentos.length > 0
      ? await supabase
          .from("versoes_orcamento")
          .select(
            "id, orcamento_id, numero_versao, status, moeda, taxa_cambio, " +
              "percentual_honorarios, percentual_imposto",
          )
          .in(
            "orcamento_id",
            orcamentos.map((o) => o.id),
          )
          .eq("tenant_id", tenantId)
          .neq("status", "cancelada")
          .order("numero_versao", { ascending: false })
      : { data: [] as any[] };

  const versoes = (versoesRaw ?? []) as Array<{
    id: string;
    orcamento_id: string;
    numero_versao: number;
    status: VersaoOrcamento["status"];
    moeda: string;
    taxa_cambio: number | string;
    percentual_honorarios: number | string;
    percentual_imposto: number | string;
  }>;

  const vigentePorOrcamento = new Map<string, (typeof versoes)[number]>();
  for (const orc of orcamentos) {
    const doOrcamento = versoes.filter((v) => v.orcamento_id === orc.id);
    const aprovada =
      doOrcamento.find((v) => v.id === orc.versao_aprovada_id) ??
      doOrcamento.find((v) => v.status === "aprovada");
    const escolhida = aprovada ?? doOrcamento[0];
    if (escolhida) vigentePorOrcamento.set(orc.id, escolhida);
  }

  const versaoIds = [...vigentePorOrcamento.values()].map((v) => v.id);

  const [gruposRes, itensRes, bvsRes] = await Promise.all([
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_grupos")
          .select("id, nome, versao_orcamento_id, ordem")
          .eq("tenant_id", tenantId)
          .in("versao_orcamento_id", versaoIds)
          .order("ordem", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_itens")
          .select(
            "id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo, categoria_id, " +
              "planilha_origem, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
              "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
              "em_save, save_consumido",
          )
          .eq("tenant_id", tenantId)
          .in("versao_orcamento_id", versaoIds)
          .order("ordem", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    versaoIds.length > 0
      ? supabase
          .from("itens_bv")
          .select(
            "item_versao_id, fornecedor_id, valor, prazo_repasse, " +
              "item:versoes_orcamento_itens!inner(versao_orcamento_id)",
          )
          .eq("tenant_id", tenantId)
          .neq("situacao", "cancelado")
          .in("item.versao_orcamento_id", versaoIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const bvPorItem = new Map(
    ((bvsRes.data ?? []) as any[]).map((b) => [
      b.item_versao_id as string,
      {
        fornecedor_id: (b.fornecedor_id ?? null) as string | null,
        valor: num(b.valor),
        prazo_repasse: (b.prazo_repasse ?? null) as string | null,
      },
    ]),
  );

  const itensPorGrupo = new Map<string, any[]>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const lista = itensPorGrupo.get(it.grupo_id) ?? [];
    lista.push({
      id: it.id,
      item: it.item,
      tipo_custo: it.tipo_custo as TipoCusto,
      categoria_id: it.categoria_id ?? null,
      valor_unitario_orcado: num(it.valor_unitario_orcado),
      quantidade_orcada: num(it.quantidade_orcada),
      dias_meses_orcado: num(it.dias_meses_orcado),
      valor_unitario_planejado: num(it.valor_unitario_planejado),
      quantidade_planejada: num(it.quantidade_planejada),
      dias_meses_planejado: num(it.dias_meses_planejado),
      planilha_origem: it.planilha_origem ?? null,
      em_save: it.em_save === true,
      save_consumido: num(it.save_consumido),
      bv: bvPorItem.get(it.id) ?? null,
    });
    itensPorGrupo.set(it.grupo_id, lista);
  }

  // O save de cada versão do agregado. Em paralelo: são consultas
  // independentes, e a regra da casa é `Promise.all` (docs/PERFORMANCE).
  // A coluna mostra aqui o mesmo estado da planilha da versão — em
  // leitura: marcar save continua na tela da versão.
  const savePorVersao = await Promise.all(
    versaoIds.map((vid) =>
      saveDaVersao(
        supabase,
        tenantId,
        vid,
        ((itensRes.data ?? []) as any[])
          .filter((it) => it.versao_orcamento_id === vid)
          .map((it) => ({
            id: it.id,
            em_save: it.em_save === true,
            save_consumido: num(it.save_consumido),
          })),
      ),
    ),
  );
  const savePorItem = Object.assign({}, ...savePorVersao) as Record<
    string,
    EstadoSaveDaLinha
  >;

  // Os saldos que este cliente tem para gastar. É o que alimenta o
  // "consumir save de outro job" do formulário — sem eles a aba abre
  // vazia e a linha só consegue GERAR crédito.
  const saldosDeSave: SaldoDeSave[] = (projeto as any).cliente_id
    ? await saldosDeSaveDoCliente(
        supabase,
        tenantId,
        (projeto as any).cliente_id as string,
      )
    : [];

  // O formulário mostra de qual grupo a linha veio; aqui a tela tem
  // vários orçamentos, então o mapa cobre os grupos de todos eles.
  const nomeDoGrupo: Record<string, string> = {};
  for (const g of (gruposRes.data ?? []) as any[]) {
    nomeDoGrupo[g.id] = g.nome;
  }

  const gruposPorVersao = new Map<string, any[]>();
  for (const g of (gruposRes.data ?? []) as any[]) {
    const lista = gruposPorVersao.get(g.versao_orcamento_id) ?? [];
    lista.push({
      id: g.id,
      nome: g.nome,
      itens: itensPorGrupo.get(g.id) ?? [],
    });
    gruposPorVersao.set(g.versao_orcamento_id, lista);
  }

  const inicial: OrcamentoRascunho[] = orcamentos.map((orc) => {
    const versao = vigentePorOrcamento.get(orc.id);
    const grupos = versao ? (gruposPorVersao.get(versao.id) ?? []) : [];
    const bloqueio = versao
      ? motivoBloqueio(orc.status, versao.status)
      : "Este orçamento ainda não tem nenhuma versão. Crie a primeira na tela do orçamento.";

    return {
      id: orc.id,
      nome: orc.nome,
      categoria_id: orc.categoria_id,
      servico_id: orc.servico_id ?? null,
      descritivo: orc.descritivo ?? null,
      regional_id: orc.regional_id,
      cidade_id: orc.cidade_id,
      cidade_nome: orc.cidade?.nome ?? "",
      gp_responsavel_id: orc.gp_responsavel_id,
      produtor_id: orc.produtor_id,
      data_inicio_prevista: orc.data_inicio_prevista,
      data_fim_prevista: orc.data_fim_prevista,
      // Aberto quando dá para mexer: a tela existe para editar.
      aberto: bloqueio === null,
      origem: grupos.length > 0 ? "manual" : null,
      grupos,
      arquivoNome: null,
      percentualHonorariosDetectado: null,
      parametros: {
        moeda: versao?.moeda ?? "BRL",
        taxa_cambio: num(versao?.taxa_cambio) || 1,
        percentual_honorarios: num(versao?.percentual_honorarios),
        percentual_imposto: num(versao?.percentual_imposto),
      },
      origemBanco: versao
        ? {
            orcamentoId: orc.id,
            versaoId: versao.id,
            numeroVersao: versao.numero_versao,
            codigo: orc.codigo,
            statusOrcamento: orc.status,
            statusVersao: versao.status,
            bloqueio,
          }
        : {
            orcamentoId: orc.id,
            versaoId: "",
            numeroVersao: 0,
            codigo: orc.codigo,
            statusOrcamento: orc.status,
            statusVersao: "",
            bloqueio,
          },
    };
  });

  const regionaisDoProjeto = ((vinculosRegRes.data ?? []) as any[])
    .filter((v) => v.regional)
    .map((v) => ({ id: v.regional.id as string, nome: v.regional.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<
    Regional,
    "id" | "nome"
  >[];

  const gpsDoProjeto = ((vinculosRespRes.data ?? []) as any[])
    .filter((v) => v.profile)
    .map((v) => ({ id: v.profile.id as string, nome: v.profile.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<
    Profile,
    "id" | "nome"
  >[];

  return (
    <EditorAgregado
      servicos={(servicosRes.data ?? []) as ServicoOption[]}
      savePorItem={savePorItem}
      saldosDeSave={saldosDeSave}
      nomeDoGrupo={nomeDoGrupo}
      projeto={{
        id: projeto.id,
        codigo: projeto.codigo,
        nome: projeto.nome,
        cliente: projeto.cliente?.nome_fantasia ?? null,
        responsavel: projeto.responsavel?.nome ?? null,
      }}
      honorariosCliente={Number(
        projeto.cliente?.percentual_honorarios_padrao ??
          HONORARIOS_PADRAO_FALLBACK,
      )}
      orcamentosExistentes={orcamentos.length}
      inicial={inicial}
      categorias={(categoriasOrcRes.data ?? []) as Pick<
        CategoriaDominio,
        "id" | "nome"
      >[]}
      regionaisDoProjeto={regionaisDoProjeto}
      cidadesIniciais={cidadesIniciais}
      gpsDoProjeto={gpsDoProjeto}
      produtores={produtores}
      categoriasItem={categoriasItemRes.data ?? []}
      fornecedores={fornecedoresRes.data ?? []}
    />
  );
}
