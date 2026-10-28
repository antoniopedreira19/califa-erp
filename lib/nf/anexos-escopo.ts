/**
 * Helper puro: mapeia NfAnexoEscopo para a tabela FK correspondente.
 * Não importa nada do Supabase/Next — pode ser usado em client e server.
 * Spec: docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md
 */

export type NfAnexoEscopo =
  | "folha_mensal"
  | "ferias_usufruto"
  | "ferias_abono"
  | "decimo_terceiro_p1"
  | "decimo_terceiro_p2"
  | "decimo_terceiro_adiantamento";

/** Retorna a tabela e coluna PK onde escopo_id deve existir. */
export function escopoParaFkTabela(escopo: NfAnexoEscopo): {
  tabela: string;
  coluna: string;
} {
  switch (escopo) {
    case "folha_mensal":
      return { tabela: "folhas_pagamento", coluna: "id" };
    case "ferias_usufruto":
    case "ferias_abono":
      return { tabela: "colaboradores_ferias_lancamentos", coluna: "id" };
    case "decimo_terceiro_p1":
    case "decimo_terceiro_p2":
      return { tabela: "decimo_terceiro_linhas", coluna: "id" };
    case "decimo_terceiro_adiantamento":
      return { tabela: "decimo_terceiro_adiantamentos", coluna: "id" };
  }
}
