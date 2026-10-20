/**
 * Constantes do form de cadastro de freelancer (portadas do RH antigo).
 * Mantidas isoladas em `lib/freelancers/` pra ficar claro o escopo e evitar
 * poluir `lib/types.ts` com arrays de UI.
 */

export const CIDADES = [
  "Anápolis",
  "Aracaju",
  "Belém",
  "Belo Horizonte",
  "Boa Vista",
  "Brasília",
  "Campinas",
  "Campo Grande",
  "Contagem",
  "Cuiabá",
  "Curitiba",
  "Feira de Santana",
  "Florianópolis",
  "Fortaleza",
  "Goiânia",
  "Guarulhos",
  "João Pessoa",
  "Joinville",
  "Juiz de Fora",
  "Londrina",
  "Macapá",
  "Maceió",
  "Manaus",
  "Maringá",
  "Natal",
  "Niterói",
  "Osasco",
  "Palmas",
  "Porto Alegre",
  "Porto Velho",
  "Recife",
  "Ribeirão Preto",
  "Rio Branco",
  "Rio de Janeiro",
  "Salvador",
  "Santo André",
  "Santos",
  "São Gonçalo",
  "São José dos Campos",
  "São Luís",
  "São Paulo",
  "Sorocaba",
  "Teresina",
  "Uberlândia",
  "Vitória",
] as const;

export const COR_RACA = [
  "Amarela",
  "Branca",
  "Parda",
  "Indígena",
  "Preta",
  "Prefiro não informar",
  "Outro",
] as const;

export const IDENTIDADE_GENERO = [
  "Mulher Cisgênero",
  "Mulher Transgênero",
  "Homem Cisgênero",
  "Homem Transgênero",
  "Pessoa não-binária",
  "Pessoa gênero-fluído",
  "Queer",
  "Prefiro não informar",
  "Outro",
] as const;

export const DEFICIENCIA = [
  "Não tenho",
  "Visual",
  "Auditiva",
  "Intelectual",
  "Neuropatia",
  "Prefiro não informar",
  "Outro",
] as const;

/** Resolve "Outro" → texto livre quando aplicável. */
export function resolveOutro(valor: string, outro: string): string {
  return valor === "Outro" && outro.trim() ? outro.trim() : valor;
}
