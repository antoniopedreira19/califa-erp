/**
 * Pagamentos atrasados (decisão 259): o que o servidor precisa saber da
 * liberação de um job fechado. As telas leem a liberação inteira pelo
 * `SELECT_LIBERACAO_PAGAMENTOS_ATRASADOS`; as actions só perguntam se ela
 * está aberta (a produção lança) e qual é a competência.
 */

import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import {
  competenciaLonga,
  competenciasParaLiberar,
  jobFechado,
  trimestreDeHoje,
  type PagamentosAtrasadosDoJob,
  type PagamentosAtrasadosNaPlanilha,
} from "@/lib/pagamentos-atrasados";
import type { AppRole } from "@/lib/types";

/** O que a Planilha Interna recebe: as liberações do job e o que o papel
 *  pode fazer com elas (a produção cria linha e conclui; o financeiro
 *  libera e conclui). */
export function pagamentosAtrasadosNaPlanilha(args: {
  pagamentos: PagamentosAtrasadosDoJob;
  role: AppRole;
  job: { competencia_trimestre: number | null; competencia_ano: number | null };
  temAR: boolean;
}): PagamentosAtrasadosNaPlanilha {
  const hoje = hojeEmSaoPauloIso();
  const t = args.job.competencia_trimestre ?? null;
  const a = args.job.competencia_ano ?? null;
  return {
    ...args.pagamentos,
    podeCriarLinha: pode(args.role, "jobs.preparar_errata"),
    podeLiberar: pode(args.role, "jobs.editar_orcado_financeiro"),
    competencias: competenciasParaLiberar({ trimestre: t, ano: a }, hoje),
    competenciaPadrao: trimestreDeHoje(hoje),
    competenciaDoJob: t && a ? competenciaLonga(t, a) : null,
    temAR: args.temAR,
  };
}

type Cliente = ReturnType<typeof createClient>;

export interface LiberacaoAbertaResumo {
  id: string;
  trimestre: number;
  ano: number;
}

/** A liberação aberta do job: sem conclusão pedida e sem encerramento. Só
 *  com ela a produção gera PP e cria linha vermelha no job fechado. */
export async function liberacaoAbertaDoJob(
  supabase: Cliente,
  jobId: string,
): Promise<LiberacaoAbertaResumo | null> {
  const { data } = await supabase
    .from("jobs_pagamentos_atrasados")
    .select("id, trimestre, ano")
    .eq("job_id", jobId)
    .is("encerrado_em", null)
    .is("conclusao_pedida_em", null)
    .maybeSingle();
  return data ? { id: data.id, trimestre: Number(data.trimestre), ano: Number(data.ano) } : null;
}

/** O job fechado aceita a PP (gerar, editar, cancelar, enviar) porque o
 *  financeiro liberou os pagamentos atrasados. Fora do job fechado, devolve
 *  false — quem chama já tem a regra de sempre. */
export async function jobFechadoLiberado(
  supabase: Cliente,
  job: { id: string; status: string },
): Promise<boolean> {
  if (!jobFechado(job.status)) return false;
  return (await liberacaoAbertaDoJob(supabase, job.id)) !== null;
}

/** A competência da PP de pagamento atrasado, para o PDF: pela marca da PP
 *  (`pagamento_atrasado_id`) ou, antes de ela existir, pela liberação aberta
 *  do job fechado. */
export async function competenciaDaPPAtrasada(
  supabase: Cliente,
  args: { pagamentoAtrasadoId?: string | null; jobId?: string | null; jobStatus?: string | null },
): Promise<{ trimestre: number; ano: number } | null> {
  if (args.pagamentoAtrasadoId) {
    const { data } = await supabase
      .from("jobs_pagamentos_atrasados")
      .select("trimestre, ano")
      .eq("id", args.pagamentoAtrasadoId)
      .maybeSingle();
    return data ? { trimestre: Number(data.trimestre), ano: Number(data.ano) } : null;
  }
  if (args.jobId && jobFechado(args.jobStatus ?? null)) {
    const lib = await liberacaoAbertaDoJob(supabase, args.jobId);
    return lib ? { trimestre: lib.trimestre, ano: lib.ano } : null;
  }
  return null;
}
