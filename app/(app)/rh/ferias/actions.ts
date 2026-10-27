"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  buscarSalarioParaFolha,
  calcularValoresLancamento,
  calcularValoresLancamentoAuto,
  calcularValoresLancamentoPJ,
} from "@/lib/ferias/calcular-valores";
import { criarFolhasDePagamentoDeFerias } from "@/lib/ferias/criar-folhas-pagamento";
import {
  gerarReciboFeriasPdf,
  type FormatoRecibo,
} from "@/lib/pdf/recibo-ferias";
import type { FeriasLancamentoTipo, TipoContratacao } from "@/lib/types";

type ActionResult =
  | { ok: true; id: string; aviso?: string }
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
      "id, tenant_id, colaborador_id, periodo_id, tipo, dias, dias_abono, data_inicio, data_fim, status, solicitado_por",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

// ---------- Preview de valores (pra confirmar antes de aprovar) ----------

type ValoresPreview = {
  valor_base_remuneracao: number;
  valor_ferias: number;
  valor_um_terco: number;
  valor_abono: number;
  valor_total: number;
};

type PreviewResult =
  | {
      ok: true;
      tipo: FeriasLancamentoTipo;
      tipo_contratacao: TipoContratacao;
      dias: number;
      dias_abono: number;
      // valores: parte PJ (RPA) para clt_recibo; valores cheios para os outros.
      valores: ValoresPreview | null;
      // valores_clt: só preenchido para clt_recibo. Estimativa bruta sobre
      // a parte CLT do salário (valor − valor_recibo). Serve como preview
      // informativo; o valor real virá no recibo da contabilidade.
      valores_clt: ValoresPreview | null;
    }
  | { ok: false; message: string };

export async function previewValoresFerias(
  lancamentoId: string,
): Promise<PreviewResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio && !bloqueio.ok) {
    return { ok: false, message: bloqueio.message };
  }

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancamentoId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };

  const supabase = createClient();
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("tipo_contratacao")
    .eq("id", lanc.colaborador_id)
    .maybeSingle();
  if (!colab) return { ok: false, message: "Colaborador não encontrado." };

  const tipoContratacao = (colab as { tipo_contratacao: TipoContratacao })
    .tipo_contratacao;
  const diasAbono = (lanc as { dias_abono?: number }).dias_abono ?? 0;

  const valores = await calcularValoresLancamentoAuto(
    lanc.colaborador_id,
    lanc.data_inicio,
    tipoContratacao,
    lanc.tipo as FeriasLancamentoTipo,
    lanc.dias,
    diasAbono,
  );

  // Pra clt_recibo, calcula também a parte CLT (bruto estimado) pra mostrar
  // no dialog de aprovação. O valor real sai do recibo da contabilidade.
  let valoresClt: ValoresPreview | null = null;
  if (tipoContratacao === "clt_recibo") {
    const salario = await buscarSalarioParaFolha(
      lanc.colaborador_id,
      lanc.data_inicio,
      tipoContratacao,
    );
    if (salario && salario.parteClt > 0) {
      valoresClt = await calcularValoresLancamento(
        lanc.colaborador_id,
        lanc.data_inicio,
        lanc.tipo as FeriasLancamentoTipo,
        lanc.dias,
        diasAbono,
        salario.parteClt,
      );
    }
  }

  return {
    ok: true,
    tipo: lanc.tipo as FeriasLancamentoTipo,
    tipo_contratacao: tipoContratacao,
    dias: lanc.dias,
    dias_abono: diasAbono,
    valores,
    valores_clt: valoresClt,
  };
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
  if (lanc.status !== "pendente_aprovacao") {
    return {
      ok: false,
      message:
        "Só é possível aprovar solicitações pendentes ou em análise.",
    };
  }

  const supabase = createClient();

  // Precisa do tipo_contratacao pra calcular corretamente: clt_recibo usa
  // só a parteRpa (parte PJ), não o salário total. Fazemos o lookup antes
  // do UPDATE pra guardar valores corretos no lançamento.
  const { data: colabParaValores } = await supabase
    .from("colaboradores")
    .select("tipo_contratacao")
    .eq("id", lanc.colaborador_id)
    .maybeSingle();
  if (!colabParaValores) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  const valores = await calcularValoresLancamentoAuto(
    lanc.colaborador_id,
    lanc.data_inicio,
    (colabParaValores as {
      tipo_contratacao: import("@/lib/types").TipoContratacao;
    }).tipo_contratacao,
    lanc.tipo as FeriasLancamentoTipo,
    lanc.dias,
    (lanc as { dias_abono?: number }).dias_abono ?? 0,
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

  // Cria folha(s) de pagamento. Lançamento retroativo é pulado.
  const colabInfo = await supabase
    .from("colaboradores")
    .select("id, tipo_contratacao")
    .eq("id", lanc.colaborador_id)
    .maybeSingle();
  let aviso: string | undefined;
  if (colabInfo.data) {
    const resFolhas = await criarFolhasDePagamentoDeFerias({
      lancamento: lanc,
      colaborador: colabInfo.data as {
        id: string;
        tipo_contratacao: TipoContratacao;
      },
      actorUserId: session.profile.id,
    });
    if (resFolhas.erro) {
      // Lançamento já foi aprovado (UPDATE acima). Expomos o erro de folha
      // como aviso pro RH não ficar com um lançamento aprovado órfão de
      // folhas e sem perceber.
      console.error("[rh.ferias.aprovar.folhas]", resFolhas.erro);
      aviso =
        "Lançamento aprovado, mas falhou ao gerar folhas de pagamento: " +
        resFolhas.erro +
        ". Avise o administrador do sistema.";
    }
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
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: lanc.id, aviso };
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
  if (lanc.status !== "pendente_aprovacao") {
    return {
      ok: false,
      message: "Só é possível reprovar solicitações pendentes.",
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

// ---------- Lançamento direto pelo RH ----------

// Schema movido pra lib/ferias/lancar-direto-schema.ts (pure module,
// testável isolado via node --test).
import { lancarDiretoSchema } from "@/lib/ferias/lancar-direto-schema";

export async function lancarDiretoPeloRh(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = lancarDiretoSchema.safeParse(input);
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
  const diasFolga =
    Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
  // Pra abono_combinado, `dias` é TOTAL consumido (folga + vendidos).
  const dias = diasFolga + dados.dias_abono;
  if (diasFolga <= 0 || dias > 30) {
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
    dados.dias_abono,
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
      dias_abono: dados.dias_abono,
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

  // Cria folha(s) de pagamento. Lançamento retroativo (data_inicio < hoje)
  // é pulado dentro da função — não cria folha pra pagamento histórico.
  const colabInfo = await supabase
    .from("colaboradores")
    .select("id, tipo_contratacao")
    .eq("id", dados.colaborador_id)
    .maybeSingle();
  if (colabInfo.data) {
    const resFolhas = await criarFolhasDePagamentoDeFerias({
      lancamento: {
        id: lanc.id as string,
        tenant_id: tenantId,
        colaborador_id: dados.colaborador_id,
        tipo: dados.tipo,
        data_inicio: dados.data_inicio,
        data_fim: dados.data_fim,
        dias,
      },
      colaborador: colabInfo.data as {
        id: string;
        tipo_contratacao: import("@/lib/types").TipoContratacao;
      },
      actorUserId: session.profile.id,
    });
    if (resFolhas.erro) {
      console.warn("[rh.ferias.lancamento_direto.folhas]", resFolhas.erro);
    }
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
  revalidatePath("/financeiro/contas-a-pagar");
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
      .neq("tipo_contratacao", "socio")
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

