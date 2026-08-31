/** Grade da visão agregada de JOBS do projeto — 15 colunas.
 *
 *  Compartilhada entre a planilha consolidada (um bloco por job) e o card
 *  de Totais embaixo dela. As duas precisam das MESMAS larguras: os
 *  Totais repetem as colunas Total de Orçado, Planejado e Realizado na
 *  mesma posição horizontal dos blocos de job acima. Sem isso a coluna
 *  "anda" quando o leitor desce a página — que era exatamente o defeito
 *  desta tela antes.
 *
 *  Sem "use client" de propósito — a planilha é client, o card de Totais
 *  é server, e ambos importam daqui.
 */
export function ColunasJobsProjeto({ save = false }: { save?: boolean } = {}) {
  return (
    <colgroup>
      {/* Save é a calha de estado do crédito entre jobs, à ESQUERDA.
          `3.5 + 13.5 = 17`, de propósito e pelo mesmo motivo da
          `grade-job`: o card de Totais NÃO tem coluna de Save e abre com
          um Agrupamento de 17%, então as duas tabelas só caem no mesmo
          eixo se Save + Agrupamento aqui somarem exatamente aquilo. O
          `min-width` é compartilhado pelas duas e não pode divergir. */}
      {save && <col className="w-[3.5%]" />}
      {/* Agrupamento · item absorve a sobra; as demais são proporcionais. */}
      <col className={save ? "w-[13.5%]" : "w-[17%]"} />
      <col className="w-[4%]" />
      <col className="w-[8%]" />
      {/* Orçado */}
      <col className="w-[7.5%]" />
      <col className="w-[3%]" />
      <col className="w-[3%]" />
      <col className="w-[8.5%]" />
      {/* Planejado */}
      <col className="w-[7.5%]" />
      <col className="w-[3%]" />
      <col className="w-[3%]" />
      <col className="w-[8.5%]" />
      {/* Realizado */}
      <col className="w-[7.5%]" />
      <col className="w-[3%]" />
      <col className="w-[3%]" />
      <col className="w-[8.5%]" />
    </colgroup>
  );
}

/** Piso para as colunas de moeda não cortarem o valor. Abaixo disso o
 *  card rola na horizontal em vez de espremer as colunas. */
export const LARGURA_MINIMA_JOBS_PROJETO = "min-w-[1320px]";

/** Quantas colunas a tabela tem — para o `colSpan` das linhas cheias
 *  (estado vazio, faixas de erro). */
export function totalDeColunasJobsProjeto(save = false): number {
  return save ? 16 : 15;
}

/** Quantas colunas o rótulo à esquerda ocupa antes do primeiro bloco. */
export function colunasDoRotuloJobsProjeto(save = false): number {
  return save ? 4 : 3;
}
