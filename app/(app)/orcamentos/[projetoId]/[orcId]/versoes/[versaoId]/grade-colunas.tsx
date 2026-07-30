/** Grade compartilhada entre a tabela de itens e o card de Totais.
 *
 *  As duas tabelas precisam das MESMAS larguras: o card de Totais repete
 *  as colunas Total (orçado), Total (planejado), Rentab. e % na mesma
 *  posição horizontal dos cards de grupo acima dele. Sem isso o leitor
 *  perde a coluna ao descer a página.
 *
 *  Sem "use client" de propósito — a tabela de itens é client, o card de
 *  Totais é server, e ambos importam daqui.
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
      {/* Rentabilidade */}
      <col className="w-[9.5%]" />
      <col className="w-[5.5%]" />
    </colgroup>
  );
}

/** Piso para as colunas de moeda não cortarem o valor. Abaixo disso o card
 *  rola na horizontal em vez de espremer as colunas. */
export const LARGURA_MINIMA = "min-w-[1060px]";
