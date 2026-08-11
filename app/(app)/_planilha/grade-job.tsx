/** Grade da planilha interna de um JOB — 15 colunas.
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
export function ColunasJob() {
  return (
    <colgroup>
      {/* Item com largura própria: sem ela absorve toda a folga tirada das
          outras e a tabela volta a estourar pelas bordas. */}
      <col className="w-[18%]" />
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
