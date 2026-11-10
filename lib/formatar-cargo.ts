// Normaliza cargo pra display: se veio tudo em minuscula (entrada manual antiga,
// ex.: "produtor musical"), aplica Title Case com preposicoes pt-BR em minuscula
// ("Produtor Musical", "Diretor de Conteudo"). Se ja veio com alguma letra
// maiuscula, passa reto — preserva acronyms ("CEO", "RH", "3D", "BI"), compostos
// ("DA/Motion"), e tudo o resto do catalogo que ja esta padronizado. Idempotente.

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

export function formatarCargo(nome: string | null | undefined): string {
  if (!nome) return "";
  const limpo = nome.trim();
  if (!limpo) return "";
  // So reformata quando a string nao tem nenhuma letra maiuscula.
  if (/\p{Lu}/u.test(limpo)) return limpo;
  return limpo
    .split(/\s+/)
    .map((palavra, idx) => {
      const lower = palavra.toLowerCase();
      if (idx > 0 && MINUSCULAS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
