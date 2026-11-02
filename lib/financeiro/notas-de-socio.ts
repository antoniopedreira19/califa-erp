/**
 * As notas de sócio (decisão 231): a nota paga à empresa e repassada aos sócios,
 * no Tipo 15. Entrada e saída ficam no mesmo subtipo, sem rateio: a regional é
 * TD, como na planilha. O banco guarda a mesma regra em `_eh_notas_de_socio`.
 */

export const TIPO_DISTRIBUICAO_DE_LUCRO = "15";
export const SUBTIPO_NOTAS_DE_SOCIO = "001";
export const DESCRICAO_DAS_NOTAS = "Notas de sócio";
/** A regional das notas nas listas: sem rateio, é TD. */
export const REGIONAL_DAS_NOTAS = "TD";

/** Pelos códigos, para quem lê o lançamento já com o plano embutido. */
export const ehCentroDasNotas = (tipoCodigo: string | null | undefined, subtipoCodigo: string | null | undefined) =>
  tipoCodigo === TIPO_DISTRIBUICAO_DE_LUCRO && subtipoCodigo === SUBTIPO_NOTAS_DE_SOCIO;

type TipoDoPlano = { id: string; codigo: string };
type SubtipoDoPlano = { id: string; tipo_id: string; codigo: string };

/** O centro das notas de sócio, ou `null` se o plano não o tiver. */
export function centroDasNotasDeSocio(
  tipos: readonly TipoDoPlano[],
  subtipos: readonly SubtipoDoPlano[],
): { tipoId: string; subtipoId: string } | null {
  const tipo = tipos.find((t) => t.codigo === TIPO_DISTRIBUICAO_DE_LUCRO);
  const subtipo = tipo && subtipos.find((s) => s.tipo_id === tipo.id && s.codigo === SUBTIPO_NOTAS_DE_SOCIO);
  return tipo && subtipo ? { tipoId: tipo.id, subtipoId: subtipo.id } : null;
}

export function ehNotasDeSocio(
  tipos: readonly TipoDoPlano[],
  subtipos: readonly SubtipoDoPlano[],
  subtipoId: string | null | undefined,
): boolean {
  return !!subtipoId && centroDasNotasDeSocio(tipos, subtipos)?.subtipoId === subtipoId;
}
