/**
 * Resolve o escopo de NF a partir dos campos da folha de pagamento.
 *
 * Função pura — sem I/O, sem dependências de Supabase ou Next.js.
 * Pode ser importada em testes Node.js diretamente.
 *
 * Spec: docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md
 */

import type { NfAnexoEscopo } from "@/lib/nf/anexos-escopo";

/** Subconjunto mínimo da linha de folha necessário para a resolução. */
export interface FolhaParaEscopo {
  id: string;
  tipo: "salario" | "ferias" | "decimo_terceiro_1a_parcela" | "decimo_terceiro_2a_parcela";
  tipo_folha_ferias: "usufruto" | "abono" | null;
  lancamento_ferias_id: string | null;
}

/** Resultado da resolução. */
export interface EscopoDaFolha {
  escopo_tipo: NfAnexoEscopo;
  escopo_id: string;
}

/**
 * Resolve o escopo de NF a partir dos campos da folha.
 *
 * Retorna null nos casos em que a trava de NF ainda não se aplica:
 * - 13° salário (stub — será implementado em fase futura)
 * - Férias sem lancamento_ferias_id
 *
 * O chamador deve tratar null como "stub sem trava".
 */
export function resolverEscopoDaFolha(
  folha: FolhaParaEscopo,
): EscopoDaFolha | null {
  switch (folha.tipo) {
    case "salario":
      return { escopo_tipo: "folha_mensal", escopo_id: folha.id };

    case "ferias": {
      if (!folha.lancamento_ferias_id) return null;
      if (folha.tipo_folha_ferias === "usufruto") {
        return { escopo_tipo: "ferias_usufruto", escopo_id: folha.lancamento_ferias_id };
      }
      if (folha.tipo_folha_ferias === "abono") {
        return { escopo_tipo: "ferias_abono", escopo_id: folha.lancamento_ferias_id };
      }
      return null;
    }

    case "decimo_terceiro_1a_parcela":
    case "decimo_terceiro_2a_parcela":
      // Stub: 13° não trava por NF ainda. Implementar quando 13° tiver escopo próprio.
      return null;
  }
}
