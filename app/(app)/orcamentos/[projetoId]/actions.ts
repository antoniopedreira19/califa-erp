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
  erroDoPeriodoMensal,
  mesesDoPeriodo,
  trimestreDe,
} from "@/lib/calculos/meses-trimestre";
import type { CategoriaModeloPlanilha } from "@/lib/types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
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
  | { ok: true; modelo: CategoriaModeloPlanilha }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }
> {
  const [catRes, servRes] = await Promise.all([
    supabase
      .from("categorias_dominio")
      .select("id, nome, modelo_planilha, servico_exclusivo_id")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .returns<CategoriaParaServico[]>(),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("id", servicoId)
      .eq("tenant_id", tenantId)
      .eq("escopo", "projeto")
      .maybeSingle<{ id: string; nome: string }>(),
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
    servicoId,
    categoria,
    categorias,
    servRes.data.nome,
  );
  if (erro) {
    return { ok: false, message: erro, fieldErrors: { categoria_id: [erro] } };
  }
  return { ok: true, modelo: categoria.modelo_planilha };
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

async function assertProjetoDoTenant(
  supabase: ReturnType<typeof createClient>,
  projetoId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("projetos")
    .select("id")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: "Projeto não encontrado." };
  }
  return { ok: true };
}

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
  // Fee e Always On: o período é obrigatório e cabe num trimestre — é dele
  // que os meses da v1 nascem (decisão 078).
  if (par.modelo === "mensal") {
    const recusa = recusaDoPeriodoMensal(
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
      projeto_id: projetoId,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[orcamentos.criar]", error.message);
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

  if (!versaoId) {
    // O orçamento existe e é válido sem versão — é o estado que a tela de
    // versões já sabe mostrar. Cair nela é o degrau seguro: refazer o
    // formulário criaria um orçamento duplicado.
    redirect(`/orcamentos/${projetoId}/${data.id}`);
  }

  redirect(`/orcamentos/${projetoId}/${data.id}?v=${versaoId}`);
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
  if (modelo === "mensal") {
    // Modelo mensal (decisão 078): a v1 nasce com os meses do período.
    const meses = await criarMesesDoPeriodo(supabase, {
      tenantId,
      versaoId: data.id,
      profileId,
      inicio: periodo.inicio,
      fim: periodo.fim,
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

  const { data: atual } = await supabase
    .from("orcamentos")
    .select(
      "status, servico_id, categoria_id, data_inicio_prevista, data_fim_prevista, " +
        // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
        "categoria:categorias_dominio!categoria_id(modelo_planilha)",
    )
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      status: string;
      servico_id: string | null;
      categoria_id: string | null;
      data_inicio_prevista: string | null;
      data_fim_prevista: string | null;
      categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
    }>();

  if (!atual) {
    return { ok: false, message: "Orçamento não encontrado." };
  }
  if (atual.status === "aprovado" || atual.status === "job_criado") {
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
  }

  const inicio = parsed.data.data_inicio_prevista;
  const fim = parsed.data.data_fim_prevista;
  if (modeloNovo === "mensal") {
    const recusa = recusaDoPeriodoMensal(inicio, fim);
    if (recusa) return recusa;
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
    metadata: trocaDeTrimestre
      ? { meses_refeitos: true, periodo: { inicio, fim } }
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
