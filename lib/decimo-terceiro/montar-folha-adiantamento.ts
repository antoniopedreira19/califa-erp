export type AdiantamentoDestino = "ambos" | "clt" | "pj";

export type AdiantamentoParaMontar = {
  adiantamento_id: string;
  colaborador_id: string;
  tipo_contratacao: "clt" | "clt_recibo" | "pj" | "mei";
  valor: number;
  /** Salário total vigente — obrigatório pra híbrido (clt_recibo) com
   *  destino 'ambos'. Ignorado se destino='clt'/'pj' (sem split) ou se
   *  tipo não híbrido. */
  salario?: number;
  /** Parte PJ (recibo) do salário — obrigatório pra híbrido com
   *  destino 'ambos'. 0 = sem parte PJ, vira CLT puro. Ignorado se
   *  destino='clt'/'pj'. */
  valor_recibo?: number;
  /** Apenas relevante pro híbrido (clt_recibo). Default 'ambos'.
   *  - 'ambos' = split proporcional (comportamento legado)
   *  - 'clt'   = valor inteiro na folha CLT ('contabilidade')
   *  - 'pj'    = valor inteiro na folha PJ ('california') */
  destino?: AdiantamentoDestino;
};

export type FolhaAdiantamentoMontada = {
  decimo_terceiro_adiantamento_id: string;
  colaborador_id: string;
  tipo: "decimo_terceiro_adiantamento";
  origem: "california" | "contabilidade";
  salario_base: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Monta as folhas de pagamento pra um adiantamento de 13º.
 *
 * - PJ/MEI: 1 folha "california" (destino é ignorado).
 * - CLT puro: 1 folha "contabilidade" (destino é ignorado).
 * - Híbrido (clt_recibo):
 *     - destino='ambos' (default) → split proporcional entre CLT e PJ:
 *         parte CLT = round2(valor × (salario − valor_recibo) / salario) → "contabilidade"
 *         parte PJ  = valor − parte CLT                                  → "california"
 *       Se valor_recibo = 0, vira 1 folha CLT só.
 *     - destino='clt' → 1 folha "contabilidade" com o valor inteiro.
 *     - destino='pj'  → 1 folha "california" com o valor inteiro.
 */
export function montarFolhasAdiantamento(
  adiantamento: AdiantamentoParaMontar,
): FolhaAdiantamentoMontada[] {
  if (adiantamento.valor <= 0) {
    throw new Error("Valor deve ser maior que 0");
  }

  const { adiantamento_id, colaborador_id, tipo_contratacao, valor } = adiantamento;
  const destino: AdiantamentoDestino = adiantamento.destino ?? "ambos";
  const base = {
    decimo_terceiro_adiantamento_id: adiantamento_id,
    colaborador_id,
    tipo: "decimo_terceiro_adiantamento" as const,
  };

  if (tipo_contratacao === "pj" || tipo_contratacao === "mei") {
    return [{ ...base, origem: "california", salario_base: valor }];
  }
  if (tipo_contratacao === "clt") {
    return [{ ...base, origem: "contabilidade", salario_base: valor }];
  }

  // Híbrido (clt_recibo)
  // Destinos específicos: sem split, vai tudo pra uma folha só.
  if (destino === "clt") {
    return [{ ...base, origem: "contabilidade", salario_base: valor }];
  }
  if (destino === "pj") {
    return [{ ...base, origem: "california", salario_base: valor }];
  }

  // destino='ambos' → split proporcional
  if (adiantamento.salario == null || adiantamento.valor_recibo == null) {
    throw new Error(
      "Híbrido (clt_recibo) com destino 'ambos' requer salario e valor_recibo pra split.",
    );
  }
  const salario = adiantamento.salario;
  const valorRecibo = adiantamento.valor_recibo;
  if (salario <= 0) {
    throw new Error("Salário deve ser maior que 0 pra calcular o split.");
  }
  if (valorRecibo < 0 || valorRecibo > salario) {
    throw new Error("valor_recibo deve estar entre 0 e o salário total.");
  }

  // Sem parte PJ → CLT puro
  if (valorRecibo === 0) {
    return [{ ...base, origem: "contabilidade", salario_base: valor }];
  }

  const parteCltValor = round2((valor * (salario - valorRecibo)) / salario);
  const partePjValor = round2(valor - parteCltValor);

  const folhas: FolhaAdiantamentoMontada[] = [];
  if (parteCltValor > 0) {
    folhas.push({
      ...base,
      origem: "contabilidade",
      salario_base: parteCltValor,
    });
  }
  if (partePjValor > 0) {
    folhas.push({ ...base, origem: "california", salario_base: partePjValor });
  }
  return folhas;
}
