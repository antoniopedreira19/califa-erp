"use server";

/**
 * "Reverter aprovação" no Contas a Pagar (decisão 253).
 *
 * Uma action só para as três origens que o financeiro aprova — PP,
 * desembolso e folha —, chamada pelo ↺ embaixo do lápis da data em Títulos a
 * Pagar, pelo rodapé da PP aprovada e pela linha do desembolso aprovado.
 * Antes da baixa, o pedido volta para avaliação ou é rejeitado, com motivo.
 *
 * As regras moram no banco (`reverter_aprovacao_pp`,
 * `reverter_aprovacao_desembolso`); a folha segue em
 * `devolverFolhaParaAprovacao`, que já apagava o título dela.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { devolverFolhaParaAprovacao } from "./actions-folhas";

type Result = { ok: true } | { ok: false; message: string };

const schema = z
  .object({
    origem: z.enum(["pp", "desembolso", "folha"]),
    /** O pedido: a PP ou o desembolso (a folha vem pelo título). */
    id: z.string().uuid().optional(),
    /** A linha de Títulos a Pagar: parcela da PP, parcela do desembolso ou conta avulsa da folha. */
    titulo_id: z.string().uuid().optional(),
    destino: z.enum(["avaliacao", "rejeitar"], {
      errorMap: () => ({ message: "Escolha para onde o pedido volta." }),
    }),
    motivo: z
      .string()
      .trim()
      .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
      .max(500, "Motivo passa de 500 caracteres."),
  })
  .refine((v) => v.id || v.titulo_id, { message: "Pedido não informado." });

export type OrigemDaReversao = "pp" | "desembolso" | "folha";
export type DestinoDaReversao = "avaliacao" | "rejeitar";

export async function reverterAprovacao(input: {
  origem: OrigemDaReversao;
  id?: string;
  titulo_id?: string;
  destino: DestinoDaReversao;
  motivo: string;
}): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const { origem, destino, motivo } = parsed.data;

  if (origem === "folha") {
    const res = await devolverFolhaParaAprovacao({
      contaAvulsaId: parsed.data.titulo_id,
      folhaId: parsed.data.titulo_id ? undefined : parsed.data.id,
      motivo,
      destino,
    });
    return res.ok ? { ok: true } : { ok: false, message: res.message };
  }

  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const entidadeTipo = origem === "pp" ? "pedido_compra" : "desembolso";
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo,
      entidadeId: parsed.data.id ?? parsed.data.titulo_id ?? null,
      metadata: { acao_tentada: `${entidadeTipo}.aprovacao_revertida`, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode reverter uma aprovação." };
  }
  const supabase = createClient();

  if (origem === "pp") {
    let ppId = parsed.data.id ?? null;
    if (!ppId && parsed.data.titulo_id) {
      const { data: parcela } = await supabase
        .from("pedidos_compra_parcelas")
        .select("pedido_compra_id")
        .eq("id", parsed.data.titulo_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      ppId = (parcela?.pedido_compra_id as string | undefined) ?? null;
    }
    if (!ppId) return { ok: false, message: "PP não encontrada." };

    const { data: pp } = await supabase
      .from("pedidos_compra")
      .select("id, codigo, job_id, valor")
      .eq("id", ppId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!pp) return { ok: false, message: "PP não encontrada." };

    const { error } = await supabase.rpc("reverter_aprovacao_pp", {
      p_pp_id: ppId,
      p_destino: destino,
      p_motivo: motivo,
    });
    if (error) return { ok: false, message: error.message };

    await logAuditEvent({
      acao: "pedido_compra.aprovacao_revertida",
      tenantId,
      entidadeTipo: "pedido_compra",
      entidadeId: ppId,
      metadata: { pp_codigo: pp.codigo, job_id: pp.job_id, valor: Number(pp.valor), destino, motivo },
    });

    revalidatePath("/financeiro/contas-a-pagar");
    revalidatePath("/financeiro/fluxo-caixa");
    revalidatePath("/financeiro");
    if (pp.job_id) revalidatePath(`/jobs/${pp.job_id}`);
    return { ok: true };
  }

  let desembolsoId = parsed.data.id ?? null;
  if (!desembolsoId && parsed.data.titulo_id) {
    const { data: parcela } = await supabase
      .from("desembolsos_parcelas")
      .select("desembolso_id")
      .eq("id", parsed.data.titulo_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    desembolsoId = (parcela?.desembolso_id as string | undefined) ?? null;
  }
  if (!desembolsoId) return { ok: false, message: "Desembolso não encontrado." };

  const { data: desembolso } = await supabase
    .from("desembolsos")
    .select("id, codigo, valor")
    .eq("id", desembolsoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };

  const { error } = await supabase.rpc("reverter_aprovacao_desembolso", {
    p_desembolso_id: desembolsoId,
    p_destino: destino,
    p_motivo: motivo,
  });
  if (error) return { ok: false, message: error.message };

  await logAuditEvent({
    acao: "desembolso.aprovacao_revertida",
    tenantId,
    entidadeTipo: "desembolso",
    entidadeId: desembolsoId,
    metadata: { codigo: desembolso.codigo, valor: Number(desembolso.valor), destino, motivo },
  });

  revalidatePath("/financeiro/desembolsos");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  return { ok: true };
}
