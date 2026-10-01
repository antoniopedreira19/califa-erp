import { createClient } from "@/lib/supabase/server";
import type { FeriasLancamentoTipo } from "@/lib/types";

export type ValoresLancamento = {
  valor_base_remuneracao: number;
  valor_ferias: number;
  valor_um_terco: number;
  valor_abono: number;
  valor_total: number;
};

/**
 * Calcula valores em R$ de um lançamento de férias para PJ.
 *
 * Regras (docs/modulos/rh/25-ferias.md §4.6):
 *   - CLT: contabilidade manda o recibo pronto → NÃO calculamos aqui.
 *   - PJ: calcula pro-rata diário com salário vigente na data_inicio.
 *     - usufruto / abono_combinado:
 *         valor_ferias   = salário / 30 × dias
 *         valor_um_terco = valor_ferias / 3
 *         valor_abono    = 0
 *     - abono_avulso / abono_excepcional:
 *         valor_ferias   = 0
 *         valor_um_terco = (salário / 30 × dias) / 3  (1/3 sobre o abono)
 *         valor_abono    = salário / 30 × dias
 *
 * Retorna null quando colaborador é CLT ou não tem salário vigente na data.
 */
export async function calcularValoresLancamentoPJ(
  colaboradorId: string,
  dataInicio: string,
  tipo: FeriasLancamentoTipo,
  dias: number,
): Promise<ValoresLancamento | null> {
  const supabase = createClient();

  // CLT não calcula — recibo vem da contabilidade
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tipo_contratacao")
    .eq("id", colaboradorId)
    .maybeSingle();
  if (!colab) return null;
  if (colab.tipo_contratacao === "clt") return null;

  // Salário vigente na data_inicio
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

  const salario = Number(salarioRow.valor);
  if (!salario || !isFinite(salario) || salario <= 0) return null;

  const diario = salario / 30;
  const valorPorDiasBrutos = round2(diario * dias);

  const isAbono =
    tipo === "abono_avulso" || tipo === "abono_excepcional";
  const isCombinado = tipo === "abono_combinado";

  // No modelo da California:
  //   usufruto             → só férias + 1/3
  //   abono_combinado      → trata como férias + 1/3 (os dias já são "venda"
  //                           mas o cálculo PJ é o mesmo que usufruto; o
  //                           distintivo contábil fica no tipo).
  //   abono_avulso / excepcional → entra como "abono" puro + 1/3 do abono.
  const valor_ferias =
    isAbono ? 0 : valorPorDiasBrutos;
  const valor_abono =
    isAbono ? valorPorDiasBrutos : 0;
  const valor_um_terco = round2(
    (isAbono ? valor_abono : valor_ferias) / 3,
  );
  const valor_total = round2(valor_ferias + valor_abono + valor_um_terco);

  return {
    valor_base_remuneracao: round2(salario),
    valor_ferias,
    valor_um_terco,
    valor_abono,
    valor_total,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
