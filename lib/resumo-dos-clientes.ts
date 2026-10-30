// Sem import de servidor: usado também no combo da abertura, que é
// componente de cliente.

/**
 * "Endemol", "Endemol e Sony", "Endemol, Sony e mais 7" — os clientes de
 * um projeto numa linha só, para o combo e para a visão do projeto.
 */
export function resumoDosClientes(nomes: (string | null)[]): string {
  const lista = nomes.map((n) => n ?? "—");
  if (lista.length === 0) return "—";
  if (lista.length === 1) return lista[0];
  if (lista.length === 2) return `${lista[0]} e ${lista[1]}`;
  return `${lista[0]}, ${lista[1]} e mais ${lista.length - 2}`;
}
