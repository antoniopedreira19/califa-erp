"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";
import { createClient } from "@/lib/supabase/server";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
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

function pathNoBucket(
  tenantId: string,
  colaboradorId: string,
  ano: number,
  mes: number,
): string {
  return `${tenantId}/${colaboradorId}/${ano}-${String(mes).padStart(2, "0")}.pdf`;
}

/**
 * Anexa (ou substitui) a NF de um colaborador para uma competência.
 * Idempotência por (colab, ano, mes): reenvio sobrescreve o arquivo
 * no Storage e o row no banco (UPSERT).
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

  if (!(await podeMexerNaNf(session, input.colaboradorId))) {
    return {
      ok: false,
      message: "Sem permissão para anexar NF desse colaborador.",
    };
  }

  // Sanidade da competência: evita NF pra competência maluca.
  const anoAtual = new Date().getFullYear();
  if (input.ano < 2024 || input.ano > anoAtual + 1) {
    return { ok: false, message: "Ano da competência fora da faixa aceita." };
  }
  if (input.mes < 1 || input.mes > 12) {
    return { ok: false, message: "Mês da competência inválido." };
  }

  // Validação de arquivo.
  if (!input.arquivoNome.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "Só aceita arquivo PDF." };
  }
  if (input.arquivoTamanhoBytes <= 0 || input.arquivoTamanhoBytes > MAX_BYTES) {
    return {
      ok: false,
      message: `Arquivo precisa ter entre 1 byte e ${MAX_BYTES / 1024 / 1024} MB.`,
    };
  }

  // Confirma colaborador do tenant e tipo compatível.
  const supabase = createClient();
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tipo_contratacao, tenant_id")
    .eq("id", input.colaboradorId)
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

  const buffer = Buffer.from(input.arquivoBuffer);
  const arquivoHash = createHash("sha256").update(buffer).digest("hex");
  const path = pathNoBucket(
    session.activeTenant.id,
    input.colaboradorId,
    input.ano,
    input.mes,
  );

  // Se já existe anexo pra essa competência: remove arquivo antigo antes de subir
  // o novo (defesa contra mudança futura do esquema de path; hoje é determinístico
  // por (ano,mes), então upsert sobrescreve o mesmo path).
  const { data: existente } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, arquivo_path")
    .eq("tenant_id", session.activeTenant.id)
    .eq("colaborador_id", input.colaboradorId)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .maybeSingle();
  if (existente && existente.arquivo_path !== path) {
    await supabase.storage.from(BUCKET).remove([existente.arquivo_path]);
  }

  // Upload (upsert sobrescreve se existe no mesmo path).
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

  const { data: anexo, error: upsertError } = await supabase
    .from("colaboradores_nf_anexos")
    .upsert(
      {
        tenant_id: session.activeTenant.id,
        colaborador_id: input.colaboradorId,
        competencia_ano: input.ano,
        competencia_mes: input.mes,
        arquivo_path: path,
        arquivo_nome: input.arquivoNome,
        arquivo_tamanho_bytes: input.arquivoTamanhoBytes,
        uploaded_by: session.profile.id,
        uploaded_at: nowIso,
        updated_at: nowIso,
      },
      {
        onConflict: "tenant_id,colaborador_id,competencia_ano,competencia_mes",
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

  const janela = janelaDaNf({
    uploadedAt: nowIso,
    competenciaAno: input.ano,
    competenciaMes: input.mes,
  });

  await logAuditEvent({
    acao: "colaborador.nf_anexada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: input.colaboradorId,
    metadata: {
      competencia_ano: input.ano,
      competencia_mes: input.mes,
      arquivo_hash: arquivoHash,
      arquivo_nome: input.arquivoNome,
      substituiu_anexo_anterior: !!existente,
      janela: janela.janela,
      data_prevista: janela.data_prevista,
    },
  });

  revalidatePath("/perfil");
  revalidatePath(`/rh/colaboradores/${input.colaboradorId}`);
  revalidatePath(
    `/rh/folhas/${input.ano}-${String(input.mes).padStart(2, "0")}`,
  );
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true, anexo_id: anexo.id, janela: janela.janela };
}

/**
 * Remove a NF de uma competência. Dono ou RH/admin.
 */
export async function removerNfColaborador(
  anexoId: string,
): Promise<ActionResult<Record<string, never>>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, colaborador_id, arquivo_path, competencia_ano, competencia_mes")
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
      competencia_ano: anexo.competencia_ano,
      competencia_mes: anexo.competencia_mes,
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
