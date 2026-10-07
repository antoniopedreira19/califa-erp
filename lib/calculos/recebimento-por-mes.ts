/**
 * A data prevista de recebimento de cada mês no envio para abertura do Fee
 * e do Always On (decisão 149, 06/10/2026).
 *
 * Funções puras: o formulário (`enviar-job-modal.tsx`) chama, e os testes
 * em `recebimento-por-mes.test.ts` conferem a regra da sugestão.
 */

/** Um mês do modelo mensal no envio: o mês e o que se fatura nele. */
export interface MesDoEnvio {
  /** Primeiro dia do mês, `YYYY-MM-01`. */
  mes: string;
  /** O que a California emite nota no mês. */
  faturamento: number;
}

/** Recebimento de um mês do modelo mensal. `sugerida`: a data veio da
 *  sugestão do primeiro mês e ninguém mexeu nela ainda — só muda a linha de
 *  apoio; para o envio, é uma data como outra qualquer. */
export interface RecebimentoDoMes {
  mes: string;
  data: string;
  sugerida: boolean;
}

/** Desloca a data em `n` meses mantendo o dia; dia que o mês não tem vira
 *  o último dia dele (31/10 + 1 mês → 30/11). */
export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

function distanciaEmMeses(de: string, ate: string): number {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  return a2 * 12 + m2 - (a1 * 12 + m1);
}

/**
 * Escolher (ou limpar) a data de um mês. Só o PRIMEIRO mês com faturamento
 * sugere: os meses seguintes que estiverem VAZIOS recebem o mesmo dia,
 * deslocado pela distância entre os meses (outubro em 20/11 → novembro em
 * 20/12). Mês já preenchido nunca muda, nem quando o primeiro muda de novo;
 * mexer num mês do meio não mexe em nenhum outro (Tiago, 06/10/2026).
 */
export function alterarRecebimento(
  linhas: RecebimentoDoMes[],
  meses: MesDoEnvio[],
  mes: string,
  data: string,
): RecebimentoDoMes[] {
  const comFaturamento = meses.filter((m) => m.faturamento > 0.004).map((m) => m.mes);
  const primeiro = comFaturamento[0];
  const novas = linhas.map((l) => (l.mes === mes ? { ...l, data, sugerida: false } : l));
  if (mes !== primeiro || !data) return novas;
  // A sugestão anterior deixa de ser "sugerida": o primeiro mês mudou, e a
  // data dela fica como está.
  return novas.map((l) =>
    l.mes > mes && comFaturamento.includes(l.mes) && !l.data
      ? { ...l, data: somarMeses(data, distanciaEmMeses(mes, l.mes)), sugerida: true }
      : { ...l, sugerida: false },
  );
}

