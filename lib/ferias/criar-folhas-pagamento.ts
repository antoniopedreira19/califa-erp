import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasLancamento,
  TipoContratacao,
} from "@/lib/types";
import {
  calcularValoresLancamento,
  buscarSalarioParaFolha,
} from "./calcular-valores";

type CriarFolhasResult = {
  criadas: string[]; // ids das folhas criadas
  pulada_porque_retroativa: boolean;
  erro?: string;
};

/**
 * Cria as folha(s) de pagamento de férias associadas a um lançamento
 * recém-aprovado. Chamada pelas 2 actions de aprovação:
 *   - `aprovarLancamento` (RH aprova solicitação do colaborador).
 *   - `lancarDiretoPeloRh` (lançamento retroativo ou direto pelo RH).
 *
 * Regras (ver docs/modulos/rh/25-ferias.md §F16):
 *   - Se `data_inicio < hoje`: NÃO cria folha (lançamento retroativo).
 *     O pagamento foi feito fora do sistema; só registramos o evento.
 *   - PJ puro:     1 folha `california` (sistema calcula).
 *   - CLT puro:    1 folha `contabilidade` (aguarda PDF).
 *   - CLT recibo:  2 folhas: 1 `california` sobre valor_recibo
 *                  (parte RPA) + 1 `contabilidade` sobre valor − valor_recibo
 *                  (parte CLT, aguarda PDF).
 *   - Estagiário:  1 folha `contabilidade` (fluxo CLT da contabilidade).
 *   - Sócio:       nunca cria — sócio é filtrado antes de aprovar férias.
 *
 * Vencimento (data_pagamento_prevista): calculado pela função SQL
 * `fn_calcular_vencimento_ferias` — 2 dias antes do início; se cair
 * em sábado/domingo, antecipa pra quinta anterior.
 *
 * Idempotente: se já existir folha pro mesmo (lancamento_ferias_id,
 * origem), não duplica.
 */
export async function criarFolhasDePagamentoDeFerias(opts: {
  lancamento: Pick<
    ColaboradorFeriasLancamento,
    | "id"
    | "tenant_id"
    | "colaborador_id"
    | "tipo"
    | "data_inicio"
    | "data_fim"
    | "dias"
  >;
  colaborador: {
    id: string;
    tipo_contratacao: TipoContratacao;
  };
  actorUserId: string;
}): Promise<CriarFolhasResult> {
  const { lancamento, colaborador, actorUserId } = opts;

  // 1) Retroativo? Pula.
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = new Date(lancamento.data_inicio + "T00:00:00");
  if (dataInicio < hoje) {
    return { criadas: [], pulada_porque_retroativa: true };
  }

  // 2) Sócio nunca deveria chegar — guard de segurança.
  if (colaborador.tipo_contratacao === "socio") {
    return {
      criadas: [],
      pulada_porque_retroativa: false,
      erro: "Sócio não gera folha de férias.",
    };
  }

  const supabase = createClient();

  // 3) Vencimento via SQL (mesma fonte-verdade pra todos os cálculos).
  const { data: vencData, error: vencErr } = await supabase.rpc(
    "fn_calcular_vencimento_ferias",
    { p_data_inicio: lancamento.data_inicio },
  );
  if (vencErr) {
    return {
      criadas: [],
      pulada_porque_retroativa: false,
      erro: "Falha ao calcular vencimento: " + vencErr.message,
    };
  }
  const dataPagamentoPrevista = vencData as string | null;

  // 4) Checa folhas já existentes pro mesmo lançamento (idempotência).
  const { data: existentes } = await supabase
    .from("folhas_pagamento")
    .select("id, origem")
    .eq("lancamento_ferias_id", lancamento.id);
  const origensExistentes = new Set(
    (existentes ?? []).map((r) => r.origem as string),
  );

  // 5) Busca salário.
  const salario = await buscarSalarioParaFolha(
    colaborador.id,
    lancamento.data_inicio,
    colaborador.tipo_contratacao,
  );
  if (!salario) {
    return {
      criadas: [],
      pulada_porque_retroativa: false,
      erro:
        "Colaborador sem salário vigente na data de início das férias.",
    };
  }

  // 6) Decide qual(is) folha(s) criar.
  const ano = dataInicio.getFullYear();
  const mes = dataInicio.getMonth() + 1;

  const inserts: Array<{
    origem: "california" | "contabilidade";
    salario_base: string;
  }> = [];

  switch (colaborador.tipo_contratacao) {
    case "pj": {
      // 1 folha PJ: sistema calcula sobre o salário total.
      const valores = await calcularValoresLancamento(
        colaborador.id,
        lancamento.data_inicio,
        lancamento.tipo,
        lancamento.dias,
        salario.valorTotal,
      );
      if (!valores) {
        return {
          criadas: [],
          pulada_porque_retroativa: false,
          erro: "Falha ao calcular valores PJ.",
        };
      }
      inserts.push({
        origem: "california",
        salario_base: valores.valor_total.toFixed(2),
      });
      break;
    }

    case "clt":
    case "estagio": {
      // 1 folha contabilidade: aguarda recibo.
      // salario_base inicial = valor total (como referência/preview);
      // RH substituirá pelo valor líquido ao anexar o PDF.
      inserts.push({
        origem: "contabilidade",
        salario_base: salario.valorTotal.toFixed(2),
      });
      break;
    }

    case "clt_recibo": {
      // Folha PJ sobre a parte RPA (valor_recibo).
      if (salario.parteRpa > 0) {
        const valoresRpa = await calcularValoresLancamento(
          colaborador.id,
          lancamento.data_inicio,
          lancamento.tipo,
          lancamento.dias,
          salario.parteRpa,
        );
        if (valoresRpa) {
          inserts.push({
            origem: "california",
            salario_base: valoresRpa.valor_total.toFixed(2),
          });
        }
      }
      // Folha contabilidade sobre a parte CLT (valor − valor_recibo).
      if (salario.parteClt > 0) {
        inserts.push({
          origem: "contabilidade",
          salario_base: salario.parteClt.toFixed(2),
        });
      }
      break;
    }

    default: {
      return {
        criadas: [],
        pulada_porque_retroativa: false,
        erro: `Tipo de contratação não suportado: ${colaborador.tipo_contratacao}`,
      };
    }
  }

  // 7) Insere evitando duplicatas por origem.
  const criadas: string[] = [];
  for (const row of inserts) {
    if (origensExistentes.has(row.origem)) continue;

    const { data: nova, error: insErr } = await supabase
      .from("folhas_pagamento")
      .insert({
        tenant_id: lancamento.tenant_id,
        colaborador_id: colaborador.id,
        competencia_ano: ano,
        competencia_mes: mes,
        salario_base: row.salario_base,
        status: "rascunho",
        origem: row.origem,
        tipo: "ferias",
        lancamento_ferias_id: lancamento.id,
        data_pagamento_prevista: dataPagamentoPrevista,
        created_by: actorUserId,
      })
      .select("id")
      .single();

    if (insErr) {
      return {
        criadas,
        pulada_porque_retroativa: false,
        erro: `Falha ao criar folha ${row.origem}: ${insErr.message}`,
      };
    }
    if (nova) criadas.push(nova.id as string);
  }

  return { criadas, pulada_porque_retroativa: false };
}
