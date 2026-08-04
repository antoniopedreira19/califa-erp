"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  calcularTotaisVersao,
  calcularEfeitoNoFaturamento,
} from "@/lib/calculos/versao-totais";
import type { TipoCusto } from "@/lib/types";

type Ok = { ok: true; errataId: string };
type Err = { ok: false; message: string };
type Result = Ok | Err;

const TIPOS = ["A", "B", "C", "D"] as const;

const alteracaoSchema = z.object({
  job_item_orcado_id: z.string().uuid(),
  valor_unitario: z.number().nonnegative(),
  tipo_custo: z.enum(TIPOS),
});

const payloadSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(5, "Título precisa de pelo menos 5 caracteres.")
    .max(200, "Título passa de 200 caracteres."),
  justificativa: z
    .string()
    .trim()
    .max(1000, "Justificativa passa de 1000 caracteres.")
    .optional()
    .nullable(),
  alteracoes: z.array(alteracaoSchema).min(1, "Nenhuma alteração informada."),
});

export type AlteracaoErrata = z.infer<typeof alteracaoSchema>;

/** Valor monetário gravado sempre com 2 casas, como `jobs.valor_total`. */
function dinheiro(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Registra uma errata e aplica as alterações no orçado do job.
 *
 * Só R$ unitário e tipo de custo mudam — QT e D/M do orçado ficam como
 * foram aprovados, então o total varia proporcionalmente ao unitário.
 *
 * Grava antes de aplicar: a errata guarda a fotografia de custo e
 * faturamento dos dois lados, mais o efeito de cada item. Isso mantém o
 * histórico legível mesmo que as regras de honorários ou imposto mudem.
 */
export async function registrarErrata(
  jobId: string,
  payload: z.input<typeof payloadSchema>,
): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const { titulo, justificativa, alteracoes } = parsed.data;

  // ---- Gate: job existe, do tenant, e em status editável ----
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, tenant_id, status, versao_orcamento_aprovada_id, projeto_id, orcamento_id",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) return { ok: false, message: "Job não encontrado." };

  if (job.status !== "aberto" && job.status !== "em_producao") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.errata_registrada",
        motivo: "status_bloqueia_edicao",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message:
        "O orçado só pode ser alterado com o job em 'Aberto' ou 'Em produção'.",
    };
  }

  // Permissão por papel fica liberada nesta fase, por decisão do time
  // (04/08/2026). O gate de status acima continua valendo pra todo mundo.

  // ---- Percentuais vêm da versão aprovada, que não muda por errata ----
  const { data: versao, error: versaoErr } = await supabase
    .from("versoes_orcamento")
    .select("id, percentual_honorarios, percentual_imposto")
    .eq("id", job.versao_orcamento_aprovada_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (versaoErr || !versao) {
    return { ok: false, message: "Versão aprovada do job não encontrada." };
  }

  const pctHonorarios = Number(versao.percentual_honorarios ?? 0);
  const pctImposto = Number(versao.percentual_imposto ?? 0);

  // ---- Estado atual do orçado do job ----
  const { data: itensAtuais, error: itensErr } = await supabase
    .from("jobs_itens_orcado")
    .select(
      "id, item, grupo_id, tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado",
    )
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErr || !itensAtuais) {
    return { ok: false, message: "Não foi possível ler o orçado do job." };
  }

  const porId = new Map(itensAtuais.map((i: any) => [i.id, i]));

  // Nome do grupo entra congelado no histórico.
  const { data: grupos } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, nome")
    .eq("versao_orcamento_id", job.versao_orcamento_aprovada_id)
    .eq("tenant_id", session.activeTenant.id);
  const nomeDoGrupo = new Map(
    (grupos ?? []).map((g: any) => [g.id, g.nome as string]),
  );

  // ---- Monta as mudanças, descartando o que não mudou de fato ----
  type Mudanca = {
    id: string;
    item_nome: string;
    grupo_nome: string;
    tipo_de: TipoCusto;
    tipo_para: TipoCusto;
    unitario_de: number;
    unitario_para: number;
    total_de: number;
    total_para: number;
    efeito: number;
  };

  const mudancas: Mudanca[] = [];

  for (const alt of alteracoes) {
    const atual = porId.get(alt.job_item_orcado_id);
    if (!atual) {
      return {
        ok: false,
        message: "Um dos itens alterados não pertence a este job.",
      };
    }

    const unitarioDe = Number(atual.valor_unitario_orcado ?? 0);
    const tipoDe = atual.tipo_custo as TipoCusto;
    const qtd = Number(atual.quantidade_orcada ?? 1);
    const dm = Number(atual.dias_meses_orcado ?? 1);

    const unitarioPara = alt.valor_unitario;
    const tipoPara = alt.tipo_custo;

    const mudouValor = unitarioPara !== unitarioDe;
    const mudouTipo = tipoPara !== tipoDe;
    if (!mudouValor && !mudouTipo) continue;

    const totalDe = Number(atual.total_orcado ?? 0);
    const totalPara = unitarioPara * qtd * dm;

    mudancas.push({
      id: atual.id,
      item_nome: atual.item,
      grupo_nome: nomeDoGrupo.get(atual.grupo_id) ?? "—",
      tipo_de: tipoDe,
      tipo_para: tipoPara,
      unitario_de: unitarioDe,
      unitario_para: unitarioPara,
      total_de: totalDe,
      total_para: totalPara,
      efeito: calcularEfeitoNoFaturamento(
        { total: totalDe, tipoCusto: tipoDe },
        { total: totalPara, tipoCusto: tipoPara },
        pctHonorarios,
        pctImposto,
      ),
    });
  }

  if (mudancas.length === 0) {
    return { ok: false, message: "Nenhum valor ou tipo de custo foi alterado." };
  }

  // ---- Totais antes e depois, pela mesma função do card de Totais ----
  const antes = calcularTotaisVersao(
    itensAtuais.map((i: any) => ({
      tipo_custo: i.tipo_custo as TipoCusto,
      total_orcado: Number(i.total_orcado ?? 0),
    })),
    pctHonorarios,
    pctImposto,
  );

  const mudancaPorId = new Map(mudancas.map((m) => [m.id, m]));
  const depois = calcularTotaisVersao(
    itensAtuais.map((i: any) => {
      const m = mudancaPorId.get(i.id);
      return {
        tipo_custo: (m ? m.tipo_para : i.tipo_custo) as TipoCusto,
        total_orcado: m ? m.total_para : Number(i.total_orcado ?? 0),
      };
    }),
    pctHonorarios,
    pctImposto,
  );

  // ---- Grava a errata ----
  const { data: errata, error: errataErr } = await supabase
    .from("jobs_erratas")
    .insert({
      tenant_id: session.activeTenant.id,
      job_id: jobId,
      titulo,
      justificativa: justificativa?.trim() || null,
      // Duas casas em tudo que é dinheiro: `jobs.valor_total` e
      // `faturamento_abertura` também são gravados assim, e sem isso o
      // card de Erratas mostra o mesmo delta com 1 centavo de diferença.
      custo_orcado_antes: dinheiro(antes.subtotalGeral),
      custo_orcado_depois: dinheiro(depois.subtotalGeral),
      faturamento_antes: dinheiro(antes.faturamento),
      faturamento_depois: dinheiro(depois.faturamento),
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (errataErr || !errata) {
    console.error("[errata.insert]", errataErr?.message);
    return { ok: false, message: "Falha ao registrar a errata." };
  }

  const { error: itensErrataErr } = await supabase
    .from("jobs_erratas_itens")
    .insert(
      mudancas.map((m) => ({
        tenant_id: session.activeTenant.id,
        errata_id: errata.id,
        job_item_orcado_id: m.id,
        item_nome: m.item_nome,
        grupo_nome: m.grupo_nome,
        tipo_custo_de: m.tipo_de,
        tipo_custo_para: m.tipo_para,
        valor_unitario_de: m.unitario_de,
        valor_unitario_para: m.unitario_para,
        total_de: dinheiro(m.total_de),
        total_para: dinheiro(m.total_para),
        efeito_faturamento: dinheiro(m.efeito),
      })),
    );

  if (itensErrataErr) {
    // Errata sem itens não serve de histórico: desfaz pra não deixar
    // registro pela metade, e o orçado continua intocado.
    await supabase.from("jobs_erratas").delete().eq("id", errata.id);
    console.error("[errata.itens_insert]", itensErrataErr.message);
    return { ok: false, message: "Falha ao registrar os itens da errata." };
  }

  // ---- Só agora aplica no orçado do job ----
  for (const m of mudancas) {
    const { error: updErr } = await supabase
      .from("jobs_itens_orcado")
      .update({
        valor_unitario_orcado: m.unitario_para,
        tipo_custo: m.tipo_para,
        updated_at: new Date().toISOString(),
      })
      .eq("id", m.id)
      .eq("tenant_id", session.activeTenant.id);

    if (updErr) {
      console.error("[errata.aplicar]", m.id, updErr.message);
      return {
        ok: false,
        message: `Errata registrada, mas o item "${m.item_nome}" não foi atualizado. Avise o suporte.`,
      };
    }
  }

  // Faturamento previsto do job acompanha o orçado.
  await supabase
    .from("jobs")
    .update({ valor_total: Number(depois.faturamento.toFixed(2)) })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "job.errata_registrada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      errata_id: errata.id,
      titulo,
      itens_alterados: mudancas.length,
      faturamento_antes: antes.faturamento,
      faturamento_depois: depois.faturamento,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, errataId: errata.id };
}
