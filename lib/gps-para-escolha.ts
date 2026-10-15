import type { ComboboxItem } from "@/components/ui/combobox";

/**
 * A lista do campo "GP Responsável" do orçamento — Novo orçamento, editor,
 * agregada e envio para abertura (decisão 175, que revisa a regra 3 da
 * 170).
 *
 * Até 15/10/2026 a lista tinha só os GPs Responsáveis do projeto. Agora tem
 * todo membro ativo que pode ser GP (papel GP ou Administrador, decisão
 * 170): os do projeto primeiro, e os outros depois. Quem vem de fora passa
 * a ser GP Responsável do projeto quando o orçamento é salvo
 * (`incluir_gp_no_projeto`) — a mesma regra da troca do GP do job aberto.
 */
export interface GpParaEscolha {
  id: string;
  nome: string;
  /** Já é GP Responsável do projeto. */
  doProjeto: boolean;
}

export const GRUPO_GPS_DO_PROJETO = "GPs do projeto";
export const GRUPO_OUTROS_GPS = "Outros GPs";

/** Os itens do combobox: os do projeto primeiro, cada lado por nome. O
 *  rótulo do grupo só aparece quando há gente dos dois lados. */
export function itensDeGp(gps: readonly GpParaEscolha[]): ComboboxItem[] {
  const porNome = (a: GpParaEscolha, b: GpParaEscolha) =>
    a.nome.localeCompare(b.nome, "pt-BR");
  const doProjeto = gps.filter((g) => g.doProjeto).sort(porNome);
  const outros = gps.filter((g) => !g.doProjeto).sort(porNome);
  const comGrupo = doProjeto.length > 0 && outros.length > 0;
  return [
    ...doProjeto.map((g) => ({
      value: g.id,
      label: g.nome,
      ...(comGrupo ? { grupo: GRUPO_GPS_DO_PROJETO } : {}),
    })),
    ...outros.map((g) => ({
      value: g.id,
      label: g.nome,
      ...(comGrupo ? { grupo: GRUPO_OUTROS_GPS } : {}),
    })),
  ];
}

/** O GP escolhido quando ele ainda não é do projeto — para o aviso de que
 *  ele entra ao salvar. */
export function gpDeFora(
  gps: readonly GpParaEscolha[],
  id: string | null | undefined,
): GpParaEscolha | null {
  if (!id) return null;
  const gp = gps.find((g) => g.id === id);
  return gp && !gp.doProjeto ? gp : null;
}

/** Junta as duas listas do banco: os GPs do projeto (`gps_do_projeto`) e
 *  todos os que podem ser GP (`gps_ativos_do_tenant`). */
export function montarGpsParaEscolha(
  doProjeto: ReadonlyArray<{ id: string; nome: string }>,
  ativos: ReadonlyArray<{ id: string; nome: string }>,
): GpParaEscolha[] {
  const ids = new Set(doProjeto.map((g) => g.id));
  return [
    ...doProjeto.map((g) => ({ id: g.id, nome: g.nome, doProjeto: true })),
    ...ativos
      .filter((g) => !ids.has(g.id))
      .map((g) => ({ id: g.id, nome: g.nome, doProjeto: false })),
  ];
}
