"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";

type ActionResult =
  | { ok: true; message?: string; count?: number }
  | { ok: false; message: string };

function assertRh(role: string): ActionResult | null {
  if (role !== "administrador" && role !== "rh") {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  return null;
}

// ---------- Enviar folhas de férias em lote ----------

/**
 * Envia as folhas de férias selecionadas pro financeiro (status
 * `rascunho` → `enviada`). RH escolhe quais na UI via checkbox.
 *
 * Regras:
 *   - Só folhas do próprio tenant.
 *   - Só folhas com `tipo = 'ferias'` e `status = 'rascunho'`.
 *   - Pra `origem = 'contabilidade'` (CLT), exige que o anexo (PDF
 *     do recibo contábil) já esteja preenchido. Sem o anexo, bloqueia
 *     — RH precisa anexar antes de enviar.
 */
export async function enviarFolhasFerias(input: {
  ids: string[];
}): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const ids = (input.ids ?? []).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (ids.length === 0) {
    return { ok: false, message: "Nenhuma folha selecionada." };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folhas, error: selErr } = await supabase
    .from("folhas_pagamento")
    .select("id, status, origem, tipo, anexo_url, colaborador_id")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  if (selErr) {
    console.error("[rh.ferias.pagamentos.enviar.select]", selErr.message);
    return { ok: false, message: "Falha ao carregar folhas." };
  }

  const naoEncontradas = ids.length - (folhas?.length ?? 0);
  if (naoEncontradas > 0) {
    return {
      ok: false,
      message: `${naoEncontradas} folha(s) não encontrada(s) ou de outro tenant.`,
    };
  }

  // Valida cada uma antes de atualizar.
  const invalidas: string[] = [];
  for (const f of folhas ?? []) {
    if (f.tipo !== "ferias") {
      invalidas.push(`${f.id}: não é folha de férias`);
      continue;
    }
    if (f.status !== "rascunho") {
      invalidas.push(`${f.id}: status ${f.status}, só rascunho pode ser enviada`);
      continue;
    }
    if (f.origem === "contabilidade" && !f.anexo_url) {
      invalidas.push(`${f.id}: CLT sem recibo contábil anexado`);
      continue;
    }
  }
  if (invalidas.length > 0) {
    return {
      ok: false,
      message:
        "Não foi possível enviar algumas folhas: " +
        invalidas.slice(0, 3).join("; ") +
        (invalidas.length > 3 ? " ..." : ""),
    };
  }

  const agora = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      enviada_em: agora,
      enviada_por: session.profile.id,
    })
    .eq("tenant_id", tenantId)
    .in("id", ids);

  if (updErr) {
    console.error("[rh.ferias.pagamentos.enviar.update]", updErr.message);
    return { ok: false, message: "Falha ao enviar: " + updErr.message };
  }

  // Audit por folha.
  for (const f of folhas ?? []) {
    await logAuditEvent({
      acao: "folha.linha.enviada",
      tenantId,
      entidadeTipo: "folha_pagamento",
      entidadeId: f.id as string,
      metadata: {
        tipo: "ferias",
        origem: f.origem,
        colaborador_id: f.colaborador_id,
      },
    });
  }

  revalidatePath("/rh/ferias");
  revalidatePath("/financeiro/contas-a-pagar");
  return {
    ok: true,
    count: ids.length,
    message: `${ids.length} folha(s) enviada(s) ao financeiro.`,
  };
}

// ---------- Anexar recibo contábil (CLT) ----------

const anexarReciboSchema = z.object({
  folha_id: z.string().uuid(),
  valor_liquido: z
    .number()
    .positive("Valor líquido precisa ser maior que zero."),
  anexo_url: z.string().optional().nullable(),
});

/**
 * Pros CLT: RH anexa o PDF do recibo da contabilidade e informa o
 * valor LÍQUIDO que vai ser pago. Decisão alinhada com PO em
 * 2026-10-03: só o líquido é obrigatório. Bruto/descontos ficam no
 * PDF — não repete no banco.
 *
 * Nesta primeira versão o upload do PDF é feito pelo cliente
 * diretamente no bucket `recibos-ferias` via signed URL (padrão
 * existente). Essa action só persiste o `anexo_url` (caminho no
 * bucket) e atualiza o `salario_base` com o valor líquido.
 */
export async function anexarReciboContabilFolhaFerias(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = anexarReciboSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.flatten().fieldErrors.valor_liquido?.[0] ??
        "Dados inválidos.",
    };
  }
  const dados = parsed.data;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folha, error: selErr } = await supabase
    .from("folhas_pagamento")
    .select("id, status, origem, tipo, lancamento_ferias_id, colaborador_id")
    .eq("id", dados.folha_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (selErr || !folha) {
    return { ok: false, message: "Folha não encontrada." };
  }

  if (folha.tipo !== "ferias") {
    return { ok: false, message: "Essa folha não é de férias." };
  }
  if (folha.origem !== "contabilidade") {
    return {
      ok: false,
      message:
        "Só folhas CLT (origem contabilidade) recebem anexo. Pra PJ, o recibo é gerado pelo sistema.",
    };
  }
  if (folha.status !== "rascunho") {
    return {
      ok: false,
      message: `Folha com status ${folha.status} não pode mais ser alterada aqui.`,
    };
  }

  const updatePayload: Record<string, unknown> = {
    salario_base: dados.valor_liquido.toFixed(2),
  };
  if (dados.anexo_url !== undefined) {
    updatePayload.anexo_url = dados.anexo_url;
  }

  const { error: updErr } = await supabase
    .from("folhas_pagamento")
    .update(updatePayload)
    .eq("id", folha.id);

  if (updErr) {
    console.error("[rh.ferias.pagamentos.anexar]", updErr.message);
    return { ok: false, message: "Falha ao anexar: " + updErr.message };
  }

  await logAuditEvent({
    acao: "folha.linha.editada_rh",
    tenantId,
    entidadeTipo: "folha_pagamento",
    entidadeId: folha.id as string,
    metadata: {
      tipo: "ferias",
      origem: "contabilidade",
      campos: ["salario_base", ...(dados.anexo_url !== undefined ? ["anexo_url"] : [])],
      valor_liquido: dados.valor_liquido,
    },
  });

  revalidatePath("/rh/ferias");
  return { ok: true };
}

// ---------- Cancelar folha de férias em rascunho ----------

export async function cancelarFolhaFerias(input: {
  folha_id: string;
}): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folha, error: selErr } = await supabase
    .from("folhas_pagamento")
    .select("id, status, tipo, origem, colaborador_id, lancamento_ferias_id")
    .eq("id", input.folha_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (selErr || !folha) {
    return { ok: false, message: "Folha não encontrada." };
  }
  if (folha.tipo !== "ferias") {
    return { ok: false, message: "Só folhas de férias podem ser canceladas aqui." };
  }
  if (folha.status !== "rascunho") {
    return {
      ok: false,
      message:
        "Essa folha já foi enviada ao financeiro — cancele pelo próprio fluxo financeiro.",
    };
  }

  const { error: delErr } = await supabase
    .from("folhas_pagamento")
    .delete()
    .eq("id", folha.id);

  if (delErr) {
    console.error("[rh.ferias.pagamentos.cancelar]", delErr.message);
    return { ok: false, message: "Falha ao cancelar: " + delErr.message };
  }

  await logAuditEvent({
    acao: "folha.linha.editada_rh",
    tenantId,
    entidadeTipo: "folha_pagamento",
    entidadeId: folha.id as string,
    metadata: {
      tipo: "ferias",
      origem: folha.origem,
      acao: "cancelada_em_rascunho",
      colaborador_id: folha.colaborador_id,
      lancamento_ferias_id: folha.lancamento_ferias_id,
    },
  });

  revalidatePath("/rh/ferias");
  return { ok: true };
}

// ---------- URL assinada pra upload do PDF (CLT) ----------

/**
 * Gera uma signed URL pra upload do PDF do recibo contábil no bucket
 * `recibos-ferias`. Caminho: `<tenant>/<colaborador>/ferias-contabil/<folha_id>.pdf`.
 * Cliente usa pra PUT direto no Storage, depois chama
 * `anexarReciboContabilFolhaFerias` com o caminho.
 */
export async function gerarUrlUploadReciboContabil(input: {
  folha_id: string;
}): Promise<
  { ok: true; signed_url: string; path: string } | { ok: false; message: string }
> {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "rh"
  ) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folha } = await supabase
    .from("folhas_pagamento")
    .select("id, colaborador_id, tenant_id")
    .eq("id", input.folha_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!folha) {
    return { ok: false, message: "Folha não encontrada." };
  }

  const path = `${folha.tenant_id}/${folha.colaborador_id}/ferias-contabil/${folha.id}.pdf`;

  const { data, error } = await supabase.storage
    .from("recibos-ferias")
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error(
      "[rh.ferias.pagamentos.upload_url]",
      error?.message ?? "sem url",
    );
    return { ok: false, message: "Falha ao gerar URL de upload." };
  }

  return { ok: true, signed_url: data.signedUrl, path };
}
