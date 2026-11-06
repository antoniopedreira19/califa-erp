/**
 * A prévia da troca do job para dentro ou para fora do Interno (decisão
 * 240): os números do job DEPOIS da troca, sem gravar nada.
 *
 * Usada duas vezes, com a mesma conta: pelo formulário, quando o
 * financeiro escolhe o serviço (o pop-up mostra os números e as previsões
 * passam a fechar com eles), e pelo "Salvar alterações", que confere as
 * previsões contra estes números e entrega os espelhos à RPC
 * `trocar_job_de_lado_do_interno`. A conta é a dos espelhos do job
 * (`lib/data/espelhos-do-job.ts`) sobre as linhas já convertidas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  faturamentoPorMesDoFinanceiro,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  totaisParaRpc,
  type TotaisParaRpc,
} from "@/lib/data/espelhos-do-job";
import type { FaturamentoDoMes } from "@/lib/calculos/faturamento-por-mes";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import {
  linhasDepoisDaTroca,
  planejadoDepoisDaTroca,
  tipoDepoisDaTroca,
  tiposDasLinhas,
  type SentidoDaTroca,
} from "@/lib/calculos/troca-do-interno";
import type { TipoCusto } from "@/lib/types";

export interface PreviaDaTrocaDoInterno {
  sentido: SentidoDaTroca;
  /** O que impede a entrada (save, BV, envio, nota, recebimento). Vazio
   *  na saída e quando nada impede. */
  bloqueios: string[];
  /** Os tipos de custo do job hoje, sem repetir. */
  tiposHoje: TipoCusto[];
  /** Quantas linhas A e D passam a ser pagas pela California (entrada). */
  linhasAD: number;
  antes: { planejado: number; faturamentoPrevisto: number };
  /** Os números do job depois da troca, nos campos do formulário. */
  depois: {
    faturamentoPrevisto: number;
    impostoPrevisto: number;
    custoPrevisto: number;
    custoPlanejado: number;
    valorJob: number;
    deducoes: number;
    /** Fee e Always On: o faturamento de cada mês. Nulo nos outros. */
    faturamentoPorMes: FaturamentoDoMes[] | null;
  };
  /** Os espelhos que a RPC grava no job. */
  totais: TotaisParaRpc;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

export async function previaDaTrocaDoInterno(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  sentido: SentidoDaTroca,
): Promise<{ ok: true; previa: PreviaDaTrocaDoInterno } | { ok: false; message: string }> {
  // As leituras são independentes: vão juntas (docs/PERFORMANCE.md).
  const [lida, planejadoRes, bloqueiosRes] = await Promise.all([
    lerBaseDosEspelhos(supabase, tenantId, jobId),
    supabase
      .from("jobs_itens_orcado")
      .select("id, tipo_custo, total_orcado, total_planejado")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    sentido === "entra"
      ? supabase.rpc("bloqueios_do_job_para_o_interno", { p_job_id: jobId })
      : Promise.resolve({ data: [] as string[], error: null }),
  ]);
  if (!lida.ok) return { ok: false, message: lida.message };
  if (planejadoRes.error || !planejadoRes.data) {
    console.error("[troca-interno.planejado]", planejadoRes.error?.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }
  if (bloqueiosRes.error || bloqueiosRes.data === null) {
    console.error("[troca-interno.bloqueios]", bloqueiosRes.error?.message);
    return { ok: false, message: "Não foi possível conferir o que impede a troca." };
  }
  const base = lida.base;
  if (base.midia) {
    return { ok: false, message: "Job de Mídia Off não entra nem sai do Interno." };
  }

  const linhas = (planejadoRes.data as any[]).map((l) => ({
    tipo_custo: l.tipo_custo as TipoCusto,
    total_orcado: Number(l.total_orcado ?? 0),
    total_planejado: Number(l.total_planejado ?? 0),
  }));

  const convertidos = linhasDepoisDaTroca(base.itens, sentido);
  const totaisAntes = totaisDoFinanceiro(base.itens, base);
  const totaisDepois = totaisDoFinanceiro(convertidos, base);

  const planejadoAntes = linhas.reduce((s, l) => s + l.total_planejado, 0);
  const planejadoDepois = linhas.reduce((s, l) => s + planejadoDepoisDaTroca(l, sentido), 0);
  // O desembolso: o planejado das linhas que a California paga por PP.
  const custoPrevisto = linhas.reduce(
    (s, l) =>
      tipoGeraDesembolso(tipoDepoisDaTroca(l.tipo_custo, sentido))
        ? s + planejadoDepoisDaTroca(l, sentido)
        : s,
    0,
  );

  return {
    ok: true,
    previa: {
      sentido,
      bloqueios: (bloqueiosRes.data as string[]) ?? [],
      tiposHoje: tiposDasLinhas(linhas),
      linhasAD:
        sentido === "entra"
          ? linhas.filter((l) => l.tipo_custo === "A" || l.tipo_custo === "D").length
          : 0,
      antes: {
        planejado: centavos(planejadoAntes),
        faturamentoPrevisto: centavos(totaisAntes.faturamentoPrevisto),
      },
      depois: {
        faturamentoPrevisto: centavos(totaisDepois.faturamentoPrevisto),
        impostoPrevisto: centavos(totaisDepois.faturamento.imposto + totaisDepois.faturamento.intTaxes),
        custoPrevisto: centavos(custoPrevisto),
        custoPlanejado: centavos(planejadoDepois),
        valorJob: centavos(totaisDepois.valorJob),
        deducoes: centavos(totaisDepois.deducoesDoResultado),
        faturamentoPorMes: faturamentoPorMesDoFinanceiro(convertidos, base),
      },
      totais: totaisParaRpc(convertidos, base),
    },
  };
}
