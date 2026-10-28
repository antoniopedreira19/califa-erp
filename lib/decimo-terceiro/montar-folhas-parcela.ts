export type ParcelaNumero = 1 | 2;

export type LinhaParaMontar = {
  decimo_terceiro_linha_id: string;
  colaborador_id: string;
  tipo_contratacao: "clt" | "clt_recibo" | "pj" | "mei";
  primeira_parcela: number;
  segunda_parcela: number;
  parte_pj_primeira_parcela: number | null;
  parte_pj_segunda_parcela: number | null;
  parte_clt_primeira_parcela: number | null;
  parte_clt_segunda_parcela: number | null;
};

export type FolhaMontada = {
  decimo_terceiro_linha_id: string;
  colaborador_id: string;
  tipo: "decimo_terceiro_1a_parcela" | "decimo_terceiro_2a_parcela";
  origem: "california" | "contabilidade";
  salario_base: number;
};

export function montarFolhasParcela(
  linha: LinhaParaMontar,
  parcela: ParcelaNumero
): FolhaMontada[] {
  // Determine the main value for the requested parcel
  const valorPrincipal =
    parcela === 1 ? linha.primeira_parcela : linha.segunda_parcela;

  // If main value is 0 or negative, return empty list
  if (valorPrincipal <= 0) {
    return [];
  }

  const tipo =
    parcela === 1
      ? ("decimo_terceiro_1a_parcela" as const)
      : ("decimo_terceiro_2a_parcela" as const);

  const resultado: FolhaMontada[] = [];

  // Handle pure types and hybrid
  if (linha.tipo_contratacao === "pj" || linha.tipo_contratacao === "mei") {
    // Pure PJ or MEI: single california line with full value
    resultado.push({
      decimo_terceiro_linha_id: linha.decimo_terceiro_linha_id,
      colaborador_id: linha.colaborador_id,
      tipo,
      origem: "california",
      salario_base: valorPrincipal,
    });
  } else if (linha.tipo_contratacao === "clt") {
    // Pure CLT: single contabilidade line with full value
    resultado.push({
      decimo_terceiro_linha_id: linha.decimo_terceiro_linha_id,
      colaborador_id: linha.colaborador_id,
      tipo,
      origem: "contabilidade",
      salario_base: valorPrincipal,
    });
  } else if (linha.tipo_contratacao === "clt_recibo") {
    // Hybrid: use part_pj and part_clt for this parcel
    const partePj =
      parcela === 1
        ? linha.parte_pj_primeira_parcela
        : linha.parte_pj_segunda_parcela;
    const parteClt =
      parcela === 1
        ? linha.parte_clt_primeira_parcela
        : linha.parte_clt_segunda_parcela;

    // Add california line if part_pj is not null and > 0
    if (partePj !== null && partePj > 0) {
      resultado.push({
        decimo_terceiro_linha_id: linha.decimo_terceiro_linha_id,
        colaborador_id: linha.colaborador_id,
        tipo,
        origem: "california",
        salario_base: partePj,
      });
    }

    // Add contabilidade line if part_clt is not null and > 0
    if (parteClt !== null && parteClt > 0) {
      resultado.push({
        decimo_terceiro_linha_id: linha.decimo_terceiro_linha_id,
        colaborador_id: linha.colaborador_id,
        tipo,
        origem: "contabilidade",
        salario_base: parteClt,
      });
    }
  }

  return resultado;
}
