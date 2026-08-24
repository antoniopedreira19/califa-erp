/** Grade das planilhas de ORÇAMENTO — 13 colunas.
 *
 *  Compartilhada entre a tabela de itens, o card de Totais da versão e o
 *  card de Totais da visão agregada do projeto. As três precisam das
 *  MESMAS larguras: os Totais repetem as colunas Total (orçado), Total
 *  (planejado), Rentab. e % na mesma posição horizontal dos cards de
 *  grupo acima deles. Sem isso o leitor perde a coluna ao descer a
 *  página.
 *
 *  Sem "use client" de propósito — a tabela de itens é client, os cards
 *  de Totais são server, e todos importam daqui.
 */

/** Larguras fixas do grid. Sem elas cada card mede as colunas pelo próprio
 *  conteúdo — um grupo com item de nome curto desalinha os blocos Orçado /
 *  Planejado / Rentabilidade em relação aos outros grupos e versões.
 *  Em porcentagem, não em px: os cards têm a mesma largura, então a mesma
 *  proporção alinha todos e ainda acompanha o container. */
export function ColunasFixas() {
  return (
    <colgroup>
      {/* Item absorve a sobra (16%); as demais são proporcionais. */}
      <col />
      <col className="w-[4.5%]" />
      <col className="w-[8.5%]" />
      {/* Orçado */}
      <col className="w-[10%]" />
      <col className="w-[3.5%]" />
      <col className="w-[3.5%]" />
      <col className="w-[11%]" />
      {/* Planejado */}
      <col className="w-[10%]" />
      <col className="w-[3.5%]" />
      <col className="w-[3.5%]" />
      <col className="w-[11%]" />
      {/* Rentabilidade — a coluna de R$ é a ÚNICA da planilha que carrega
          sinal negativo, e por isso precisa de um dígito a mais que as
          outras de moeda: "-R$ 117.500,00" a 13px pede ~122px, e os 9,5%
          de antes davam 101px no piso de 1060px. O espaço saiu do "%",
          que nunca passa de "-99,9%". */}
      <col className="w-[11.5%]" />
      <col className="w-[4.5%]" />
    </colgroup>
  );
}

/** Piso para as colunas de moeda não cortarem o valor. Abaixo disso o card
 *  rola na horizontal em vez de espremer as colunas. */
export const LARGURA_MINIMA = "min-w-[1060px]";
