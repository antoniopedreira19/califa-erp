/** Helpers puros de validação dos campos extraídos da NF. Falhou? vira
 *  null — nunca inventa, nunca aceita algo duvidoso. Spec D5. */

/** Dígitos verificadores do CNPJ pelo módulo 11. Retorna 14 dígitos
 *  limpos se válido, senão null. */
export function validarCnpj(bruto: string | null): string | null {
  if (!bruto) return null;
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length !== 14) return null;
  // 00000000000000, 11111111111111, etc.
  if (/^(\d)\1{13}$/.test(digitos)) return null;

  const calcularDV = (base: string, pesos: number[]): number => {
    const soma = base.split("").reduce((s, d, i) => s + Number(d) * pesos[i]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const base = digitos.slice(0, 12);
  const dv1 = calcularDV(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = calcularDV(base + dv1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== Number(digitos[12]) || dv2 !== Number(digitos[13])) return null;
  return digitos;
}

/** Data ISO entre 2015-01-01 e `hojeIso` (inclusive, ambos). */
export function validarDataEmissao(iso: string | null, hojeIso: string): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  // Rejeita algo tipo "2026-13-01" que `new Date` deixaria rolar como 2027-01-01.
  if (d.toISOString().slice(0, 10) !== iso) return null;
  if (iso < "2015-01-01" || iso > hojeIso) return null;
  return iso;
}

export function validarValor(bruto: number | null): number | null {
  if (bruto === null) return null;
  if (typeof bruto !== "number" || !Number.isFinite(bruto)) return null;
  if (bruto <= 0 || bruto >= 10_000_000) return null;
  return bruto;
}

export function validarNumeroNF(bruto: string | null): string | null {
  if (!bruto) return null;
  const t = bruto.trim();
  return t === "" ? null : t;
}

export function validarDescricao(bruto: string | null): string | null {
  if (!bruto) return null;
  const t = bruto.trim();
  if (t === "") return null;
  return t.length > 500 ? t.slice(0, 500) : t;
}
