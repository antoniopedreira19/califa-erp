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

// ---------------------------------------------------------------------------
// Copiar as notas de um envio anterior (decisão 188, entrega 3)
// ---------------------------------------------------------------------------

/** Uma nota como o pop-up a monta, e como ela vem de um envio anterior. */
export interface NotaParaCopiar {
  tomador: string;
  /** Só dígitos; nulo no tomador no exterior. */
  cnpj: string | null;
  exterior: boolean;
  valor: number;
  descritivo: string;
  modo: ModoDoRateio;
}

/** Cada valor mantém a sua parte do total; o último fecha os centavos. */
export function escalarCentavos(cents: number[], alvo: number): number[] {
  const soma = cents.reduce((a, b) => a + b, 0);
  if (soma <= 0 || cents.length === 0) return [...cents];
  const novos = cents.map((v) => Math.round((v * alvo) / soma));
  novos[novos.length - 1] += alvo - novos.reduce((a, b) => a + b, 0);
  return novos;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Na caixa do texto que estava lá: "OUTUBRO", "Outubro" ou "outubro". */
function naMesmaCaixa(original: string, novo: string): string {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return novo.toUpperCase();
  if (original.charAt(0) === original.charAt(0).toUpperCase()) return novo.charAt(0).toUpperCase() + novo.slice(1);
  return novo;
}

/**
 * Troca o mês de um envio pelo do outro no descritivo: "outubro" vira
 * "novembro", na caixa em que estava. Quando o ano vem junto ("dezembro de
 * 2026", "dezembro/2026"), ele muda também — de dezembro para janeiro, o ano
 * vira. Mês com OUTRO ano no texto ("outubro/2025") fica como está: não é o
 * mês do envio.
 */
export function trocarMesNoTexto(texto: string, deIso: string, paraIso: string): string {
  const [deAno, deMes] = deIso.split("-").map(Number);
  const [paraAno, paraMes] = paraIso.split("-").map(Number);
  if (deAno === paraAno && deMes === paraMes) return texto;
  const de = MESES[deMes - 1];
  const para = MESES[paraMes - 1];
  const re = new RegExp(`(?<!\\p{L})(${de})(?!\\p{L})(\\s*(?:de|\\/|-)\\s*)?(\\d{4})?`, "giu");
  return texto.replace(re, (todo: string, mes: string, ligacao: string | undefined, ano: string | undefined) => {
    if (ano && Number(ano) !== deAno) return todo;
    const nome = naMesmaCaixa(mes, para);
    if (ano) return `${nome}${ligacao ?? ""}${paraAno}`;
    return `${nome}${ligacao ?? ""}`;
  });
}

export interface CopiaDasNotas {
  notas: NotaParaCopiar[];
  /** Os valores foram levados ao total deste envio, na mesma proporção. */
  ajustou: boolean;
  /** Algum descritivo teve o mês trocado. */
  trocouMes: boolean;
  /** Notas "Só o job" de um job que não é deste envio: voltaram para Proporcional. */
  voltaramDeJob: number;
  /** Notas divididas à mão: voltaram para Proporcional (os valores dos jobs mudam). */
  voltaramDeManual: number;
}

/**
 * As notas de um envio anterior no envio de agora: tomador, CNPJ (ou
 * exterior), descritivo com o mês trocado e o valor — igual, ou na mesma
 * proporção do total de agora (`ajustar`). A nota "Só o job" continua assim
 * se o job é deste envio; a de outro job e a dividida à mão voltam para
 * Proporcional.
 */
export function copiarNotas(
  notas: NotaParaCopiar[],
  o: { jobs: string[]; totalCentavos: number; ajustar: boolean; mesDe: string | null; mesPara: string | null },
): CopiaDasNotas {
  const cents = notas.map((n) => centavos(n.valor));
  const soma = cents.reduce((a, b) => a + b, 0);
  const ajustou = o.ajustar && soma !== o.totalCentavos && soma > 0;
  const valores = ajustou ? escalarCentavos(cents, o.totalCentavos) : cents;
  const ids = new Set(o.jobs);
  let trocouMes = false;
  let voltaramDeJob = 0;
  let voltaramDeManual = 0;
  const copiadas = notas.map((n, i) => {
    let descritivo = n.descritivo;
    if (o.mesDe && o.mesPara) {
      const novo = trocarMesNoTexto(descritivo, o.mesDe, o.mesPara);
      if (novo !== descritivo) trocouMes = true;
      descritivo = novo;
    }
    let modo = n.modo;
    if (modo === MANUAL) {
      voltaramDeManual += 1;
      modo = PROPORCIONAL;
    } else if (modo !== PROPORCIONAL && !ids.has(modo)) {
      voltaramDeJob += 1;
      modo = PROPORCIONAL;
    }
    return { ...n, valor: valores[i] / 100, descritivo, modo };
  });
  return { notas: copiadas, ajustou, trocouMes, voltaramDeJob, voltaramDeManual };
}
