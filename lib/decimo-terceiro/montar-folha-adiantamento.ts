export type AdiantamentoParaMontar = {
  adiantamento_id: string;
  colaborador_id: string;
  tipo_contratacao: "clt" | "clt_recibo" | "pj" | "mei";
  valor: number;
  /** Salário total vigente — obrigatório pra híbrido (clt_recibo), ignorado nos demais tipos. */
  salario?: number;
  /** Parte PJ (recibo) do salário — obrigatório pra híbrido. 0 = sem parte PJ, vira CLT puro. */
  valor_recibo?: number;
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
 * - PJ/MEI: 1 folha "california".
 * - CLT puro: 1 folha "contabilidade".
 * - Híbrido (clt_recibo): até 2 folhas, com valor proporcional ao salário:
 *     parte CLT  = round2(valor × (salario − valor_recibo) / salario) → "contabilidade"
 *     parte PJ   = valor − parte CLT                                   → "california"
 *   Se valor_recibo = 0, vira 1 folha CLT só.
 */
export function montarFolhasAdiantamento(
  adiantamento: AdiantamentoParaMontar,
): FolhaAdiantamentoMontada[] {
  if (adiantamento.valor <= 0) {
    throw new Error("Valor deve ser maior que 0");
  }

  const { adiantamento_id, colaborador_id, tipo_contratacao, valor } = adiantamento;
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
  if (adiantamento.salario == null || adiantamento.valor_recibo == null) {
    throw new Error(
      "Híbrido (clt_recibo) requer salario e valor_recibo pra split.",
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
