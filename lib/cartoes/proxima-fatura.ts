/**
 * Calcula a próxima data de vencimento da fatura de um cartão a partir
 * de uma data de referência.
 *
 * Regra: se hoje é dia <= vencimento, retorna dia deste mês; se
 * hoje > vencimento, retorna dia do mês seguinte. Se o dia (>28) não
 * existe no mês alvo, cai no último dia do mês (fev com 28/29, meses
 * com 30, etc), espelhando o comportamento de contas_avulsas_recorrentes.
 *
 * Casos de referência (verificação manual):
 *   proximaFatura(20, 2026-08-05)  → 2026-08-20
 *   proximaFatura(20, 2026-08-20)  → 2026-08-20 (inclusive)
 *   proximaFatura(20, 2026-08-22)  → 2026-09-20
 *   proximaFatura(31, 2026-02-10)  → 2026-02-28 (não bissexto)
 *   proximaFatura(31, 2028-02-10)  → 2028-02-29 (bissexto)
 *   proximaFatura(31, 2026-04-10)  → 2026-04-30
 *   proximaFatura(15, 2026-12-20)  → 2027-01-15
 */
export function proximaFatura(diaVencimento: number, hoje: Date): Date {
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    throw new Error(`dia_vencimento_fatura inválido: ${diaVencimento}`);
  }

  const ano = hoje.getFullYear();
  const mes = hoje.getMonth(); // 0-11
  const diaHoje = hoje.getDate();

  const proximoMes = diaHoje <= diaVencimento ? mes : mes + 1;
  const anoAlvo = proximoMes > 11 ? ano + 1 : ano;
  const mesAlvo = proximoMes > 11 ? 0 : proximoMes;

  const ultimoDiaDoMes = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(diaVencimento, ultimoDiaDoMes);

  return new Date(anoAlvo, mesAlvo, diaAlvo);
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
): Date[] {
  if (quantidade < 1) return [];
  const primeira = proximaFatura(diaVencimento, hoje);
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
