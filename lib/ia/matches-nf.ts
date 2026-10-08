/** Helpers puros de match entre CNPJ extraído da NF e as listas que já
 *  vêm no formulário (tomadores e fornecedores do tenant). Spec D6 e D7. */

function soDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function acharEstabelecimentoPorCnpj(
  cnpjDigitos: string,
  tomadores: Array<{ id: string; cnpj: string }>,
): string | null {
  const alvo = soDigitos(cnpjDigitos);
  if (alvo.length !== 14) return null;
  const match = tomadores.find((t) => soDigitos(t.cnpj) === alvo);
  return match ? match.id : null;
}

export function acharFornecedorPorCnpj(
  cnpjDigitos: string,
  fornecedores: Array<{ id: string; cpf_cnpj?: string | null }>,
): string | null {
  const alvo = soDigitos(cnpjDigitos);
  if (alvo.length !== 14) return null;
  const match = fornecedores.find((f) => {
    const d = soDigitos(f.cpf_cnpj);
    return d.length === 14 && d === alvo; // ignora CPF (11 dígitos)
  });
  return match ? match.id : null;
}
