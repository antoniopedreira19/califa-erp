/** Grade das planilhas de ORÇAMENTO — 13 colunas, 14 com a de Save.
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
export function ColunasFixas({ save = false }: { save?: boolean } = {}) {
  return (
    <colgroup>
      {/* Save é a calha de estado do crédito entre jobs, à ESQUERDA de
          tudo — do lado oposto ao da calha de BV e PP, que é absoluta e
          vive fora do frame. Estreita: ela guarda um botão de 18px ou um
          código de job em 9px, nada mais. Some quando desligada, e o Item
          reabsorve a largura. */}
      {save && <col className="w-[4%]" />}
      {/* Item absorve a sobra (16%, ou 12% com a coluna de Save); as
          demais são proporcionais. */}
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

/** O mesmo piso com a coluna de Save aberta: os 4% dela em cima de 1060px
 *  dão ~44px, e sem isso as colunas de moeda voltam a espremer. */
export const LARGURA_MINIMA_SAVE = "min-w-[1104px]";

/** Quantas colunas a grade tem — o número que os `colSpan` de linha
 *  inteira precisam. Constante em vez de literal porque ele muda com a
 *  coluna de Save, e um `colSpan` desatualizado desalinha a tabela
 *  inteira sem erro de compilação. */
export function totalDeColunas(save = false): number {
  return save ? 14 : 13;
}

/** Quantas colunas o rótulo à esquerda ocupa: Item, Tipo e Categoria,
 *  mais a de Save quando ela está aberta. É o `colSpan` do nome do
 *  agrupamento e o do rótulo de subtotal. */
export function colunasDoRotulo(save = false): number {
  return save ? 4 : 3;
}
