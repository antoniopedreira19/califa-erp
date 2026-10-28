/**
 * Input de um pacote de alocação multi-empresa, como vem do modal/action.
 */
export interface InputPacote {
  itens: Array<{
    empresa_id: string;
    percentual_empresa: number;
    usa_rateio_empresa: boolean;
    regionais: Array<{
      regional_id: string;
      percentual_regional: number;
    }>;
  }>;
}

export type ValidacaoResult =
  | { ok: true }
  | { ok: false; erros: string[] };

/**
 * Valida o input de um pacote de alocação antes de salvar.
 *
 * Regras:
 * 1. Deve haver pelo menos um item (uma empresa).
 * 2. Soma de percentual_empresa deve ser exatamente 100.
 * 3. Se usa_rateio_empresa=true, regionais deve estar vazio.
 * 4. Se usa_rateio_empresa=false, regionais deve ter soma 100.
 * 5. Nenhuma empresa pode aparecer 2x no mesmo pacote.
 *
 * Função pura — sem I/O.
 *
 * @param input pacote a validar
 * @returns { ok: true } ou { ok: false; erros: string[] }
 */
export function validarInputPacote(input: InputPacote): ValidacaoResult {
  const erros: string[] = [];

  // Regra 1: Deve haver pelo menos um item
  if (!input.itens || input.itens.length === 0) {
    erros.push("Pacote deve ter pelo menos uma empresa.");
  }

  if (erros.length > 0) {
    return { ok: false, erros };
  }

  // Regra 2: Soma de percentual_empresa deve ser 100
  const somaEmpresa = input.itens.reduce(
    (acc, item) => acc + item.percentual_empresa,
    0
  );

  // Compara com tolerância de 0.01 (alinhado com SQL trigger >= 0.01)
  if (Math.abs(somaEmpresa - 100) >= 0.01) {
    erros.push(
      `A soma dos percentuais de empresa deve ser 100%. Atual: ${somaEmpresa.toFixed(2)}%.`
    );
  }

  // Regra 5: Verificar duplicação de empresa
  const empresasVistas = new Set<string>();
  for (const item of input.itens) {
    if (empresasVistas.has(item.empresa_id)) {
      erros.push(`Empresa duplicada: ${item.empresa_id}.`);
    }
    empresasVistas.add(item.empresa_id);
  }

  // Validações por item
  for (let i = 0; i < input.itens.length; i++) {
    const item = input.itens[i];

    // Regra 3: Se usa_rateio_empresa=true, regionais deve estar vazio
    if (item.usa_rateio_empresa && item.regionais.length > 0) {
      erros.push(
        `Item ${i + 1}: não pode ter regional quando usar rateio da empresa está ativado.`
      );
    }

    // Regra 4: Se usa_rateio_empresa=false, regionais deve ter soma 100
    if (!item.usa_rateio_empresa) {
      if (item.regionais.length === 0) {
        erros.push(
          `Item ${i + 1}: quando "Usar rateio da empresa" está desativado, deve haver pelo menos uma regional.`
        );
      } else {
        const somaRegional = item.regionais.reduce(
          (acc, reg) => acc + reg.percentual_regional,
          0
        );

        if (Math.abs(somaRegional - 100) >= 0.01) {
          erros.push(
            `Item ${i + 1}: a soma dos percentuais regionais deve ser 100%. Atual: ${somaRegional.toFixed(2)}%.`
          );
        }
      }
    }
  }

  if (erros.length > 0) {
    return { ok: false, erros };
  }

  return { ok: true };
}
