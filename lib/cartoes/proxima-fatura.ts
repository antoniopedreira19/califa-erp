/**
 * Calcula a próxima data de vencimento da fatura de um cartão a partir
 * de uma data de referência.
 *
 * ⚠️ ESPELHO da função de banco `proxima_fatura_cartao`. As duas contas
 * precisam dar o mesmo resultado: esta aqui é o que o usuário VÊ ao
 * escolher o cartão no formulário, e a do banco é o que fica GRAVADO.
 * Divergir entre elas é mostrar uma data e salvar outra.
 *
 * Duas datas, dois papéis (28/08/2026):
 *   · FECHAMENTO decide em QUAL fatura a compra cai.
 *   · VENCIMENTO decide QUANDO essa fatura é paga.
 *
 * Sem fechamento cadastrado, cai no comportamento anterior — o vencimento
 * fazendo as vezes de fronteira. Ele só acerta quando as duas datas
 * coincidem; num cartão que fecha 25 e vence 5, uma compra do dia 28 ia
 * para uma fatura cedo demais.
 *
 * Casos de referência (verificados contra o banco em 28/08/2026):
 *   proximaFatura(20, 2026-08-05)          → 2026-08-20
 *   proximaFatura(20, 2026-08-22)          → 2026-09-20
 *   proximaFatura(31, 2026-02-10)          → 2026-02-28 (não bissexto)
 *   proximaFatura(5,  2026-08-10, 25)      → 2026-09-05 (antes do fecha)
 *   proximaFatura(5,  2026-08-28, 25)      → 2026-10-05 (depois do fecha)
 *   proximaFatura(5,  2026-12-28, 25)      → 2027-02-05 (vira o ano)
 *   proximaFatura(30, 2026-08-10, 25)      → 2026-08-30 (vence no mês)
 */
export function proximaFatura(
  diaVencimento: number,
  hoje: Date,
  diaFechamento?: number | null,
): Date {
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    throw new Error(`dia_vencimento_fatura inválido: ${diaVencimento}`);
  }
  if (
    diaFechamento != null &&
    (!Number.isInteger(diaFechamento) || diaFechamento < 1 || diaFechamento > 31)
  ) {
    throw new Error(`dia_fechamento_fatura inválido: ${diaFechamento}`);
  }

  const diaHoje = hoje.getDate();
  let mesAcumulado = hoje.getMonth(); // 0-11

  if (diaFechamento == null) {
    if (diaHoje > diaVencimento) mesAcumulado += 1;
  } else {
    // 1. Em qual fatura a compra cai.
    if (diaHoje > diaFechamento) mesAcumulado += 1;
    // 2. Quando essa fatura vence. Vencimento antes ou no dia do
    //    fechamento cai no mês seguinte — o caso comum (fecha 25, vence 5).
    if (diaVencimento <= diaFechamento) mesAcumulado += 1;
  }

  const anoAlvo = hoje.getFullYear() + Math.floor(mesAcumulado / 12);
  const mesAlvo = ((mesAcumulado % 12) + 12) % 12;

  const ultimoDiaDoMes = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  return new Date(anoAlvo, mesAlvo, Math.min(diaVencimento, ultimoDiaDoMes));
}

/**
 * Sequência de datas de fatura para parcelas de PP no cartão.
 * 1ª parcela = próxima fatura; 2ª = fatura +1 mês; N = fatura +(N-1) meses.
 * Cada mês respeita a regra do último dia (dia 31 em fev vira 28/29).
 */
export function parcelasParaFatura(
  diaVencimento: number,
  hoje: Date,
  quantidade: number,
  diaFechamento?: number | null,
): Date[] {
  if (quantidade < 1) return [];
  const primeira = proximaFatura(diaVencimento, hoje, diaFechamento);
  const datas: Date[] = [primeira];
  for (let i = 1; i < quantidade; i++) {
    const alvoMes = primeira.getMonth() + i;
    const anoAlvo = primeira.getFullYear() + Math.floor(alvoMes / 12);
    const mesAlvo = ((alvoMes % 12) + 12) % 12;
    const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
    datas.push(new Date(anoAlvo, mesAlvo, Math.min(diaVencimento, ultimoDia)));
  }
  return datas;
}

export function formatarISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
