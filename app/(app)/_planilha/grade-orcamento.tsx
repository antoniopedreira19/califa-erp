/** Grade das planilhas de ORÇAMENTO — 13 colunas, 14 com a de Save, 15 na
 *  planilha internacional (que acrescenta a coluna da moeda estrangeira
 *  dentro do bloco ORÇADO).
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
 *  é a planilha inteira, que é como as agregadas e os Totais a leem.
 *
 *  `moedaEstrangeira` é a exceção: ela nasce **desligada**, como a de Save.
 *  Só a planilha do orçamento internacional a pede (decisão 072), e o
 *  default `false` é o que garante que as outras telas que compartilham
 *  esta grade — em especial o card agregado do projeto, que chama
 *  `ColunasFixas()` sem argumento e tem `colSpan` literais próprios —
 *  continuem exatamente como estavam. */
export interface ColunasVisiveis {
  save?: boolean;
  orcado?: boolean;
  rentabilidade?: boolean;
  /** Coluna calculada com o total da linha na moeda estrangeira. Vive
   *  DENTRO do bloco ORÇADO, entre D/M e Total — some junto com ele. */
  moedaEstrangeira?: boolean;
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
  moedaEstrangeira = false,
}: ColunasVisiveis = {}) {
  const l = largurasDosBlocos(orcado, rentabilidade, moedaEstrangeira);
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
          {/* A moeda estrangeira entra ANTES do Total, como no design: ela
              é o total da linha convertido, e lê-se "…, D/M, isto em USD,
              isto em BRL". Sem prefixo de moeda na célula — o cabeçalho já
              diz qual é, e o "US$ " custaria ~34px de coluna. */}
          {l.moeda && <col className={l.moeda} />}
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
function largurasDosBlocos(
  orcado: boolean,
  rentabilidade: boolean,
  moedaEstrangeira = false,
) {
  // --- Internacional: o bloco ORÇADO tem 5 colunas em vez de 4.
  //
  // Os 72% dos blocos viram 71,5% repartidos entre 11 (ou 9) colunas em
  // vez de 10 (ou 8) — Item, Tipo e Categoria NÃO cedem espaço, e o Item
  // até ganha meio ponto. Quem paga a coluna nova é o piso de largura:
  // `LARGURA_MINIMA_INTERNACIONAL` sobe de 1060px para 1280px, e a
  // mesma fração passa a valer mais pixels. Abaixo disso o card rola na
  // horizontal, que é o que a grade já faz.
  //
  // É também o que mantém a faixa **RENTABILIDADE** escrita por extenso:
  // a 1280px os 14,5% dela dão ~186px, e o rótulo pede ~105px.
  if (orcado && moedaEstrangeira) {
    if (rentabilidade) {
      return {
        unit: "w-[9%]",
        qt: "w-[3%]",
        dm: "w-[3%]",
        moeda: "w-[8%]",
        total: "w-[9.5%]",
        rentab: { valor: "w-[10.5%]", pct: "w-[4%]" },
      };
    }
    // Sem rentabilidade: os 14,5% dela voltam para Orçado e Planejado.
    return {
      unit: "w-[11%]",
      qt: "w-[4%]",
      dm: "w-[4%]",
      moeda: "w-[9.5%]",
      total: "w-[12.5%]",
      rentab: null,
    };
  }

  if (orcado && rentabilidade) {
    return {
      unit: "w-[10%]",
      qt: "w-[3.5%]",
      dm: "w-[3.5%]",
      moeda: null,
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
      moeda: null,
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
      moeda: null,
      total: "w-[18%]",
      rentab: { valor: "w-[19%]", pct: "w-[7%]" },
    };
  }
  // Só o Planejado — ele fica com os 72% inteiros.
  return {
    unit: "w-[26%]",
    qt: "w-[9%]",
    dm: "w-[9%]",
    moeda: null,
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

/** Piso da planilha internacional, que tem uma coluna de moeda a mais
 *  (decisão 072).
 *
 *  É aqui que a coluna nova é paga. Os blocos continuam com ~72% da
 *  tabela, mas agora repartidos entre 11 colunas em vez de 10 — então o
 *  que cresce é o total: 1280px em vez de 1060px. Nessa largura a coluna
 *  da moeda tem ~102px para "283.668,01" (~85px a 13px mono), o Total
 *  ~122px para "R$ 283.668,01", e a faixa RENTABILIDADE ~186px para um
 *  rótulo que pede ~105px — que é o que permitiu **não** abreviar o
 *  rótulo para "RENTA", como o design havia feito. */
export const LARGURA_MINIMA_INTERNACIONAL = "min-w-[1280px]";

/** O piso internacional com a coluna de Save aberta. */
export const LARGURA_MINIMA_INTERNACIONAL_SAVE = "min-w-[1324px]";

/** O piso certo para a combinação de flags desta tela. Evita o ternário
 *  aninhado repetido em cada renderizador de planilha. */
export function larguraMinima({
  save = false,
  moedaEstrangeira = false,
}: ColunasVisiveis = {}): string {
  if (moedaEstrangeira) {
    return save ? LARGURA_MINIMA_INTERNACIONAL_SAVE : LARGURA_MINIMA_INTERNACIONAL;
  }
  return save ? LARGURA_MINIMA_SAVE : LARGURA_MINIMA;
}

/** Quantas colunas a grade tem — o número que os `colSpan` de linha
 *  inteira precisam. Constante em vez de literal porque ele muda com a
 *  coluna de Save e com os blocos escondidos, e um `colSpan`
 *  desatualizado desalinha a tabela inteira sem erro de compilação. */
export function totalDeColunas({
  save = false,
  orcado = true,
  rentabilidade = true,
  moedaEstrangeira = false,
}: ColunasVisiveis = {}): number {
  return (
    colunasDoRotulo({ save }) +
    (orcado ? colunasDoOrcado({ moedaEstrangeira }) : 0) +
    4 +
    (rentabilidade ? 2 : 0)
  );
}

/** Quantas colunas o bloco ORÇADO tem: 4 (R$ Unit., QT, D/M, Total) e 5 no
 *  internacional, com a da moeda estrangeira no meio.
 *
 *  Existe como função, e não como literal repetido, porque é o `colSpan`
 *  da faixa "ORÇADO" no cabeçalho — e faixa com `colSpan` desatualizado
 *  desalinha a tabela inteira sem erro de compilação. */
export function colunasDoOrcado({
  moedaEstrangeira = false,
}: ColunasVisiveis = {}): number {
  return moedaEstrangeira ? 5 : 4;
}

/** O `colSpan` das células vagas do bloco ORÇADO nas linhas de grupo e de
 *  subtotal — tudo menos a coluna do Total. */
export function colunasVagasDoOrcado(c: ColunasVisiveis = {}): number {
  return colunasDoOrcado(c) - 1;
}

/** Quantas colunas o rótulo à esquerda ocupa: Item, Tipo e Categoria,
 *  mais a de Save quando ela está aberta. É o `colSpan` do nome do
 *  agrupamento e o do rótulo de subtotal. */
export function colunasDoRotulo({ save = false }: ColunasVisiveis = {}): number {
  return save ? 4 : 3;
}
