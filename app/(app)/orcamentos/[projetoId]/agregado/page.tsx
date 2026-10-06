import { notFound } from "next/navigation";
import { FaixaDoProjeto } from "@/components/faixa-do-projeto";
import { AGREGADA, itensDeOrcamentos } from "@/lib/faixa-do-projeto";
import { novoOrcamentoHref } from "../faixa-orcamentos";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { chaveDoCambio } from "@/app/(app)/_planilha/moeda-estrangeira";
import { servicosDoOrcamentoQuery, type ServicoOption } from "@/lib/data/servicos";
import { requireSession } from "@/lib/auth/session";
import { pode } from "@/lib/permissoes";
import { createClient } from "@/lib/supabase/server";
import { saveDaVersao, saldosDeSaveDoCliente } from "@/lib/data/saves";
import type { SaldoDeSave } from "@/lib/data/saves";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import { listActiveMembers } from "@/lib/data/members";
import { listarCidadesIniciais } from "@/lib/data/cidades";
import { HONORARIOS_PADRAO_FALLBACK } from "@/lib/validations/clientes";
import { escolherJobDoFunil, estagioFunil } from "@/lib/calculos/funil";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import type {
  Categoria,
  CategoriaDominio,
  ItemBv,
  JobStatus,
  OrcamentoStatus,
  Profile,
  Regional,
  TipoCusto,
  VersaoOrcamento,
  CategoriaModeloPlanilha,
} from "@/lib/types";
import type { CategoriaParaServico } from "@/lib/categorias-do-servico";
import { EditorAgregado } from "./editor-agregado";
import type { OrcamentoMidiaNaAgregada } from "./card-midia";
import {
  chaveDoMeio,
  fechamentoDosItens,
  parametrosDaVersao,
} from "@/lib/calculos/midia-off";
import type { OrcamentoRascunho } from "../../_rascunho/tipos";
import type { OrcamentoExportavel } from "../../_selecao/exportar-orcamentos-menu";

export const dynamic = "force-dynamic";

/** Status em que o orçamento saiu da mesa — não somam ao projeto. */
const STATUS_FORA = ["cancelado", "recusado"];

/** Status em que a planilha não se altera mais por aqui, com o motivo. */
function motivoBloqueio(
  statusOrcamento: string,
  statusVersao: string,
): string | null {
  // O orçamento de Fee ou Always On (decisão 078) se edita aqui desde
  // 16/09/2026: grupos e itens dentro dos meses que ele já tem. Os meses em
  // si continuam na tela do orçamento.
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
 * editor recebe tudo pronto e grava cada alteração na hora (decisão 148).
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
        "id, codigo, nome, status, cliente_id, cliente:clientes(nome_fantasia, percentual_honorarios_padrao), responsavel:profiles!responsavel_id(nome)",
      )
      .eq("id", params.projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("orcamentos")
      .select(
        "id, codigo, nome, status, arquivado_em, versao_aprovada_id, categoria_id, servico_id, descritivo, regional_id, " +
        // `!categoria_id`: `orcamentos` tem duas FKs para
        // `categorias_dominio`, e o embed ambíguo derruba a query inteira.
        "categoria:categorias_dominio!categoria_id(modelo_planilha), " +
          "cidade_id, cidade:cidades(nome), gp_responsavel_id, produtor_id, " +
          "data_inicio_prevista, data_fim_prevista",
      )
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId)
      .not("status", "in", `(${STATUS_FORA.join(",")})`)
      // Arquivado (decisão 118) não entra na agregada: saiu da mesa como o
      // cancelado, e só volta pelo filtro da lista do projeto.
      .is("arquivado_em", null)
      .order("codigo", { ascending: true }),
    supabase
      .from("categorias_dominio")
      // `modelo_planilha` vem junto: é ele que diz como o orçamento criado
      // aqui vai fechar (decisão 072). `servico_exclusivo_id` e o modelo
      // separam as categorias do Fee e do Always On, que não nascem por
      // aqui (078); `em_breve` é a Mídia Off, travada na lista (131).
      .select("id, nome, modelo_planilha, servico_exclusivo_id, aceita_servico_interno, em_breve")
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
    arquivado_em: string | null;
    versao_aprovada_id: string | null;
    categoria_id: string | null;
    /** Só o modelo: é ele que diz como este orçamento fecha (decisão 072). */
    categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
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
  // escolha de qual vale acontece em memória. Os jobs vêm junto, leves,
  // só para o estágio do funil que os seletores "Exibir" e "Exportar"
  // mostram no chip de cada orçamento.
  const [{ data: versoesRaw }, { data: jobsRaw }] =
    orcamentos.length > 0
      ? await Promise.all([
          supabase
            .from("versoes_orcamento")
            .select(
              "id, orcamento_id, numero_versao, status, moeda, taxa_cambio, " +
                "percentual_honorarios, percentual_imposto, " +
                // Cadeia internacional (decisão 072).
                "percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra, " +
                // Mídia Off (decisão 147).
                "percentual_veiculo, base_honorarios",
            )
            .in(
              "orcamento_id",
              orcamentos.map((o) => o.id),
            )
            .eq("tenant_id", tenantId)
            .neq("status", "cancelada")
            .order("numero_versao", { ascending: false }),
          supabase
            .from("jobs")
            .select("orcamento_id, status, created_at")
            .in(
              "orcamento_id",
              orcamentos.map((o) => o.id),
            )
            .eq("tenant_id", tenantId),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];

  const jobsPorOrcamento = new Map<string, { status: JobStatus; created_at: string }[]>();
  for (const j of ((jobsRaw ?? []) as any[])) {
    const atuais = jobsPorOrcamento.get(j.orcamento_id) ?? [];
    atuais.push({ status: j.status as JobStatus, created_at: j.created_at });
    jobsPorOrcamento.set(j.orcamento_id, atuais);
  }
  const estagioDe = (orc: { id: string; status: string }) =>
    estagioFunil(
      orc.status as OrcamentoStatus,
      escolherJobDoFunil(jobsPorOrcamento.get(orc.id) ?? []),
    );

  const versoes = (versoesRaw ?? []) as Array<{
    id: string;
    orcamento_id: string;
    numero_versao: number;
    status: VersaoOrcamento["status"];
    moeda: string;
    taxa_cambio: number | string;
    percentual_honorarios: number | string;
    percentual_imposto: number | string;
    percentual_int_taxes: number | string;
    int_transaction_costs: number | string;
    moeda_estrangeira: string | null;
    cambio_compra: number | string | null;
    percentual_veiculo: number | string;
    base_honorarios: string;
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

  const [gruposRes, itensRes, bvsRes, mesesRes] = await Promise.all([
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_grupos")
          // `meio` e `formato`: o card da Mídia Off conta os meios (147).
          .select("id, nome, versao_orcamento_id, ordem, mes_id, meio, formato")
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
          // A linha inteira (decisão 148): a janela do BV da agregada grava
          // pelas actions da versão e precisa do id de cada BV — e o item
          // pode ter vários (decisão 062).
          .select(
            "id, tenant_id, item_versao_id, job_item_orcado_id, fornecedor_id, valor, " +
              "prazo_repasse, percentual_imposto, situacao, created_by, created_at, updated_at, " +
              "item:versoes_orcamento_itens!inner(versao_orcamento_id)",
          )
          .eq("tenant_id", tenantId)
          .neq("situacao", "cancelado")
          .in("item.versao_orcamento_id", versaoIds)
      : Promise.resolve({ data: [] as any[] }),
    // Meses do modelo mensal (decisão 078): o card empilha um bloco por mês,
    // cada um com os grupos dele.
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_meses")
          .select("id, mes, versao_orcamento_id")
          .eq("tenant_id", tenantId)
          .in("versao_orcamento_id", versaoIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const mesesPorVersao = new Map<string, { id: string; mes: string }[]>();
  for (const m of (mesesRes.data ?? []) as {
    id: string;
    mes: string;
    versao_orcamento_id: string;
  }[]) {
    const lista = mesesPorVersao.get(m.versao_orcamento_id) ?? [];
    lista.push({ id: m.id, mes: m.mes });
    mesesPorVersao.set(m.versao_orcamento_id, lista);
  }

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

  // A lista de BVs por item, como na tela da versão (decisão 062). É ela
  // que a janela do BV da agregada mostra e grava desde a decisão 148; o
  // `bv` do item, acima, só segue para o formato do rascunho.
  const bvsPorItem: Record<string, ItemBv[]> = {};
  for (const raw of (bvsRes.data ?? []) as any[]) {
    const { item: _filtro, ...bv } = raw;
    (bvsPorItem[bv.item_versao_id] ??= []).push({
      ...bv,
      valor: num(bv.valor),
      percentual_imposto:
        bv.percentual_imposto === null || bv.percentual_imposto === undefined
          ? null
          : num(bv.percentual_imposto),
    } as ItemBv);
  }

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
      mesId: g.mes_id ?? null,
      itens: itensPorGrupo.get(g.id) ?? [],
    });
    gruposPorVersao.set(g.versao_orcamento_id, lista);
  }

  // Projeto arquivado é só leitura (decisão 118): todos os orçamentos
  // ficam em consulta, e o "Criar orçamento de job" some.
  const projetoArquivado = projeto.status === "arquivado";

  // Mídia Off (decisão 147, entrega 1): só consulta, com o atalho para a
  // tela do orçamento — a planilha dela é por meio e mês, com a conta da
  // mídia, e o editor daqui é o da nacional.
  const ehMidiaOff = (orc: (typeof orcamentos)[number]) =>
    orc.categoria?.modelo_planilha === "midia_off";
  const midias: OrcamentoMidiaNaAgregada[] = orcamentos.filter(ehMidiaOff).map((orc) => {
    const versao = vigentePorOrcamento.get(orc.id);
    const itensDaVersao = versao
      ? ((itensRes.data ?? []) as any[]).filter((it) => it.versao_orcamento_id === versao.id)
      : [];
    const gruposDaVersao = versao
      ? ((gruposRes.data ?? []) as any[]).filter((g) => g.versao_orcamento_id === versao.id && g.meio)
      : [];
    const f = versao
      ? fechamentoDosItens(
          itensDaVersao.map((it) => ({
            tipo_custo: it.tipo_custo,
            total_orcado:
              num(it.valor_unitario_orcado) * num(it.quantidade_orcada) * num(it.dias_meses_orcado),
          })),
          parametrosDaVersao(versao),
        )
      : null;
    return {
      id: orc.id,
      nome: orc.nome,
      detalhe: versao
        ? `v${versao.numero_versao}${versao.status === "aprovada" ? " · aprovada" : ""}`
        : "sem versão",
      href: versao
        ? `/orcamentos/${params.projetoId}/${orc.id}?v=${versao.id}`
        : `/orcamentos/${params.projetoId}/${orc.id}`,
      qtdMeses: versao ? (mesesPorVersao.get(versao.id) ?? []).length : 0,
      qtdMeios: new Set(gruposDaVersao.map((g) => chaveDoMeio(g.meio, g.formato))).size,
      qtdLinhas: itensDaVersao.length,
      valorJob: f?.valorJob ?? 0,
      faturamentoPrevisto: f?.faturamentoPrevisto ?? 0,
      imposto: f?.imposto ?? 0,
      custoPlanejado: f?.custoPlanejado ?? 0,
      resultadoGeral: f?.resultadoGeral ?? null,
    };
  });

  const inicial: OrcamentoRascunho[] = orcamentos.filter((o) => !ehMidiaOff(o)).map((orc) => {
    const versao = vigentePorOrcamento.get(orc.id);
    const grupos = versao ? (gruposPorVersao.get(versao.id) ?? []) : [];
    const bloqueio = projetoArquivado
      ? "Projeto arquivado — reative o projeto para editar."
      : versao
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
      meses: versao ? (mesesPorVersao.get(versao.id) ?? []) : [],
      arquivoNome: null,
      percentualHonorariosDetectado: null,
      parametros: {
        moeda: versao?.moeda ?? "BRL",
        taxa_cambio: num(versao?.taxa_cambio) || 1,
        percentual_honorarios: num(versao?.percentual_honorarios),
        percentual_imposto: num(versao?.percentual_imposto),
        // Cadeia internacional (decisão 072): cada orçamento do projeto
        // fecha pela sua, e o consolidado soma os fechamentos.
        percentual_int_taxes: num(versao?.percentual_int_taxes),
        int_transaction_costs: num(versao?.int_transaction_costs),
        moeda_estrangeira: versao?.moeda_estrangeira ?? null,
        cambio_compra:
          versao?.cambio_compra === null || versao?.cambio_compra === undefined
            ? null
            : Number(versao.cambio_compra),
      },
      modeloPlanilha: (orc.categoria?.modelo_planilha ??
        "nacional") as CategoriaModeloPlanilha,
      origemBanco: versao
        ? {
            orcamentoId: orc.id,
            versaoId: versao.id,
            numeroVersao: versao.numero_versao,
            statusOrcamento: orc.status,
            statusVersao: versao.status,
            bloqueio,
            estagio: estagioDe(orc),
          }
        : {
            orcamentoId: orc.id,
            versaoId: "",
            numeroVersao: 0,
            statusOrcamento: orc.status,
            statusVersao: "",
            bloqueio,
            estagio: estagioDe(orc),
          },
    };
  });

  // O que o seletor "Exportar" mostra por orçamento: a versão vigente e o
  // FATURAMENTO que a planilha imprime — o lado `cliente` (decisão 041):
  // save gerado dentro, crédito consumido fora. Calculado
  // aqui, sobre o que está GRAVADO — a exportação lê o banco, e a tela
  // pode estar com alteração ainda não salva.
  const exportaveis: OrcamentoExportavel[] = inicial.map((orc) => {
    const origem = orc.origemBanco!;
    const temVersao = origem.versaoId !== "";
    const valor = temVersao
      ? calcularTotaisVersao(
          orc.grupos.flatMap((g) =>
            g.itens.map((it) => ({
              tipo_custo: it.tipo_custo,
              total_orcado:
                it.valor_unitario_orcado *
                it.quantidade_orcada *
                it.dias_meses_orcado,
              em_save: it.em_save === true,
              save_consumido: Number(it.save_consumido ?? 0),
            })),
          ),
          orc.parametros.percentual_honorarios,
          orc.parametros.percentual_imposto,
          // O valor que o seletor "Exportar" mostra tem que ser o mesmo da
          // planilha exportada — e ela fecha pela cadeia do orçamento
          // (decisão 072).
          configDaPlanilha(orc.modeloPlanilha, orc.parametros).internacional,
        ).cliente.total
      : null;
    return {
      id: orc.id,
      nome: orc.nome,
      numeroVersao: temVersao ? origem.numeroVersao : null,
      estagio: origem.estagio ?? "orcamento",
      valor,
      // Trava a mistura de nacional com internacional no seletor (072).
      modeloPlanilha: orc.modeloPlanilha,
      chaveCambio:
        orc.modeloPlanilha === "internacional"
          ? chaveDoCambio(
              orc.parametros.moeda_estrangeira,
              orc.parametros.cambio_compra,
            )
          : null,
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

  // Fee e Always On não nascem pela agregada (decisão 078): o editor daqui
  // não conhece meses. Saem da lista as categorias exclusivas de planilha
  // mensal E os serviços donos delas — sobrar o serviço Fee com a categoria
  // Evento seria abrir de novo a porta que a trava fechou. O Mídia fica
  // (decisão 131): as categorias dele são da planilha nacional, e o
  // formulário mostra só as dele, como na tela do orçamento.
  const categoriasOrcamento = (categoriasOrcRes.data ?? []) as CategoriaParaServico[];
  // A Mídia Off também só nasce na tela do orçamento (decisão 147): a
  // planilha dela é por meio e mês. O serviço Mídia fica, por causa da
  // Mídia On.
  const soMensal = (c: CategoriaParaServico) =>
    c.servico_exclusivo_id !== null && c.modelo_planilha === "mensal";
  const soNaTelaDoOrcamento = (c: CategoriaParaServico) =>
    soMensal(c) || c.modelo_planilha === "midia_off";
  const servicosComCategoriaPropria = new Set(
    categoriasOrcamento
      .filter(soMensal)
      .map((c) => c.servico_exclusivo_id)
      .filter((id): id is string => id !== null),
  );

  return (
    <EditorAgregado
      servicos={((servicosRes.data ?? []) as ServicoOption[]).filter(
        (s) => !servicosComCategoriaPropria.has(s.id),
      )}
      savePorItem={savePorItem}
      bvsPorItem={bvsPorItem}
      saldosDeSave={saldosDeSave}
      nomeDoGrupo={nomeDoGrupo}
      faixa={
        <FaixaDoProjeto
          modulo="orcamentos"
          reservaDoVoltar={`/orcamentos/${projeto.id}`}
          projeto={{
            codigo: projeto.codigo,
            nome: projeto.nome,
            href: `/orcamentos/${projeto.id}`,
          }}
          agregadaHref={`/orcamentos/${projeto.id}/agregado`}
          itens={itensDeOrcamentos(projeto.id, orcamentos, null)}
          ativo={AGREGADA}
          // O “+” sai da agregada para a página "Novo orçamento", como o
          // botão da página do projeto (decisão do Tiago, 05/10/2026) — e
          // não para o rascunho do "Criar orçamento de job" daqui. Com
          // alteração por salvar, a faixa segura a saída.
          novoHref={novoOrcamentoHref(
            projeto.id,
            !projetoArquivado && pode(session.activeRole, "orcamentos.criar"),
          )}
        />
      }
      projeto={{
        id: projeto.id,
        codigo: projeto.codigo,
        nome: projeto.nome,
        cliente: projeto.cliente?.nome_fantasia ?? null,
        responsavel: projeto.responsavel?.nome ?? null,
      }}
      projetoArquivado={projetoArquivado}
      podeEditarImpostos={pode(session.activeRole, "orcamentos.editar_impostos")}
      podeMarcarSave={pode(session.activeRole, "orcamentos.marcar_em_save")}
      honorariosCliente={Number(
        projeto.cliente?.percentual_honorarios_padrao ??
          HONORARIOS_PADRAO_FALLBACK,
      )}
      inicial={inicial}
      midias={midias}
      exportaveis={exportaveis}
      categorias={categoriasOrcamento.filter((c) => !soNaTelaDoOrcamento(c))}
      nomesDeCategoria={categoriasOrcamento}
      regionaisDoProjeto={regionaisDoProjeto}
      cidadesIniciais={cidadesIniciais}
      gpsDoProjeto={gpsDoProjeto}
      produtores={produtores}
      categoriasItem={categoriasItemRes.data ?? []}
      fornecedores={fornecedoresRes.data ?? []}
    />
  );
}
