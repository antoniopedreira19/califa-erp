import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasLancamento,
  FeriasLancamentoTipo,
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
 * Representa uma folha a inserir, antes do INSERT.
 * Internamente usado por `decidirFolhasAInserir` (testável puro).
 */
export type FolhaAInserir = {
  origem: "california" | "contabilidade";
  salario_base: string;
  tipo_folha_ferias: "usufruto" | "abono";
};

/**
 * Lógica PURA de decisão: dado o tipo de lançamento e as parcelas de salário,
 * retorna a lista de folhas a inserir, SEM realizar I/O.
 *
 * Regras (ver docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md):
 *   - usufruto        → 1 folha usufruto, salario_base = valor_ferias + valor_um_terco
 *   - abono_avulso    → 1 folha abono,    salario_base = valor_abono
 *   - abono_excepcional → 1 folha abono,  salario_base = valor_abono
 *   - abono_combinado → 2 folhas:
 *       1ª: usufruto, salario_base = valor_ferias + valor_um_terco
 *       2ª: abono,    salario_base = valor_abono
 *
 * Para clt_recibo (híbrido), o chamador passa valoresRpa e valoresClt separados;
 * cada parte gera suas próprias folhas (até 4 no caso de abono_combinado).
 *
 * Exportada para permitir testes unitários sem Supabase.
 */
export function decidirFolhasAInserir(params: {
  tipo: FeriasLancamentoTipo;
  tipoContratacao: TipoContratacao;
  /** Valores calculados sobre a parte "california" (PJ/RPA). Null pra CLT puro/estagio. */
  valoresCalifornia: {
    valor_ferias: number;
    valor_um_terco: number;
    valor_abono: number;
    valor_total: number;
  } | null;
  /** Base salarial da parte "contabilidade" (CLT). Null pra PJ puro. */
  baseClt: number | null;
}): FolhaAInserir[] {
  const { tipo, tipoContratacao, valoresCalifornia, baseClt } = params;
  const inserts: FolhaAInserir[] = [];

  // --- Parte california (PJ / RPA do híbrido) ---
  if (valoresCalifornia !== null) {
    switch (tipo) {
      case "usufruto":
      case "abono_combinado": {
        // Folha de usufruto (férias + 1/3)
        const base = (
          valoresCalifornia.valor_ferias + valoresCalifornia.valor_um_terco
        ).toFixed(2);
        inserts.push({ origem: "california", salario_base: base, tipo_folha_ferias: "usufruto" });
        break;
      }
      case "abono_avulso":
      case "abono_excepcional": {
        inserts.push({
          origem: "california",
          salario_base: valoresCalifornia.valor_abono.toFixed(2),
          tipo_folha_ferias: "abono",
        });
        break;
      }
    }
    // Para abono_combinado, adiciona também a folha de abono (parte california)
    if (tipo === "abono_combinado") {
      inserts.push({
        origem: "california",
        salario_base: valoresCalifornia.valor_abono.toFixed(2),
        tipo_folha_ferias: "abono",
      });
    }
  }

  // --- Parte contabilidade (CLT / estagio / parte CLT do híbrido) ---
  if (baseClt !== null && baseClt > 0) {
    switch (tipo) {
      case "usufruto":
      case "abono_combinado": {
        inserts.push({
          origem: "contabilidade",
          salario_base: baseClt.toFixed(2),
          tipo_folha_ferias: "usufruto",
        });
        break;
      }
      case "abono_avulso":
      case "abono_excepcional": {
        inserts.push({
          origem: "contabilidade",
          salario_base: baseClt.toFixed(2),
          tipo_folha_ferias: "abono",
        });
        break;
      }
    }
    // Para abono_combinado, a contabilidade também gera folha de abono
    // Nota: baseClt aqui é o valor total CLT, não há como separar usufruto/abono
    // sem calcular — usamos o mesmo valor como referência (RH substitui pelo recibo).
    if (tipo === "abono_combinado") {
      inserts.push({
        origem: "contabilidade",
        salario_base: baseClt.toFixed(2),
        tipo_folha_ferias: "abono",
      });
    }
  }

  return inserts;
}

/**
 * Cria as folha(s) de pagamento de férias associadas a um lançamento
 * recém-aprovado. Chamada pelas 2 actions de aprovação:
 *   - `aprovarLancamento` (RH aprova solicitação do colaborador).
 *   - `lancarDiretoPeloRh` (lançamento retroativo ou direto pelo RH).
 *
 * Regras (ver docs/modulos/rh/25-ferias.md §F16):
 *   - Se `data_inicio < hoje`: NÃO cria folha (lançamento retroativo).
 *     O pagamento foi feito fora do sistema; só registramos o evento.
 *   - PJ puro:     1-2 folhas `california` (1 usufruto; 2 pra abono_combinado).
 *   - CLT puro:    1-2 folhas `contabilidade` (aguarda PDF).
 *   - CLT recibo:  2-4 folhas (1-2 california sobre valor_recibo + 1-2 contabilidade).
 *   - Estagiário:  1-2 folhas `contabilidade`.
 *   - Sócio:       nunca cria — sócio é filtrado antes de aprovar férias.
 *
 * Idempotente: checa `(lancamento_ferias_id, origem, tipo_folha_ferias)` pra não duplicar.
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
  //    Agora a chave de idempotência é (lancamento_ferias_id, origem, tipo_folha_ferias).
  const { data: existentes } = await supabase
    .from("folhas_pagamento")
    .select("id, origem, tipo_folha_ferias")
    .eq("lancamento_ferias_id", lancamento.id);
  const existentesSet = new Set(
    (existentes ?? []).map(
      (r) => `${r.origem as string}|${r.tipo_folha_ferias as string}`,
    ),
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
      erro: "Colaborador sem salário vigente na data de início das férias.",
    };
  }

  // 6) Decide qual(is) folha(s) criar via lógica pura (testável).
  let valoresCalifornia: Awaited<ReturnType<typeof calcularValoresLancamento>> = null;
  let baseClt: number | null = null;

  switch (colaborador.tipo_contratacao) {
    case "pj": {
      valoresCalifornia = await calcularValoresLancamento(
        colaborador.id,
        lancamento.data_inicio,
        lancamento.tipo,
        lancamento.dias,
        salario.valorTotal,
      );
      if (!valoresCalifornia) {
        return {
          criadas: [],
          pulada_porque_retroativa: false,
          erro: "Falha ao calcular valores PJ.",
        };
      }
      break;
    }

    case "clt":
    case "estagio": {
      // salario_base inicial = valor total (referência/preview); RH substitui pelo recibo.
      baseClt = salario.valorTotal;
      break;
    }

    case "clt_recibo": {
      if (salario.parteRpa > 0) {
        valoresCalifornia = await calcularValoresLancamento(
          colaborador.id,
          lancamento.data_inicio,
          lancamento.tipo,
          lancamento.dias,
          salario.parteRpa,
        );
        if (!valoresCalifornia) {
          return {
            criadas: [],
            pulada_porque_retroativa: false,
            erro: "Falha ao calcular valores RPA.",
          };
        }
      }
      if (salario.parteClt > 0) {
        baseClt = salario.parteClt;
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

  const inserts = decidirFolhasAInserir({
    tipo: lancamento.tipo,
    tipoContratacao: colaborador.tipo_contratacao,
    valoresCalifornia,
    baseClt,
  });

  // 7) Insere evitando duplicatas por (origem, tipo_folha_ferias).
  const ano = dataInicio.getFullYear();
  const mes = dataInicio.getMonth() + 1;
  const criadas: string[] = [];

  for (const row of inserts) {
    const chave = `${row.origem}|${row.tipo_folha_ferias}`;
    if (existentesSet.has(chave)) continue;

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
        tipo_folha_ferias: row.tipo_folha_ferias,
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
        erro: `Falha ao criar folha ${row.origem}/${row.tipo_folha_ferias}: ${insErr.message}`,
      };
    }
    if (nova) {
      criadas.push(nova.id as string);
      existentesSet.add(chave); // evita duplicar na mesma chamada se chamar 2x
    }
  }

  return { criadas, pulada_porque_retroativa: false };
}
