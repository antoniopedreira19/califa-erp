/**
 * A folha de pagamento no Extrato (decisão 202, Tiago, 21/10/2026): cada
 * pagamento da folha continua uma linha própria — o Santander debita cada
 * pagamento da remessa numa linha do banco, e um pode falhar e sair no dia
 * seguinte —, com a sua marca do banco, e a conciliação segue linha a linha.
 *
 * O agrupamento é SÓ para ver: os pagamentos da mesma folha no mesmo dia,
 * seguidos na ordem do Extrato, ganham uma faixa recolhível ("Folha de
 * pagamento 10/2026 · 19/10 · 17 pagamentos · R$ X · 16 ✓ 1 ○"). A faixa não
 * junta valores para conciliar, não muda o saldo corrente nem a ordem por
 * data. O pagamento que saiu noutro dia aparece na faixa desse dia.
 *
 * A folha é a competência e o tipo (salário ou férias): `folhas_pagamento`
 * tem uma linha por colaborador, e a folha do mês é o conjunto delas.
 */

export interface FolhaDaLinha {
  /** `salario|2026-10`, `ferias|2026-10`. */
  chave: string;
  /** "Folha de pagamento 10/2026", "Férias 10/2026". */
  rotulo: string;
}

/** O nome de cada tipo de `folhas_pagamento`. Um tipo novo fica sem faixa
 *  até ganhar nome aqui (a linha continua no Extrato, como as outras). */
const NOME_DO_TIPO: Record<string, string> = { salario: "Folha de pagamento", ferias: "Férias" };

/** A folha de uma baixa, pela folha do colaborador que a avulsa pagou. */
export function folhaDaBaixa(
  origem: string,
  folha: { competencia_ano: number; competencia_mes: number; tipo: string | null } | null | undefined,
): FolhaDaLinha | null {
  if (origem !== "avulsa_baixa" || !folha?.tipo) return null;
  const nome = NOME_DO_TIPO[folha.tipo];
  if (!nome) return null;
  const mes = String(folha.competencia_mes).padStart(2, "0");
  return {
    chave: `${folha.tipo}|${folha.competencia_ano}-${mes}`,
    rotulo: `${nome} ${mes}/${folha.competencia_ano}`,
  };
}

export type ItemDoExtrato<L> =
  | { tipo: "linha"; linha: L }
  | {
      tipo: "folha";
      /** Única na lista: a folha, o dia e o primeiro pagamento da faixa. */
      chave: string;
      rotulo: string;
      data: string;
      linhas: L[];
    };

/**
 * As linhas do Extrato, na mesma ordem, com os pagamentos seguidos da mesma
 * folha no mesmo dia dentro de uma faixa. Uma linha de outra coisa no meio
 * fecha a faixa (a ordem do Extrato não muda), e a faixa pode ter um
 * pagamento só (o que saiu noutro dia).
 */
export function agruparFolhaNoExtrato<L extends { id: string; data_movimento: string; folha: FolhaDaLinha | null }>(
  linhas: L[],
): ItemDoExtrato<L>[] {
  const itens: ItemDoExtrato<L>[] = [];
  for (const l of linhas) {
    const ultimo = itens[itens.length - 1];
    if (!l.folha) {
      itens.push({ tipo: "linha", linha: l });
    } else if (
      ultimo?.tipo === "folha" &&
      ultimo.data === l.data_movimento &&
      ultimo.linhas[0].folha?.chave === l.folha.chave
    ) {
      ultimo.linhas.push(l);
    } else {
      itens.push({
        tipo: "folha",
        chave: `${l.folha.chave}|${l.data_movimento}|${l.id}`,
        rotulo: l.folha.rotulo,
        data: l.data_movimento,
        linhas: [l],
      });
    }
  }
  return itens;
}
