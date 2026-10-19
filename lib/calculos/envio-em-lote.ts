/**
 * As contas do envio em lote para faturamento (decisão 188, 19/10/2026).
 *
 * O lote junta jobs de um mesmo cliente e de uma mesma empresa, e as notas
 * são as que o cliente pediu — uma nota pode juntar jobs, e um job pode ser
 * dividido entre notas. Cada nota diz de que jobs ela é ("Rateio"):
 *
 *   - `proporcional`: a nota se divide entre os jobs na proporção do que
 *     falta de cada um, depois das notas de um job só e das divididas à mão;
 *   - o id de um job: a nota é toda daquele job ("Só o job X");
 *   - `manual`: quem envia escreve quanto vai para cada job.
 *
 * Tudo em centavos. A última nota proporcional fecha os centavos de cada
 * job: quando as notas somam o valor dos jobs, cada job fecha exato — que é
 * o que o banco confere (`enviar_lote_para_faturamento`).
 *
 * Funções puras: a tela usa para mostrar o rateio, e a action usa para
 * montar as partes que vão ao banco. Testes em `envio-em-lote.test.ts`.
 */

export const PROPORCIONAL = "proporcional";
export const MANUAL = "manual";

export type ModoDoRateio = string; // "proporcional" | "manual" | id do job

export interface NotaParaRatear {
  id: string;
  /** Valor da nota em reais. */
  valor: number;
  modo: ModoDoRateio;
  /** Só no modo manual: id do job → reais. */
  manual?: Record<string, number>;
}

export interface JobParaRatear {
  id: string;
  /** O valor a faturar do job (o do mês, no mensal), em reais. */
  valor: number;
}

export const centavos = (v: number) => Math.round((Number(v) || 0) * 100);

/**
 * Quanto de cada nota vai para cada job, em centavos: nota → job → centavos.
 * Só entram as partes maiores que zero.
 */
export function ratearNotas(
  notas: NotaParaRatear[],
  jobs: JobParaRatear[],
): Record<string, Record<string, number>> {
  const partes: Record<string, Record<string, number>> = Object.fromEntries(notas.map((n) => [n.id, {}]));
  const ids = new Set(jobs.map((j) => j.id));
  const resto: Record<string, number> = Object.fromEntries(jobs.map((j) => [j.id, centavos(j.valor)]));

  // 1. As notas de um job só e as divididas à mão.
  for (const n of notas) {
    if (n.modo === MANUAL) {
      for (const [jid, v] of Object.entries(n.manual ?? {})) {
        const c = centavos(v);
        if (c <= 0 || !ids.has(jid)) continue;
        partes[n.id][jid] = c;
        resto[jid] -= c;
      }
    } else if (n.modo !== PROPORCIONAL && ids.has(n.modo)) {
      const c = centavos(n.valor);
      if (c > 0) {
        partes[n.id][n.modo] = c;
        resto[n.modo] -= c;
      }
    }
  }

  // 2. As proporcionais, na proporção do que falta de cada job.
  const prop = notas.filter((n) => n.modo === PROPORCIONAL && centavos(n.valor) > 0);
  const restos = jobs.map((j) => Math.max(0, resto[j.id]));
  const somaRestos = restos.reduce((s, x) => s + x, 0);
  if (prop.length === 0 || somaRestos <= 0) return partes;
  const somaProp = prop.reduce((s, n) => s + centavos(n.valor), 0);
  const usado = jobs.map(() => 0);

  prop.forEach((n, k) => {
    const v = centavos(n.valor);
    // A última fecha cada job exato quando as notas somam o que falta.
    if (k === prop.length - 1 && somaProp === somaRestos) {
      jobs.forEach((j, i) => {
        const x = restos[i] - usado[i];
        if (x > 0) partes[n.id][j.id] = x;
        usado[i] += x;
      });
      return;
    }
    const bruto = restos.map((r) => (v * r) / somaRestos);
    const base = bruto.map(Math.floor);
    const ordem = bruto
      .map((b, i) => [b - base[i], i] as const)
      .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    let sobra = v - base.reduce((s, x) => s + x, 0);
    for (let t = 0; sobra > 0; t++, sobra--) base[ordem[t % ordem.length][1]]++;
    jobs.forEach((j, i) => {
      if (base[i] > 0) partes[n.id][j.id] = base[i];
      usado[i] += base[i];
    });
  });
  return partes;
}

/** Quanto do job já está nas notas, em centavos. */
export function centavosDoJobNasNotas(
  partes: Record<string, Record<string, number>>,
  jobId: string,
): number {
  return Object.values(partes).reduce((s, p) => s + (p[jobId] ?? 0), 0);
}

/** "2026-11-10" + 30 → "2026-12-10", em data local. */
export function somaDiasIso(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * A parte de um job numa nota, dividida nas parcelas da nota: N partes
 * iguais, em centavos, com a sobra na última; a 1ª no vencimento e as
 * seguintes de 30 em 30 dias — a mesma conta do envio de um job só. Assim
 * cada parcela da nota leva os jobs na proporção deles.
 */
export function parcelasDaParte(
  valorCentavos: number,
  n: number,
  primeiraData: string,
): Array<{ valor: number; data_vencimento: string }> {
  const base = Math.floor(valorCentavos / n);
  const sobra = valorCentavos - base * n;
  return Array.from({ length: n }, (_, i) => ({
    valor: (i === n - 1 ? base + sobra : base) / 100,
    data_vencimento: i === 0 ? primeiraData : somaDiasIso(primeiraData, 30 * i),
  }));
}
