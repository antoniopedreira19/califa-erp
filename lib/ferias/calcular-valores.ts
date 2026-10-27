import { createClient } from "@/lib/supabase/server";
import type { FeriasLancamentoTipo, TipoContratacao } from "@/lib/types";

export type ValoresLancamento = {
  valor_base_remuneracao: number;
  valor_ferias: number;
  valor_um_terco: number;
  valor_abono: number;
  valor_total: number;
};

/**
 * Calcula valores em R$ de um lançamento de férias para QUALQUER tipo
 * de contratação (PJ, CLT, estagiário, clt_recibo). O cálculo é sempre
 * o VALOR BRUTO — descontos CLT (INSS, IRRF) ficam fora do sistema e
 * são aplicados pela contabilidade.
 *
 * Fórmula (docs/modulos/rh/25-ferias.md §4.6):
 *   diario = salario / 30
 *   usufruto:
 *     valor_ferias   = diario × dias
 *     valor_um_terco = valor_ferias / 3
 *     valor_abono    = 0
 *   abono_avulso / abono_excepcional:
 *     valor_ferias   = 0
 *     valor_abono    = diario × dias
 *     valor_um_terco = valor_abono / 3
 *   abono_combinado (dias = dias_folga + dias_abono):
 *     diasFolga      = dias - diasAbono
 *     valor_ferias   = diario × diasFolga
 *     valor_abono    = diario × diasAbono
 *     valor_um_terco = valor_ferias / 3   (só sobre férias, CLT: abono não gera 1/3)
 *
 * Fonte do salário: `colaboradores_salarios.valor` vigente na
 * `data_inicio` das férias.
 *
 * Caso especial `clt_recibo` (híbrido): o cálculo é feito sobre a
 * BASE desejada, que o chamador passa explicitamente via `salarioBase`.
 *
 * Retorna null se não tem salário vigente na data_inicio.
 */
export async function calcularValoresLancamento(
  colaboradorId: string,
  dataInicio: string,
  tipo: FeriasLancamentoTipo,
  dias: number,
  diasAbono: number = 0,
  salarioBaseOverride?: number,
): Promise<ValoresLancamento | null> {
  let salario: number;

  if (salarioBaseOverride !== undefined) {
    salario = salarioBaseOverride;
  } else {
    const supabase = createClient();
    const { data: salarios } = await supabase
      .from("colaboradores_salarios")
      .select("valor, data_inicio, data_fim")
      .eq("colaborador_id", colaboradorId)
      .lte("data_inicio", dataInicio)
      .or(`data_fim.is.null,data_fim.gte.${dataInicio}`)
      .order("data_inicio", { ascending: false })
      .limit(1);

    const salarioRow = salarios?.[0];
    if (!salarioRow) return null;
    salario = Number(salarioRow.valor);
  }

  if (!salario || !isFinite(salario) || salario <= 0) return null;

  const diario = salario / 30;

  let valor_ferias: number;
  let valor_abono: number;
  let valor_um_terco: number;

  if (tipo === "abono_avulso" || tipo === "abono_excepcional") {
    valor_ferias = 0;
    valor_abono = round2(diario * dias);
    valor_um_terco = round2(valor_abono / 3);
  } else if (tipo === "abono_combinado") {
    const diasFolga = dias - diasAbono;
    valor_ferias = round2(diario * diasFolga);
    valor_abono = round2(diario * diasAbono);
    // 1/3 só sobre férias (CLT: abono pecuniário não gera 1/3 constitucional)
    valor_um_terco = round2(valor_ferias / 3);
  } else {
    // usufruto
    valor_ferias = round2(diario * dias);
    valor_abono = 0;
    valor_um_terco = round2(valor_ferias / 3);
  }

  const valor_total = round2(valor_ferias + valor_abono + valor_um_terco);

  return {
    valor_base_remuneracao: round2(salario),
    valor_ferias,
    valor_um_terco,
    valor_abono,
    valor_total,
  };
}

/**
 * Alias legado — chamadas antigas (actions.ts) continuam funcionando.
 * Pra PJ e estagiário, calcula normalmente. Pra CLT puro, calcula
 * bruto também (mudança desta sessão). Pra clt_recibo, usa valor
 * total — o fluxo híbrido deve chamar `calcularValoresLancamento`
 * diretamente passando `salarioBaseOverride` da parte certa.
 *
 * @deprecated Use `calcularValoresLancamento` diretamente.
 */
export async function calcularValoresLancamentoPJ(
  colaboradorId: string,
  dataInicio: string,
  tipo: FeriasLancamentoTipo,
  dias: number,
  diasAbono: number = 0,
): Promise<ValoresLancamento | null> {
  return calcularValoresLancamento(colaboradorId, dataInicio, tipo, dias, diasAbono);
}

/**
 * Divide o salário de um `clt_recibo` nas 2 parcelas.
 * - `parteRpa`: valor_recibo (parte PJ, calculada pelo sistema).
 * - `parteClt`: valor − valor_recibo (parte CLT, aguarda contabilidade).
 *
 * Pra tipos != 'clt_recibo', `parteRpa = 0` e `parteClt = valor` total.
 * Retorna null se não há salário vigente.
 */
export async function buscarSalarioParaFolha(
  colaboradorId: string,
  dataInicio: string,
  tipoContratacao: TipoContratacao,
): Promise<{
  valorTotal: number;
  parteRpa: number;
  parteClt: number;
} | null> {
  const supabase = createClient();
  const { data: salarios } = await supabase
    .from("colaboradores_salarios")
    .select("valor, valor_recibo")
    .eq("colaborador_id", colaboradorId)
    .lte("data_inicio", dataInicio)
    .or(`data_fim.is.null,data_fim.gte.${dataInicio}`)
    .order("data_inicio", { ascending: false })
    .limit(1);

  const row = salarios?.[0];
  if (!row) return null;

  const valorTotal = Number(row.valor) || 0;
  if (valorTotal <= 0) return null;

  if (tipoContratacao === "clt_recibo") {
    const parteRpa = Number(row.valor_recibo) || 0;
    const parteClt = Math.max(valorTotal - parteRpa, 0);
    return { valorTotal, parteRpa, parteClt };
  }

  // Pros outros: tudo numa parcela só, nenhuma RPA.
  return { valorTotal, parteRpa: 0, parteClt: valorTotal };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
