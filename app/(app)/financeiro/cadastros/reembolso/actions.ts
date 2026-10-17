"use server";

/**
 * O desgaste do veículo por km do reembolso de veículo próprio (decisão
 * 187, 17/10/2026). Só o financeiro e o administrador mudam — a RLS de
 * `financeiro_parametros` repete a trava. A PP guarda o valor da data em
 * que nasceu: mudar aqui vale para as PPs novas, não refaz as geradas.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

const CHAVE = "reembolso_desgaste_por_km";

const schema = z.object({
  valor: z
    .number({ invalid_type_error: "Informe o desgaste por km." })
    .finite()
    .min(0, "O desgaste por km não pode ser negativo.")
    .max(100, "O desgaste por km passa de R$ 100,00 — confira o valor."),
});

type Result = { ok: true } | { ok: false; message: string };

export async function salvarDesgastePorKm(input: unknown): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Valor inválido." };
  }
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas o financeiro ou o administrador muda o desgaste por km." };
  }
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const valor = Math.round(parsed.data.valor * 100) / 100;

  const { data: atual, error: erroAtual } = await supabase
    .from("financeiro_parametros")
    .select("id, valor")
    .eq("tenant_id", tenantId)
    .eq("chave", CHAVE)
    .maybeSingle<{ id: string; valor: number | string }>();
  if (erroAtual) return { ok: false, message: `Falha ao ler o desgaste por km: ${erroAtual.message}` };

  const anterior = atual ? Number(atual.valor) : null;
  if (anterior !== null && Math.abs(anterior - valor) < 0.00005) return { ok: true };

  const linha = {
    valor,
    atualizado_por: session.profile.id,
    atualizado_em: new Date().toISOString(),
  };
  const { error } = atual
    ? await supabase.from("financeiro_parametros").update(linha).eq("id", atual.id)
    : await supabase.from("financeiro_parametros").insert({ tenant_id: tenantId, chave: CHAVE, ...linha });
  if (error) return { ok: false, message: `Falha ao salvar o desgaste por km: ${error.message}` };

  await logAuditEvent({
    acao: "financeiro_parametro.atualizado",
    tenantId,
    entidadeTipo: "financeiro_parametro",
    entidadeId: atual?.id ?? CHAVE,
    metadata: { chave: CHAVE, valor_anterior: anterior, valor_novo: valor },
  });

  revalidatePath("/financeiro/cadastros/reembolso");
  revalidatePath("/financeiro/cadastros");
  return { ok: true };
}
