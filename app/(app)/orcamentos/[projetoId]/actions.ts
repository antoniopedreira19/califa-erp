"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { orcamentoSchema } from "@/lib/validations/orcamentos";
import { gerarCodigoOrcamento } from "@/lib/codigos/orcamentos";
import { honorariosDoOrcamento } from "@/lib/data/clientes";
import { modeloPlanilhaDoOrcamento } from "@/lib/data/modelo-planilha";
import { criarMesesDoPeriodo } from "@/lib/data/meses-versao";
import {
  ALIQUOTA_IMPOSTO_PADRAO,
  PERCENTUAL_INT_TAXES_PADRAO,
} from "@/lib/impostos";
import {
  erroDoParServicoCategoria,
  type CategoriaParaServico,
} from "@/lib/categorias-do-servico";
import {
  erroDoPeriodoDaCampanha,
  erroDoPeriodoMensal,
  mesesDoPeriodo,
  nomeDoMes,
  trimestreDe,
} from "@/lib/calculos/meses-trimestre";
import {
  FILTRO_SEM_CANCELADO_ANTES_DA_ABERTURA,
  ORCAMENTO_STATUS_MANUAIS_ANTIGOS,
  type CategoriaModeloPlanilha,
  type OrcamentoStatus,
} from "@/lib/types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    categoria_id: formData.get("categoria_id")?.toString() ?? "",
    servico_id: formData.get("servico_id")?.toString() ?? "",
    descritivo: formData.get("descritivo")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    cidade_id: formData.get("cidade_id")?.toString() ?? "",
    gp_responsavel_id: formData.get("gp_responsavel_id")?.toString() ?? "",
    produtor_id: formData.get("produtor_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  // As recusas do serviço Interno (decisão 105) já saem do banco em
  // português, com o motivo.
  if (msg.includes("serviço Interno") || msg.includes("BV confirmado ou recebido")) {
    return msg;
  }
  if (msg.includes("uniq_orcamentos_codigo_por_tenant")) {
    return "Já existe um orçamento com este código neste tenant.";
  }
  if (msg.includes("orcamentos_datas_ordem")) {
    return "Data fim precisa ser igual ou posterior à data início.";
  }
  if (msg.includes("orcamentos_regional_id_fkey")) {
    return "Regional inválida.";
  }
  if (msg.includes("orcamentos_servico_id_fkey")) {
    return "Serviço inválido.";
  }
  if (msg.includes("orcamentos_descritivo_tamanho")) {
    return "O descritivo passa de 500 caracteres.";
  }
  if (msg.includes("orcamentos_cidade_id_fkey")) {
    return "Cidade inválida.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * Serviço × categoria (decisão 078): o serviço com categoria exclusiva
 * (Fee, Always On) só aceita a dele, e a categoria exclusiva só vale para o
 * serviço dela. O formulário já filtra; esta é a porta que não depende da
 * tela. Devolve também o modelo de planilha da categoria, que as regras
 * seguintes usam.
 *
 * Lê TODAS as categorias do escopo, inclusive as inativas: a exclusividade
 * de um serviço não deixa de existir porque alguém desativou a categoria.
 */
async function conferirServicoECategoria(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  servicoId: string,
  categoriaId: string,
): Promise<
  | { ok: true; modelo: CategoriaModeloPlanilha; interno: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }
> {
  const [catRes, servRes] = await Promise.all([
    supabase
      .from("categorias_dominio")
      .select("id, nome, modelo_planilha, servico_exclusivo_id, aceita_servico_interno, em_breve")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .returns<CategoriaParaServico[]>(),
    supabase
      .from("categorias_dominio")
      .select("id, nome, investimento_interno")
      .eq("id", servicoId)
      .eq("tenant_id", tenantId)
      .eq("escopo", "projeto")
      .maybeSingle<{ id: string; nome: string; investimento_interno: boolean }>(),
  ]);

  const categorias = catRes.data ?? [];
  const categoria = categorias.find((c) => c.id === categoriaId);
  if (!categoria) {
    return {
      ok: false,
      message: "Categoria inválida.",
      fieldErrors: { categoria_id: ["Selecione a categoria."] },
    };
  }
  if (!servRes.data) {
    return {
      ok: false,
      message: "Serviço inválido.",
      fieldErrors: { servico_id: ["Selecione o serviço."] },
    };
  }
  const erro = erroDoParServicoCategoria(
    servRes.data,
    categoria,
    categorias,
    servRes.data.nome,
  );
  if (erro) {
    return { ok: false, message: erro, fieldErrors: { categoria_id: [erro] } };
  }
  return {
    ok: true,
    modelo: categoria.modelo_planilha,
    interno: servRes.data.investimento_interno,
  };
}

/**
 * O orçamento já preenchido que passa para o serviço Interno (decisão 105,
 * resposta 1-b do Tiago) tem as linhas CONVERTIDAS: tipo F · Interno e
 * planejado igual ao orçado, em todas as versões. Quem converte é o
 * gatilho `orcamento_entra_no_interno`; aqui ficam as recusas com a frase
 * certa ANTES de qualquer gravação — o gatilho recusaria do mesmo jeito,
 * mas depois de a action já ter salvo os outros campos.
 *
 * - linha em save (gerado ou consumido): o Interno não tem save, e o save
 *   não se desfaz por efeito colateral;
 * - BV confirmado ou recebido: FI não tem BV, e esse BV já está no
 *   financeiro. O BV em negociação é cancelado pelo gatilho.
 */
async function conferirEntradaNoInterno(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  orcamentoId: string,
): Promise<
  | { ok: true; linhas: number; linhasConvertidas: number }
  | { ok: false; message: string }
> {
  const { data: linhas, error } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "id, item, tipo_custo, em_save, save_consumido, versao:versoes_orcamento!inner(orcamento_id)",
    )
    .eq("tenant_id", tenantId)
    .eq("versao.orcamento_id", orcamentoId);
  if (error) {
    console.error("[orcamentos.entrada_interno.linhas]", error.message);
    return { ok: false, message: "Não foi possível conferir as linhas do orçamento." };
  }
  const todas = (linhas ?? []) as {
    id: string;
    item: string;
    tipo_custo: string;
    em_save: boolean;
    save_consumido: number | string | null;
  }[];

  const comSave = todas.filter(
    (l) => l.em_save || Number(l.save_consumido ?? 0) > 0,
  );
  if (comSave.length > 0) {
    const nomes = comSave.slice(0, 3).map((l) => `“${l.item}”`).join(", ");
    return {
      ok: false,
      message: `O serviço Interno não usa save. Tire o save ${
        comSave.length === 1 ? "da linha" : `das ${comSave.length} linhas`
      } (${nomes}${comSave.length > 3 ? "…" : ""}) antes de trocar o serviço.`,
    };
  }

  const ids = todas.map((l) => l.id);
  if (ids.length > 0) {
    const { data: bvs, error: bvErr } = await supabase
      .from("itens_bv")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("item_versao_id", ids)
      .in("situacao", ["confirmado", "recebido"])
      .limit(1);
    if (bvErr) {
      console.error("[orcamentos.entrada_interno.bv]", bvErr.message);
      return { ok: false, message: "Não foi possível conferir os BVs do orçamento." };
    }
    if ((bvs ?? []).length > 0) {
      return {
        ok: false,
        message:
          "Este orçamento tem BV confirmado ou recebido. O serviço Interno só usa custo F · Interno, que não tem BV — não é possível trocar o serviço.",
      };
    }
  }

  return {
    ok: true,
    linhas: todas.length,
    linhasConvertidas: todas.filter((l) => l.tipo_custo !== "FI").length,
  };
}

function recusaDoPeriodoMensal(
  inicio: string | null,
  fim: string | null,
): { ok: false; message: string; fieldErrors: Record<string, string[]> } | null {
  const erro = erroDoPeriodoMensal(inicio, fim);
  return erro
    ? {
        ok: false,
        message: "Verifique os campos destacados.",
        fieldErrors: { data_fim_prevista: [erro] },
      }
    : null;
}

/** Mídia Off (decisão 147): o período é a campanha inteira, sem o
 *  trimestre — os meses da planilha nascem dele. */
function recusaDoPeriodoDaCampanha(
  inicio: string | null,
  fim: string | null,
): { ok: false; message: string; fieldErrors: Record<string, string[]> } | null {
  const erro = erroDoPeriodoDaCampanha(inicio, fim);
  return erro
    ? {
        ok: false,
        message: "Verifique os campos destacados.",
        fieldErrors: { data_fim_prevista: [erro] },
      }
    : null;
}

async function assertProjetoDoTenant(
  supabase: ReturnType<typeof createClient>,
  projetoId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("projetos")
    .select("id, status")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; status: string }>();
  if (error || !data) {
    return { ok: false, message: "Projeto não encontrado." };
  }
  // Decisão 118: projeto arquivado é só leitura. O banco recusa também;
  // aqui a mensagem chega inteira.
  if (data.status === "arquivado") {
    return { ok: false, message: PROJETO_ARQUIVADO };
  }
  return { ok: true };
}

const PROJETO_ARQUIVADO =
  "Projeto arquivado é só leitura. Reative o projeto para editar.";
const ORCAMENTO_ARQUIVADO =
  "Orçamento arquivado é só leitura. Reative o orçamento para editar.";

/**
 * Regional e GP do orçamento têm que sair do projeto — o formulário já
 * mostra só essas opções, mas quem posta o form pode mandar outra coisa.
 * A FK não cobre isso: ela só garante que a regional existe no cadastro.
 */
async function assertRegionalEGpDoProjeto(
  supabase: ReturnType<typeof createClient>,
  projetoId: string,
  tenantId: string,
  regionalId: string,
  gpId: string,
): Promise<{ ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }> {
  const [regRes, gpRes] = await Promise.all([
    supabase
      .from("projeto_regionais")
      .select("regional_id")
      .eq("projeto_id", projetoId)
      .eq("regional_id", regionalId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("projeto_responsaveis")
      .select("profile_id")
      .eq("projeto_id", projetoId)
      .eq("profile_id", gpId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (!regRes.data) {
    return {
      ok: false,
      message: "Regional inválida para este projeto.",
      fieldErrors: { regional_id: ["Escolha uma das regionais do projeto."] },
    };
  }
  if (!gpRes.data) {
    return {
      ok: false,
      message: "GP responsável inválido para este projeto.",
      fieldErrors: {
        gp_responsavel_id: ["Escolha um dos responsáveis do projeto."],
      },
    };
  }
  return { ok: true };
}

/**
 * Cria o orçamento (com a v1 junto) e REDIRECIONA para ele.
 *
 * Retorno `ActionResult | void`: `redirect()` no servidor não devolve
 * valor ao cliente — no caminho feliz o `await` resolve `undefined` e a
 * navegação já aconteceu. Só o erro volta como objeto.
 */
export async function criarOrcamento(
  projetoId: string,
  formData: FormData,
): Promise<ActionResult | void> {
  const res = await criarOrcamentoComV1(projetoId, formData, {});
  if (!res.ok) return res;
  if (!res.versaoId) {
    // O orçamento existe e é válido sem versão — é o estado que a tela de
    // versões já sabe mostrar. Cair nela é o degrau seguro: refazer o
    // formulário criaria um orçamento duplicado.
    redirect(`/orcamentos/${projetoId}/${res.orcamentoId}`);
  }
  redirect(`/orcamentos/${projetoId}/${res.orcamentoId}?v=${res.versaoId}`);
}

export type CriarNaAgregadaResult =
  | {
      ok: true;
      orcamentoId: string;
      /** `null` quando o orçamento entrou e a v1 não: a agregada o mostra
       *  em consulta, como a página mostra o orçamento sem versão. */
      versaoId: string | null;
    }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * O "Criar orçamento de job" da visão agregada (decisão 148): grava na hora,
 * com a v1 vazia, e devolve os ids em vez de redirecionar — a tela continua
 * na agregada e passa a tratar o orçamento como gravado.
 *
 * Mesma criação do "Novo orçamento", com duas travas a mais: o mensal e a
 * Mídia Off só nascem na tela "Novo orçamento" (decisões 078 e 147), e a
 * `chave` do formulário vai para `orcamentos.chave_rascunho` — o índice
 * único dela recusa o segundo envio do mesmo formulário (duplo clique,
 * resposta perdida).
 */
export async function criarOrcamentoDaAgregada(
  projetoId: string,
  formData: FormData,
): Promise<CriarNaAgregadaResult> {
  const chave = formData.get("chave")?.toString() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)) {
    return { ok: false, message: "A tela está desatualizada. Recarregue a página antes de criar o orçamento." };
  }
  const res = await criarOrcamentoComV1(projetoId, formData, {
    chave,
    soNaTelaNovoOrcamento: ["mensal", "midia_off"],
  });
  if (!res.ok) return res;
  revalidatePath(`/orcamentos/${projetoId}/agregado`);
  return { ok: true, orcamentoId: res.orcamentoId, versaoId: res.versaoId };
}

/** O miolo da criação: orçamento + v1. Não exportada — todo export async
 *  de arquivo "use server" vira Server Action. */
async function criarOrcamentoComV1(
  projetoId: string,
  formData: FormData,
  opcoes: {
    /** Grava em `orcamentos.chave_rascunho` (decisão 148). */
    chave?: string;
    /** Modelos de planilha que esta porta recusa. */
    soNaTelaNovoOrcamento?: CategoriaModeloPlanilha[];
  },
): Promise<
  | { ok: true; orcamentoId: string; versaoId: string | null }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.criar");
  if (!gate.ok) return gate;
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const chk = await assertProjetoDoTenant(supabase, projetoId, session.activeTenant.id);
  if (!chk.ok) return chk;

  const par = await conferirServicoECategoria(
    supabase,
    session.activeTenant.id,
    parsed.data.servico_id,
    parsed.data.categoria_id,
  );
  if (!par.ok) return par;
  if (opcoes.soNaTelaNovoOrcamento?.includes(par.modelo)) {
    return {
      ok: false,
      message:
        par.modelo === "midia_off"
          ? "O orçamento de Mídia Off nasce na tela “Novo orçamento”, com a planilha por meio e mês."
          : "O orçamento de Fee e de Always On nasce na tela “Novo orçamento”, com os meses do período.",
    };
  }
  // Fee e Always On: o período é obrigatório e cabe num trimestre — é dele
  // que os meses da v1 nascem (decisão 078).
  if (par.modelo === "mensal") {
    const recusa = recusaDoPeriodoMensal(
      parsed.data.data_inicio_prevista,
      parsed.data.data_fim_prevista,
    );
    if (recusa) return recusa;
  }
  // Mídia Off: o período é obrigatório, e os meses da v1 nascem dele.
  if (par.modelo === "midia_off") {
    const recusa = recusaDoPeriodoDaCampanha(
      parsed.data.data_inicio_prevista,
      parsed.data.data_fim_prevista,
    );
    if (recusa) return recusa;
  }

  const vinculo = await assertRegionalEGpDoProjeto(
    supabase,
    projetoId,
    session.activeTenant.id,
    parsed.data.regional_id,
    parsed.data.gp_responsavel_id,
  );
  if (!vinculo.ok) return vinculo;

  let codigo: string;
  try {
    codigo = parsed.data.codigo ?? (await gerarCodigoOrcamento(supabase, projetoId, session.activeTenant.id));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { codigo: _unused, ...rest } = parsed.data;

  const { data, error } = await supabase
    .from("orcamentos")
    .insert({
      ...rest,
      codigo,
      ...(opcoes.chave ? { chave_rascunho: opcoes.chave } : {}),
      projeto_id: projetoId,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[orcamentos.criar]", error.message);
    if (error.message.includes("uniq_orcamentos_chave_rascunho")) {
      return {
        ok: false,
        message: "Este orçamento já foi criado. Recarregue a página para vê-lo.",
      };
    }
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: data.id,
    metadata: { codigo, nome: parsed.data.nome, projeto_id: projetoId },
  });

  revalidatePath(`/orcamentos/${projetoId}`);

  // A V1 nasce junto com o orçamento e o usuário cai direto na planilha
  // (decisão do time, 13/08/2026). Antes, criar um orçamento levava para
  // uma lista de versões vazia e exigia um segundo passo — "Nova versão"
  // — que nunca teve escolha real: a primeira versão de um orçamento novo
  // é sempre a v1 em rascunho.
  //
  // Sem alíquota de propósito: escolher imposto é decisão de fechamento,
  // não de abertura, e quem cobra é a aprovação (docs/decisions/006).
  const versaoId = await criarVersaoInicial(
    data.id,
    session.activeTenant.id,
    session.profile.id,
    {
      inicio: parsed.data.data_inicio_prevista,
      fim: parsed.data.data_fim_prevista,
    },
  );

  return { ok: true, orcamentoId: data.id, versaoId };
}

/** Cria a v1 em rascunho de um orçamento recém-criado.
 *
 *  Devolve o id, ou `null` quando não deu — e aí quem chama decide o
 *  destino. Não usa `criarVersao`: aquela é a porta do formulário, com
 *  validação de status e redirect próprio, e chamá-la de dentro daqui
 *  significaria capturar o redirect dela para descartar. */
async function criarVersaoInicial(
  orcamentoId: string,
  tenantId: string,
  profileId: string,
  /** Período do orçamento — no modelo mensal, é dele que os meses nascem. */
  periodo: { inicio: string | null; fim: string | null },
): Promise<string | null> {
  const supabase = createClient();

  // Honorários vêm do cadastro do cliente, como em toda criação de versão.
  // Sem eles a conta de fechamento sai errada e em silêncio, então é
  // preferível abrir sem versão a abrir com uma versão de base errada.
  const honorarios = await honorariosDoOrcamento(orcamentoId, tenantId);
  if (!honorarios) {
    console.error("[orcamentos.criar.v1] honorários do cliente não lidos", {
      orcamentoId,
    });
    return null;
  }

  // Qual planilha este orçamento usa — sai da categoria dele, que acabou
  // de ser gravada (decisão 072).
  const modelo = await modeloPlanilhaDoOrcamento(orcamentoId, tenantId);

  const { data, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      tenant_id: tenantId,
      orcamento_id: orcamentoId,
      numero_versao: 1,
      status: "rascunho",
      // BRL mesmo no internacional: `moeda` descreve os VALORES da
      // planilha, que continuam em reais. A moeda de fora é
      // `moeda_estrangeira` (decisão 072).
      moeda: "BRL",
      taxa_cambio: 1,
      percentual_honorarios: honorarios.percentual,
      // Alíquota padrão já escolhida (03/09/2026): a v1 nasce pronta para
      // aprovar, sem o passo extra de abrir "Editar" só para o imposto.
      percentual_imposto: ALIQUOTA_IMPOSTO_PADRAO,
      // Mesma ideia no internacional: as int. taxes já vêm na praticada, e
      // só o câmbio fica em branco — a cotação é do dia, e inventar uma
      // seria pior do que o travessão que a coluna mostra até alguém
      // preencher.
      ...(modelo === "internacional"
        ? {
            moeda_estrangeira: "USD",
            percentual_int_taxes: PERCENTUAL_INT_TAXES_PADRAO,
          }
        : {}),
      created_by: profileId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    console.error("[orcamentos.criar.v1]", error?.message);
    return null;
  }

  // Nenhum modelo nasce mais com agrupamento gravado (21/09/2026). A v1
  // nacional trazia um "Novo grupo" para a tela abrir pronta; hoje quem faz
  // isso é a própria tela, que abre a planilha vazia com o campo do primeiro
  // agrupamento em edição ("Nomeie o agrupamento" — `NovoGrupoInline`). O
  // agrupamento só passa a existir com nome: nas palavras do Tiago, "nada
  // poderá ser feito com um agrupamento sem nome". De quebra, o mês vazio
  // continua sem grupo no banco, que é o que o "Copiar itens de outro mês"
  // exige do destino.
  if (modelo === "mensal" || modelo === "midia_off") {
    // Modelo mensal (decisão 078) e Mídia Off (decisão 147): a v1 nasce com
    // os meses do período.
    const meses = await criarMesesDoPeriodo(supabase, {
      tenantId,
      versaoId: data.id,
      profileId,
      inicio: periodo.inicio,
      fim: periodo.fim,
      modelo,
    });
    if (!meses.ok) {
      console.error("[orcamentos.criar.v1.meses]", meses.message);
    }
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: data.id,
    metadata: { orcamento_id: orcamentoId, numero_versao: 1, origem: "criacao_orcamento" },
  });

  return data.id;
}

export async function atualizarOrcamento(
  projetoId: string,
  orcId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const chkProjeto = await assertProjetoDoTenant(
    supabase,
    projetoId,
    session.activeTenant.id,
  );
  if (!chkProjeto.ok) return chkProjeto;

  const { data: atual } = await supabase
    .from("orcamentos")
    .select(
      "status, arquivado_em, servico_id, categoria_id, data_inicio_prevista, data_fim_prevista, " +
        // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
        "categoria:categorias_dominio!categoria_id(modelo_planilha), " +
        "servico:categorias_dominio!servico_id(investimento_interno)",
    )
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      status: string;
      arquivado_em: string | null;
      servico_id: string | null;
      categoria_id: string | null;
      data_inicio_prevista: string | null;
      data_fim_prevista: string | null;
      categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
      servico: { investimento_interno: boolean } | null;
    }>();

  if (!atual) {
    return { ok: false, message: "Orçamento não encontrado." };
  }
  if (atual.arquivado_em) {
    return { ok: false, message: ORCAMENTO_ARQUIVADO };
  }
  // Com o job devolvido pelo financeiro, os dados do orçamento se corrigem
  // sem cancelar a aprovação (decisão 128) — menos o que muda o orçado,
  // conferido mais abaixo.
  let devolvido = false;
  if (atual.status === "job_criado") {
    const { data: jobVivo } = await supabase
      .from("jobs")
      .select("status")
      .eq("orcamento_id", orcId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .maybeSingle<{ status: string }>();
    devolvido = jobVivo?.status === "rejeitado_financeiro";
  }
  if ((atual.status === "aprovado" || atual.status === "job_criado") && !devolvido) {
    return {
      ok: false,
      message:
        "Orçamento em estado protegido (aprovado ou com job criado). Alterações precisam ser feitas pela Task 004/005.",
    };
  }

  const vinculo = await assertRegionalEGpDoProjeto(
    supabase,
    projetoId,
    session.activeTenant.id,
    parsed.data.regional_id,
    parsed.data.gp_responsavel_id,
  );
  if (!vinculo.ok) return vinculo;

  // O par serviço × categoria só é conferido quando muda: os orçamentos
  // antigos com serviço Fee e categoria nacional ficam como estão
  // (decisão do Tiago, 14/09/2026).
  const modeloAtual: CategoriaModeloPlanilha =
    atual.categoria?.modelo_planilha ?? "nacional";
  let modeloNovo = modeloAtual;
  const eraInterno = atual.servico?.investimento_interno === true;
  let ficaInterno = eraInterno;
  const parMudou =
    parsed.data.servico_id !== atual.servico_id ||
    parsed.data.categoria_id !== atual.categoria_id;
  if (parMudou) {
    const par = await conferirServicoECategoria(
      supabase,
      session.activeTenant.id,
      parsed.data.servico_id,
      parsed.data.categoria_id,
    );
    if (!par.ok) return par;
    modeloNovo = par.modelo;
    ficaInterno = par.interno;
  }

  // Job devolvido (decisão 128): o que muda o valor do job e o faturamento
  // previsto é outro acordo com o cliente, e passa pelo "Cancelar
  // aprovação".
  if (devolvido) {
    if (ficaInterno !== eraInterno) {
      const msg =
        "O serviço Interno muda o valor do job e o faturamento previsto. Para trocá-lo, cancele a aprovação da versão.";
      return { ok: false, message: msg, fieldErrors: { servico_id: [msg] } };
    }
    if ((modeloNovo === "internacional") !== (modeloAtual === "internacional")) {
      const msg =
        "A planilha internacional muda o valor do job e o faturamento previsto. Para trocar a categoria, cancele a aprovação da versão.";
      return { ok: false, message: msg, fieldErrors: { categoria_id: [msg] } };
    }
    if (
      modeloNovo === "mensal" &&
      modeloAtual !== "mensal" &&
      parsed.data.data_inicio_prevista &&
      parsed.data.data_fim_prevista &&
      mesesDoPeriodo({
        inicio: parsed.data.data_inicio_prevista,
        fim: parsed.data.data_fim_prevista,
      }).length > 1
    ) {
      const msg =
        "Com o job devolvido, a planilha mensal só entra num período de um mês. Com mais meses, cancele a aprovação para distribuir as linhas e aprovar de novo.";
      return { ok: false, message: msg, fieldErrors: { categoria_id: [msg] } };
    }
  }

  // Passar para o Interno converte as linhas de todas as versões (decisão
  // 105). A tela pede a confirmação; sem ela, nada é gravado.
  const entraNoInterno = ficaInterno && !eraInterno;
  let conversao: { linhas: number; linhasConvertidas: number } | null = null;
  if (entraNoInterno) {
    if (formData.get("confirmar_entrada_interno") !== "1") {
      return {
        ok: false,
        message: "Confirme a passagem para o serviço Interno antes de salvar.",
      };
    }
    const entrada = await conferirEntradaNoInterno(
      supabase,
      session.activeTenant.id,
      orcId,
    );
    if (!entrada.ok) {
      return {
        ok: false,
        message: entrada.message,
        fieldErrors: { servico_id: [entrada.message] },
      };
    }
    conversao = entrada;
  }

  const inicio = parsed.data.data_inicio_prevista;
  const fim = parsed.data.data_fim_prevista;
  if (modeloNovo === "mensal") {
    const recusa = recusaDoPeriodoMensal(inicio, fim);
    if (recusa) return recusa;
  }

  // Mídia Off (decisão 147): a planilha dela não se converte na de outra
  // categoria, nem o contrário — meio, grade e período não têm para onde
  // ir. Quem precisa trocar cria um orçamento novo.
  if ((modeloNovo === "midia_off") !== (modeloAtual === "midia_off")) {
    const msg =
      modeloAtual === "midia_off"
        ? "A planilha de Mídia Off não se converte na de outra categoria. Para mudar, crie um orçamento novo."
        : "A planilha de Mídia Off não recebe as linhas de outra categoria. Crie um orçamento novo de Mídia Off.";
    return { ok: false, message: msg, fieldErrors: { categoria_id: [msg] } };
  }
  // Os meses da campanha acompanham o período: os que entram nascem
  // vazios; os que saem só saem sem linhas.
  let mesesDaCampanha: SincroniaDeMeses | null = null;
  if (modeloNovo === "midia_off") {
    const recusa = recusaDoPeriodoDaCampanha(inicio, fim);
    if (recusa) return recusa;
    if (inicio !== atual.data_inicio_prevista || fim !== atual.data_fim_prevista) {
      const sincronia = await conferirMesesDaCampanha(
        supabase,
        session.activeTenant.id,
        orcId,
        { inicio: inicio!, fim: fim! },
      );
      if (!sincronia.ok) {
        return {
          ok: false,
          message: sincronia.message,
          fieldErrors: { data_fim_prevista: [sincronia.message] },
        };
      }
      mesesDaCampanha = sincronia;
    }
  }

  // Entrar ou sair do modelo mensal muda a estrutura de todas as versões.
  // A tela pede a confirmação; sem ela, nada é gravado.
  const trocaDeModelo = (modeloAtual === "mensal") !== (modeloNovo === "mensal");
  if (trocaDeModelo && formData.get("confirmar_troca_modelo") !== "1") {
    return {
      ok: false,
      message: "Confirme a troca de planilha antes de salvar.",
    };
  }

  // Mensal que continua mensal e muda de TRIMESTRE: o trimestre é a
  // identidade do orçamento, então só passa com os meses sem itens — e
  // aí os meses são refeitos pelo período novo (decisão 078).
  const trocaDeTrimestre =
    !trocaDeModelo && modeloNovo === "mensal"
      ? await trimestreMudou(supabase, session.activeTenant.id, orcId, inicio!, atual)
      : null;
  if (trocaDeTrimestre && trocaDeTrimestre.itens > 0) {
    return {
      ok: false,
      message:
        "Para mudar o período para outro trimestre, os meses precisam estar sem itens. Apague os itens ou crie um orçamento novo para o outro trimestre.",
      fieldErrors: {
        data_fim_prevista: ["Período em outro trimestre com itens lançados."],
      },
    };
  }

  const { codigo, ...rest } = parsed.data;
  const base = codigo ? { ...rest, codigo } : rest;
  // Na troca de modelo serviço e categoria são gravados pela RPC, junto
  // com a estrutura das versões — gravá-los antes deixaria o orçamento com
  // a categoria nova e a planilha velha se a RPC falhasse, e a trava do par
  // serviço × categoria no banco recusaria o serviço novo com a categoria
  // velha.
  const payload = trocaDeModelo
    ? Object.fromEntries(
        Object.entries(base).filter(
          ([k]) => k !== "categoria_id" && k !== "servico_id",
        ),
      )
    : base;

  const { error } = await supabase
    .from("orcamentos")
    .update(payload)
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[orcamentos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  if (trocaDeModelo) {
    const { error: trocaErr } = await supabase.rpc(
      "trocar_modelo_mensal_do_orcamento",
      {
        p_orcamento_id: orcId,
        p_servico_id: parsed.data.servico_id,
        p_categoria_id: parsed.data.categoria_id,
        p_meses:
          modeloNovo === "mensal" ? mesesDoPeriodo({ inicio: inicio!, fim: fim! }) : [],
      },
    );
    if (trocaErr) {
      console.error("[orcamentos.atualizar.troca_modelo]", trocaErr.message);
      revalidatePath(`/orcamentos/${projetoId}/${orcId}`);
      return {
        ok: false,
        message:
          "Os demais campos foram salvos, mas a troca de planilha não foi feita. Tente de novo.",
      };
    }
    await logAuditEvent({
      acao: "orcamento.modelo_planilha_trocado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "orcamento",
      entidadeId: orcId,
      metadata: {
        de: modeloAtual,
        para: modeloNovo,
        categoria_de: atual.categoria_id,
        categoria_para: parsed.data.categoria_id,
      },
    });
  }

  if (conversao) {
    await logAuditEvent({
      acao: "orcamento.virou_interno",
      tenantId: session.activeTenant.id,
      entidadeTipo: "orcamento",
      entidadeId: orcId,
      metadata: {
        servico_de: atual.servico_id,
        servico_para: parsed.data.servico_id,
        linhas: conversao.linhas,
        linhas_convertidas_para_fi: conversao.linhasConvertidas,
      },
    });
  }

  if (mesesDaCampanha) {
    await aplicarMesesDaCampanha(supabase, {
      tenantId: session.activeTenant.id,
      profileId: session.profile.id,
      sincronia: mesesDaCampanha,
    });
  }

  if (trocaDeTrimestre) {
    await refazerMesesDoOrcamento(supabase, {
      tenantId: session.activeTenant.id,
      profileId: session.profile.id,
      versaoIds: trocaDeTrimestre.versaoIds,
      inicio: inicio!,
      fim: fim!,
    });
  }

  await logAuditEvent({
    acao: "orcamento.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: orcId,
    metadata:
      trocaDeTrimestre || devolvido
        ? {
            ...(trocaDeTrimestre ? { meses_refeitos: true, periodo: { inicio, fim } } : {}),
            // Corrigido com o job devolvido, sem cancelar a aprovação (128).
            ...(devolvido ? { com_job_devolvido: true } : {}),
          }
        : undefined,
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/${orcId}`);
  return { ok: true, id: orcId };
}

/**
 * O período novo de um orçamento mensal caiu em outro trimestre? Compara
 * com os meses que as versões já têm (ou, sem mês, com o período antigo).
 * `null` quando o trimestre é o mesmo.
 */
async function trimestreMudou(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  orcamentoId: string,
  inicioNovo: string,
  atual: { data_inicio_prevista: string | null },
): Promise<{ versaoIds: string[]; itens: number } | null> {
  const { data: versoes } = await supabase
    .from("versoes_orcamento")
    .select("id")
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", tenantId)
    .returns<{ id: string }[]>();
  const versaoIds = (versoes ?? []).map((v) => v.id);
  if (versaoIds.length === 0) return null;

  const [mesRes, itensRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_meses")
      .select("mes")
      .in("versao_orcamento_id", versaoIds)
      .eq("tenant_id", tenantId)
      .order("mes", { ascending: true })
      .limit(1)
      .maybeSingle<{ mes: string }>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("id", { count: "exact", head: true })
      .in("versao_orcamento_id", versaoIds)
      .eq("tenant_id", tenantId),
  ]);

  const referencia = mesRes.data?.mes ?? atual.data_inicio_prevista;
  if (!referencia) return null;
  const antes = trimestreDe(referencia);
  const depois = trimestreDe(inicioNovo);
  if (antes.ano === depois.ano && antes.trimestre === depois.trimestre) {
    return null;
  }
  return { versaoIds, itens: itensRes.count ?? 0 };
}

interface SincroniaDeMeses {
  ok: true;
  /** Por versão: os meses a criar e os ids dos meses vazios a apagar. */
  versoes: Array<{ versaoId: string; criar: string[]; apagar: string[] }>;
}

/**
 * Mídia Off (decisão 147): o período novo, mês a mês, contra os meses de
 * cada versão. Mês que sai do período com linha recusa a edição — as
 * linhas não somem por efeito colateral de uma data. Não grava nada.
 */
async function conferirMesesDaCampanha(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  orcamentoId: string,
  periodo: { inicio: string; fim: string },
): Promise<SincroniaDeMeses | { ok: false; message: string }> {
  const { data: versoes } = await supabase
    .from("versoes_orcamento")
    .select("id")
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", tenantId)
    .returns<{ id: string }[]>();
  const versaoIds = (versoes ?? []).map((v) => v.id);
  if (versaoIds.length === 0) return { ok: true, versoes: [] };

  const [mesesRes, gruposRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_meses")
      .select("id, versao_orcamento_id, mes")
      .in("versao_orcamento_id", versaoIds)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; versao_orcamento_id: string; mes: string }[]>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("mes_id")
      .in("versao_orcamento_id", versaoIds)
      .not("mes_id", "is", null)
      .eq("tenant_id", tenantId)
      .returns<{ mes_id: string }[]>(),
  ]);
  if (mesesRes.error || gruposRes.error) {
    console.error("[orcamentos.meses_campanha]", (mesesRes.error ?? gruposRes.error)?.message);
    return { ok: false, message: "Não foi possível conferir os meses da campanha." };
  }

  const desejados = mesesDoPeriodo(periodo);
  const comMeio = new Set((gruposRes.data ?? []).map((g) => g.mes_id));
  const presos = new Set<string>();
  const resultado: SincroniaDeMeses["versoes"] = [];
  for (const versaoId of versaoIds) {
    const doVersao = (mesesRes.data ?? []).filter((m) => m.versao_orcamento_id === versaoId);
    const fora = doVersao.filter((m) => !desejados.includes(m.mes));
    for (const m of fora) if (comMeio.has(m.id)) presos.add(m.mes);
    resultado.push({
      versaoId,
      criar: desejados.filter((d) => !doVersao.some((m) => m.mes === d)),
      apagar: fora.map((m) => m.id),
    });
  }
  if (presos.size > 0) {
    const nomes = [...presos].sort().map((m) => nomeDoMes(m));
    const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
    return {
      ok: false,
      message: `O período novo deixa de fora ${lista}, que ${nomes.length === 1 ? "tem" : "têm"} linhas. Apague ${nomes.length === 1 ? "o mês" : "os meses"} em “Editar meses”, na planilha, ou ajuste o período.`,
    };
  }
  return { ok: true, versoes: resultado };
}

/** Grava a sincronia conferida: cria os meses que entraram e apaga os
 *  vazios que saíram. Sem grupo neles, nada mais vai junto. */
async function aplicarMesesDaCampanha(
  supabase: ReturnType<typeof createClient>,
  {
    tenantId,
    profileId,
    sincronia,
  }: { tenantId: string; profileId: string; sincronia: SincroniaDeMeses },
) {
  const criar = sincronia.versoes.flatMap((v) =>
    v.criar.map((mes) => ({
      tenant_id: tenantId,
      versao_orcamento_id: v.versaoId,
      mes,
      created_by: profileId,
    })),
  );
  const apagar = sincronia.versoes.flatMap((v) => v.apagar);
  if (criar.length > 0) {
    const { error } = await supabase.from("versoes_orcamento_meses").insert(criar);
    if (error) console.error("[orcamentos.meses_campanha.criar]", error.message);
  }
  if (apagar.length > 0) {
    const { error } = await supabase
      .from("versoes_orcamento_meses")
      .delete()
      .in("id", apagar)
      .eq("tenant_id", tenantId);
    if (error) console.error("[orcamentos.meses_campanha.apagar]", error.message);
  }
}

/** Troca os meses de todas as versões pelos do período novo. Só roda com
 *  as versões sem itens (conferido antes): os grupos que sobram são vazios
 *  e saem junto com os meses. */
async function refazerMesesDoOrcamento(
  supabase: ReturnType<typeof createClient>,
  {
    tenantId,
    profileId,
    versaoIds,
    inicio,
    fim,
  }: {
    tenantId: string;
    profileId: string;
    versaoIds: string[];
    inicio: string;
    fim: string;
  },
) {
  const { error: gErr } = await supabase
    .from("versoes_orcamento_grupos")
    .delete()
    .in("versao_orcamento_id", versaoIds)
    .not("mes_id", "is", null)
    .eq("tenant_id", tenantId);
  if (gErr) {
    console.error("[orcamentos.refazer_meses.grupos]", gErr.message);
    return;
  }
  const { error: mErr } = await supabase
    .from("versoes_orcamento_meses")
    .delete()
    .in("versao_orcamento_id", versaoIds)
    .eq("tenant_id", tenantId);
  if (mErr) {
    console.error("[orcamentos.refazer_meses.meses]", mErr.message);
    return;
  }
  for (const versaoId of versaoIds) {
    const r = await criarMesesDoPeriodo(supabase, {
      tenantId,
      versaoId,
      profileId,
      inicio,
      fim,
    });
    if (!r.ok) console.error("[orcamentos.refazer_meses.criar]", r.message);
  }
}

/**
 * Arquivar o orçamento (decisão 118). Ele sai da visão agregada, das abas
 * do projeto e da exportação, e fica só leitura; na lista do projeto só
 * aparece com o filtro "Arquivados". Arquivar não mexe no status: o
 * Reativar devolve o orçamento como estava.
 *
 * Só antes da aprovação: aprovado precisa ter a aprovação desfeita, e com
 * job nunca. O banco confere a mesma coisa (`orcamentos_guarda_arquivado`).
 */
export async function arquivarOrcamento(
  projetoId: string,
  orcId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const chkProjeto = await assertProjetoDoTenant(
    supabase,
    projetoId,
    session.activeTenant.id,
  );
  if (!chkProjeto.ok) return chkProjeto;

  const [orcRes, jobsRes] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("status, arquivado_em")
      .eq("id", orcId)
      .eq("projeto_id", projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ status: string; arquivado_em: string | null }>(),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("orcamento_id", orcId)
      .eq("tenant_id", session.activeTenant.id)
      .or(FILTRO_SEM_CANCELADO_ANTES_DA_ABERTURA),
  ]);

  if (!orcRes.data) return { ok: false, message: "Orçamento não encontrado." };
  if (orcRes.data.arquivado_em) {
    return { ok: false, message: "Este orçamento já está arquivado." };
  }
  if (
    orcRes.data.status === "aprovado" ||
    orcRes.data.status === "job_criado" ||
    (jobsRes.count ?? 0) > 0
  ) {
    return {
      ok: false,
      message:
        "Orçamento aprovado ou com job não se arquiva. Desfaça a aprovação antes.",
    };
  }

  const { error } = await supabase
    .from("orcamentos")
    .update({
      arquivado_em: new Date().toISOString(),
      arquivado_por: session.profile.id,
    })
    .eq("id", orcId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[orcamento.arquivar]", error.message);
    return { ok: false, message: "Não foi possível arquivar o orçamento." };
  }

  await logAuditEvent({
    acao: "orcamento.arquivado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: orcId,
    metadata: { status: orcRes.data.status },
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/${orcId}`);
  return { ok: true, id: orcId };
}

/** Tira o orçamento do arquivo, no status em que ele estava. Com o projeto
 *  arquivado, recusa: o projeto se reativa primeiro.
 *
 *  Status manual antigo (cancelado, recusado, enviado ao cliente) não volta:
 *  ninguém mais o escolhe (decisão 117), e o orçamento ficaria preso nele.
 *  Volta como rascunho. */
export async function reativarOrcamento(
  projetoId: string,
  orcId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const chkProjeto = await assertProjetoDoTenant(
    supabase,
    projetoId,
    session.activeTenant.id,
  );
  if (!chkProjeto.ok) {
    return chkProjeto.message === PROJETO_ARQUIVADO
      ? {
          ok: false,
          message:
            "O projeto deste orçamento está arquivado. Reative o projeto primeiro.",
        }
      : chkProjeto;
  }

  const { data: atual } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: OrcamentoStatus }>();
  if (!atual) return { ok: false, message: "Orçamento não encontrado." };

  const { error } = await supabase
    .from("orcamentos")
    .update({
      arquivado_em: null,
      arquivado_por: null,
      ...(ORCAMENTO_STATUS_MANUAIS_ANTIGOS.includes(atual.status)
        ? { status: "rascunho" as const }
        : {}),
    })
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[orcamento.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar o orçamento." };
  }

  await logAuditEvent({
    acao: "orcamento.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: orcId,
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/${orcId}`);
  return { ok: true, id: orcId };
}
