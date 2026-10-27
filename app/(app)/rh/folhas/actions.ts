"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import {
  gerarFolhaSchema,
  linhaFolhaSchema,
} from "@/lib/validations/rh-folhas";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Gera a folha de uma competência. Idempotente por colaborador.
 *
 * A regra mora no banco, em `gerar_folha_da_competencia` (decisão 218,
 * migration 20261027100003), para o botão e a rotina diária que faz a folha
 * do mês seguinte nascer sozinha usarem a mesma. A função roda com a RLS de
 * quem clicou e numa transação só: a soma 100 das alocações é conferida no
 * fim, e se falhar nada fica.
 *
 * Modelo de alocação (2026-09-23):
 *   • Camada 1 tem 1 alocação vigente por colaborador — ou regional
 *     específica (100% ali) ou "toda a empresa" (regional_id=null,
 *     usa_rateio_empresa=true).
 *   • Snapshot da folha (`folhas_pagamento_alocacoes`) continua sendo
 *     N linhas com % somando 100 — o motor EXPANDE aqui:
 *       - regional específica → 1 linha 100%
 *       - toda a empresa → N linhas conforme rateio da empresa+ano da
 *         competência (empresas_rateios_regionais), só as regionais com % > 0
 *   • Se toggle=ON e a empresa não tem rateio configurado pra o ano da
 *     competência, colaborador é pulado com aviso.
 *
 * Regra de inclusão: fluxo PJ (origem=california) — pj, mei e a parte Recibo
 * do híbrido clt_recibo — que esteve ativo em qualquer dia da competência
 * (data_admissao <= último dia AND (status=ativo OR data_encerramento >=
 * primeiro dia)). CLT puro, estágio e sócio vêm pela importação do PDF da
 * contabilidade.
 */
export async function gerarFolha(input: {
  ano: number;
  mes: number;
}): Promise<
  ActionResult<{
    criadas: number;
    ja_existiam: number;
    pulados_sem_salario: string[];
    pulados_sem_alocacao: string[];
    pulados_sem_rateio: string[];
  }>
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const parsed = gerarFolhaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Competência inválida.",
    };
  }
  const { ano, mes } = parsed.data;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data, error } = await supabase.rpc("gerar_folha_da_competencia", {
    p_tenant_id: tenantId,
    p_ano: ano,
    p_mes: mes,
  });
  if (error || !data) {
    console.error("[folha.gerar]", error?.message ?? "sem retorno");
    return { ok: false, message: "Falha ao gerar a folha." };
  }
  const resultado = data as {
    criadas: number;
    ja_existiam: number;
    pulados_sem_salario: string[];
    pulados_sem_alocacao: string[];
    pulados_sem_rateio: string[];
  };

  if (resultado.criadas > 0) {
    await logAuditEvent({
      acao: "folha.gerada",
      tenantId,
      entidadeTipo: "folha",
      entidadeId: `${ano}-${String(mes).padStart(2, "0")}`,
      metadata: {
        ano,
        mes,
        origem: "california",
        tipos_incluidos: ["pj", "mei", "clt_recibo"],
        criadas: resultado.criadas,
        ja_existiam: resultado.ja_existiam,
        pulados_sem_salario: resultado.pulados_sem_salario,
        pulados_sem_alocacao: resultado.pulados_sem_alocacao,
        pulados_sem_rateio: resultado.pulados_sem_rateio,
      },
    });
  }

  // Só revalida a lista: /rh/folhas. O hub /rh e a página da competência
  // não precisam ser marcados stale aqui — o hub não muda visualmente com
  // folha recém-criada (contagem no card é de pendências, não rascunhos),
  // e a página da competência é hidratada no primeiro acesso. Marcar
  // essas duas é trabalho de SSR gasto sem ninguém esperando.
  revalidatePath("/rh/folhas");
  return { ok: true, ...resultado };
}

/**
 * Edita uma linha da folha pelo RH. Só permitido quando status é
 * rascunho ou pendente_correcao. Se estava pendente_correcao, o
 * motivo_pendencia é limpo (mas o motivo permanece no audit).
 *
 * Regra da soma=100 é enforçada pelo constraint trigger deferred no
 * banco. Aqui só orquestra o swap: deleta as alocações antigas, insere
 * as novas — o trigger valida no commit.
 */
export async function editarLinhaFolhaRh(
  folhaId: string,
  payload: {
    salario_base: string;
    alocacoes: {
      empresa_id: string;
      regional_id: string;
      percentual: string;
    }[];
  },
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const parsed = linhaFolhaSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // 1) Confirma que a linha existe, pertence ao tenant e está em estado editável pelo RH
  const { data: folha, error: folhaError } = await supabase
    .from("folhas_pagamento")
    .select(
      "id, salario_base, status, colaborador_id, competencia_ano, competencia_mes",
    )
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (folhaError || !folha) {
    return { ok: false, message: "Linha da folha não encontrada." };
  }
  if (folha.status !== "rascunho" && folha.status !== "pendente_correcao") {
    return {
      ok: false,
      message: `Linha em status "${folha.status}" não é editável pelo RH.`,
    };
  }

  const valorAnterior = String(folha.salario_base);

  // 2) Atualiza o salario_base + limpa motivo_pendencia se estava pendente
  const patch: {
    salario_base: string;
    motivo_pendencia?: string | null;
  } = {
    salario_base: parsed.data.salario_base,
  };
  if (folha.status === "pendente_correcao") {
    patch.motivo_pendencia = null;
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update(patch)
    .eq("id", folhaId);
  if (upError) {
    console.error("[folha.editar_rh.folha]", upError.message);
    return { ok: false, message: "Falha ao atualizar a linha." };
  }

  // 3) Swap das alocações (deleta antigas, insere novas — trigger deferred valida no commit)
  const { error: delError } = await supabase
    .from("folhas_pagamento_alocacoes")
    .delete()
    .eq("folha_id", folhaId);
  if (delError) {
    console.error("[folha.editar_rh.del_aloc]", delError.message);
    return { ok: false, message: "Falha ao substituir alocações." };
  }

  const linhasAloc = parsed.data.alocacoes.map((a) => ({
    tenant_id: tenantId,
    folha_id: folhaId,
    empresa_id: a.empresa_id,
    regional_id: a.regional_id,
    percentual: a.percentual,
  }));

  const { error: insError } = await supabase
    .from("folhas_pagamento_alocacoes")
    .insert(linhasAloc);
  if (insError) {
    console.error("[folha.editar_rh.ins_aloc]", insError.message);
    if (insError.message.includes("Rateio de alocacoes")) {
      return {
        ok: false,
        message: "A soma dos percentuais das alocações precisa dar 100.",
      };
    }
    return { ok: false, message: "Falha ao gravar alocações." };
  }

  await logAuditEvent({
    acao: "folha.linha.editada_rh",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: folhaId,
    metadata: {
      colaborador_id: folha.colaborador_id,
      competencia: `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`,
      salario_anterior: valorAnterior,
      salario_novo: parsed.data.salario_base,
      alocacoes_novas: parsed.data.alocacoes,
      status_anterior: folha.status,
    },
  });

  const chaveCompetencia = `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chaveCompetencia}`);
  return { ok: true, id: folhaId };
}

/**
 * Envia uma linha de folha do RH para o financeiro. Muda status de
 * rascunho|pendente_correcao → enviada. Limpa motivo_pendencia se
 * estava em pendente_correcao.
 */
export async function enviarLinhaFolha(
  folhaId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folha, error: folhaError } = await supabase
    .from("folhas_pagamento")
    .select("id, status, competencia_ano, competencia_mes, colaborador_id")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (folhaError || !folha) {
    return { ok: false, message: "Linha da folha não encontrada." };
  }
  if (folha.status !== "rascunho" && folha.status !== "pendente_correcao") {
    return {
      ok: false,
      message: `Linha em status "${folha.status}" não pode ser enviada.`,
    };
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      motivo_pendencia: null,
      enviada_em: new Date().toISOString(),
      enviada_por: session.profile.id,
    })
    .eq("id", folhaId);
  if (upError) {
    console.error("[folha.enviar]", upError.message);
    return { ok: false, message: "Não foi possível enviar." };
  }

  await logAuditEvent({
    acao: "folha.linha.enviada",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: folhaId,
    metadata: {
      colaborador_id: folha.colaborador_id,
      competencia: `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`,
      status_anterior: folha.status,
    },
  });

  const chave = `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chave}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: folhaId };
}

/**
 * Envia todas as linhas em rascunho|pendente_correcao de uma competência.
 * Ação em lote. Retorna quantas foram enviadas.
 */
export async function enviarFolhaInteira(
  ano: number,
  mes: number,
): Promise<
  ActionResult<{ enviadas: number; falhas: number }>
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: linhas, error } = await supabase
    .from("folhas_pagamento")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .in("status", ["rascunho", "pendente_correcao"]);

  if (error) {
    console.error("[folha.enviar_tudo.list]", error.message);
    return { ok: false, message: "Falha ao listar linhas." };
  }

  const ids = ((linhas ?? []) as { id: string }[]).map((l) => l.id);
  if (ids.length === 0) {
    return { ok: true, enviadas: 0, falhas: 0 };
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      motivo_pendencia: null,
      enviada_em: new Date().toISOString(),
      enviada_por: session.profile.id,
    })
    .in("id", ids);

  if (upError) {
    console.error("[folha.enviar_tudo.up]", upError.message);
    return { ok: false, message: "Falha ao enviar em lote." };
  }

  await logAuditEvent({
    acao: "folha.linha.enviada",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: `${ano}-${String(mes).padStart(2, "0")}`,
    metadata: { competencia: `${ano}-${mes}`, quantidade: ids.length, lote: true },
  });

  const chave = `${ano}-${String(mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chave}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, enviadas: ids.length, falhas: 0 };
}
