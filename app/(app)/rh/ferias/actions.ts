"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { calcularValoresLancamentoPJ } from "@/lib/ferias/calcular-valores";
import {
  gerarReciboFeriasPdf,
  type FormatoRecibo,
} from "@/lib/pdf/recibo-ferias";
import type { FeriasLancamentoTipo } from "@/lib/types";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

function assertRh(role: string): ActionResult | null {
  if (role !== "administrador" && role !== "rh") {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  return null;
}

async function carregarLancamento(id: string, tenantId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, tenant_id, colaborador_id, periodo_id, tipo, dias, data_inicio, data_fim, status, solicitado_por",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

async function destinatariosDoColaborador(
  tenantId: string,
  colaboradorId: string,
): Promise<string[]> {
  const supabase = createClient();
  const [{ data: colab }, { data: solicitante }] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("user_id, lider_id, nome")
      .eq("id", colaboradorId)
      .maybeSingle(),
    Promise.resolve({ data: null }),
  ]);

  const set = new Set<string>();
  if (colab?.user_id) set.add(colab.user_id);
  if (colab?.lider_id) set.add(colab.lider_id);
  return Array.from(set);
}

// ---------- Aprovar ----------

export async function aprovarLancamento(
  lancamentoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancamentoId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "pendente_aprovacao" && lanc.status !== "em_analise") {
    return {
      ok: false,
      message:
        "Só é possível aprovar solicitações pendentes ou em análise.",
    };
  }

  const supabase = createClient();

  // Calcula valores de PJ (CLT retorna null = fica tudo em branco).
  const valores = await calcularValoresLancamentoPJ(
    lanc.colaborador_id,
    lanc.data_inicio,
    lanc.tipo as FeriasLancamentoTipo,
    lanc.dias,
  );

  const updatePayload: Record<string, unknown> = {
    status: "aprovado",
    aprovado_por: session.profile.id,
    aprovado_em: new Date().toISOString(),
    motivo_reprovacao: null,
  };
  if (valores) {
    updatePayload.valor_base_remuneracao = valores.valor_base_remuneracao;
    updatePayload.valor_ferias = valores.valor_ferias;
    updatePayload.valor_um_terco = valores.valor_um_terco;
    updatePayload.valor_abono = valores.valor_abono;
    updatePayload.valor_total = valores.valor_total;
  }

  const { error: updErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update(updatePayload)
    .eq("id", lancamentoId);

  if (updErr) {
    console.error("[rh.ferias.aprovar]", updErr.message);
    return { ok: false, message: "Falha ao aprovar: " + updErr.message };
  }

  // Notifica o colaborador + líder
  const destinatarios = await destinatariosDoColaborador(
    tenantId,
    lanc.colaborador_id,
  );
  if (destinatarios.length > 0) {
    const diasStr = `${lanc.dias} dia${lanc.dias > 1 ? "s" : ""}`;
    await supabase.rpc("fn_criar_notificacao_ferias", {
      p_tenant_id: tenantId,
      p_tipo: "aprovada",
      p_colaborador_id: lanc.colaborador_id,
      p_destinatarios: destinatarios,
      p_titulo: "Férias aprovadas",
      p_mensagem: `Sua solicitação de ${diasStr} entre ${lanc.data_inicio} e ${lanc.data_fim} foi aprovada.`,
      p_payload: {
        dias: lanc.dias,
        tipo: lanc.tipo,
        data_inicio: lanc.data_inicio,
        data_fim: lanc.data_fim,
      },
      p_lancamento_id: lanc.id,
      p_periodo_id: lanc.periodo_id,
    });
  }

  await logAuditEvent({
    acao: "ferias.lancamento.aprovado",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      tipo: lanc.tipo,
      dias: lanc.dias,
    },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Reprovar ----------

const reprovarSchema = z.object({
  lancamento_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(5, "O motivo precisa ter pelo menos 5 caracteres.")
    .max(500, "O motivo é longo demais."),
});

export async function reprovarLancamento(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = reprovarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.flatten().fieldErrors.motivo?.[0] ??
        "Dados inválidos.",
    };
  }
  const { lancamento_id: lancId, motivo } = parsed.data;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (
    lanc.status !== "pendente_aprovacao" &&
    lanc.status !== "em_analise"
  ) {
    return {
      ok: false,
      message:
        "Só é possível reprovar solicitações pendentes ou em análise.",
    };
  }

  const supabase = createClient();
  const { error: updErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "reprovado",
      aprovado_por: session.profile.id,
      aprovado_em: new Date().toISOString(),
      motivo_reprovacao: motivo,
    })
    .eq("id", lancId);

  if (updErr) {
    console.error("[rh.ferias.reprovar]", updErr.message);
    return { ok: false, message: "Falha ao reprovar: " + updErr.message };
  }

  const destinatarios = await destinatariosDoColaborador(
    tenantId,
    lanc.colaborador_id,
  );
  if (destinatarios.length > 0) {
    await supabase.rpc("fn_criar_notificacao_ferias", {
      p_tenant_id: tenantId,
      p_tipo: "reprovada",
      p_colaborador_id: lanc.colaborador_id,
      p_destinatarios: destinatarios,
      p_titulo: "Férias reprovadas",
      p_mensagem: `Sua solicitação entre ${lanc.data_inicio} e ${lanc.data_fim} foi reprovada. Motivo: ${motivo}`,
      p_payload: { motivo, dias: lanc.dias },
      p_lancamento_id: lanc.id,
      p_periodo_id: lanc.periodo_id,
    });
  }

  await logAuditEvent({
    acao: "ferias.lancamento.reprovado",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      motivo,
      dias: lanc.dias,
    },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Mover para "em análise" ----------

const emAnaliseSchema = z.object({
  lancamento_id: z.string().uuid(),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export async function moverEmAnalise(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = emAnaliseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos." };
  }
  const { lancamento_id: lancId, observacao } = parsed.data;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "pendente_aprovacao") {
    return {
      ok: false,
      message: "Só é possível mover para análise solicitações pendentes.",
    };
  }

  const supabase = createClient();
  const { error: updErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "em_analise",
      observacao: observacao || null,
    })
    .eq("id", lancId);

  if (updErr) {
    console.error("[rh.ferias.em_analise]", updErr.message);
    return { ok: false, message: "Falha: " + updErr.message };
  }

  const destinatarios = await destinatariosDoColaborador(
    tenantId,
    lanc.colaborador_id,
  );
  if (destinatarios.length > 0) {
    await supabase.rpc("fn_criar_notificacao_ferias", {
      p_tenant_id: tenantId,
      p_tipo: "em_analise",
      p_colaborador_id: lanc.colaborador_id,
      p_destinatarios: destinatarios,
      p_titulo: "Férias em análise",
      p_mensagem: observacao
        ? `Sua solicitação está em análise. Observação do RH: ${observacao}`
        : "Sua solicitação está em análise pelo RH.",
      p_payload: { observacao },
      p_lancamento_id: lanc.id,
      p_periodo_id: lanc.periodo_id,
    });
  }

  await logAuditEvent({
    acao: "ferias.lancamento.movido_em_analise",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: { colaborador_id: lanc.colaborador_id, observacao },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Lançamento direto pelo RH ----------

const lancamentoDiretoSchema = z
  .object({
    colaborador_id: z.string().uuid(),
    periodo_id: z.string().uuid().nullable(),
    tipo: z.enum([
      "usufruto",
      "abono_combinado",
      "abono_avulso",
      "abono_excepcional",
    ]),
    data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    observacao: z.string().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.tipo === "abono_avulso" && data.periodo_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodo_id"],
        message: "Abono avulso não vincula a período.",
      });
    }
    if (data.tipo !== "abono_avulso" && !data.periodo_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodo_id"],
        message: "Escolha o período aquisitivo.",
      });
    }
  });

export async function lancarDiretoPeloRh(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = lancamentoDiretoSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const primeiro = Object.values(flat).flat()[0];
    return {
      ok: false,
      message: primeiro ?? "Dados inválidos.",
    };
  }
  const dados = parsed.data;

  const ini = new Date(dados.data_inicio + "T00:00:00");
  const fim = new Date(dados.data_fim + "T00:00:00");
  if (fim < ini) {
    return { ok: false, message: "Data de fim antes do início." };
  }
  const dias =
    Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
  if (dias <= 0 || dias > 30) {
    return { ok: false, message: "Período deve ter entre 1 e 30 dias." };
  }

  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  // Valores PJ (CLT fica null)
  const valores = await calcularValoresLancamentoPJ(
    dados.colaborador_id,
    dados.data_inicio,
    dados.tipo,
    dias,
  );

  const { data: lanc, error: insErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .insert({
      tenant_id: tenantId,
      colaborador_id: dados.colaborador_id,
      periodo_id: dados.periodo_id,
      tipo: dados.tipo,
      data_inicio: dados.data_inicio,
      data_fim: dados.data_fim,
      dias,
      status: "aprovado",
      solicitado_por: session.profile.id,
      aprovado_por: session.profile.id,
      aprovado_em: new Date().toISOString(),
      observacao: dados.observacao || null,
      lancado_direto_por_rh: true,
      valor_base_remuneracao: valores?.valor_base_remuneracao ?? null,
      valor_ferias: valores?.valor_ferias ?? null,
      valor_um_terco: valores?.valor_um_terco ?? null,
      valor_abono: valores?.valor_abono ?? null,
      valor_total: valores?.valor_total ?? null,
    })
    .select("id")
    .single();

  if (insErr || !lanc) {
    console.error("[rh.ferias.lancamento_direto]", insErr?.message);
    return {
      ok: false,
      message: "Falha ao lançar: " + (insErr?.message ?? ""),
    };
  }

  const destinatarios = await destinatariosDoColaborador(
    tenantId,
    dados.colaborador_id,
  );
  if (destinatarios.length > 0) {
    await supabase.rpc("fn_criar_notificacao_ferias", {
      p_tenant_id: tenantId,
      p_tipo: "aprovada",
      p_colaborador_id: dados.colaborador_id,
      p_destinatarios: destinatarios,
      p_titulo: "Férias lançadas pelo RH",
      p_mensagem: `O RH lançou ${dias} dia${dias > 1 ? "s" : ""} de ${dados.tipo === "abono_avulso" ? "abono avulso" : "férias"} entre ${dados.data_inicio} e ${dados.data_fim}.`,
      p_payload: { dias, tipo: dados.tipo, lancado_direto: true },
      p_lancamento_id: lanc.id,
      p_periodo_id: dados.periodo_id,
    });
  }

  await logAuditEvent({
    acao: "ferias.lancamento.lancado_direto_pelo_rh",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: dados.colaborador_id,
      tipo: dados.tipo,
      dias,
    },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Fetch do modal de detalhe (Onda 3 — modal via state local) ----------

type DetalheColaboradorResult =
  | {
      ok: true;
      colaborador: {
        id: string;
        nome: string;
        tipo_contratacao: string;
        funcao: string;
        data_admissao: string;
      };
      periodos: unknown[];
      lancamentos: unknown[];
    }
  | { ok: false; message: string };

/**
 * Puxa os dados detalhados de UM colaborador pro modal do Quadro.
 *
 * Antes, essa query rodava DENTRO do AbaQuadro (server component) toda vez
 * que `?colab=xxx` estava presente — o que re-renderizava TODO o Quadro
 * (colaboradores + períodos + lançamentos) ao abrir/fechar o modal.
 *
 * Agora: modal é client-side, chama essa action quando abre. Fechar o modal
 * NÃO dispara request RSC — vira instantâneo. Impacto: fechar modal de 2,4s
 * pra <100ms, abrir modal de 2,2s pra ~500ms.
 */
export async function obterDetalheColaboradorFerias(
  colaboradorId: string,
): Promise<DetalheColaboradorResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    return { ok: false, message: "Sem permissão." };
  }

  if (!colaboradorId || typeof colaboradorId !== "string") {
    return { ok: false, message: "ID inválido." };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // 3 queries em paralelo pros dados do modal
  const [colabRes, periodosRes, lancamentosRes] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id, nome, tipo_contratacao, funcao, data_admissao")
      .eq("id", colaboradorId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("colaboradores_ferias_periodos")
      .select("*")
      .eq("colaborador_id", colaboradorId)
      .order("numero", { ascending: true }),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("*")
      .eq("colaborador_id", colaboradorId)
      .order("data_inicio", { ascending: false }),
  ]);

  if (!colabRes.data) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  return {
    ok: true,
    colaborador: colabRes.data as {
      id: string;
      nome: string;
      tipo_contratacao: string;
      funcao: string;
      data_admissao: string;
    },
    periodos: periodosRes.data ?? [],
    lancamentos: lancamentosRes.data ?? [],
  };
}

// ---------- Gerar recibo PDF (só PJ) ----------

const gerarReciboSchema = z.object({
  lancamento_id: z.string().uuid(),
  formato: z.enum(["ferias", "abono", "combinado"]),
});

export async function gerarRecibo(input: unknown): Promise<ActionResult> {
  const session = await requireSession();

  const parsed = gerarReciboSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Formato de recibo inválido." };
  }
  const { lancamento_id: lancId, formato } = parsed.data;

  const supabase = createClient();
  const service = createServiceClient();

  // Busca lançamento + colaborador
  const { data: lanc } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, tenant_id, colaborador_id, periodo_id, tipo, dias, data_inicio, data_fim, status, valor_base_remuneracao, valor_ferias, valor_um_terco, valor_abono, valor_total",
    )
    .eq("id", lancId)
    .maybeSingle();
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "aprovado" && lanc.status !== "concluido") {
    return {
      ok: false,
      message: "Só é possível gerar recibo de lançamentos aprovados.",
    };
  }

  // Permissão: RH/admin lê qualquer; colaborador só o próprio
  const isRh =
    session.activeRole === "administrador" || session.activeRole === "rh";
  if (!isRh) {
    const { data: colab } = await supabase
      .from("colaboradores")
      .select("id")
      .eq("user_id", session.profile.id)
      .maybeSingle();
    if (!colab || colab.id !== lanc.colaborador_id) {
      return { ok: false, message: "Sem permissão." };
    }
  }

  // Precisa dos valores calculados (CLT não tem)
  if (
    lanc.valor_total === null ||
    lanc.valor_total === undefined ||
    Number(lanc.valor_total) <= 0
  ) {
    return {
      ok: false,
      message:
        "Este lançamento não tem valor calculado — CLT recebe recibo da contabilidade.",
    };
  }

  // Busca nome do colaborador + período aquisitivo
  const [{ data: colab }, { data: periodo }] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("nome, tipo_contratacao")
      .eq("id", lanc.colaborador_id)
      .maybeSingle(),
    lanc.periodo_id
      ? supabase
          .from("colaboradores_ferias_periodos")
          .select("aquisitivo_inicio, aquisitivo_fim")
          .eq("id", lanc.periodo_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }
  if (colab.tipo_contratacao === "clt") {
    return {
      ok: false,
      message:
        "CLT não gera recibo pelo sistema — a contabilidade cuida.",
    };
  }

  const periodoAquisitivo = periodo
    ? `${(periodo as { aquisitivo_inicio: string }).aquisitivo_inicio.slice(0, 4)}/${(periodo as { aquisitivo_fim: string }).aquisitivo_fim.slice(0, 4)}`
    : "";

  // Gera PDF
  const pdfBuffer = await gerarReciboFeriasPdf(formato as FormatoRecibo, {
    prestadorNome: colab.nome,
    periodoAquisitivo,
    dataInicio: lanc.data_inicio,
    dataFim: lanc.data_fim,
    dias: lanc.dias,
    valorBase: Number(lanc.valor_base_remuneracao ?? 0),
    valorFerias: Number(lanc.valor_ferias ?? 0),
    valorAbono: Number(lanc.valor_abono ?? 0),
    valorUmTerco: Number(lanc.valor_um_terco ?? 0),
    valorTotal: Number(lanc.valor_total ?? 0),
  });

  // Upload no Storage via service role (bypassa RLS pra garantir sucesso).
  const path = `${lanc.colaborador_id}/${lanc.id}-${formato}.pdf`;
  const { error: upErr } = await service.storage
    .from("recibos-ferias")
    .upload(path, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (upErr) {
    console.error("[rh.ferias.recibo.upload]", upErr.message);
    return { ok: false, message: "Falha no upload: " + upErr.message };
  }

  // Grava URL (caminho relativo) e timestamp no lançamento
  const { error: updErr } = await service
    .from("colaboradores_ferias_lancamentos")
    .update({
      recibo_url: path,
      recibo_gerado_em: new Date().toISOString(),
    })
    .eq("id", lanc.id);

  if (updErr) {
    console.error("[rh.ferias.recibo.update]", updErr.message);
    return { ok: false, message: "Falha ao gravar: " + updErr.message };
  }

  await logAuditEvent({
    acao: "ferias.recibo.gerado",
    tenantId: lanc.tenant_id,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: { formato, colaborador_id: lanc.colaborador_id },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// Gera signed URL temporária pra baixar o recibo (10 min).
export async function obterUrlRecibo(
  lancamentoId: string,
): Promise<
  { ok: true; url: string } | { ok: false; message: string }
> {
  const session = await requireSession();
  const supabase = createClient();
  const service = createServiceClient();

  const { data: lanc } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("id, colaborador_id, recibo_url")
    .eq("id", lancamentoId)
    .maybeSingle();

  if (!lanc || !lanc.recibo_url) {
    return { ok: false, message: "Recibo ainda não foi gerado." };
  }

  const isRh =
    session.activeRole === "administrador" || session.activeRole === "rh";
  if (!isRh) {
    const { data: colab } = await supabase
      .from("colaboradores")
      .select("id")
      .eq("user_id", session.profile.id)
      .maybeSingle();
    if (!colab || colab.id !== lanc.colaborador_id) {
      return { ok: false, message: "Sem permissão." };
    }
  }

  const { data, error } = await service.storage
    .from("recibos-ferias")
    .createSignedUrl(lanc.recibo_url, 600);

  if (error || !data?.signedUrl) {
    return {
      ok: false,
      message: "Falha ao gerar URL: " + (error?.message ?? ""),
    };
  }
  return { ok: true, url: data.signedUrl };
}

// ---------- Marcar notificação como lida ----------

export async function marcarNotificacaoLida(
  id: string,
): Promise<ActionResult> {
  await requireSession();
  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores_ferias_notificacoes")
    .update({ lida_em: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id };
}
