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

/**
 * Onde entram os itens de uma aba sem título de mês, no orçamento de Fee
 * ou Always On (decisão 158): repetidos em todos os meses do orçamento, ou
 * só no primeiro.
 */
export type OpcaoDosMeses = "todos" | "primeiro";

/** A aba sem título de mês, com as leituras de cada opção prontas — a
 *  tela troca de opção sem voltar ao servidor (decisão 158). */
export interface SemBlocoDeMes {
  /** Os meses do orçamento (`YYYY-MM-01`), em ordem. */
  meses: string[];
  /** Os itens repetidos em cada mês. No orçamento de um mês só, é a única
   *  leitura, e não há pergunta. */
  todos: PreviewDaAba;
  /** Os itens só no primeiro mês. `null` no orçamento de um mês só. */
  primeiro: PreviewDaAba | null;
}

export type PreviewResult =
  | {
      ok: true;
      arquivo: { nome: string; tamanho: number };
      /** Todas as abas, na ordem da tabela (decisão 110). */
      abas: AbaResumo[];
      /** A que vem marcada. */
      sugerida: string;
      /** Resumo de cada aba legível, pelo nome. Na aba sem título de mês
       *  de um orçamento de vários meses, é a aba como está (um mês). */
      previews: Record<string, PreviewDaAba>;
      /** As abas sem título de mês no Fee e no Always On (decisão 158),
       *  pelo nome. Vazio nos outros modelos e nas abas com bloco de mês. */
      semBloco: Record<string, SemBlocoDeMes>;
    }
  | { ok: false; message: string };

