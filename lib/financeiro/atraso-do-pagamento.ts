/**
 * O atraso de um pagamento, para a dica do "+ Juros e multa" no popup de
 * baixa (decisão 196).
 *
 * Os dias são corridos, contados a partir do primeiro dia útil: vencimento
 * no sábado passa para a segunda (+2), no domingo também (+1), e o banco
 * aceita o pagamento nesse dia sem encargo. Feriados ficam de fora — exigem
 * um calendário, e a especificação deixou para depois. O vencimento do
 * documento nunca muda; só a contagem começa no dia útil.
 *
 * Datas em ISO (AAAA-MM-DD), lidas como dia do calendário, sem fuso.
 */

const DIA_MS = 86_400_000;

/** Dia da semana (0 = domingo) e o quanto ele empurra o vencimento. */
const FIM_DE_SEMANA: Record<number, { nome: "sábado" | "domingo"; empurra: number }> = {
  6: { nome: "sábado", empurra: 2 },
  0: { nome: "domingo", empurra: 1 },
};

export interface AtrasoDoPagamento {
  /** Dias depois do primeiro dia útil a partir do vencimento; 0 em dia. */
  dias: number;
  /** O primeiro dia útil a partir do vencimento (o próprio, num dia útil). */
  vencimentoUtil: string | null;
  /** O dia da semana do vencimento, quando caiu num fim de semana. */
  fimDeSemana: "sábado" | "domingo" | null;
}

function diaUtc(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function atrasoDoPagamento(data: string | null, vencimento: string | null): AtrasoDoPagamento {
  if (!data || !vencimento) return { dias: 0, vencimentoUtil: vencimento, fimDeSemana: null };
  const venc = diaUtc(vencimento);
  if (Number.isNaN(venc) || Number.isNaN(diaUtc(data))) {
    return { dias: 0, vencimentoUtil: vencimento, fimDeSemana: null };
  }
  const fds = FIM_DE_SEMANA[new Date(venc).getUTCDay()] ?? null;
  const util = venc + (fds?.empurra ?? 0) * DIA_MS;
  return {
    dias: Math.max(0, Math.round((diaUtc(data) - util) / DIA_MS)),
    vencimentoUtil: new Date(util).toISOString().slice(0, 10),
    fimDeSemana: fds?.nome ?? null,
  };
}

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "3 dias depois do vencimento (18/10/2026, sábado, conta a partir de 20/10/2026)". */
export function textoDoAtraso(atraso: AtrasoDoPagamento, vencimento: string): string {
  const dias = `${atraso.dias} ${atraso.dias === 1 ? "dia" : "dias"}`;
  return atraso.fimDeSemana && atraso.vencimentoUtil
    ? `${dias} depois do vencimento (${dataBr(vencimento)}, ${atraso.fimDeSemana}, conta a partir de ${dataBr(atraso.vencimentoUtil)})`
    : `${dias} depois do vencimento (${dataBr(vencimento)})`;
}
