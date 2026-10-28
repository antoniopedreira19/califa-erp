export type AdiantamentoParaMontar = {
  adiantamento_id: string;
  colaborador_id: string;
  tipo_contratacao: "clt" | "clt_recibo" | "pj" | "mei";
  valor: number;
};

export type FolhaAdiantamentoMontada = {
  decimo_terceiro_adiantamento_id: string;
  colaborador_id: string;
  tipo: "decimo_terceiro_adiantamento";
  origem: "california" | "contabilidade";
  salario_base: number;
};

export function montarFolhaAdiantamento(
  adiantamento: AdiantamentoParaMontar
): FolhaAdiantamentoMontada {
  // Defensive: throw if valor is not positive
  if (adiantamento.valor <= 0) {
    throw new Error("Valor deve ser maior que 0");
  }

  // Determine origin based on tipo_contratacao
  const origem =
    adiantamento.tipo_contratacao === "clt" ? "contabilidade" : "california";

  return {
    decimo_terceiro_adiantamento_id: adiantamento.adiantamento_id,
    colaborador_id: adiantamento.colaborador_id,
    tipo: "decimo_terceiro_adiantamento",
    origem,
    salario_base: adiantamento.valor,
  };
}
