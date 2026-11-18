"use server";

/**
 * Decisão 266 — o "Salvar" da planilha do job de pagamentos.
 *
 * No job de pagamentos não há errata: a linha nova (com o planejado que a
 * produção digitou, ou vermelha, sem planejado), o agrupamento novo e a
 * correção do planejado entram na hora. O orçado fica em zero e o tipo é
 * F · Interno (o gatilho `planejado_espelha_orcado` garante). Quem grava é a
 * função `salvar_planilha_do_job_de_pagamentos`, que confere o papel, o
 * acesso, o status e a marca do job. O que a tela manda é o mesmo conteúdo
 * do rascunho da errata (`errata.payload`).
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";

const numero = z.number().nonnegative().optional();

const grupoRef = z
  .string()
  .refine(
    (v) => z.string().uuid().safeParse(v).success || /^grupo-novo:\d+$/.test(v),
    "Agrupamento inválido.",
  );

const conteudoSchema = z.object({
  alteracoes: z
    .array(
      z.object({
        job_item_orcado_id: z.string().uuid(),
        valor_unitario_planejado: numero,
        quantidade_planejada: numero,
        dias_meses_planejado: numero,
      }),
    )
    .default([]),
  novas: z
    .array(
      z.object({
        grupo_id: grupoRef,
        item: z
          .string()
          .trim()
          .min(1, "Toda linha nova precisa de uma descrição.")
          .max(200, "A descrição do item passa de 200 caracteres."),
        linha_vermelha: z.boolean(),
        valor_unitario_planejado: numero,
        quantidade_planejada: numero,
        dias_meses_planejado: numero,
      }),
    )
    .default([]),
  cancelamentos: z.array(z.string()).default([]),
  remocoes: z.array(z.string()).default([]),
  estrutura: z
    .object({
      grupos_novos: z
        .array(z.object({ chave: z.string().regex(/^grupo-novo:\d+$/), nome: z.string() }))
        .default([]),
      grupos_renomeados: z.array(z.unknown()).default([]),
      itens_renomeados: z.array(z.unknown()).default([]),
      ordem: z.array(z.unknown()).nullable().default(null),
    })
    .nullable()
    .optional(),
});

export type ConteudoDaPlanilhaDePagamentos = z.input<typeof conteudoSchema>;

type Resultado = { ok: true } | { ok: false; message: string };

export async function salvarPlanilhaDoJobDePagamentos(
  jobId: string,
  conteudo: ConteudoDaPlanilhaDePagamentos,
): Promise<Resultado> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.preparar_errata", {
    acao_tentada: "job.planilha_de_pagamentos_salva",
    job_id: jobId,
  });
  if (!gate.ok) return { ok: false, message: gate.message };

  const parsed = conteudoSchema.safeParse(conteudo);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const c = parsed.data;
  // Cancelar, renomear e reorganizar não passam por aqui: a tela só chama
  // esta action quando o rascunho tem linha nova, agrupamento novo e
  // planejado.
  if (
    c.cancelamentos.length > 0 ||
    c.remocoes.length > 0 ||
    (c.estrutura?.grupos_renomeados.length ?? 0) > 0 ||
    (c.estrutura?.itens_renomeados.length ?? 0) > 0 ||
    (c.estrutura?.ordem?.length ?? 0) > 0
  ) {
    return {
      ok: false,
      message: "Cancelar, renomear ou reorganizar linhas não entra neste salvar. Recarregue a página.",
    };
  }
  if (c.novas.length === 0 && c.alteracoes.length === 0) {
    return { ok: false, message: "Nada mudou na planilha." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("salvar_planilha_do_job_de_pagamentos", {
    p_job_id: jobId,
    p_conteudo: {
      grupos: (c.estrutura?.grupos_novos ?? []).map((g) => ({ chave: g.chave, nome: g.nome })),
      linhas: c.novas.map((n, i) => ({
        chave: `nova:${i + 1}`,
        grupo_id: n.grupo_id,
        item: n.item,
        linha_vermelha: n.linha_vermelha,
        valor_unitario_planejado: n.linha_vermelha ? 0 : (n.valor_unitario_planejado ?? 0),
        quantidade_planejada: n.linha_vermelha ? 0 : (n.quantidade_planejada ?? 0),
        dias_meses_planejado: n.linha_vermelha ? 0 : (n.dias_meses_planejado ?? 0),
      })),
      alteracoes: c.alteracoes.map((a) => ({
        job_item_orcado_id: a.job_item_orcado_id,
        valor_unitario_planejado: a.valor_unitario_planejado ?? 0,
        quantidade_planejada: a.quantidade_planejada ?? 0,
        dias_meses_planejado: a.dias_meses_planejado ?? 0,
      })),
    },
  });
  if (error || !data) {
    console.error("[job-de-pagamentos.planilha]", error?.code, error?.message);
    return {
      ok: false,
      message: error?.message
        ? `Não foi possível salvar a planilha, e nada foi gravado. ${error.message}`
        : "Não foi possível salvar a planilha, e nada foi gravado.",
    };
  }

  await logAuditEvent({
    acao: "job.planilha_de_pagamentos_salva",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      linhas_novas: c.novas.length,
      linhas_vermelhas: c.novas.filter((n) => n.linha_vermelha).length,
      planejados_alterados: c.alteracoes.length,
      agrupamentos_novos: c.estrutura?.grupos_novos.length ?? 0,
      decisao: "266",
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
  return { ok: true };
}
