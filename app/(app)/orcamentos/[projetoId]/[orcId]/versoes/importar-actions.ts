"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { honorariosDoOrcamento } from "@/lib/data/clientes";
import {
  parseOficial,
  recusaPorModelo,
  type ParseResultado,
} from "@/lib/importacao/parser-oficial";
import { PERCENTUAL_INT_TAXES_PADRAO } from "@/lib/impostos";
import { escolherVersaoVigente } from "@/lib/calculos/versao-vigente";
import type { GrupoAtual, ItemAtual } from "@/lib/importacao/diff-projeto";
import {
  casarComAnterior,
  linhasParaGravar,
  type OrigemDoPlanejado,
} from "@/lib/importacao/planejado-anterior";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import { extrairArquivoXlsx } from "@/lib/importacao/arquivo";

const BUCKET = "orcamento-importacoes";

export type PreviewResult =
  | {
      ok: true;
      preview: {
        aba: string;
        grupos: {
          nome: string;
          ordem: number;
          itens_count: number;
          total_bruto: number;
          total_planejado: number;
          /** Planejado do grupo se a versão herdar o da anterior. */
          total_planejado_herdado: number;
        }[];
        /** A pergunta "planejado da versão anterior ou da planilha". */
        planejado: {
          /** Número da versão de onde o planejado pode vir. `null` sem
           *  versão anterior — a pergunta não aparece e vale a planilha. */
          versao_anterior: number | null;
          casadas: number;
          por_descricao: number;
          total_itens: number;
          planilha_tem_planejado: boolean;
        };
        warnings: ParseResultado["warnings"];
        /** % que a planilha traz. Não é o que vai ser aplicado — serve para
         *  avisar quem importou quando difere do cadastro do cliente. */
        percentual_honorarios: number | null;
        /** % que a versão vai receber de fato: o do cadastro do cliente. */
        percentual_honorarios_cliente: number;
        cliente_nome: string;
        linhas_lidas: number;
        linhas_importadas: number;
        linhas_ignoradas: number;
        arquivo_nome: string;
        arquivo_tamanho: number;
      };
    }
  | { ok: false; message: string };

export type ConfirmResult =
  | { ok: true; versao_id: string; orcamento_id: string; importacao_id: string }
  | { ok: false; message: string };

const extractArquivo = extrairArquivoXlsx;

/** O que a tela escolheu. Sem escolha — ou sem versão anterior — vale a
 *  planilha, que é o comportamento de antes. */
function origemDoPlanejado(formData: FormData): OrigemDoPlanejado {
  return formData.get("origem_planejado") === "anterior" ? "anterior" : "planilha";
}

const numero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A versão de onde vem o planejado: a pedida (no sobrescrever, a própria
 * versão) ou a vigente do orçamento (aprovada, senão a mais recente — a
 * regra da exportação e da importação do projeto). Com grupos e itens no
 * formato que o casamento usa. `null` quando o orçamento não tem versão.
 */
async function versaoAnterior(
  orcamentoId: string,
  tenantId: string,
  versaoIdPedida: string | null,
): Promise<{
  id: string;
  numero_versao: number;
  grupos: GrupoAtual[];
  itens: ItemAtual[];
} | null> {
  const supabase = createClient();
  const [{ data: orc }, { data: versoes }] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("versao_aprovada_id")
      .eq("id", orcamentoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ versao_aprovada_id: string | null }>(),
    supabase
      .from("versoes_orcamento")
      .select("id, numero_versao, status, created_at")
      .eq("orcamento_id", orcamentoId)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; numero_versao: number; status: string; created_at: string }[]>(),
  ]);

  const vivas = (versoes ?? []).filter((v) => v.status !== "cancelada");
  const alvo = versaoIdPedida
    ? (versoes ?? []).find((v) => v.id === versaoIdPedida) ?? null
    : escolherVersaoVigente(vivas, orc?.versao_aprovada_id);
  if (!alvo) return null;

  const [{ data: grupos }, { data: itens }] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, ordem")
      .eq("versao_orcamento_id", alvo.id)
      .eq("tenant_id", tenantId),
    supabase
      .from("versoes_orcamento_itens")
      .select(
        "id, grupo_id, ordem, item, tipo_custo, categoria_id, planilha_origem, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
          "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, em_save",
      )
      .eq("versao_orcamento_id", alvo.id)
      .eq("tenant_id", tenantId),
  ]);

  return {
    id: alvo.id,
    numero_versao: alvo.numero_versao,
    grupos: ((grupos ?? []) as any[]).map((g) => ({
      id: g.id,
      nome: g.nome,
      ordem: numero(g.ordem),
    })),
    itens: ((itens ?? []) as any[]).map((it) => ({
      id: it.id,
      grupo_id: it.grupo_id,
      ordem: numero(it.ordem),
      item: it.item,
      tipo_custo: it.tipo_custo,
      valor_unitario_orcado: numero(it.valor_unitario_orcado),
      quantidade_orcada: numero(it.quantidade_orcada),
      dias_meses_orcado: numero(it.dias_meses_orcado),
      valor_unitario_planejado: numero(it.valor_unitario_planejado),
      quantidade_planejada: numero(it.quantidade_planejada),
      dias_meses_planejado: numero(it.dias_meses_planejado),
      categoria_id: it.categoria_id ?? null,
      planilha_origem: it.planilha_origem ?? null,
      em_save: it.em_save === true,
    })),
  };
}

async function verificarOrcamento(
  orcamentoId: string,
  tenantId: string,
): Promise<
  | { ok: true; projeto_id: string; modelo: CategoriaModeloPlanilha }
  | { ok: false; message: string }
> {
  const supabase = createClient();
  const { data: orc, error } = await supabase
    .from("orcamentos")
    // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
    .select("id, status, projeto_id, categoria:categorias_dominio!categoria_id(modelo_planilha)")
    .eq("id", orcamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      status: string;
      projeto_id: string;
      categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
    }>();

  if (error || !orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }
  if (orc.status === "job_criado" || orc.status === "cancelado") {
    return {
      ok: false,
      message: `Orçamento em estado ${orc.status} não aceita nova versão.`,
    };
  }
  // Modelo mensal (decisão 078): a planilha importada não diz de que mês é
  // cada grupo — os itens cairiam fora de todos os meses.
  if (orc.categoria?.modelo_planilha === "mensal") {
    return {
      ok: false,
      message:
        "A importação de planilha ainda não está disponível para orçamentos de Fee e Always On.",
    };
  }
  return {
    ok: true,
    projeto_id: orc.projeto_id,
    modelo: orc.categoria?.modelo_planilha ?? "nacional",
  };
}

/**
 * Faz o parse do arquivo enviado e retorna um resumo. Não persiste nada.
 * A tela usa isso para o admin revisar antes de confirmar.
 */
export async function previewImportacao(
  orcamentoId: string,
  formData: FormData,
): Promise<PreviewResult> {
  const session = await requireSession();

  const check = await verificarOrcamento(orcamentoId, session.activeTenant.id);
  if (!check.ok) return { ok: false, message: check.message };

  // O percentual que a versão vai receber. Lido aqui para o preview poder
  // avisar antes de confirmar quando a planilha discorda do cadastro.
  const honorariosCliente = await honorariosDoOrcamento(
    orcamentoId,
    session.activeTenant.id,
  );
  if (!honorariosCliente) {
    return {
      ok: false,
      message:
        "Não foi possível ler os honorários do cliente. Confira o cadastro do cliente do projeto.",
    };
  }

  const arq = await extractArquivo(formData);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer);
  } catch (err) {
    console.error("[importacao.preview.parse]", err);
    return {
      ok: false,
      message:
        "Não conseguimos ler o arquivo. Verifique se é a planilha padrão salva como .xlsx.",
    };
  }

  // Modelo errado é recusado antes de qualquer contagem (decisão 072).
  const recusaPreview = recusaPorModelo(parsed.modelo, check.modelo);
  if (recusaPreview) return { ok: false, message: recusaPreview };

  if (parsed.grupos.length === 0) {
    return {
      ok: false,
      message:
        parsed.warnings[0]?.motivo ??
        "Nenhum item encontrado na planilha. Confira se a aba 'Padrão' traz o agrupamento na coluna A, o nome do item na B e o tipo de custo na G.",
    };
  }

  // A versão nova herda da vigente; o sobrescrever manda a própria versão.
  const versaoIdDoForm = formData.get("versao_id");
  const anterior = await versaoAnterior(
    orcamentoId,
    session.activeTenant.id,
    typeof versaoIdDoForm === "string" && versaoIdDoForm !== "" ? versaoIdDoForm : null,
  );
  const casamento = anterior
    ? casarComAnterior(parsed.grupos, anterior.grupos, anterior.itens)
    : null;

  const preview = {
    aba: parsed.aba,
    grupos: parsed.grupos.map((g, gi) => ({
      nome: g.nome,
      ordem: g.ordem,
      itens_count: g.itens.length,
      total_bruto: g.itens.reduce(
        (s, it) =>
          s + it.valor_unitario_orcado * it.quantidade_orcada * it.dias_meses_orcado,
        0,
      ),
      total_planejado: g.itens.reduce(
        (s, it) =>
          s +
          it.valor_unitario_planejado *
            it.quantidade_planejada *
            it.dias_meses_planejado,
        0,
      ),
      total_planejado_herdado: casamento?.planejadoHerdadoPorGrupo[gi] ?? 0,
    })),
    planejado: {
      versao_anterior: anterior?.numero_versao ?? null,
      casadas: casamento?.casadas ?? 0,
      por_descricao: casamento?.porDescricao ?? 0,
      total_itens: casamento?.totalItens ?? 0,
      planilha_tem_planejado: parsed.tem_planejado,
    },
    warnings: parsed.warnings,
    percentual_honorarios: parsed.percentual_honorarios,
    percentual_honorarios_cliente: honorariosCliente.percentual,
    cliente_nome: honorariosCliente.clienteNome,
    linhas_lidas: parsed.linhas_lidas,
    linhas_importadas: parsed.linhas_importadas,
    linhas_ignoradas: parsed.linhas_ignoradas,
    arquivo_nome: arq.nome,
    arquivo_tamanho: arq.tamanho,
  };

  return { ok: true, preview };
}

/**
 * Persiste a importação: cria versão em rascunho, grupos, itens e a linha
 * em orcamento_importacoes, com o XLSX original salvo no bucket.
 * Reparseia o arquivo (não confiamos no que veio do client entre requests).
 */
export async function confirmarImportacao(
  orcamentoId: string,
  formData: FormData,
): Promise<ConfirmResult> {
  const session = await requireSession();

  const check = await verificarOrcamento(orcamentoId, session.activeTenant.id);
  if (!check.ok) return { ok: false, message: check.message };
  const projetoId = check.projeto_id;

  const honorariosCliente = await honorariosDoOrcamento(
    orcamentoId,
    session.activeTenant.id,
  );
  if (!honorariosCliente) {
    return {
      ok: false,
      message:
        "Não foi possível ler os honorários do cliente. Confira o cadastro do cliente do projeto.",
    };
  }

  const arq = await extractArquivo(formData);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer);
  } catch (err) {
    console.error("[importacao.confirmar.parse]", err);
    return {
      ok: false,
      message: "Falha ao processar o arquivo.",
    };
  }

  const recusaConfirmar = recusaPorModelo(parsed.modelo, check.modelo);
  if (recusaConfirmar) return { ok: false, message: recusaConfirmar };

  // Planejado: da vigente ou da planilha. Lido ANTES de criar a versão
  // nova — depois dela, a "mais recente" seria a própria.
  const anteriorConfirmar = await versaoAnterior(orcamentoId, session.activeTenant.id, null);
  const origemPlanejado: OrigemDoPlanejado = anteriorConfirmar
    ? origemDoPlanejado(formData)
    : "planilha";
  const linhas = linhasParaGravar(
    parsed.grupos,
    anteriorConfirmar
      ? casarComAnterior(parsed.grupos, anteriorConfirmar.grupos, anteriorConfirmar.itens).origens
      : null,
    origemPlanejado,
    check.modelo === "internacional",
  );

  if (parsed.grupos.length === 0) {
    return {
      ok: false,
      message:
        "Nenhum item encontrado na planilha. Cancele e revise antes de reenviar.",
    };
  }

  const tenantId = session.activeTenant.id;
  const service = createServiceClient();

  // 1) Descobrir próximo número de versão dentro do orçamento.
  const { data: ultimaVersao } = await service
    .from("versoes_orcamento")
    .select("numero_versao")
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", tenantId)
    .order("numero_versao", { ascending: false })
    .limit(1)
    .maybeSingle<{ numero_versao: number }>();

  const numero = (ultimaVersao?.numero_versao ?? 0) + 1;

  // 2) Criar a versão em rascunho. O % de honorários vem do cadastro do
  //    cliente e vence o que estiver escrito na planilha — o preview já
  //    avisou quem importou quando os dois divergiam (11/08/2026).
  const { data: novaVersao, error: versaoErr } = await service
    .from("versoes_orcamento")
    .insert({
      tenant_id: tenantId,
      orcamento_id: orcamentoId,
      numero_versao: numero,
      nome: `Importada de ${arq.nome}`,
      status: "rascunho",
      moeda: "BRL",
      taxa_cambio: 1,
      percentual_honorarios: honorariosCliente.percentual,
      // Zerada de propósito: versão importada abre com o seletor de
      // alíquota em branco e obriga a escolha manual antes de aprovar
      // (decisão 044, 03/09/2026). A padrão de 19,53% vale para versão
      // que nasce do zero, não para planilha que veio de fora.
      percentual_imposto: 0,
      // Internacional (decisão 072): nasce como qualquer versão nova dele —
      // USD e as int. taxes praticadas — e com o câmbio EM BRANCO, por
      // decisão do Tiago (14/09/2026): a cotação é do dia e é preenchida
      // na tela; sem ela a versão não aprova.
      ...(check.modelo === "internacional"
        ? {
            moeda_estrangeira: "USD",
            percentual_int_taxes: PERCENTUAL_INT_TAXES_PADRAO,
          }
        : {}),
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (versaoErr || !novaVersao) {
    console.error("[importacao.confirmar.versao]", versaoErr?.message);
    return {
      ok: false,
      message: "Não foi possível criar a versão. Tente novamente.",
    };
  }

  const versaoId = novaVersao.id as string;

  // 3) Criar grupos.
  const gruposParaInserir = parsed.grupos.map((g) => ({
    tenant_id: tenantId,
    versao_orcamento_id: versaoId,
    nome: g.nome,
    ordem: g.ordem,
  }));

  const { data: gruposCriados, error: gruposErr } = await service
    .from("versoes_orcamento_grupos")
    .insert(gruposParaInserir)
    .select("id, nome, ordem");

  if (gruposErr || !gruposCriados) {
    console.error("[importacao.confirmar.grupos]", gruposErr?.message);
    // Rollback manual da versão criada.
    await service.from("versoes_orcamento").delete().eq("id", versaoId);
    return {
      ok: false,
      message: "Não foi possível criar os grupos.",
    };
  }

  // 4) Mapear grupo importado → grupo criado (por nome + ordem, únicos aqui).
  const grupoIdPorNome = new Map<string, string>();
  for (const g of gruposCriados as { id: string; nome: string; ordem: number }[]) {
    grupoIdPorNome.set(`${g.nome}#${g.ordem}`, g.id);
  }

  // 5) Criar itens em bulk.
  const itensParaInserir: any[] = [];
  let ordemGlobal = 0;
  parsed.grupos.forEach((grupo, gi) => {
    const grupoId = grupoIdPorNome.get(`${grupo.nome}#${grupo.ordem}`);
    if (!grupoId) return;
    for (const it of linhas[gi]) {
      ordemGlobal++;
      itensParaInserir.push({
        tenant_id: tenantId,
        versao_orcamento_id: versaoId,
        grupo_id: grupoId,
        categoria_id: it.categoria_id,
        ordem: ordemGlobal,
        planilha_origem: `linha ${it.linha_xlsx}`,
        item: it.item,
        tipo_custo: it.tipo_custo,
        valor_unitario_orcado: it.valor_unitario_orcado,
        quantidade_orcada: it.quantidade_orcada,
        dias_meses_orcado: it.dias_meses_orcado,
        valor_unitario_planejado: it.valor_unitario_planejado,
        quantidade_planejada: it.quantidade_planejada,
        dias_meses_planejado: it.dias_meses_planejado,
        // Só a linha que herdou traz a marca; a nova fica no default.
        ...(it.em_save !== null ? { em_save: it.em_save } : {}),
      });
    }
  });

  const { error: itensErr } = await service
    .from("versoes_orcamento_itens")
    .insert(itensParaInserir);

  if (itensErr) {
    console.error("[importacao.confirmar.itens]", itensErr.message);
    // Rollback manual: apaga versão em cascata leva grupos+itens+importacoes.
    await service.from("versoes_orcamento").delete().eq("id", versaoId);
    return {
      ok: false,
      message: "Não foi possível gravar os itens.",
    };
  }

  // 6) Upload do arquivo original no bucket.
  const importacaoId = crypto.randomUUID();
  const arquivoNomeSlug = arq.nome.replace(/[^\w.\-]/g, "_");
  const arquivoPath = `${tenantId}/${orcamentoId}/${importacaoId}-${arquivoNomeSlug}`;

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(arquivoPath, arq.buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (uploadErr) {
    console.error("[importacao.confirmar.upload]", uploadErr.message);
    // Não bloqueia — a versão já está criada. Loga mas segue.
  }

  // 7) Registrar em orcamento_importacoes.
  const { error: impErr } = await service.from("orcamento_importacoes").insert({
    id: importacaoId,
    tenant_id: tenantId,
    orcamento_id: orcamentoId,
    versao_orcamento_id: versaoId,
    arquivo_path: uploadErr ? "" : arquivoPath,
    arquivo_nome_original: arq.nome,
    arquivo_tamanho_bytes: arq.tamanho,
    aba_origem: parsed.aba,
    linhas_lidas: parsed.linhas_lidas,
    linhas_importadas: parsed.linhas_importadas,
    linhas_ignoradas: parsed.linhas_ignoradas,
    warnings: parsed.warnings as any,
    created_by: session.profile.id,
  });

  if (impErr) {
    console.error("[importacao.confirmar.registro]", impErr.message);
    // Só o registro de auditoria falhou; a versão já existe. Segue.
  }

  await logAuditEvent({
    acao: "versao_orcamento.importada",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: orcamentoId,
      importacao_id: importacaoId,
      arquivo_nome: arq.nome,
      linhas_importadas: parsed.linhas_importadas,
      warnings_count: parsed.warnings.length,
      origem_planejado: origemPlanejado,
      ...(parsed.percentual_honorarios !== null &&
      parsed.percentual_honorarios !== honorariosCliente.percentual
        ? {
            honorarios_planilha_ignorado: parsed.percentual_honorarios,
            honorarios_aplicado: honorariosCliente.percentual,
            honorarios_origem: "cadastro_do_cliente",
          }
        : {}),
    },
  });

  revalidatePath(`/orcamentos/${projetoId}/${orcamentoId}`);
  return {
    ok: true,
    versao_id: versaoId,
    orcamento_id: orcamentoId,
    importacao_id: importacaoId,
  };
}

/**
 * Substitui o conteúdo de uma versão EXISTENTE pelo de uma planilha.
 *
 * Irmã de `confirmarImportacao`, com uma diferença de intenção: aquela
 * cria uma versão nova (v+1) e é a porta da tela do orçamento; esta
 * sobrescreve a versão aberta e é a porta da tela da versão. O caso que
 * ela atende, nas palavras do time: "importei a planilha errada, quero
 * importar a certa no mesmo lugar".
 *
 * O que ela APAGA da versão: grupos, itens e — em cascata — os BVs
 * lançados nesses itens. Decisão do time (13/08/2026): o BV pertence ao
 * item e não sobrevive à troca da planilha. Quem chama mostra a contagem
 * na confirmação antes de chegar aqui.
 *
 * O que ela PRESERVA: alíquota, honorários, moeda, câmbio e status da
 * versão. Quem já escolheu a alíquota não perde a escolha ao reimportar.
 * É a diferença mais visível para `confirmarImportacao`, que redefine
 * tudo isso ao criar a versão.
 */
export async function sobrescreverVersaoComPlanilha(
  versaoId: string,
  formData: FormData,
): Promise<ConfirmResult> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; status: string; orcamento_id: string }>();

  if (!versao) return { ok: false, message: "Versão não encontrada." };

  // Congelada não se sobrescreve: aprovada é o que o cliente aceitou e o
  // que alimenta o job; cancelada é histórico.
  if (versao.status === "aprovada" || versao.status === "cancelada") {
    return {
      ok: false,
      message: `Versão ${versao.status} não aceita importação.`,
    };
  }

  const orcamentoId = versao.orcamento_id;
  const check = await verificarOrcamento(orcamentoId, tenantId);
  if (!check.ok) return { ok: false, message: check.message };
  const projetoId = check.projeto_id;

  // Guarda dura: apagar item cascateia para `jobs_itens_realizado` e é
  // BARRADO por `jobs_itens_orcado` (NO ACTION). Um job aberto sobre esta
  // versão transformaria a importação em erro de FK no meio do caminho —
  // ou, pior, em realizado apagado. O status já impediria (job exige
  // versão aprovada), mas a regra é financeira e não pode depender de uma
  // camada só.
  const { count: copiasDeJob } = await supabase
    .from("jobs_itens_orcado")
    .select("id", { count: "exact", head: true })
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId);

  if ((copiasDeJob ?? 0) > 0) {
    return {
      ok: false,
      message:
        "Esta versão já gerou um job e não pode ser sobrescrita. Crie uma versão nova para importar outra planilha.",
    };
  }

  const arq = await extractArquivo(formData);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer);
  } catch (err) {
    console.error("[importacao.sobrescrever.parse]", err);
    return { ok: false, message: "Falha ao processar o arquivo." };
  }

  // Antes de apagar qualquer coisa: planilha do modelo errado não troca o
  // conteúdo da versão (decisão 072).
  const recusaSobrescrever = recusaPorModelo(parsed.modelo, check.modelo);
  if (recusaSobrescrever) return { ok: false, message: recusaSobrescrever };

  // Planejado: o desta versão ou o da planilha. Lido ANTES de apagar.
  const anteriorSobrescrever = await versaoAnterior(orcamentoId, tenantId, versaoId);
  const origemPlanejado: OrigemDoPlanejado = anteriorSobrescrever
    ? origemDoPlanejado(formData)
    : "planilha";
  const linhas = linhasParaGravar(
    parsed.grupos,
    anteriorSobrescrever
      ? casarComAnterior(parsed.grupos, anteriorSobrescrever.grupos, anteriorSobrescrever.itens).origens
      : null,
    origemPlanejado,
    check.modelo === "internacional",
  );

  // Planilha vazia não apaga nada: seria destruir o que existe em troca
  // de nada, e o usuário não pediu isso — ele pediu para TROCAR.
  if (parsed.grupos.length === 0) {
    return {
      ok: false,
      message:
        "Nenhum item encontrado na planilha. Nada foi apagado — revise o arquivo e tente de novo.",
    };
  }

  const service = createServiceClient();

  // ---- 1) Apagar o conteúdo atual ----
  // Itens ANTES dos grupos: `versoes_orcamento_itens.grupo_id` é RESTRICT,
  // então apagar grupo com item dentro falha. Os BVs saem junto com os
  // itens, por cascade.
  const { error: delItensErr } = await service
    .from("versoes_orcamento_itens")
    .delete()
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId);

  if (delItensErr) {
    console.error("[importacao.sobrescrever.itens.delete]", delItensErr.message);
    return {
      ok: false,
      message: "Não foi possível limpar os itens da versão. Nada foi alterado.",
    };
  }

  const { error: delGruposErr } = await service
    .from("versoes_orcamento_grupos")
    .delete()
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId);

  if (delGruposErr) {
    console.error("[importacao.sobrescrever.grupos.delete]", delGruposErr.message);
    return {
      ok: false,
      message:
        "Os itens foram removidos, mas os grupos não. Recarregue a tela e tente de novo.",
    };
  }

  // ---- 2) Gravar o conteúdo novo ----
  const { data: gruposCriados, error: gruposErr } = await service
    .from("versoes_orcamento_grupos")
    .insert(
      parsed.grupos.map((g) => ({
        tenant_id: tenantId,
        versao_orcamento_id: versaoId,
        nome: g.nome,
        ordem: g.ordem,
      })),
    )
    .select("id, nome, ordem");

  if (gruposErr || !gruposCriados) {
    console.error("[importacao.sobrescrever.grupos]", gruposErr?.message);
    return {
      ok: false,
      message:
        "A versão foi esvaziada, mas os grupos da planilha não entraram. Importe novamente.",
    };
  }

  const grupoIdPorNome = new Map<string, string>();
  for (const g of gruposCriados as { id: string; nome: string; ordem: number }[]) {
    grupoIdPorNome.set(`${g.nome}#${g.ordem}`, g.id);
  }

  const itensParaInserir: any[] = [];
  let ordemGlobal = 0;
  parsed.grupos.forEach((grupo, gi) => {
    const grupoId = grupoIdPorNome.get(`${grupo.nome}#${grupo.ordem}`);
    if (!grupoId) return;
    for (const it of linhas[gi]) {
      ordemGlobal++;
      itensParaInserir.push({
        tenant_id: tenantId,
        versao_orcamento_id: versaoId,
        grupo_id: grupoId,
        categoria_id: it.categoria_id,
        ordem: ordemGlobal,
        planilha_origem: `linha ${it.linha_xlsx}`,
        item: it.item,
        tipo_custo: it.tipo_custo,
        valor_unitario_orcado: it.valor_unitario_orcado,
        quantidade_orcada: it.quantidade_orcada,
        dias_meses_orcado: it.dias_meses_orcado,
        valor_unitario_planejado: it.valor_unitario_planejado,
        quantidade_planejada: it.quantidade_planejada,
        dias_meses_planejado: it.dias_meses_planejado,
        // Só a linha que herdou traz a marca; a nova fica no default.
        ...(it.em_save !== null ? { em_save: it.em_save } : {}),
      });
    }
  });

  const { error: itensErr } = await service
    .from("versoes_orcamento_itens")
    .insert(itensParaInserir);

  if (itensErr) {
    console.error("[importacao.sobrescrever.itens]", itensErr.message);
    return {
      ok: false,
      message:
        "Os grupos entraram, mas os itens não. Importe novamente para completar.",
    };
  }

  // ---- 3) Guardar o arquivo e registrar ----
  const importacaoId = crypto.randomUUID();
  const arquivoNomeSlug = arq.nome.replace(/[^\w.\-]/g, "_");
  const arquivoPath = `${tenantId}/${orcamentoId}/${importacaoId}-${arquivoNomeSlug}`;

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(arquivoPath, arq.buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (uploadErr) {
    console.error("[importacao.sobrescrever.upload]", uploadErr.message);
    // Não bloqueia: a planilha já está na versão.
  }

  const { error: impErr } = await service.from("orcamento_importacoes").insert({
    id: importacaoId,
    tenant_id: tenantId,
    orcamento_id: orcamentoId,
    versao_orcamento_id: versaoId,
    arquivo_path: uploadErr ? "" : arquivoPath,
    arquivo_nome_original: arq.nome,
    arquivo_tamanho_bytes: arq.tamanho,
    aba_origem: parsed.aba,
    linhas_lidas: parsed.linhas_lidas,
    linhas_importadas: parsed.linhas_importadas,
    linhas_ignoradas: parsed.linhas_ignoradas,
    warnings: parsed.warnings as any,
    created_by: session.profile.id,
  });

  if (impErr) console.error("[importacao.sobrescrever.registro]", impErr.message);

  await logAuditEvent({
    acao: "versao_orcamento.sobrescrita_por_importacao",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: orcamentoId,
      importacao_id: importacaoId,
      arquivo_nome: arq.nome,
      linhas_importadas: parsed.linhas_importadas,
      warnings_count: parsed.warnings.length,
      origem_planejado: origemPlanejado,
    },
  });

  revalidatePath(`/orcamentos/${projetoId}/${orcamentoId}`);

  return {
    ok: true,
    versao_id: versaoId,
    orcamento_id: orcamentoId,
    importacao_id: importacaoId,
  };
}
