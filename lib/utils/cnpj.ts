/** Remove todos os caracteres não-numéricos de um CNPJ. */
export function apenasDigitosCnpj(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * Valida o CNPJ pelos dois dígitos verificadores.
 * Recebe a string já limpa (14 dígitos) ou formatada (será limpa internamente).
 */
export function cnpjValido(cnpj: string): boolean {
  const c = apenasDigitosCnpj(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  // Cálculo dos 2 dígitos verificadores
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}
