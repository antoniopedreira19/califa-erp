/** Grade da planilha interna de um JOB — 15 colunas, 16 com a de Save.
 *
 *  Compartilhada entre a tabela de itens de cada agrupamento e o card de
 *  Totais do job. As duas precisam das MESMAS larguras: os Totais repetem
 *  as colunas Total de Orçado, Planejado e Realizado na mesma posição
 *  horizontal dos cards de grupo acima. Estas larguras já eram idênticas
 *  nos dois arquivos — agora vivem num lugar só e não podem divergir.
 *
 *  Sem "use client" de propósito — a tabela de itens é client, o card de
 *  Totais é server, e ambos importam daqui.
 */
export function ColunasJob({ save = false }: { save?: boolean } = {}) {
  return (
    <colgroup>
      {/* Save é a calha de estado do crédito entre jobs, à ESQUERDA — do
          lado oposto ao da trilha de BV e PP. Mesma coluna da planilha do
          orçamento, para as duas telas se lerem igual. */}
      {save && <col className="w-[3.5%]" />}
      {/* Item com largura própria: sem ela absorve toda a folga tirada das
          outras e a tabela volta a estourar pelas bordas. */}
      <col className={save ? "w-[15.5%]" : "w-[18%]"} />
      <col className="w-[4%]" />
      <col className="w-[8.5%]" />
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

/** Piso para as colunas de moeda não cortarem o valor. */
export const LARGURA_MINIMA_JOB = "min-w-[1160px]";

/** O mesmo piso com a coluna de Save aberta. */
export const LARGURA_MINIMA_JOB_SAVE = "min-w-[1200px]";

/** Quantas colunas a grade do job tem — o `colSpan` de linha inteira. */
export function totalDeColunasJob(save = false): number {
  return save ? 16 : 15;
}

/** Item, Tipo e Categoria, mais a de Save quando aberta. */
export function colunasDoRotuloJob(save = false): number {
  return save ? 4 : 3;
}
