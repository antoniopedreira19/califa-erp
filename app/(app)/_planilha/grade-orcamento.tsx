/** Grade das planilhas de ORÇAMENTO — 13 colunas, 14 com a de Save.
 *
 *  Compartilhada entre a tabela de itens, o card de Totais da versão e o
 *  card de Totais da visão agregada do projeto. As três precisam das
 *  MESMAS larguras: os Totais repetem as colunas Total (orçado), Total
 *  (planejado), Rentab. e % na mesma posição horizontal dos cards de
 *  grupo acima deles. Sem isso o leitor perde a coluna ao descer a
 *  página.
 *
 *  ⚠️ Desde 03/09/2026 os blocos **Orçado** e **Rentabilidade** podem ser
 *  ocultados pelo menu "Exibir" da planilha da versão. PLANEJADO nunca
 *  sai: é o bloco que sobra quando tudo mais está fechado, e uma planilha
 *  sem nenhum bloco não é planilha. Quem esconde um bloco tem que passar
 *  as MESMAS flags para tudo que divide esta grade na mesma tela, senão
 *  as tabelas desalinham.
 *
 *  Sem "use client" de propósito — a tabela de itens é client, os cards
 *  de Totais são server, e todos importam daqui.
 */

/** Quais colunas a grade desenha nesta tela. Ausente ⇒ visível: o default
 *  é a planilha inteira, que é como as agregadas e os Totais a leem. */
export interface ColunasVisiveis {
  save?: boolean;
  orcado?: boolean;
  rentabilidade?: boolean;
}

/** Larguras fixas do grid. Sem elas cada card mede as colunas pelo próprio
 *  conteúdo — um grupo com item de nome curto desalinha os blocos Orçado /
 *  Planejado / Rentabilidade em relação aos outros grupos e versões.
 *  Em porcentagem, não em px: os cards têm a mesma largura, então a mesma
 *  proporção alinha todos e ainda acompanha o container. */
export function ColunasFixas({
  save = false,
  orcado = true,
  rentabilidade = true,
}: ColunasVisiveis = {}) {
  const l = largurasDosBlocos(orcado, rentabilidade);
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
      {orcado && (
        <>
          <col className={l.unit} />
          <col className={l.qt} />
          <col className={l.dm} />
          <col className={l.total} />
        </>
      )}
      {/* Planejado */}
      <col className={l.unit} />
      <col className={l.qt} />
      <col className={l.dm} />
      <col className={l.total} />
      {/* Rentabilidade — a coluna de R$ é a ÚNICA da planilha que carrega
          sinal negativo, e por isso precisa de um dígito a mais que as
          outras de moeda: "-R$ 117.500,00" a 13px pede ~122px, e os 9,5%
          de antes davam 101px no piso de 1060px. O espaço saiu do "%",
          que nunca passa de "-99,9%". */}
      {rentabilidade && l.rentab && (
        <>
          <col className={l.rentab.valor} />
          <col className={l.rentab.pct} />
        </>
      )}
    </colgroup>
  );
}

/** As larguras de bloco por combinação visível.
 *
 *  Os três blocos somam 72% da tabela (28 + 28 + 16); Item, Tipo e
 *  Categoria ficam com o resto. Ao esconder um bloco, os 72% são
 *  redistribuídos entre os que ficaram, na mesma proporção — assim o
 *  Item continua com a largura que sempre teve em vez de engordar 28% de
 *  branco, e as colunas de moeda ganham a folga.
 *
 *  Classes literais, uma combinação por vez, porque o Tailwind varre o
 *  fonte: largura montada em template string não existiria no CSS. */
function largurasDosBlocos(orcado: boolean, rentabilidade: boolean) {
  if (orcado && rentabilidade) {
    return {
      unit: "w-[10%]",
      qt: "w-[3.5%]",
      dm: "w-[3.5%]",
      total: "w-[11%]",
      rentab: { valor: "w-[11.5%]", pct: "w-[4.5%]" },
    };
  }
  if (orcado) {
    // Sem rentabilidade: 16% para dividir entre Orçado e Planejado.
    return {
      unit: "w-[13%]",
      qt: "w-[4.5%]",
      dm: "w-[4.5%]",
      total: "w-[14%]",
      rentab: null,
    };
  }
  if (rentabilidade) {
    // Sem orçado: os 28% dele vão para Planejado e Rentabilidade.
    return {
      unit: "w-[16.5%]",
      qt: "w-[5.5%]",
      dm: "w-[5.5%]",
      total: "w-[18%]",
      rentab: { valor: "w-[19%]", pct: "w-[7%]" },
    };
  }
  // Só o Planejado — ele fica com os 72% inteiros.
  return {
    unit: "w-[26%]",
    qt: "w-[9%]",
    dm: "w-[9%]",
    total: "w-[28%]",
    rentab: null,
  };
}

/** Piso para as colunas de moeda não cortarem o valor. Abaixo disso o card
 *  rola na horizontal em vez de espremer as colunas.
 *
 *  Vale igual com bloco escondido: lá as colunas de moeda ficam com uma
 *  fração MAIOR do mesmo piso, então nenhuma delas aperta. */
export const LARGURA_MINIMA = "min-w-[1060px]";

/** O mesmo piso com a coluna de Save aberta: os 4% dela em cima de 1060px
 *  dão ~44px, e sem isso as colunas de moeda voltam a espremer. */
export const LARGURA_MINIMA_SAVE = "min-w-[1104px]";

/** Quantas colunas a grade tem — o número que os `colSpan` de linha
 *  inteira precisam. Constante em vez de literal porque ele muda com a
 *  coluna de Save e com os blocos escondidos, e um `colSpan`
 *  desatualizado desalinha a tabela inteira sem erro de compilação. */
export function totalDeColunas({
  save = false,
  orcado = true,
  rentabilidade = true,
}: ColunasVisiveis = {}): number {
  return (
    colunasDoRotulo({ save }) +
    (orcado ? 4 : 0) +
    4 +
    (rentabilidade ? 2 : 0)
  );
}

/** Quantas colunas o rótulo à esquerda ocupa: Item, Tipo e Categoria,
 *  mais a de Save quando ela está aberta. É o `colSpan` do nome do
 *  agrupamento e o do rótulo de subtotal. */
export function colunasDoRotulo({ save = false }: ColunasVisiveis = {}): number {
  return save ? 4 : 3;
}
