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
export function ColunasJobsProjeto() {
  return (
    <colgroup>
      {/* Agrupamento · item absorve a sobra; as demais são proporcionais. */}
      <col className="w-[17%]" />
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
