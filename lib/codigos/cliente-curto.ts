/**
 * O código curto do cliente — a sigla de 3 letras que vira o prefixo dos
 * códigos de projeto (`AMB-0001/26`).
 *
 * Regra definida pelo Tiago em 18/09/2026, depois de olhar a base: dos 160
 * clientes cadastrados, **151 já usavam 3 letras** e só 5 batiam com a
 * sugestão antiga (6 primeiras letras do nome). A sugestão passou a ser o
 * que a agência de fato escreve.
 *
 * O desempate é **a próxima letra DO NOME na última posição** — não a do
 * alfabeto, e não um número. Assim a sigla continua sendo uma abreviação
 * do cliente, e não um contador: quem lê `BRD` reconhece o BRADESCO.
 *
 *   BRADESCO EST UNIF     → BRA
 *   BRADESCO AG SALVADOR  → BRD   (BRA ocupado; a 4ª letra do nome)
 *   BRAINVEST ASSESSORIA  → BRI   (BRA ocupado; a 4ª letra DESTE nome)
 */

/** Só letras, sem acento, maiúsculas — a base de onde a sigla sai. */
export function letrasDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

/** O tamanho da sigla. Nome com menos letras que isso vira o que tem —
 *  "C&A" é CA, e não CAX: inventar letra que o nome não tem confunde. */
export const TAMANHO_CODIGO = 3;

/**
 * Os candidatos a código, na ordem em que devem ser tentados: primeiro a
 * sigla do nome; depois ela com a última posição percorrendo o **resto
 * das letras do nome**; e, se o nome acabar, com um dígito no fim.
 *
 *   PEVETECH → PEV, PEE, PET, PEC, PEH, PEV2, PEV3…
 *
 * Nome sem letra nenhuma ("37.699.074") devolve lista vazia — quem chama
 * decide o que fazer, porque aqui não há o que inventar.
 */
export function candidatosDeCodigo(nome: string): string[] {
  const letras = letrasDoNome(nome);
  if (letras === "") return [];

  const base = letras.slice(0, TAMANHO_CODIGO);
  const fora: string[] = [base];

  // O desempate troca só a ÚLTIMA posição, e o que entra nela são as
  // letras seguintes do próprio nome, na ordem em que aparecem. Nome
  // curto demais ("C&A" → CA) não tem resto para percorrer e vai direto
  // ao dígito — "CB" seria outro nome, não uma abreviação deste.
  if (base.length === TAMANHO_CODIGO) {
    const prefixo = base.slice(0, TAMANHO_CODIGO - 1);
    for (const letra of letras.slice(TAMANHO_CODIGO)) {
      const candidato = prefixo + letra;
      if (!fora.includes(candidato)) fora.push(candidato);
    }
  }

  for (let d = 2; d <= 9; d++) fora.push(`${base}${d}`);

  return fora;
}

/**
 * O primeiro candidato que ninguém está usando. `ocupados` chega do banco,
 * e a comparação ignora maiúscula porque o índice único também ignora.
 */
export function proximoCodigoLivre(
  nome: string,
  ocupados: Iterable<string>,
): string {
  const tomados = new Set(
    Array.from(ocupados, (c) => c.trim().toUpperCase()),
  );
  const candidatos = candidatosDeCodigo(nome);
  for (const c of candidatos) {
    if (!tomados.has(c)) return c;
  }
  // Nome sem letras, ou 34 candidatos ocupados: devolve o que der, e o
  // índice único é quem recusa. Melhor um código feio que um vazio.
  return candidatos[0] ?? "";
}
