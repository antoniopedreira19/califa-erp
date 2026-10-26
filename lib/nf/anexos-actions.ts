"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";
import { createClient } from "@/lib/supabase/server";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
import { escopoParaFkTabela } from "@/lib/nf/anexos-escopo";
import type { NfAnexoEscopo } from "@/lib/nf/anexos-escopo";
import type { JanelaPagamento } from "@/lib/types";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

const BUCKET = "colaboradores-nf";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Dono do recurso OU papel com alçada (rh.nf.anexar_qualquer).
 * Faz 1 query extra para resolver o user_id vinculado ao colaborador.
 */
async function podeMexerNaNf(
  session: Awaited<ReturnType<typeof requireSession>>,
  colaboradorId: string,
): Promise<boolean> {
  if (pode(session.activeRole, "rh.nf.anexar_qualquer")) return true;

  const supabase = createClient();
  const { data } = await supabase
    .from("colaboradores")
    .select("user_id")
    .eq("id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  return !!data?.user_id && data.user_id === session.profile.id;
}

function pathNoBucketPorEscopo(
  tenantId: string,
  colaboradorId: string,
  escopoTipo: NfAnexoEscopo,
  escopoId: string,
): string {
  return `${tenantId}/${colaboradorId}/${escopoTipo}/${escopoId}.pdf`;
}

/** @deprecated Mantida para compatibilidade. Usar pathNoBucketPorEscopo. */
function pathNoBucket(
  tenantId: string,
  colaboradorId: string,
  ano: number,
  mes: number,
): string {
  return `${tenantId}/${colaboradorId}/${ano}-${String(mes).padStart(2, "0")}.pdf`;
}

// ---------------------------------------------------------------------------
// Helpers: resolver colaborador_id e competencia a partir do escopoId
// ---------------------------------------------------------------------------

interface EscopoResolvido {
  colaboradorId: string;
  competenciaAno: number;
  competenciaMes: number;
}

/**
 * Para folha mensal: busca colaborador_id, competencia_ano, competencia_mes
 * diretamente na linha da folha.
 */
async function resolverFolhaMensal(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  escopoId: string,
): Promise<EscopoResolvido | null> {
  const { data } = await supabase
    .from("folhas_pagamento")
    .select("colaborador_id, competencia_ano, competencia_mes")
    .eq("id", escopoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return {
    colaboradorId: data.colaborador_id,
    competenciaAno: data.competencia_ano,
    competenciaMes: data.competencia_mes,
  };
}

/**
 * Para férias (usufruto ou abono): busca colaborador_id e deriva competencia
 * do data_inicio do lançamento.
 */
async function resolverFeriasLancamento(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  escopoId: string,
): Promise<EscopoResolvido | null> {
  const { data } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("colaborador_id, data_inicio")
    .eq("id", escopoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const d = new Date(data.data_inicio);
  return {
    colaboradorId: data.colaborador_id,
    competenciaAno: d.getUTCFullYear(),
    competenciaMes: d.getUTCMonth() + 1,
  };
}

/**
 * Para 13° (P1 ou P2): busca colaborador_id via decimo_terceiro_linhas +
 * join com folhas_decimo_terceiro para pegar o ano. Mês = 11 (P1) ou 12 (P2)
 * por convenção.
 */
async function resolverDecimoTerceiroLinha(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  escopoId: string,
  escopo: "decimo_terceiro_p1" | "decimo_terceiro_p2",
): Promise<EscopoResolvido | null> {
  const { data } = await supabase
    .from("decimo_terceiro_linhas")
    .select("colaborador_id, folha_id, folhas_decimo_terceiro!inner(ano)")
    .eq("id", escopoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  // TypeScript não infere o join corretamente via string select; cast para any.
  const folha = (data as any).folhas_decimo_terceiro as { ano: number } | null;
  if (!folha) return null;
  return {
    colaboradorId: data.colaborador_id,
    competenciaAno: folha.ano,
    competenciaMes: escopo === "decimo_terceiro_p1" ? 11 : 12,
  };
}

async function resolverEscopo(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  escopoTipo: NfAnexoEscopo,
  escopoId: string,
): Promise<EscopoResolvido | null> {
  switch (escopoTipo) {
    case "folha_mensal":
      return resolverFolhaMensal(supabase, tenantId, escopoId);
    case "ferias_usufruto":
    case "ferias_abono":
      return resolverFeriasLancamento(supabase, tenantId, escopoId);
    case "decimo_terceiro_p1":
    case "decimo_terceiro_p2":
      return resolverDecimoTerceiroLinha(supabase, tenantId, escopoId, escopoTipo);
  }
}

// ---------------------------------------------------------------------------
// API pública principal
// ---------------------------------------------------------------------------

/**
 * Anexa (ou substitui) a NF vinculada a um escopo específico
 * (folha mensal, férias, 13°).
 *
 * Idempotência por (tenant_id, colaborador_id, escopo_tipo, escopo_id):
 * reenvio sobrescreve o arquivo no Storage e o row no banco (UPSERT).
 */
export async function anexarNfPorEscopo(input: {
  escopoTipo: NfAnexoEscopo;
  escopoId: string;
  file: File;
}): Promise<ActionResult<{ nfId: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  // 1. Resolve colaborador_id e competência a partir do escopo.
  const resolvido = await resolverEscopo(
    supabase,
    session.activeTenant.id,
    input.escopoTipo,
    input.escopoId,
  );
  if (!resolvido) {
    return { ok: false, message: "Escopo não encontrado." };
  }

  // 2. Valida ownership: colaborador dono do escopo deve ser o usuário logado
  //    (a menos que tenha alçada rh.nf.anexar_qualquer).
  if (!(await podeMexerNaNf(session, resolvido.colaboradorId))) {
    return {
      ok: false,
      message: "Não é o colaborador dono desse escopo.",
    };
  }

  // 3. Valida arquivo.
  if (!input.file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "Só aceita arquivo PDF." };
  }
  if (input.file.size <= 0 || input.file.size > MAX_BYTES) {
    return {
      ok: false,
      message: `Arquivo precisa ter entre 1 byte e ${MAX_BYTES / 1024 / 1024} MB.`,
    };
  }

  // 4. Confirma colaborador do tenant e tipo compatível com NF.
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tipo_contratacao, tenant_id")
    .eq("id", resolvido.colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }
  if (!["pj", "mei", "clt_recibo"].includes(colab.tipo_contratacao)) {
    return {
      ok: false,
      message: `Colaborador do tipo ${colab.tipo_contratacao} não exige NF.`,
    };
  }

  const buffer = Buffer.from(await input.file.arrayBuffer());
  const arquivoHash = createHash("sha256").update(buffer).digest("hex");
  const path = pathNoBucketPorEscopo(
    session.activeTenant.id,
    resolvido.colaboradorId,
    input.escopoTipo,
    input.escopoId,
  );

  // 5. Se já existe anexo pra esse escopo: remove arquivo antigo antes de
  //    subir o novo (defesa contra mudança de esquema de path).
  const { data: existente } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, arquivo_path")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", resolvido.colaboradorId)
    .eq("escopo_tipo", input.escopoTipo)
    .eq("escopo_id", input.escopoId)
    .maybeSingle();
  if (existente && existente.arquivo_path !== path) {
    await supabase.storage.from(BUCKET).remove([existente.arquivo_path]);
  }

  // 6. Upload (upsert sobrescreve se existe no mesmo path).
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (upload.error) {
    return {
      ok: false,
      message: `Falha ao subir arquivo: ${upload.error.message}`,
    };
  }

  const nowIso = new Date().toISOString();

  // 7. UPSERT via índice único (tenant_id, colaborador_id, escopo_tipo, escopo_id).
  const { data: anexo, error: upsertError } = await supabase
    .from("colaboradores_nf_anexos")
    .upsert(
      {
        tenant_id: session.activeTenant.id,
        colaborador_id: resolvido.colaboradorId,
        competencia_ano: resolvido.competenciaAno,
        competencia_mes: resolvido.competenciaMes,
        escopo_tipo: input.escopoTipo,
        escopo_id: input.escopoId,
        arquivo_path: path,
        arquivo_nome: input.file.name,
        arquivo_tamanho_bytes: input.file.size,
        uploaded_by: session.profile.id,
        uploaded_at: nowIso,
        updated_at: nowIso,
      },
      {
        onConflict: "tenant_id,colaborador_id,escopo_tipo,escopo_id",
      },
    )
    .select("id")
    .single();

  if (upsertError || !anexo) {
    // Rollback do upload pra não deixar arquivo órfão.
    await supabase.storage.from(BUCKET).remove([path]);
    return {
      ok: false,
      message: `Falha ao gravar metadado: ${upsertError?.message ?? "sem detalhe"}.`,
    };
  }

  // 8. Auditoria.
  await logAuditEvent({
    acao: "colaborador.nf_anexada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: resolvido.colaboradorId,
    metadata: {
      escopo_tipo: input.escopoTipo,
      escopo_id: input.escopoId,
      arquivo_hash: arquivoHash,
      arquivo_nome: input.file.name,
      substituiu_anexo_anterior: !!existente,
    },
  });

  revalidatePath("/perfil");
  revalidatePath(`/rh/colaboradores/${resolvido.colaboradorId}`);
  revalidatePath(
    `/rh/folhas/${resolvido.competenciaAno}-${String(resolvido.competenciaMes).padStart(2, "0")}`,
  );
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true, nfId: anexo.id };
}

/**
 * Remove a NF vinculada a um escopo. Dono ou RH/admin.
 */
export async function removerNfPorEscopo(input: {
  escopoTipo: NfAnexoEscopo;
  escopoId: string;
}): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, colaborador_id, arquivo_path, competencia_ano, competencia_mes")
    .eq("tenant_id", session.activeTenant.id)
    .eq("escopo_tipo", input.escopoTipo)
    .eq("escopo_id", input.escopoId)
    .maybeSingle();
  if (!anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  if (!(await podeMexerNaNf(session, anexo.colaborador_id))) {
    return { ok: false, message: "Sem permissão para remover NF." };
  }

  await supabase.storage.from(BUCKET).remove([anexo.arquivo_path]);
  const { error: delError } = await supabase
    .from("colaboradores_nf_anexos")
    .delete()
    .eq("id", anexo.id);
  if (delError) {
    return { ok: false, message: delError.message };
  }

  await logAuditEvent({
    acao: "colaborador.nf_removida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: anexo.colaborador_id,
    metadata: {
      escopo_tipo: input.escopoTipo,
      escopo_id: input.escopoId,
    },
  });

  revalidatePath("/perfil");
  revalidatePath(`/rh/colaboradores/${anexo.colaborador_id}`);
  revalidatePath(
    `/rh/folhas/${anexo.competencia_ano}-${String(anexo.competencia_mes).padStart(2, "0")}`,
  );
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true } as { ok: true } & Record<string, never>;
}

// ---------------------------------------------------------------------------
// Backward-compat: anexarNfColaborador (wrapper pra card-nf-mes e histórico)
// Será removida quando card-nf-mes.tsx e historico-nf-modal.tsx forem deletados
// na Task 7 do plano 2026-10-26-quadro-nf-colaborador.
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `anexarNfPorEscopo` diretamente.
 * Wrapper de compatibilidade que localiza a folha_mensal por (colaboradorId,
 * ano, mes) e delega ao novo action.
 */
export async function anexarNfColaborador(input: {
  colaboradorId: string;
  ano: number;
  mes: number;
  arquivoBuffer: ArrayBuffer;
  arquivoNome: string;
  arquivoTamanhoBytes: number;
}): Promise<ActionResult<{ anexo_id: string; janela: JanelaPagamento }>> {
  const session = await requireSession();
  const supabase = createClient();

  // Sanidade da competência.
  const anoAtual = new Date().getFullYear();
  if (input.ano < 2024 || input.ano > anoAtual + 1) {
    return { ok: false, message: "Ano da competência fora da faixa aceita." };
  }
  if (input.mes < 1 || input.mes > 12) {
    return { ok: false, message: "Mês da competência inválido." };
  }

  // Localiza a folha_mensal correspondente.
  const { data: folha } = await supabase
    .from("folhas_pagamento")
    .select("id")
    .eq("colaborador_id", input.colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .maybeSingle();
  if (!folha) {
    return {
      ok: false,
      message: "Folha de pagamento não encontrada para essa competência.",
    };
  }

  // Reconstrói um File a partir do ArrayBuffer (necessário para o novo action).
  const file = new File([input.arquivoBuffer], input.arquivoNome, {
    type: "application/pdf",
  });

  const r = await anexarNfPorEscopo({
    escopoTipo: "folha_mensal",
    escopoId: folha.id,
    file,
  });

  if (!r.ok) return r;

  const nowIso = new Date().toISOString();
  const janela = janelaDaNf({
    uploadedAt: nowIso,
    competenciaAno: input.ano,
    competenciaMes: input.mes,
  });

  return { ok: true, anexo_id: r.nfId, janela: janela.janela };
}

/**
 * Remove a NF de uma competência. Dono ou RH/admin.
 * @deprecated Use `removerNfPorEscopo` diretamente.
 */
export async function removerNfColaborador(
  anexoId: string,
): Promise<ActionResult<Record<string, never>>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, colaborador_id, arquivo_path, competencia_ano, competencia_mes, escopo_tipo, escopo_id")
    .eq("id", anexoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  if (!(await podeMexerNaNf(session, anexo.colaborador_id))) {
    return { ok: false, message: "Sem permissão para remover NF." };
  }

  await supabase.storage.from(BUCKET).remove([anexo.arquivo_path]);
  const { error: delError } = await supabase
    .from("colaboradores_nf_anexos")
    .delete()
    .eq("id", anexoId);
  if (delError) {
    return { ok: false, message: delError.message };
  }

  await logAuditEvent({
    acao: "colaborador.nf_removida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: anexo.colaborador_id,
    metadata: {
      escopo_tipo: anexo.escopo_tipo,
      escopo_id: anexo.escopo_id,
    },
  });

  revalidatePath("/perfil");
  revalidatePath(`/rh/colaboradores/${anexo.colaborador_id}`);
  revalidatePath(
    `/rh/folhas/${anexo.competencia_ano}-${String(anexo.competencia_mes).padStart(2, "0")}`,
  );
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true } as { ok: true } & Record<string, never>;
}

/**
 * Devolve uma Signed URL com validade de 10 minutos pra baixar a NF.
 * Permissão: dono OU rh.nf.ver (RH, admin, financeiro).
 */
export async function baixarNfColaborador(
  anexoId: string,
): Promise<ActionResult<{ url: string; arquivo_nome: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("colaboradores_nf_anexos")
    .select(
      "id, colaborador_id, arquivo_path, arquivo_nome, competencia_ano, competencia_mes",
    )
    .eq("id", anexoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  const temAlcada = pode(session.activeRole, "rh.nf.ver");
  const ehDono = !temAlcada && (await podeMexerNaNf(session, anexo.colaborador_id));
  if (!temAlcada && !ehDono) {
    return { ok: false, message: "Sem permissão para baixar NF." };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, 60 * 10);
  if (error || !data) {
    return { ok: false, message: `Falha ao gerar link: ${error?.message}` };
  }

  // Só audita quando quem baixa não é o dono (visualização por RH/financeiro).
  if (temAlcada) {
    await logAuditEvent({
      acao: "colaborador.nf_baixada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "colaborador",
      entidadeId: anexo.colaborador_id,
      metadata: {
        competencia_ano: anexo.competencia_ano,
        competencia_mes: anexo.competencia_mes,
      },
    });
  }

  return { ok: true, url: data.signedUrl, arquivo_nome: anexo.arquivo_nome };
}
