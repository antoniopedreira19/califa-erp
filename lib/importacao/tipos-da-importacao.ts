/**
 * O que a leitura de um arquivo de planilha devolve à tela (decisão 110):
 * a tabela de abas e o resumo de cada aba legível. Neutro de servidor e de
 * cliente — a importação da versão e a do editor do orçamento usam a mesma
 * tela.
 */

import type { ImportacaoWarning } from "@/lib/types";
import type { AbaResumo } from "./abas-do-arquivo";

export type { AbaResumo };

/** O resumo de uma aba legível, como a tela mostra. */
export interface PreviewDaAba {
  aba: string;
  grupos: {
    nome: string;
    ordem: number;
    itens_count: number;
    total_bruto: number;
    total_planejado: number;
    /** Planejado do grupo se a versão herdar o da anterior. */
    total_planejado_herdado: number;
  }[];
  /** A pergunta "planejado da versão anterior ou da planilha". */
  planejado: {
    /** Número da versão de onde o planejado pode vir. `null` sem
     *  versão anterior — a pergunta não aparece e vale a planilha. */
    versao_anterior: number | null;
    casadas: number;
    por_descricao: number;
    total_itens: number;
    planilha_tem_planejado: boolean;
  };
  /** Os 40 primeiros avisos, ajustes antes das linhas ignoradas. */
  warnings: ImportacaoWarning[];
  avisos_total: { ajustes: number; ignoradas: number };
  /** % que a planilha traz. Não é o que vai ser aplicado — serve para
   *  avisar quem importou quando difere do cadastro do cliente. */
  percentual_honorarios: number | null;
  /** % que a versão vai receber de fato: o do cadastro do cliente. */
  percentual_honorarios_cliente: number;
  cliente_nome: string;
  linhas_lidas: number;
  linhas_importadas: number;
  linhas_ignoradas: number;
}

export type PreviewResult =
  | {
      ok: true;
      arquivo: { nome: string; tamanho: number };
      /** Todas as abas, na ordem da tabela (decisão 110). */
      abas: AbaResumo[];
      /** A que vem marcada. */
      sugerida: string;
      /** Resumo de cada aba legível, pelo nome. */
      previews: Record<string, PreviewDaAba>;
    }
  | { ok: false; message: string };

