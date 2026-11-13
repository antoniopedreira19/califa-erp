"use server";

/**
 * Actions para resolver pendências de histórico de férias direto pela UI.
 *
 * O `/rh/ferias/actions.ts` cuida do fluxo normal (solicitação → aprovação →
 * folha → recibo). Este arquivo é separado porque atua em lançamentos já
 * concluídos — hipótese esperada é que sejam entradas vindas da migração
 * da planilha FériasAtt (2023-2026) onde:
 *   - O RH cadastrou em duplicata (mesmos dias, tipo, datas)
 *   - Marcou o aquisitivo errado (lançamento no período anterior ou seguinte)
 *   - Juntou duas férias num único lançamento (ex: 45d cruzando 2 períodos)
 *
 * Toda action aqui exige role rh ou administrador, valida com Zod, respeita
 * tenant_id e registra audit.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";

type ActionResult =
  | { ok: true; id?: string; ids?: string[]; aviso?: string }
  | { ok: false; message: string };

function assertRh(role: string): ActionResult | null {
  if (role !== "administrador" && role !== "rh") {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  return null;
}

/** Status onde correção manual é permitida. Pendente de aprovação ou
 *  cancelado NÃO entram — esses usam o fluxo normal (aprovar/reprovar). */
const STATUS_EDITAVEIS = new Set(["aprovado", "concluido"]);

async function carregarLancamento(id: string, tenantId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono, data_inicio, data_fim, status, observacao, valor_total",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

// ======================================================================
// 1. Excluir lançamento
// ======================================================================

const excluirSchema = z.object({
  lancamento_id: z.string().uuid({ message: "ID inválido." }),
  motivo: z
    .string()
    .trim()
    .min(3, "Explique por que está excluindo.")
    .max(300, "Motivo longo demais."),
});

export async function excluirLancamentoFerias(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = excluirSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.flatten().fieldErrors.motivo?.[0] ??
        "Dados inválidos.",
    };
  }

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(parsed.data.lancamento_id, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (!STATUS_EDITAVEIS.has(lanc.status)) {
    return {
      ok: false,
      message:
        "Só é possível excluir lançamentos aprovados ou concluídos. Use o fluxo normal para solicitações pendentes.",
    };
  }
  if (lanc.valor_total !== null) {
    return {
      ok: false,
      message:
        "Este lançamento já teve valores calculados. Cancele a folha de pagamento antes.",
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .delete()
    .eq("id", lanc.id);

  if (error) {
    console.error("[rh.ferias.pendencia.excluir]", error.message);
    return { ok: false, message: "Falha ao excluir: " + error.message };
  }

  await logAuditEvent({
    acao: "ferias.lancamento.excluido_por_pendencia",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      periodo_id: lanc.periodo_id,
      dias: lanc.dias,
      tipo: lanc.tipo,
      motivo: parsed.data.motivo,
    },
  });

  revalidatePath("/rh/ferias");
  return { ok: true, id: lanc.id };
}

// ======================================================================
// 2. Editar lançamento (dias / datas / observação)
// ======================================================================

const editarSchema = z.object({
  lancamento_id: z.string().uuid(),
  data_inicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida."),
  data_fim: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fim inválida."),
  dias_abono: z.coerce
    .number()
    .int("dias_abono precisa ser inteiro.")
    .min(0)
    .max(10, "Abono máximo legal é 10 dias."),
  observacao: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),
  motivo: z
    .string()
    .trim()
    .min(3, "Explique a correção.")
    .max(300),
});

export async function editarLancamentoFerias(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = editarSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      ok: false,
      message: Object.values(flat).flat()[0] ?? "Dados inválidos.",
    };
  }
  const d = parsed.data;

  const ini = new Date(d.data_inicio + "T00:00:00");
  const fim = new Date(d.data_fim + "T00:00:00");
  if (fim < ini) {
    return { ok: false, message: "Data de fim antes do início." };
  }
  const diasFolga = Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
  const diasTotal = diasFolga + d.dias_abono;
  if (diasTotal <= 0 || diasTotal > 30) {
    return {
      ok: false,
      message: "Dias totais (folga + abono) devem estar entre 1 e 30.",
    };
  }

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(d.lancamento_id, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (!STATUS_EDITAVEIS.has(lanc.status)) {
    return { ok: false, message: "Status atual não permite edição direta." };
  }
  if (lanc.valor_total !== null) {
    return {
      ok: false,
      message:
        "Lançamento com valores já calculados. Cancele a folha antes de editar.",
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      data_inicio: d.data_inicio,
      data_fim: d.data_fim,
      dias: diasTotal,
      dias_abono: d.dias_abono,
      observacao: d.observacao ?? null,
    })
    .eq("id", lanc.id);

  if (error) {
    console.error("[rh.ferias.pendencia.editar]", error.message);
    return { ok: false, message: "Falha ao editar: " + error.message };
  }

  await logAuditEvent({
    acao: "ferias.lancamento.editado_por_pendencia",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      antes: {
        data_inicio: lanc.data_inicio,
        data_fim: lanc.data_fim,
        dias: lanc.dias,
        dias_abono: lanc.dias_abono,
      },
      depois: {
        data_inicio: d.data_inicio,
        data_fim: d.data_fim,
        dias: diasTotal,
        dias_abono: d.dias_abono,
      },
      motivo: d.motivo,
    },
  });

  revalidatePath("/rh/ferias");
  return { ok: true, id: lanc.id };
}

// ======================================================================
// 3. Mover para outro período aquisitivo
// ======================================================================

const moverSchema = z.object({
  lancamento_id: z.string().uuid(),
  novo_periodo_id: z.string().uuid(),
  motivo: z.string().trim().min(3).max(300),
});

export async function moverLancamentoFerias(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = moverSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos." };
  }
  const { lancamento_id: lancId, novo_periodo_id: novoPeriodoId, motivo } =
    parsed.data;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (!STATUS_EDITAVEIS.has(lanc.status)) {
    return { ok: false, message: "Status atual não permite mover." };
  }
  if (lanc.periodo_id === novoPeriodoId) {
    return { ok: false, message: "Já está nesse período aquisitivo." };
  }

  const supabase = createClient();

  // Garante que o novo período existe e é do MESMO colaborador.
  const { data: novoPer } = await supabase
    .from("colaboradores_ferias_periodos")
    .select("id, colaborador_id, tenant_id")
    .eq("id", novoPeriodoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!novoPer || novoPer.colaborador_id !== lanc.colaborador_id) {
    return {
      ok: false,
      message:
        "Período de destino inválido ou pertence a outro colaborador.",
    };
  }

  const { error } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({ periodo_id: novoPeriodoId })
    .eq("id", lanc.id);

  if (error) {
    console.error("[rh.ferias.pendencia.mover]", error.message);
    return { ok: false, message: "Falha ao mover: " + error.message };
  }

  await logAuditEvent({
    acao: "ferias.lancamento.movido_por_pendencia",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      periodo_anterior: lanc.periodo_id,
      periodo_novo: novoPeriodoId,
      motivo,
    },
  });

  revalidatePath("/rh/ferias");
  return { ok: true, id: lanc.id };
}

// ======================================================================
// 4. Dividir lançamento combinado em N lançamentos separados
// ======================================================================
// Caso típico: lançamento único de 45 dias que cruza dois aquisitivos.
// O RH informa a divisão (ex: 30d em 24/25 + 15d em 25/26) e esta action
// apaga o original e cria N novos, cada um já dentro de um aquisitivo.
//
// Transação: todas as inserções precisam dar certo, senão rollback.

const partePartidoSchema = z.object({
  periodo_id: z.string().uuid(),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dias_abono: z.coerce.number().int().min(0).max(10),
});

const dividirSchema = z.object({
  lancamento_id: z.string().uuid(),
  partes: z
    .array(partePartidoSchema)
    .min(2, "Informe pelo menos 2 partes.")
    .max(4, "Divisão em no máximo 4 partes."),
  motivo: z.string().trim().min(3).max(300),
});

export async function dividirLancamentoCombinado(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = dividirSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        Object.values(parsed.error.flatten().fieldErrors).flat()[0] ??
        "Dados inválidos.",
    };
  }
  const { lancamento_id: lancId, partes, motivo } = parsed.data;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (!STATUS_EDITAVEIS.has(lanc.status)) {
    return { ok: false, message: "Status atual não permite dividir." };
  }
  if (lanc.valor_total !== null) {
    return {
      ok: false,
      message:
        "Lançamento com valores já calculados. Cancele a folha antes de dividir.",
    };
  }

  // Valida cada parte: dias da parte precisam fechar em (data_fim - data_inicio + 1 + dias_abono)
  const partesCalc = partes.map((p) => {
    const ini = new Date(p.data_inicio + "T00:00:00");
    const fim = new Date(p.data_fim + "T00:00:00");
    const folga = Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
    return { ...p, folga, total: folga + p.dias_abono };
  });
  for (const p of partesCalc) {
    if (p.folga <= 0 || p.total > 30) {
      return {
        ok: false,
        message:
          "Cada parte deve ter entre 1 e 30 dias (folga + abono).",
      };
    }
  }

  const supabase = createClient();

  // Confere que todos os períodos de destino pertencem ao mesmo colaborador.
  const { data: periodosDestino } = await supabase
    .from("colaboradores_ferias_periodos")
    .select("id, colaborador_id")
    .in(
      "id",
      partes.map((p) => p.periodo_id),
    )
    .eq("tenant_id", tenantId);
  if (
    !periodosDestino ||
    periodosDestino.length !== new Set(partes.map((p) => p.periodo_id)).size
  ) {
    return {
      ok: false,
      message:
        "Um ou mais períodos de destino não existem no tenant atual.",
    };
  }
  for (const pd of periodosDestino) {
    if (pd.colaborador_id !== lanc.colaborador_id) {
      return {
        ok: false,
        message:
          "Todos os períodos de destino devem ser do mesmo colaborador.",
      };
    }
  }

  // Monta os novos inserts. Preserva tipo original, observação referencia
  // o lançamento antigo pra rastreio.
  const novos = partesCalc.map((p) => ({
    tenant_id: tenantId,
    colaborador_id: lanc.colaborador_id,
    periodo_id: p.periodo_id,
    tipo: p.dias_abono > 0 ? "abono_combinado" : lanc.tipo,
    data_inicio: p.data_inicio,
    data_fim: p.data_fim,
    dias: p.total,
    dias_abono: p.dias_abono,
    status: lanc.status,
    solicitado_por: session.profile.id,
    aprovado_por: session.profile.id,
    aprovado_em: new Date().toISOString(),
    observacao:
      "Dividido do lançamento " +
      lanc.id +
      (motivo ? " — " + motivo : ""),
    lancado_direto_por_rh: true,
  }));

  // Faz a troca: insere todos primeiro, depois apaga o original. Se insert
  // falhar, o original fica intacto; se delete falhar, limpa os inseridos.
  const { data: inseridos, error: insErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .insert(novos)
    .select("id");
  if (insErr || !inseridos) {
    console.error("[rh.ferias.pendencia.dividir.insert]", insErr?.message);
    return {
      ok: false,
      message: "Falha ao criar partes: " + (insErr?.message ?? ""),
    };
  }

  const { error: delErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .delete()
    .eq("id", lanc.id);
  if (delErr) {
    // Rollback manual: apaga o que acabou de inserir
    await supabase
      .from("colaboradores_ferias_lancamentos")
      .delete()
      .in(
        "id",
        inseridos.map((x) => x.id as string),
      );
    console.error("[rh.ferias.pendencia.dividir.delete]", delErr.message);
    return {
      ok: false,
      message: "Falha ao remover original: " + delErr.message,
    };
  }

  await logAuditEvent({
    acao: "ferias.lancamento.dividido_por_pendencia",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      original: {
        periodo_id: lanc.periodo_id,
        dias: lanc.dias,
        dias_abono: lanc.dias_abono,
        data_inicio: lanc.data_inicio,
        data_fim: lanc.data_fim,
      },
      partes: partesCalc.map((p) => ({
        periodo_id: p.periodo_id,
        dias: p.total,
        dias_abono: p.dias_abono,
        data_inicio: p.data_inicio,
        data_fim: p.data_fim,
      })),
      ids_criados: inseridos.map((x) => x.id as string),
      motivo,
    },
  });

  revalidatePath("/rh/ferias");
  return { ok: true, ids: inseridos.map((x) => x.id as string) };
}
