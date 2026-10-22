import type { AppRole } from "@/lib/types";

/** Valores monetários já são de centavos; a folga evita ruído binário. */
export function acimaDoOrcado(custo: number, orcado: number): boolean {
  return custo - orcado > 0.005;
}

/** Resultado geral é percentual sobre o valor do job, antes de formatar. */
export function rentabilidadeAbaixoDoMinimo(resultadoGeral: number | null): boolean {
  return resultadoGeral !== null && resultadoGeral < 20 - 1e-9;
}

export function bloqueioAprovacaoPorLimites(
  papel: AppRole,
  temItemAcimaDoOrcado: boolean,
  resultadoGeral: number | null,
): string | null {
  if (papel === "administrador") return null;
  const motivos: string[] = [];
  if (temItemAcimaDoOrcado) motivos.push("há item com planejado acima do orçado");
  if (rentabilidadeAbaixoDoMinimo(resultadoGeral)) motivos.push("o resultado geral está abaixo de 20%");
  return motivos.length
    ? `Só o administrador pode aprovar esta versão: ${motivos.join(" e ")}. Peça a aprovação ao administrador.`
    : null;
}

export function bloqueioGeracaoPPPorLimite(
  papel: AppRole,
  realizado: number,
  orcado: number,
): string | null {
  return papel !== "administrador" && acimaDoOrcado(realizado, orcado)
    ? "Só o administrador pode gerar ou editar esta PP: o realizado acumulado do item ultrapassa o orçado. Salve a PP a emitir e peça a revisão ao administrador."
    : null;
}
