/** Grade da planilha interna de um JOB — 15 colunas, 16 com a de Save,
 *  mais 2 por bloco de rentabilidade ligado (até 20).
 *
 *  Só a tabela de itens (`job-item-realizado-table.tsx`) usa esta grade:
 *  o card de Totais do job é o fechamento em duas colunas, sem tabela.
 *  Ainda assim, tudo que conta coluna — `colgroup`, `colSpan` de linha
 *  inteira e o piso de largura — sai daqui, para um `colSpan`
 *  desatualizado não desalinhar a tabela em silêncio.
 *
 *  ⚠️ Desde 03/09/2026 (decisão 045) o bloco ORÇADO pode ser escondido e
 *  os blocos PLANEJADO e REALIZADO podem ganhar duas colunas de
 *  rentabilidade cada (Rentab. R$ e Rentab. %) pelo menu "Exibir".
 *  PLANEJADO e REALIZADO nunca saem: o realizado é por onde se acompanham
 *  as PPs, e o planejado é o custo com que ele se compara.
 *
 *  Sem "use client" de propósito — pode ser importada de qualquer lado.
 */

/** Quais colunas a grade desenha. Ausente ⇒ o default de sempre: os três
 *  blocos, sem rentabilidade. */
export interface ColunasJobVisiveis {
  save?: boolean;
  orcado?: boolean;
  rentabPlanejada?: boolean;
  rentabRealizada?: boolean;
}

/** Os pesos de cada coluna — os mesmos percentuais que a grade sempre
 *  teve. Somam 96,5, com ou sem Save (Save + Item = os 18% do Item): a
 *  sobra a grade sempre deixou o navegador distribuir, e o default
 *  continua bit a bit o de antes.
 *
 *  Quando uma coluna entra ou sai, os pesos dos que ficaram são
 *  renormalizados para a MESMA soma — as colunas de moeda apertam um
 *  pouco para a rentabilidade caber, e o piso de largura cresce junto
 *  (abaixo) para nenhuma delas cortar valor. */
const PESO = {
  save: 3.5,
  item: 18,
  itemComSave: 14.5,
  tipo: 4,
  categoria: 8.5,
  unit: 7.5,
  qt: 3,
  dm: 3,
  total: 8.5,
  /** A coluna de R$ da rentabilidade é a única que carrega sinal
   *  negativo — precisa de um dígito a mais que as outras de moeda. */
  rentabValor: 8,
  /** O cabeçalho "Rentab. %" quebra em duas linhas (como "Total
   *  líquido"), e "RENTAB." sozinho pede ~55px + padding. Com 5% ele
   *  ainda vazava para a coluna vizinha em produção (04/09/2026). */
  rentabPct: 5.5,
} as const;

/** Soma dos pesos no estado de sempre: 18 + 4 + 8,5 + 3 × 22. */
const SOMA_PADRAO = 96.5;

function larguras({
  save = false,
  orcado = true,
  rentabPlanejada = false,
  rentabRealizada = false,
}: ColunasJobVisiveis): number[] {
  const bloco = [PESO.unit, PESO.qt, PESO.dm, PESO.total];
  const rentab = [PESO.rentabValor, PESO.rentabPct];
  const pesos = [
    ...(save ? [PESO.save, PESO.itemComSave] : [PESO.item]),
    PESO.tipo,
    PESO.categoria,
    ...(orcado ? bloco : []),
    ...bloco,
    ...(rentabPlanejada ? rentab : []),
    ...bloco,
    ...(rentabRealizada ? rentab : []),
  ];
  const soma = pesos.reduce((t, p) => t + p, 0);
  // Nada mudou: devolve os pesos como sempre foram, sem arredondar.
  if (Math.abs(soma - SOMA_PADRAO) < 0.001) return pesos;
  return pesos.map((p) => Math.round((p / soma) * SOMA_PADRAO * 100) / 100);
}

/** Larguras em `style`, e não em classe: são 16 combinações de colunas
 *  visíveis, e o Tailwind varre o fonte — classe montada em template
 *  string não existiria no CSS. `<col>` com `width` inline é a forma
 *  que o próprio `table-fixed` espera. */
export function ColunasJob(colunas: ColunasJobVisiveis = {}) {
  const { save = false, orcado = true, rentabPlanejada = false, rentabRealizada = false } = colunas;
  const l = larguras(colunas);
  let i = 0;
  const col = () => <col key={i} style={{ width: `${l[i++]}%` }} />;
  const bloco = () => [col(), col(), col(), col()];
  const rentab = () => [col(), col()];
  return (
    <colgroup>
      {/* Save é a calha de estado do crédito entre jobs, à ESQUERDA — do
          lado oposto ao da trilha de BV e PP. Mesma coluna da planilha do
          orçamento, para as duas telas se lerem igual. Save + Item somam
          os 18% do Item sem Save, de propósito: é o que mantém os blocos
          no mesmo eixo com a coluna aberta ou fechada. */}
      {save && col()}
      <col style={{ width: `${l[i++]}%` }} />
      {col()}
      {col()}
      {/* Orçado */}
      {orcado && bloco()}
      {/* Planejado, com a rentabilidade planejada colada nele */}
      {bloco()}
      {rentabPlanejada && rentab()}
      {/* Realizado, idem */}
      {bloco()}
      {rentabRealizada && rentab()}
    </colgroup>
  );
}

/** Piso para as colunas de moeda não cortarem o valor. Abaixo disso o
 *  card rola na horizontal em vez de espremer as colunas.
 *
 *  1160px é o piso de sempre (1200 com Save). Cada par de rentabilidade
 *  pede ~170px a mais ("-R$ 117.500,00" a 13px + o "%"); o Orçado
 *  escondido devolve os ~256px dele. Em `style`, pelo mesmo motivo das
 *  larguras: a conta muda com as colunas. */
export function larguraMinimaJob({
  save = false,
  orcado = true,
  rentabPlanejada = false,
  rentabRealizada = false,
}: ColunasJobVisiveis = {}): number {
  return (
    1160 +
    (save ? 40 : 0) -
    (orcado ? 0 : 256) +
    (rentabPlanejada ? 170 : 0) +
    (rentabRealizada ? 170 : 0)
  );
}

/** Quantas colunas a grade do job tem — o `colSpan` de linha inteira. */
export function totalDeColunasJob({
  save = false,
  orcado = true,
  rentabPlanejada = false,
  rentabRealizada = false,
}: ColunasJobVisiveis = {}): number {
  return (
    colunasDoRotuloJob({ save }) +
    (orcado ? 4 : 0) +
    4 +
    (rentabPlanejada ? 2 : 0) +
    4 +
    (rentabRealizada ? 2 : 0)
  );
}

/** Item, Tipo e Categoria, mais a de Save quando aberta. */
export function colunasDoRotuloJob({ save = false }: ColunasJobVisiveis = {}): number {
  return save ? 4 : 3;
}
