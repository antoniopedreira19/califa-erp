"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { checarPermissao } from "@/lib/permissoes-server";
import { logAuditEvent } from "@/lib/auth/audit";
import { honorariosDoOrcamento } from "@/lib/data/clientes";
import {
  parseOficial,
  recusaPorModelo,
  type ParseResultado,
} from "@/lib/importacao/parser-oficial";
import { PERCENTUAL_INT_TAXES_PADRAO } from "@/lib/impostos";
import { pode } from "@/lib/permissoes";
import { impostosDaVersaoVigente } from "@/lib/data/impostos-da-vigente";
import { escolherVersaoVigente } from "@/lib/calculos/versao-vigente";
import type { GrupoAtual, ItemAtual } from "@/lib/importacao/diff-projeto";
import {
  casarComAnterior,
  linhasParaGravar,
  type OrigemDoPlanejado,
} from "@/lib/importacao/planejado-anterior";
import type { CategoriaModeloPlanilha, PlanejadoAntesDoSave } from "@/lib/types";
import { baixarEnvio, descartarEnvio, type EnvioDaPlanilha } from "@/lib/importacao/envio";
import type { PreviewDaAba, PreviewResult } from "@/lib/importacao/tipos-da-importacao";
import { montarPreviewDaAba } from "@/lib/importacao/preview-da-aba";
import {
  abaSugerida,
  lerTodasAsAbas,
  ordenarAbas,
  totaisDaAba,
  type AbaLida,
  type AbaResumo,
} from "@/lib/importacao/abas-do-arquivo";
import { casarBlocosComMeses } from "@/lib/importacao/meses-da-planilha";
import {
  copiarMesesEntreVersoes,
  criarMesesDoPeriodo,
  mesesDaVersaoQuery,
} from "@/lib/data/meses-versao";
import {
  erroDoPeriodoMensal,
  mesesDoPeriodo,
  rotuloMesCurto,
} from "@/lib/calculos/meses-trimestre";

export type { PreviewDaAba, PreviewResult } from "@/lib/importacao/tipos-da-importacao";

/** O arquivo já no Storage e, no sobrescrever, a versão aberta. */
export interface EntradaDoPreview {
  envio: EnvioDaPlanilha;
  versao_id?: string | null;
}

/** O que a tela manda para gravar. */
export interface EntradaDaGravacao {
  envio: EnvioDaPlanilha;
  /** A aba escolhida na tabela, pelo nome exato. */
  aba: string;
  /** De onde vem o planejado. Sem versão anterior, vale a planilha. */
  origem_planejado: "anterior" | "planilha";
}

export type ConfirmResult =
  | { ok: true; versao_id: string; orcamento_id: string; importacao_id: string }
  | { ok: false; message: string };

/** O que a tela escolheu. Sem escolha — ou sem versão anterior — vale a
 *  planilha, que é o comportamento de antes. */
function origemDoPlanejado(entrada: EntradaDaGravacao): OrigemDoPlanejado {
  return entrada.origem_planejado === "anterior" ? "anterior" : "planilha";
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
  /** Meses da versão (modelo mensal, decisão 078); vazio nos outros. */
  meses: { id: string; mes: string }[];
  /** O planejado que o save zerou, por id de item da versão — só as linhas
   *  que têm o dado (decisão 099). */
  planejadoAntesSave: Map<string, PlanejadoAntesDoSave>;
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

  const [{ data: grupos }, { data: itens }, { data: meses }] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, ordem, mes_id")
      .eq("versao_orcamento_id", alvo.id)
      .eq("tenant_id", tenantId),
    supabase
      .from("versoes_orcamento_itens")
      .select(
        "id, grupo_id, ordem, item, tipo_custo, categoria_id, planilha_origem, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
          "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, em_save, " +
          "planejado_antes_save",
      )
      .eq("versao_orcamento_id", alvo.id)
      .eq("tenant_id", tenantId),
    mesesDaVersaoQuery(supabase, tenantId, alvo.id),
  ]);
  const mesPorId = new Map((meses ?? []).map((m) => [m.id, m.mes]));
  const planejadoAntesSave = new Map<string, PlanejadoAntesDoSave>();
  for (const it of (itens ?? []) as any[]) {
    if (it.planejado_antes_save) planejadoAntesSave.set(it.id, it.planejado_antes_save);
  }

  return {
    id: alvo.id,
    numero_versao: alvo.numero_versao,
    meses: (meses ?? []).map((m) => ({ id: m.id, mes: m.mes })),
    planejadoAntesSave,
    grupos: ((grupos ?? []) as any[]).map((g) => ({
      id: g.id,
      nome: g.nome,
      ordem: numero(g.ordem),
      mes: g.mes_id ? (mesPorId.get(g.mes_id) ?? null) : null,
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

/**
 * O planejado que o save zerou, levado da linha de origem para a linha
 * nova que HERDA a marca de save (decisão 099, 22/09/2026). Sem ele a
 * linha nasce em save com o planejado zerado — é o que a origem guarda —
 * e o trigger não teria o que devolver quando o save sair. Linha que não
 * herda (planejado da planilha, ou linha sem par) fica como antes: o
 * trigger guarda o planejado que ela trouxer.
 */
function planejadoAntesDaOrigem(
  emSave: boolean | null,
  origem: ItemAtual | null,
  mapa: Map<string, PlanejadoAntesDoSave> | undefined,
): { planejado_antes_save?: PlanejadoAntesDoSave } {
  if (emSave !== true || !origem) return {};
  const antes = mapa?.get(origem.id);
  return antes ? { planejado_antes_save: antes } : {};
}

async function verificarOrcamento(
  orcamentoId: string,
  tenantId: string,
): Promise<
  | {
      ok: true;
      projeto_id: string;
      modelo: CategoriaModeloPlanilha;
      /** Período do orçamento — os meses da versão nova do mensal sem vigente. */
      periodo: { inicio: string | null; fim: string | null };
      /** Serviço Interno (decisão 105): toda linha entra como F · Interno. */
      interno: boolean;
    }
  | { ok: false; message: string }
> {
  const supabase = createClient();
  const { data: orc, error } = await supabase
    .from("orcamentos")
    // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
    .select(
      "id, status, projeto_id, data_inicio_prevista, data_fim_prevista, categoria:categorias_dominio!categoria_id(modelo_planilha), servico:categorias_dominio!servico_id(investimento_interno)",
    )
    .eq("id", orcamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      status: string;
      projeto_id: string;
      data_inicio_prevista: string | null;
      data_fim_prevista: string | null;
      categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
      servico: { investimento_interno: boolean } | null;
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
  // Mídia Off (decisão 147): a importação de planilha dela fica para depois
  // do desenho. A tela já desliga o botão; esta é a regra.
  if (orc.categoria?.modelo_planilha === "midia_off") {
    return {
      ok: false,
      message: "A importação de planilha da Mídia Off ainda não está disponível.",
    };
  }
  return {
    ok: true,
    projeto_id: orc.projeto_id,
    modelo: orc.categoria?.modelo_planilha ?? "nacional",
    periodo: { inicio: orc.data_inicio_prevista, fim: orc.data_fim_prevista },
    interno: orc.servico?.investimento_interno === true,
  };
}

/**
 * Modelo mensal (decisão 078): os meses em que a planilha cai. Os da versão
 * de onde vem o planejado — a própria no sobrescrever, a vigente na versão
 * nova, que os copia — e, sem versão nenhuma, os do período do orçamento.
 */
function mesesDeDestino(
  anterior: { meses: { mes: string }[] } | null,
  periodo: { inicio: string | null; fim: string | null },
): { ok: true; datas: string[] } | { ok: false; message: string } {
  if (anterior && anterior.meses.length > 0) {
    return { ok: true, datas: anterior.meses.map((m) => m.mes) };
  }
  const erro = erroDoPeriodoMensal(periodo.inicio, periodo.fim);
  if (erro) return { ok: false, message: `${erro} Nada foi importado.` };
  return {
    ok: true,
    datas: mesesDoPeriodo({ inicio: periodo.inicio!, fim: periodo.fim! }),
  };
}

/**
 * Lê TODAS as abas do arquivo enviado e devolve a tabela de abas e o
 * resumo de cada aba legível (decisão 110). Não persiste nada. A tela
 * troca de aba sem voltar ao servidor; quem grava é `confirmarImportacao`
 * ou `sobrescreverVersaoComPlanilha`, com a aba escolhida.
 */
export async function previewImportacao(
  orcamentoId: string,
  entrada: EntradaDoPreview,
): Promise<PreviewResult> {
  const session = await requireSession();
  // Só lê, mas é a primeira etapa da gravação e baixa o arquivo com a chave
  // de serviço: pede a permissão de quem grava — a da versão nova, ou a de
  // editar quando a planilha sobrescreve a versão aberta (06/10/2026).
  const gate = await checarPermissao(
    session,
    entrada.versao_id ? "orcamentos.editar" : "orcamentos.criar",
  );
  if (!gate.ok) return { ok: false, message: gate.message };
  const tenantId = session.activeTenant.id;

  const check = await verificarOrcamento(orcamentoId, tenantId);
  if (!check.ok) return { ok: false, message: check.message };

  // O percentual que a versão vai receber. Lido aqui para o preview poder
  // avisar antes de confirmar quando a planilha discorda do cadastro.
  const [honorariosCliente, arq] = await Promise.all([
    honorariosDoOrcamento(orcamentoId, tenantId),
    baixarEnvio(entrada.envio, tenantId),
  ]);
  if (!honorariosCliente) {
    return {
      ok: false,
      message:
        "Não foi possível ler os honorários do cliente. Confira o cadastro do cliente do projeto.",
    };
  }
  if (!arq.ok) return { ok: false, message: arq.message };

  let lidas: AbaLida[];
  try {
    lidas = await lerTodasAsAbas(arq.buffer, {
      mensal: check.modelo === "mensal",
      tipoFixo: check.interno ? "FI" : undefined,
    });
  } catch (err) {
    console.error("[importacao.preview.parse]", err);
    return {
      ok: false,
      message: "Não conseguimos ler o arquivo. Verifique se é uma planilha salva como .xlsx.",
    };
  }

  // A versão nova herda da vigente; o sobrescrever manda a própria versão.
  const anterior = await versaoAnterior(orcamentoId, tenantId, entrada.versao_id || null);
  let mesesDestino: string[] | null = null;
  if (check.modelo === "mensal") {
    const destino = mesesDeDestino(anterior, check.periodo);
    if (!destino.ok) return { ok: false, message: destino.message };
    mesesDestino = destino.datas;
  }

  const previews: Record<string, PreviewDaAba> = {};
  const abas: AbaResumo[] = lidas.map((lida) => {
    const r = montarPreviewDaAba(lida.parsed, {
      modelo: check.modelo,
      anterior,
      mesesDestino,
      honorarios: honorariosCliente,
    });
    if (!r.ok) {
      return {
        nome: lida.nome,
        visivel: lida.visivel,
        legivel: false,
        motivo: r.motivo,
        grupos: 0,
        itens: 0,
        orcado: 0,
        planejado: 0,
      };
    }
    previews[lida.nome] = r.preview;
    return { nome: lida.nome, visivel: lida.visivel, legivel: true, motivo: null, ...totaisDaAba(r.parsed) };
  });

  const sugerida = abaSugerida(abas);
  if (!sugerida) {
    return {
      ok: false,
      message:
        abas.length === 1
          ? (abas[0].motivo ?? "Nenhum item encontrado na planilha.")
          : `Nenhuma das ${abas.length} abas do arquivo está no formato do orçamento. Confira o modelo e envie de novo.`,
    };
  }

  return {
    ok: true,
    arquivo: { nome: entrada.envio.nome, tamanho: entrada.envio.tamanho },
    abas: ordenarAbas(abas),
    sugerida,
    previews,
  };
}

/**
 * Persiste a importação: cria versão em rascunho, grupos, itens e a linha
 * em orcamento_importacoes, e descarta o XLSX (decisão 129) — o conteúdo
 * fica na versão.
 * Reparseia o arquivo (não confiamos no que veio do client entre requests).
 */
export async function confirmarImportacao(
  orcamentoId: string,
  entrada: EntradaDaGravacao,
): Promise<ConfirmResult> {
  const session = await requireSession();
  // Cria a versão com a chave de serviço, que passa por cima da RLS: a
  // permissão é a do `criarVersao`, conferida aqui e não só no botão
  // (06/10/2026).
  const gate = await checarPermissao(session, "orcamentos.criar");
  if (!gate.ok) return { ok: false, message: gate.message };

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

  const arq = await baixarEnvio(entrada.envio, session.activeTenant.id);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer, {
      mensal: check.modelo === "mensal",
      tipoFixo: check.interno ? "FI" : undefined,
      aba: entrada.aba,
    });
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

  // Mensal (decisão 078): os mesmos meses do preview — os da vigente, que a
  // versão nova copia, ou os do período do orçamento.
  let datasDoMensal: string[] = [];
  if (check.modelo === "mensal") {
    const destino = mesesDeDestino(anteriorConfirmar, check.periodo);
    if (!destino.ok) return { ok: false, message: destino.message };
    const casados = casarBlocosComMeses(parsed.grupos, parsed.meses, destino.datas);
    if (!casados.ok) return { ok: false, message: casados.message };
    parsed = {
      ...parsed,
      grupos: casados.grupos,
      warnings: [...parsed.warnings, ...casados.avisos],
      // A contagem segue os meses aceitos: item de bloco fora do trimestre
      // não entra, e a confirmação não pode prometer mais itens do que grava.
      linhas_importadas: casados.grupos.reduce((s, g) => s + g.itens.length, 0),
      linhas_ignoradas:
        parsed.linhas_ignoradas +
        parsed.linhas_importadas -
        casados.grupos.reduce((s, g) => s + g.itens.length, 0),
    };
    datasDoMensal = destino.datas;
  }
  const origemPlanejado: OrigemDoPlanejado = anteriorConfirmar
    ? origemDoPlanejado(entrada)
    : "planilha";
  const origensConfirmar = anteriorConfirmar
    ? casarComAnterior(parsed.grupos, anteriorConfirmar.grupos, anteriorConfirmar.itens).origens
    : null;
  const linhas = linhasParaGravar(
    parsed.grupos,
    origensConfirmar,
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
      nome: `Importada de ${entrada.envio.nome}`,
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
      // Sem a permissão de editar impostos, Impostos BR e int. taxes vêm da
      // vigente (decisão do Tiago, 14/09/2026). Sem isso a versão nasceria
      // com o imposto em branco e quem importou não conseguiria aprovar.
      ...(check.modelo === "internacional" &&
      !pode(session.activeRole, "orcamentos.editar_impostos")
        ? await impostosDaVersaoVigente(orcamentoId, tenantId)
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

  // 3) Mensal: os meses da versão nova, antes dos grupos que apontam para
  //    eles — copiados da vigente ou criados do período.
  const mesIdPorData = new Map<string, string>();
  if (check.modelo === "mensal") {
    if (anteriorConfirmar && anteriorConfirmar.meses.length > 0) {
      const copiados = await copiarMesesEntreVersoes(service, {
        tenantId,
        origemId: anteriorConfirmar.id,
        destinoId: versaoId,
        profileId: session.profile.id,
      });
      for (const m of anteriorConfirmar.meses) {
        const novo = copiados.get(m.id);
        if (novo) mesIdPorData.set(m.mes, novo);
      }
    } else {
      const criados = await criarMesesDoPeriodo(service, {
        tenantId,
        versaoId,
        profileId: session.profile.id,
        inicio: check.periodo.inicio,
        fim: check.periodo.fim,
      });
      if (criados.ok) {
        const { data: novos } = await mesesDaVersaoQuery(service, tenantId, versaoId);
        for (const m of novos ?? []) mesIdPorData.set(m.mes, m.id);
      }
    }
    if (datasDoMensal.some((d) => !mesIdPorData.has(d))) {
      await service.from("versoes_orcamento").delete().eq("id", versaoId);
      return { ok: false, message: "Não foi possível criar os meses da versão." };
    }
  }

  // 4) Criar grupos.
  const gruposParaInserir = parsed.grupos.map((g) => ({
    tenant_id: tenantId,
    versao_orcamento_id: versaoId,
    nome: g.nome,
    ordem: g.ordem,
    mes_id: g.mes ? (mesIdPorData.get(g.mes) ?? null) : null,
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
    linhas[gi].forEach((it, ii) => {
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
        ...planejadoAntesDaOrigem(
          it.em_save,
          origensConfirmar?.[gi]?.[ii] ?? null,
          anteriorConfirmar?.planejadoAntesSave,
        ),
      });
    });
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

  // 6) Registrar em orcamento_importacoes. Sem caminho: o arquivo não fica
  //    guardado (decisão 129).
  const importacaoId = crypto.randomUUID();
  const { error: impErr } = await service.from("orcamento_importacoes").insert({
    id: importacaoId,
    tenant_id: tenantId,
    orcamento_id: orcamentoId,
    versao_orcamento_id: versaoId,
    arquivo_path: null,
    arquivo_nome_original: entrada.envio.nome,
    arquivo_tamanho_bytes: entrada.envio.tamanho,
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

  // 7) O arquivo sai do Storage: o conteúdo já está na versão.
  await descartarEnvio(entrada.envio.path, tenantId);

  await logAuditEvent({
    acao: "versao_orcamento.importada",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: orcamentoId,
      importacao_id: importacaoId,
      arquivo_nome: entrada.envio.nome,
      aba: parsed.aba,
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
  entrada: EntradaDaGravacao,
): Promise<ConfirmResult> {
  const session = await requireSession();
  // A troca apaga e regrava a planilha com a chave de serviço: a permissão
  // tem que ser conferida aqui, não só no botão (06/10/2026, decisão 148 —
  // a visão agregada passou a importar por esta mesma porta).
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return { ok: false, message: gate.message };
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

  const arq = await baixarEnvio(entrada.envio, tenantId);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer, {
      mensal: check.modelo === "mensal",
      tipoFixo: check.interno ? "FI" : undefined,
      aba: entrada.aba,
    });
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

  // Mensal (decisão 078): os meses são os da própria versão. Casados ANTES
  // de apagar qualquer coisa — mês a mais ou a menos não troca o conteúdo.
  const mesIdDaVersao = new Map(
    (anteriorSobrescrever?.meses ?? []).map((m) => [m.mes, m.id]),
  );
  if (check.modelo === "mensal") {
    const casados = casarBlocosComMeses(parsed.grupos, parsed.meses, [
      ...mesIdDaVersao.keys(),
    ]);
    if (!casados.ok) return { ok: false, message: casados.message };
    parsed = {
      ...parsed,
      grupos: casados.grupos,
      warnings: [...parsed.warnings, ...casados.avisos],
      // A contagem segue os meses aceitos: item de bloco fora do trimestre
      // não entra, e a confirmação não pode prometer mais itens do que grava.
      linhas_importadas: casados.grupos.reduce((s, g) => s + g.itens.length, 0),
      linhas_ignoradas:
        parsed.linhas_ignoradas +
        parsed.linhas_importadas -
        casados.grupos.reduce((s, g) => s + g.itens.length, 0),
    };
  }
  const origemPlanejado: OrigemDoPlanejado = anteriorSobrescrever
    ? origemDoPlanejado(entrada)
    : "planilha";
  const origensSobrescrever = anteriorSobrescrever
    ? casarComAnterior(parsed.grupos, anteriorSobrescrever.grupos, anteriorSobrescrever.itens).origens
    : null;
  const linhas = linhasParaGravar(
    parsed.grupos,
    origensSobrescrever,
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
        mes_id: g.mes ? (mesIdDaVersao.get(g.mes) ?? null) : null,
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
    linhas[gi].forEach((it, ii) => {
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
        // Lido antes de apagar os itens antigos (`versaoAnterior`).
        ...planejadoAntesDaOrigem(
          it.em_save,
          origensSobrescrever?.[gi]?.[ii] ?? null,
          anteriorSobrescrever?.planejadoAntesSave,
        ),
      });
    });
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

  // ---- 3) Registrar e descartar o arquivo ----
  // O registro fica sem caminho, e o arquivo sai do Storage (decisão 129):
  // a planilha já está na versão.
  const importacaoId = crypto.randomUUID();
  const { error: impErr } = await service.from("orcamento_importacoes").insert({
    id: importacaoId,
    tenant_id: tenantId,
    orcamento_id: orcamentoId,
    versao_orcamento_id: versaoId,
    arquivo_path: null,
    arquivo_nome_original: entrada.envio.nome,
    arquivo_tamanho_bytes: entrada.envio.tamanho,
    aba_origem: parsed.aba,
    linhas_lidas: parsed.linhas_lidas,
    linhas_importadas: parsed.linhas_importadas,
    linhas_ignoradas: parsed.linhas_ignoradas,
    warnings: parsed.warnings as any,
    created_by: session.profile.id,
  });

  if (impErr) console.error("[importacao.sobrescrever.registro]", impErr.message);

  await descartarEnvio(entrada.envio.path, tenantId);

  await logAuditEvent({
    acao: "versao_orcamento.sobrescrita_por_importacao",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: orcamentoId,
      importacao_id: importacaoId,
      arquivo_nome: entrada.envio.nome,
      aba: parsed.aba,
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
