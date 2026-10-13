import type { BeneficioModoCusteio } from "@/lib/types";
import type { BeneficioCompleto } from "@/lib/queries/beneficios";

/**
 * Cálculo client-side de preview do vínculo (para o modal de "Novo
 * Benefício"). Replica a lógica da fn_beneficios_custo_mensal pro
 * **titular apenas** — sem dependentes.
 *
 * Mantém sincronia com a função SQL: se a lógica do custeio mudar lá,
 * precisa espelhar aqui.
 */

export interface PreviewVinculo {
  idade: number;
  /** Faixa resolvida (quando modelo_preco='faixa_etaria'). Null = flat ou faixa não cadastrada. */
  faixa: { idade_min: number; idade_max: number | null } | null;
  /** Valor cheio do titular (R$). Null = não foi possível calcular. */
  valorCheio: number | null;
  /** O que a empresa paga do titular. */
  valorEmpresa: number | null;
  /** O que o colaborador paga do titular. */
  valorColaborador: number | null;
}

/**
 * Idade em anos completos no primeiro dia da competência (ano/mes).
 */
export function calcularIdadeNaCompetencia(
  dataNascimentoISO: string,
  ano: number,
  mes: number,
): number | null {
  if (!dataNascimentoISO) return null;
  const [anoN, mesN, diaN] = dataNascimentoISO.split("-").map(Number);
  if (!anoN || !mesN || !diaN) return null;
  const nasc = new Date(anoN, mesN - 1, diaN);
  const ref = new Date(ano, mes - 1, 1);
  let idade = ref.getFullYear() - nasc.getFullYear();
  const difMes = ref.getMonth() - nasc.getMonth();
  if (difMes < 0 || (difMes === 0 && ref.getDate() < nasc.getDate())) {
    idade--;
  }
  return idade >= 0 ? idade : null;
}

function faixaParaIdade(
  faixas: BeneficioCompleto["faixas"],
  idade: number,
) {
  for (const f of faixas) {
    if (
      idade >= f.idade_min &&
      (f.idade_max === null || idade <= f.idade_max)
    ) {
      return f;
    }
  }
  return null;
}

export function calcularPreviewVinculo({
  beneficio,
  catalogoCompleto,
  modo,
  dataNascimentoISO,
  ano,
  mes,
}: {
  beneficio: BeneficioCompleto;
  /** Catálogo todo — necessário para buscar o benefício base no modo upgrade. */
  catalogoCompleto: BeneficioCompleto[];
  modo: BeneficioModoCusteio;
  dataNascimentoISO: string | null;
  ano: number;
  mes: number;
}): PreviewVinculo | null {
  if (!dataNascimentoISO) return null;
  const idade = calcularIdadeNaCompetencia(dataNascimentoISO, ano, mes);
  if (idade === null) return null;

  // Resolve valor cheio do titular
  let valorCheio: number | null = null;
  let faixaResolvida: PreviewVinculo["faixa"] = null;

  if (beneficio.modelo_preco === "flat") {
    valorCheio =
      beneficio.valor_flat !== null ? Number(beneficio.valor_flat) : null;
  } else {
    const faixa = faixaParaIdade(beneficio.faixas, idade);
    if (faixa) {
      faixaResolvida = { idade_min: faixa.idade_min, idade_max: faixa.idade_max };
      valorCheio = Number(faixa.valor);
    }
  }

  if (valorCheio === null) {
    return { idade, faixa: faixaResolvida, valorCheio: null, valorEmpresa: null, valorColaborador: null };
  }

  // Aplica modo de custeio
  let valorEmpresa: number;
  if (modo === "rateado") {
    valorEmpresa = Math.round(
      (valorCheio * beneficio.percentual_empresa_titular) / 100 * 100,
    ) / 100;
  } else if (modo === "integral_empresa") {
    valorEmpresa = valorCheio;
  } else {
    // integral_empresa_com_upgrade: empresa paga valor do benefício base na mesma faixa
    if (!beneficio.beneficio_base_id) {
      valorEmpresa = 0;
    } else {
      const base = catalogoCompleto.find(
        (b) => b.id === beneficio.beneficio_base_id,
      );
      if (!base) {
        valorEmpresa = 0;
      } else {
        const faixaBase = faixaParaIdade(base.faixas, idade);
        valorEmpresa = faixaBase ? Number(faixaBase.valor) : 0;
      }
    }
  }

  return {
    idade,
    faixa: faixaResolvida,
    valorCheio,
    valorEmpresa,
    valorColaborador: Math.round((valorCheio - valorEmpresa) * 100) / 100,
  };
}

/**
 * Filtra os modos de custeio que fazem sentido pra um benefício específico.
 * - Dental: só rateado (hoje sempre 100% colaborador)
 * - Saúde base (sem upgrade): rateado ou integral_empresa
 * - Saúde que é upgrade: os 3 modos
 */
export function modosDisponiveisParaBeneficio(
  beneficio: BeneficioCompleto,
): BeneficioModoCusteio[] {
  if (beneficio.tipo === "dental") {
    return ["rateado"];
  }
  if (beneficio.beneficio_base_id) {
    return ["rateado", "integral_empresa", "integral_empresa_com_upgrade"];
  }
  return ["rateado", "integral_empresa"];
}
