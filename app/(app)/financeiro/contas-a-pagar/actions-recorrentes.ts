"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarContaRecorrenteSchema,
  editarContaRecorrenteSchema,
} from "@/lib/validations/conta-recorrente";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import type { DocumentoTipo } from "@/lib/types";
import { excluirContaAvulsa } from "./actions-avulsas";
import { proximasDatas, somarDias } from "./recorrencias/dados";

type Ok<T = { id: string }> = { ok: true } & Partial<T>;
type Err = { ok: false; message: string; fieldErrors?: Record<string, string[]> };
type Result<T = { id: string }> = Ok<T> | Err;

/**
 * Gate: apenas admin ou financeiro.
 * Duplicado de actions-avulsas.ts para evitar acoplamento entre módulos.
 * Adaptado para `entidadeTipo: "conta_recorrente"`.
 */
async function checarGateFinanceiro(
  entidadeId: string | null,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_recorrente",
      entidadeId,
      metadata: {
        acao_tentada: acaoTentada,
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }

  return { ok: true, session, supabase };
}

/**
 * Gera como título o que vence dentro da antecedência (30 dias, decisão de
 * 15/09/2026), sem esperar a rotina diária das 6h. Não repete data que já
 * virou título. Falha aqui não desfaz a recorrência: a rotina tenta de novo
 * no dia seguinte, e a previsão já aparece no fluxo de caixa.
 */
async function gerarOcorrencias(
  supabase: ReturnType<typeof createClient>,
  recorrenteId: string,
) {
  const { error } = await supabase.rpc("gerar_ocorrencias_da_recorrente", {
    p_recorrente_id: recorrenteId,
  });
  if (error) console.error("[recorrente.gerar_ocorrencias]", error.message);
}

type Rateio = Array<{ regional_id: string; percentual: number }>;

/**
 * A regional do formulário vira o rateio que o banco grava (decisão 272).
 * "td" = Todas, pelo rateio da tabela da empresa (`empresas_rateios_regionais`,
 * o ano vigente ou o último antes dele). Devolve `rateio: null` quando nada
 * muda: o TD que a recorrência já tinha continua como está.
 */
async function rateioDaRegional(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  empresaId: string,
  regional: string,
  atual: Rateio | null,
): Promise<{ ok: true; rateio: Rateio | null } | Err> {
  const erro = (message: string): Err => ({ ok: false, message, fieldErrors: { regional: [message] } });
  if (regional === "td") {
    if (atual && atual.length > 1) return { ok: true, rateio: null };
    const ano = Number(hojeEmSaoPauloIso().slice(0, 4));
    const { data, error } = await supabase
      .from("empresas_rateios_regionais")
      .select("ano_vigencia, regional_id, percentual")
      .eq("tenant_id", tenantId)
      .eq("empresa_id", empresaId)
      .lte("ano_vigencia", ano)
      .order("ano_vigencia", { ascending: false });
    if (error) return erro(`Falha ao ler a tabela de rateio: ${error.message}`);
    const linhas = (data ?? []) as Array<{ ano_vigencia: number; regional_id: string; percentual: string | number }>;
    const doAno = linhas.filter((l) => l.ano_vigencia === linhas[0]?.ano_vigencia);
    const soma = doAno.reduce((t, l) => t + Number(l.percentual), 0);
    if (!doAno.length || Math.abs(soma - 100) > 0.01) {
      return erro("Esta empresa não tem a tabela de rateio (TD) completa. Escolha uma regional.");
    }
    return { ok: true, rateio: doAno.map((l) => ({ regional_id: l.regional_id, percentual: Number(l.percentual) })) };
  }
  const { data: reg } = await supabase
    .from("regionais")
    .select("id, empresa_id, ativo")
    .eq("id", regional)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!reg || reg.empresa_id !== empresaId) return erro("Escolha uma regional desta empresa.");
  if (atual && atual.length === 1 && atual[0].regional_id === regional) return { ok: true, rateio: null };
  return { ok: true, rateio: [{ regional_id: regional, percentual: 100 }] };
}

/** O que já foi baixado de cada título (baixa parcial, decisão 125). */
async function baixadoDosTitulos(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const { data } = await supabase
    .from("lancamentos_financeiros")
    .select("conta_avulsa_id, valor")
    .eq("origem", "avulsa_baixa")
    .in("conta_avulsa_id", ids);
  for (const l of (data ?? []) as Array<{ conta_avulsa_id: string; valor: string | number }>) {
    m.set(l.conta_avulsa_id, (m.get(l.conta_avulsa_id) ?? 0) + Number(l.valor));
  }
  return m;
}

export async function criarContaRecorrente(input: unknown): Promise<Result> {
  const parsed = criarContaRecorrenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const gate = await checarGateFinanceiro(null, "conta_recorrente.criada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const d = parsed.data;

  // Valida subtipo pertence ao tipo
  const { data: subtipo } = await supabase
    .from("plano_contas_subtipos")
    .select("tipo_id, ativo")
    .eq("id", d.plano_conta_subtipo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!subtipo || subtipo.tipo_id !== d.plano_conta_tipo_id || !subtipo.ativo) {
    return {
      ok: false,
      message: "Subtipo inválido ou não pertence ao tipo escolhido.",
    };
  }

  const regional = await rateioDaRegional(supabase, session.activeTenant.id, d.empresa_id, d.regional, null);
  if (!regional.ok) return regional;
  const rateio = regional.rateio!;

  // Calcula proxima_data inicial via RPC
  const { data: proxDataResult, error: rpcErr } = await supabase.rpc(
    "calcular_proxima_data_inicial",
    {
      p_frequencia: d.frequencia,
      p_dia_do_mes: d.dia_do_mes,
      p_dia_quinzena_1: d.dia_quinzena_1,
      p_dia_quinzena_2: d.dia_quinzena_2,
      p_dia_do_ano_dia: d.dia_do_ano_dia,
      p_dia_do_ano_mes: d.dia_do_ano_mes,
    },
  );

  if (rpcErr || !proxDataResult) {
    return {
      ok: false,
      message: `Falha ao calcular próxima data: ${rpcErr?.message ?? "erro desconhecido"}`,
    };
  }
  const proximaData = proxDataResult as string;

  // Se data_fim informada, valida ordem
  if (d.data_fim != null && proximaData > d.data_fim) {
    return {
      ok: false,
      message: "Data de fim é anterior à primeira ocorrência calculada.",
      fieldErrors: {
        data_fim: ["Data de fim deve ser posterior à primeira ocorrência."],
      },
    };
  }

  // A recorrência e o rateio nascem juntos, numa transação só (decisão 069,
  // revisão de 15/09/2026): o banco recusa recorrência sem rateio.
  const { data: recId, error } = await supabase.rpc("criar_conta_recorrente", {
    p_dados: {
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      valor: d.valor,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      frequencia: d.frequencia,
      dia_do_mes: d.dia_do_mes,
      dia_quinzena_1: d.dia_quinzena_1,
      dia_quinzena_2: d.dia_quinzena_2,
      dia_do_ano_dia: d.dia_do_ano_dia,
      dia_do_ano_mes: d.dia_do_ano_mes,
      proxima_data: proximaData,
      data_fim: d.data_fim,
      forma_pagamento: d.forma_pagamento ?? null,
      cartao_credito_id: d.cartao_credito_id ?? null,
      valor_variavel: d.valor_variavel,
      texto_no_extrato: d.forma_pagamento === "debito_automatico" ? d.texto_no_extrato : null,
      criado_por: session.profile.id,
    },
    p_rateio: rateio,
  });

  if (error || !recId) {
    return {
      ok: false,
      message: `Falha ao criar recorrência: ${error?.message ?? "erro"}`,
    };
  }
  const rec = { id: recId as string };

  // O que vence em até 30 dias já nasce título.
  await gerarOcorrencias(supabase, rec.id);

  await logAuditEvent({
    acao: "conta_recorrente.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: rec.id,
    metadata: {
      descricao: d.descricao,
      valor: Number(d.valor),
      frequencia: d.frequencia,
      proxima_data: proximaData,
      data_fim: d.data_fim,
      forma_pagamento: d.forma_pagamento ?? null,
      cartao_credito_id: d.cartao_credito_id ?? null,
      valor_variavel: d.valor_variavel,
      regional: d.regional === "td" ? "td" : "uma",
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: rec.id };
}

export async function editarContaRecorrente(
  id: string,
  input: unknown,
): Promise<Result> {
  const parsed = editarContaRecorrenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const gate = await checarGateFinanceiro(id, "conta_recorrente.editada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const d = parsed.data;

  const { data: atual } = await supabase
    .from("contas_avulsas_recorrentes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Recorrência não encontrada." };
  if (!atual.ativo) {
    return {
      ok: false,
      message: "Só recorrências ativas podem ser editadas. Reative primeiro.",
    };
  }

  // Detecta mudança em cluster de frequência
  const mudouFrequencia =
    atual.frequencia !== d.frequencia ||
    atual.dia_do_mes !== d.dia_do_mes ||
    atual.dia_quinzena_1 !== d.dia_quinzena_1 ||
    atual.dia_quinzena_2 !== d.dia_quinzena_2 ||
    atual.dia_do_ano_dia !== d.dia_do_ano_dia ||
    atual.dia_do_ano_mes !== d.dia_do_ano_mes;

  let novaProxData: string | null = null;
  if (mudouFrequencia) {
    const { data: prox, error: rpcErr } = await supabase.rpc(
      "calcular_proxima_data_inicial",
      {
        p_frequencia: d.frequencia,
        p_dia_do_mes: d.dia_do_mes,
        p_dia_quinzena_1: d.dia_quinzena_1,
        p_dia_quinzena_2: d.dia_quinzena_2,
        p_dia_do_ano_dia: d.dia_do_ano_dia,
        p_dia_do_ano_mes: d.dia_do_ano_mes,
      },
    );
    if (rpcErr || !prox) {
      return {
        ok: false,
        message: `Falha ao recalcular próxima data: ${rpcErr?.message ?? "erro"}`,
      };
    }
    novaProxData = prox as string;
    // O novo dia não repete o mês de um título já gerado (decisão 272): sem
    // isto, mudar o vencimento de 8 para 10 com o título de 08/12 já nascido
    // gerava também o de 10/12 — dois títulos no mesmo mês.
    const { data: gerados } = await supabase
      .from("contas_avulsas")
      .select("data_compra, data_pagamento_primeira")
      .eq("recorrente_id", id)
      .eq("tenant_id", session.activeTenant.id);
    const ultimo = ((gerados ?? []) as Array<{ data_compra: string | null; data_pagamento_primeira: string | null }>)
      .map((g) => g.data_compra ?? g.data_pagamento_primeira ?? "")
      .filter(Boolean)
      .sort()
      .pop();
    if (ultimo) {
      const ult = ultimo.slice(0, 10);
      // Mensal: o novo dia vale do mês seguinte ao do último título. Nas
      // outras, da data seguinte ao último título.
      const [y, m] = ult.split("-").map(Number);
      const limite = d.frequencia === "mensal" ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : ult;
      if (novaProxData <= limite) novaProxData = proximasDatas(d, somarDias(limite, 1), 1)[0] ?? novaProxData;
    }
  }

  const patch: Record<string, unknown> = {
    descricao: d.descricao,
    valor: d.valor,
    fornecedor_id: d.fornecedor_id,
    cliente_id: d.cliente_id,
    plano_conta_tipo_id: d.plano_conta_tipo_id,
    plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    frequencia: d.frequencia,
    dia_do_mes: d.dia_do_mes,
    dia_quinzena_1: d.dia_quinzena_1,
    dia_quinzena_2: d.dia_quinzena_2,
    dia_do_ano_dia: d.dia_do_ano_dia,
    dia_do_ano_mes: d.dia_do_ano_mes,
    data_fim: d.data_fim,
    forma_pagamento: d.forma_pagamento ?? null,
    cartao_credito_id: d.cartao_credito_id ?? null,
    valor_variavel: d.valor_variavel,
    texto_no_extrato: d.forma_pagamento === "debito_automatico" ? d.texto_no_extrato : null,
  };
  if (novaProxData !== null) patch.proxima_data = novaProxData;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao atualizar: ${error.message}` };

  // Rateio regional: carrega atual, compara, substitui se mudou
  const { data: rateioAtual } = await supabase
    .from("contas_avulsas_recorrentes_regionais")
    .select("regional_id, percentual")
    .eq("recorrente_id", id)
    .eq("tenant_id", session.activeTenant.id);

  const regional = await rateioDaRegional(
    supabase,
    session.activeTenant.id,
    atual.empresa_id,
    d.regional,
    ((rateioAtual ?? []) as Array<{ regional_id: string; percentual: string | number }>).map((r) => ({
      regional_id: r.regional_id,
      percentual: Number(r.percentual),
    })),
  );
  if (!regional.ok) return regional;
  const rateioNovo = regional.rateio;

  if (rateioNovo) {
    // Apaga e grava numa transação só (15/09/2026): a recorrência nunca
    // fica sem rateio no meio da troca.
    const { error: rateioErr } = await supabase.rpc(
      "substituir_rateio_conta_recorrente",
      { p_recorrente_id: id, p_rateio: rateioNovo },
    );
    if (rateioErr) {
      return { ok: false, message: `Falha ao salvar rateio: ${rateioErr.message}` };
    }

    await logAuditEvent({
      acao: "conta_recorrente.rateio_alterado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_recorrente",
      entidadeId: id,
      metadata: {
        linhas_anteriores: (rateioAtual ?? []).length,
        linhas_novas: rateioNovo.length,
      },
    });
  }

  // A conta que varia (decisão 272): os títulos em aberto acompanham a
  // marca — "Aguardando conta" até a conta do mês ser lançada.
  if (Boolean(atual.valor_variavel) !== d.valor_variavel) {
    await supabase
      .from("contas_avulsas")
      .update({ valor_estimado: d.valor_variavel })
      .eq("recorrente_id", id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "aprovada")
      .is("conta_lancada_em", null);
  }

  // Opção A da decisão 272: a mudança vai também ao título já gerado e em
  // aberto, se a pessoa pediu.
  const titulosAtualizados = d.aplicar_no_titulo_em_aberto
    ? await aplicarNosTitulosEmAberto(supabase, session, id)
    : 0;

  // Frequência, valor ou data de fim podem ter mudado: o que agora vence em
  // até 30 dias vira título já. Sem a opção acima, os títulos criados antes
  // ficam como estão.
  await gerarOcorrencias(supabase, id);

  await logAuditEvent({
    acao: "conta_recorrente.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: {
      mudou_frequencia: mudouFrequencia,
      nova_proxima_data: novaProxData,
      valor_variavel: d.valor_variavel,
      titulos_em_aberto_atualizados: titulosAtualizados,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function pausarContaRecorrente(id: string, excluirTitulos: string[] = []): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.pausada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao pausar: ${error.message}` };

  // O título em aberto que a pessoa escolheu tirar (decisão 272): a avulsa
  // não tem status cancelado, então sai pelo Excluir, com as mesmas travas.
  const excluidos = await excluirTitulosDaRecorrencia(supabase, session.activeTenant.id, id, excluirTitulos);
  if (!excluidos.ok) return excluidos;

  await logAuditEvent({
    acao: "conta_recorrente.pausada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: { titulos_excluidos: excluirTitulos.length },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function reativarContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.reativada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas_recorrentes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Recorrência não encontrada." };

  // Se proxima_data já passou, recalcula.
  // Hoje em Brasília: em UTC, depois das 21h a recorrência que vence
  // amanhã já contava como vencida e tinha a próxima data recalculada.
  const hoje = hojeEmSaoPauloIso();
  let novaProxData: string | null = null;
  if (atual.proxima_data <= hoje) {
    const { data: prox } = await supabase.rpc("calcular_proxima_data_inicial", {
      p_frequencia: atual.frequencia,
      p_dia_do_mes: atual.dia_do_mes,
      p_dia_quinzena_1: atual.dia_quinzena_1,
      p_dia_quinzena_2: atual.dia_quinzena_2,
      p_dia_do_ano_dia: atual.dia_do_ano_dia,
      p_dia_do_ano_mes: atual.dia_do_ano_mes,
    });
    novaProxData = prox as string;
  }

  const patch: Record<string, unknown> = { ativo: true };
  if (novaProxData !== null) patch.proxima_data = novaProxData;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao reativar: ${error.message}` };

  await gerarOcorrencias(supabase, id);

  await logAuditEvent({
    acao: "conta_recorrente.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: {
      recalculou_proxima_data: novaProxData !== null,
      proxima_data: novaProxData,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function excluirContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.excluida");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Conta instâncias já geradas
  const { count } = await supabase
    .from("contas_avulsas")
    .select("id", { count: "exact", head: true })
    .eq("recorrente_id", id);

  const geradas = count ?? 0;

  if (geradas === 0) {
    // Hard delete — nunca gerou nada.
    const { error } = await supabase
      .from("contas_avulsas_recorrentes")
      .delete()
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);

    if (error) {
      return { ok: false, message: `Falha ao excluir: ${error.message}` };
    }
  } else {
    // Soft delete — mantém histórico das instâncias.
    const { error } = await supabase
      .from("contas_avulsas_recorrentes")
      .update({ ativo: false })
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);

    if (error) {
      return { ok: false, message: `Falha ao pausar: ${error.message}` };
    }
  }

  await logAuditEvent({
    acao: "conta_recorrente.excluida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: { hard_delete: geradas === 0, instancias_geradas: geradas },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Decisão 272: o título em aberto, o encerramento, o documento e a conta do mês
// ---------------------------------------------------------------------------

/** Exclui os títulos em aberto escolhidos, conferindo que são da recorrência. */
async function excluirTitulosDaRecorrencia(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  recorrenteId: string,
  ids: string[],
): Promise<{ ok: true } | Err> {
  if (!ids.length) return { ok: true };
  const { data } = await supabase
    .from("contas_avulsas")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("recorrente_id", recorrenteId)
    .in("id", ids);
  const daRecorrencia = new Set(((data ?? []) as Array<{ id: string }>).map((x) => x.id));
  for (const tid of ids) {
    if (!daRecorrencia.has(tid)) return { ok: false, message: "Título não é desta recorrência." };
    const r = await excluirContaAvulsa(tid);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Leva o cadastro da recorrência aos títulos dela que ainda estão em aberto
 * (opção A da decisão 272): sem baixa, fora da fatura de cartão. O valor só
 * muda enquanto a conta do mês não foi lançada; a forma de pagamento não
 * entra nem sai do cartão por aqui. Cada campo mudado vai ao histórico do
 * título, como na edição da conta avulsa.
 */
async function aplicarNosTitulosEmAberto(
  supabase: ReturnType<typeof createClient>,
  session: Awaited<ReturnType<typeof requireSession>>,
  recorrenteId: string,
): Promise<number> {
  const tenantId = session.activeTenant.id;
  const [{ data: rec }, { data: rateioRec }, { data: titulos }] = await Promise.all([
    supabase
      .from("contas_avulsas_recorrentes")
      .select("descricao, valor, fornecedor_id, cliente_id, plano_conta_tipo_id, plano_conta_subtipo_id, forma_pagamento, cartao_credito_id")
      .eq("id", recorrenteId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("contas_avulsas_recorrentes_regionais")
      .select("regional_id, percentual")
      .eq("recorrente_id", recorrenteId)
      .eq("tenant_id", tenantId),
    supabase
      .from("contas_avulsas")
      .select(
        "id, descricao, valor, fornecedor_id, cliente_id, plano_conta_tipo_id, plano_conta_subtipo_id, forma_pagamento, cartao_credito_id, conta_lancada_em, rateio:contas_avulsas_regionais(regional_id, percentual)",
      )
      .eq("recorrente_id", recorrenteId)
      .eq("tenant_id", tenantId)
      .eq("status", "aprovada")
      .is("fatura_cartao_id", null),
  ]);
  if (!rec) return 0;
  type T = {
    id: string;
    descricao: string;
    valor: string | number;
    fornecedor_id: string | null;
    cliente_id: string | null;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    forma_pagamento: string | null;
    cartao_credito_id: string | null;
    conta_lancada_em: string | null;
    rateio: Array<{ regional_id: string; percentual: string | number }> | null;
  };
  const lista = (titulos ?? []) as unknown as T[];
  const baixado = await baixadoDosTitulos(supabase, lista.map((t) => t.id));
  const chave = (rows: Array<{ regional_id: string; percentual: string | number }>) =>
    rows.map((r) => `${r.regional_id}:${Number(r.percentual).toFixed(2)}`).sort().join("|");
  const rateio = ((rateioRec ?? []) as Array<{ regional_id: string; percentual: string | number }>).map((r) => ({
    regional_id: r.regional_id,
    percentual: Number(r.percentual),
  }));
  const cartaoNaRec = rec.forma_pagamento === "cartao_credito";
  let atualizados = 0;
  for (const t of lista) {
    if ((baixado.get(t.id) ?? 0) > 0.004) continue;
    const novo: Record<string, string | number | null> = {
      descricao: rec.descricao,
      fornecedor_id: rec.fornecedor_id,
      cliente_id: rec.cliente_id,
      plano_conta_tipo_id: rec.plano_conta_tipo_id,
      plano_conta_subtipo_id: rec.plano_conta_subtipo_id,
    };
    if (!t.conta_lancada_em) novo.valor = Number(rec.valor);
    if (!cartaoNaRec && t.forma_pagamento !== "cartao_credito") novo.forma_pagamento = rec.forma_pagamento;
    const mudou = Object.entries(novo).filter(([campo, depois]) => {
      const antes = t[campo as keyof T] as unknown;
      const a = antes == null ? null : campo === "valor" ? Number(antes).toFixed(2) : String(antes);
      const b = depois == null ? null : campo === "valor" ? Number(depois).toFixed(2) : String(depois);
      return a !== b;
    });
    const rateioMudou = rateio.length > 0 && chave(t.rateio ?? []) !== chave(rateio);
    if (!mudou.length && !rateioMudou) continue;
    if (mudou.length) {
      const { error } = await supabase
        .from("contas_avulsas")
        .update(Object.fromEntries(mudou))
        .eq("id", t.id)
        .eq("tenant_id", tenantId);
      if (error) {
        console.error("[recorrente.aplicar_no_titulo]", error.message);
        continue;
      }
      await supabase.from("contas_avulsas_historico").insert(
        mudou.map(([campo, depois]) => ({
          tenant_id: tenantId,
          conta_avulsa_id: t.id,
          campo_alterado: campo,
          valor_anterior: t[campo as keyof T] == null ? null : String(t[campo as keyof T]),
          valor_novo: depois == null ? null : String(depois),
          alterado_por: session.profile.id,
        })),
      );
    }
    if (rateioMudou) {
      const { error } = await supabase.rpc("substituir_rateio_conta_avulsa", { p_conta_avulsa_id: t.id, p_rateio: rateio });
      if (error) console.error("[recorrente.aplicar_no_titulo.rateio]", error.message);
    }
    await logAuditEvent({
      acao: "conta_avulsa.editada",
      tenantId,
      entidadeTipo: "conta_avulsa",
      entidadeId: t.id,
      metadata: { campos_alterados: mudou.map(([c]) => c), rateio_alterado: rateioMudou, pela_recorrencia: recorrenteId },
    });
    atualizados++;
  }
  return atualizados;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Encerra a recorrência (decisão 272): `ultimo` é o último vencimento que
 * vale (nulo = nenhum a partir de hoje). Enquanto ainda houver vencimento
 * até ele por gerar, ela segue ativa e o gerador para sozinho na data de fim.
 */
export async function encerrarContaRecorrente(
  id: string,
  ultimo: string | null,
  excluirTitulos: string[] = [],
): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.encerrada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  if (ultimo && !DATA_ISO.test(ultimo)) return { ok: false, message: "Data inválida." };

  const { data: atual } = await supabase
    .from("contas_avulsas_recorrentes")
    .select("proxima_data")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!atual) return { ok: false, message: "Recorrência não encontrada." };

  const hoje = hojeEmSaoPauloIso();
  const dataFim = ultimo ?? hoje;
  // Ainda falta gerar até o último vencimento: segue ativa até ele. Se o
  // último já virou título, a próxima data está depois dele e recua junto
  // (o banco exige `data_fim >= proxima_data`); inativa, não gera mais nada.
  const segueAtiva = Boolean(ultimo && atual.proxima_data <= ultimo);
  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update({ data_fim: dataFim, ativo: segueAtiva, ...(segueAtiva ? {} : { proxima_data: dataFim }) })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao encerrar: ${error.message}` };

  const excluidos = await excluirTitulosDaRecorrencia(supabase, session.activeTenant.id, id, excluirTitulos);
  if (!excluidos.ok) return excluidos;

  await logAuditEvent({
    acao: "conta_recorrente.encerrada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: { data_fim: dataFim, titulos_excluidos: excluirTitulos.length },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id };
}

const TIPOS_DE_DOCUMENTO: readonly DocumentoTipo[] = ["nota_fiscal", "recibo", "fatura", "boleto", "guia", "contrato", "outro"];

interface AnexoEnviado {
  /** O caminho no bucket `contas-avulsas`, que o navegador já enviou. */
  path: string;
  nome: string;
  tamanho: number;
  mimetype: string;
  tipo: DocumentoTipo;
  numero: string | null;
}

/** O título, se for de recorrência e do tenant. */
async function tituloDaRecorrencia(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  tituloId: string,
) {
  const { data } = await supabase
    .from("contas_avulsas")
    .select("id, recorrente_id, status, valor, valor_estimado, conta_lancada_em, data_prevista_pagamento, data_pagamento, fatura_cartao_id")
    .eq("id", tituloId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data && data.recorrente_id ? data : null;
}

/** O arquivo enviado tem de estar na pasta do tenant (a RLS do bucket pede). */
function anexoValido(a: AnexoEnviado, tenantId: string): string | null {
  if (!a?.path || !a.path.startsWith(`${tenantId}/`)) return "Arquivo fora da pasta da empresa.";
  if (!TIPOS_DE_DOCUMENTO.includes(a.tipo)) return "Escolha o tipo do documento.";
  if (!a.nome?.trim()) return "Arquivo sem nome.";
  return null;
}

/** Anexa o documento do pagamento a um título da recorrência (decisão 272). */
export async function anexarDocumentoAoTitulo(tituloId: string, anexo: AnexoEnviado): Promise<Result> {
  const gate = await checarGateFinanceiro(tituloId, "conta_avulsa.anexo_incluido");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;
  const titulo = await tituloDaRecorrencia(supabase, tenantId, tituloId);
  if (!titulo) return { ok: false, message: "Título não encontrado." };
  const invalido = anexoValido(anexo, tenantId);
  if (invalido) return { ok: false, message: invalido };

  const { error } = await supabase.from("contas_avulsas_anexos").insert({
    tenant_id: tenantId,
    conta_avulsa_id: tituloId,
    arquivo_path: anexo.path,
    arquivo_nome_original: anexo.nome,
    arquivo_tamanho_bytes: anexo.tamanho,
    arquivo_mimetype: anexo.mimetype || "application/octet-stream",
    documento_tipo: anexo.tipo,
    documento_numero: anexo.numero?.trim() || null,
    created_by: session.profile.id,
  });
  if (error) return { ok: false, message: `Falha ao anexar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.anexo_incluido",
    tenantId,
    entidadeTipo: "conta_avulsa",
    entidadeId: tituloId,
    metadata: { tipo: anexo.tipo, recorrente_id: titulo.recorrente_id },
  });
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: tituloId };
}

/** Tira um documento do título (o arquivo sai do bucket junto). */
export async function removerDocumentoDoTitulo(anexoId: string): Promise<Result> {
  const gate = await checarGateFinanceiro(anexoId, "conta_avulsa.anexo_removido");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;
  const { data: anexo } = await supabase
    .from("contas_avulsas_anexos")
    .select("id, arquivo_path, conta_avulsa_id")
    .eq("id", anexoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!anexo) return { ok: false, message: "Documento não encontrado." };
  const titulo = await tituloDaRecorrencia(supabase, tenantId, anexo.conta_avulsa_id);
  if (!titulo) return { ok: false, message: "Título não encontrado." };

  const { error } = await supabase.from("contas_avulsas_anexos").delete().eq("id", anexoId).eq("tenant_id", tenantId);
  if (error) return { ok: false, message: `Falha ao tirar o documento: ${error.message}` };
  const { error: rmErr } = await supabase.storage.from("contas-avulsas").remove([anexo.arquivo_path]);
  if (rmErr) console.error("[recorrente.documento.storage]", rmErr.message);

  await logAuditEvent({
    acao: "conta_avulsa.anexo_removido",
    tenantId,
    entidadeTipo: "conta_avulsa",
    entidadeId: anexo.conta_avulsa_id,
    metadata: { recorrente_id: titulo.recorrente_id },
  });
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: anexo.conta_avulsa_id };
}

/**
 * "Lançar a conta" (decisão 272): na conta que varia, a fatura do mês chega e
 * o título passa a ter o valor real e o vencimento dela. Grava o documento
 * junto. O título continua aberto, agora "A pagar".
 */
export async function lancarContaDoTitulo(
  tituloId: string,
  d: { valor: number; vencimento: string; anexo: AnexoEnviado },
): Promise<Result> {
  const gate = await checarGateFinanceiro(tituloId, "conta_avulsa.conta_lancada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;
  const titulo = await tituloDaRecorrencia(supabase, tenantId, tituloId);
  if (!titulo) return { ok: false, message: "Título não encontrado." };
  if (titulo.status !== "aprovada") return { ok: false, message: "Este título já foi pago." };
  if (titulo.fatura_cartao_id) return { ok: false, message: "Título na fatura do cartão: ajuste pela fatura." };
  if (!(d.valor > 0) || !Number.isFinite(d.valor)) return { ok: false, message: "Informe o valor da conta." };
  if (!DATA_ISO.test(d.vencimento)) return { ok: false, message: "Informe o vencimento." };
  const invalido = anexoValido(d.anexo, tenantId);
  if (invalido) return { ok: false, message: invalido };
  const baixado = (await baixadoDosTitulos(supabase, [tituloId])).get(tituloId) ?? 0;
  if (baixado > 0.004) return { ok: false, message: "Este título já tem baixa. Para mudar o valor, cancele a baixa antes." };

  const valor = Math.round(d.valor * 100) / 100;
  const patch: Record<string, unknown> = {
    valor,
    data_prevista_pagamento: d.vencimento,
    valor_estimado: false,
    conta_lancada_em: new Date().toISOString(),
  };
  // A data de pagamento acompanha enquanto ninguém a repactuou (como na edição da avulsa).
  if (titulo.data_pagamento == null || titulo.data_pagamento === titulo.data_prevista_pagamento) patch.data_pagamento = d.vencimento;
  const { error } = await supabase.from("contas_avulsas").update(patch).eq("id", tituloId).eq("tenant_id", tenantId);
  if (error) return { ok: false, message: `Falha ao lançar a conta: ${error.message}` };

  const historico = (
    [
      ["valor", Number(titulo.valor).toFixed(2), valor.toFixed(2)],
      ["data_prevista_pagamento", titulo.data_prevista_pagamento as string | null, d.vencimento],
    ] as Array<[string, string | null, string]>
  ).filter(([, a, b]) => a !== b);
  if (historico.length) {
    await supabase.from("contas_avulsas_historico").insert(
      historico.map(([campo, antes, depois]) => ({
        tenant_id: tenantId,
        conta_avulsa_id: tituloId,
        campo_alterado: campo,
        valor_anterior: antes,
        valor_novo: depois,
        alterado_por: session.profile.id,
      })),
    );
  }

  const { error: anexoErr } = await supabase.from("contas_avulsas_anexos").insert({
    tenant_id: tenantId,
    conta_avulsa_id: tituloId,
    arquivo_path: d.anexo.path,
    arquivo_nome_original: d.anexo.nome,
    arquivo_tamanho_bytes: d.anexo.tamanho,
    arquivo_mimetype: d.anexo.mimetype || "application/octet-stream",
    documento_tipo: d.anexo.tipo,
    documento_numero: d.anexo.numero?.trim() || null,
    created_by: session.profile.id,
  });
  if (anexoErr) console.error("[recorrente.lancar_conta.anexo]", anexoErr.message);

  await logAuditEvent({
    acao: "conta_avulsa.conta_lancada",
    tenantId,
    entidadeTipo: "conta_avulsa",
    entidadeId: tituloId,
    metadata: {
      recorrente_id: titulo.recorrente_id,
      valor_estimado: Number(titulo.valor),
      valor_lancado: valor,
      vencimento: d.vencimento,
      anexo_gravado: !anexoErr,
    },
  });
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: tituloId };
}
