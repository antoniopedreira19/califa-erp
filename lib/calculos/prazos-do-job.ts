/**
 * Os três prazos de um job, em dias corridos — decisão 075, nota de
 * 15/09/2026 (regras escolhidas pelo Tiago).
 *
 * Fica em `lib/calculos/` pelo mesmo motivo da esteira: é regra de negócio e
 * precisa ser conferível sem emitir nota de verdade.
 *
 *   faturamento — abertura → faturamento médio
 *   recebimento — faturamento médio → recebimento médio
 *   total       — abertura → recebimento médio
 *
 * - **Faturamento médio:** a emissão das notas do job, ponderada pela PARTE
 *   do job em cada nota — a mesma da coluna Faturamento, nunca o total de uma
 *   NF agrupada. O peso é sobre o que JÁ foi faturado, e não sobre o
 *   faturamento previsto: enquanto o job é faturado em partes, o prazo sai só
 *   do que aconteceu, e no fim os dois dão o mesmo número.
 * - **Recebimento médio:** o vencimento de cada título dessas notas, pago ou
 *   não, ponderado pelo valor do título × parte do job ÷ total da nota — o
 *   rateio da esteira. Numa NF agrupada o título é da nota inteira, e cada
 *   job o conta na proporção da sua parte.
 * - **Sem nota**, o prazo segue pelo previsto da abertura: a data prevista de
 *   faturamento e a ÚLTIMA parcela da previsão de recebimento. A média das
 *   parcelas previstas dá prazo negativo quando elas começam antes da data
 *   prevista de faturamento — o caso do JOB-0034, um Fee.
 * - **Job mensal** (Fee e Always On, decisão 078) segue a mesma regra: os
 *   meses ainda sem nota não entram no prazo.
 *
 * As datas médias são arredondadas para o dia ANTES de medir os prazos, e
 * por isso faturamento + recebimento é sempre igual ao total.
 */

import type { NotaDoJob } from "./esteira-faturamento";

export interface PrazosCalculados {
  faturamento: number | null;
  recebimento: number | null;
  total: number | null;
}

export interface EntradaDosPrazos {
  /** Abertura no financeiro. Só o dia conta. */
  abertura: string | null;
  /** `jobs.data_prevista_faturamento` — só vale enquanto não há nota. */
  faturamentoPrevisto: string | null;
  /** Notas EMITIDAS do job, com os títulos não cancelados da nota inteira. */
  notas: NotaDoJob[];
  /** Datas das parcelas da previsão de recebimento da abertura. */
  previsoesRecebimento: string[];
}

const DIA_MS = 86_400_000;

function paraDia(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / DIA_MS);
}

function deDia(dia: number): string {
  return new Date(dia * DIA_MS).toISOString().slice(0, 10);
}

export function diasEntre(de: string | null, ate: string | null): number | null {
  const d1 = paraDia(de);
  const d2 = paraDia(ate);
  return d1 === null || d2 === null ? null : d2 - d1;
}

/**
 * A data média ponderada, arredondada para o dia; meio dia arredonda para a
 * data mais tardia.
 *
 * A conta é em dias inteiros e centavos inteiros, e o arredondamento sai do
 * resto da divisão: com ponto flutuante, 27,5 dias podia virar
 * 27,499999999999996 e cair para o dia anterior.
 */
export function dataMediaPonderada(
  pontos: { data: string | null; peso: number }[],
): string | null {
  const validos: { dia: number; centavos: number }[] = [];
  for (const p of pontos) {
    const dia = paraDia(p.data);
    const centavos = Math.round(p.peso * 100);
    if (dia !== null && centavos > 0) validos.push({ dia, centavos });
  }
  if (validos.length === 0) return null;

  const base = Math.min(...validos.map((p) => p.dia));
  let soma = 0;
  let pesos = 0;
  for (const p of validos) {
    soma += (p.dia - base) * p.centavos;
    pesos += p.centavos;
  }

  let dias = Math.floor(soma / pesos);
  let resto = soma - dias * pesos;
  // A divisão em ponto flutuante pode arredondar para o inteiro de cima.
  if (resto < 0) {
    dias -= 1;
    resto += pesos;
  }
  if (2 * resto >= pesos) dias += 1;

  return deDia(base + dias);
}

export function calcularPrazosDoJob(entrada: EntradaDosPrazos): PrazosCalculados {
  const notas = entrada.notas.filter(
    (n) => !!n.data_emissao && n.parte_do_job > 0,
  );

  const faturamento =
    notas.length > 0
      ? dataMediaPonderada(
          notas.map((n) => ({ data: n.data_emissao, peso: n.parte_do_job })),
        )
      : (entrada.faturamentoPrevisto?.slice(0, 10) ?? null);

  const vencimentos = notas.flatMap((n) =>
    n.valor_total > 0
      ? n.titulos.map((t) => ({
          data: t.vencimento,
          peso: (t.valor * n.parte_do_job) / n.valor_total,
        }))
      : [],
  );

  // Nota emitida ainda sem título — cobrança não montada — cai no previsto,
  // como o job sem nota.
  const ultimaPrevista =
    entrada.previsoesRecebimento
      .filter(Boolean)
      .map((d) => d.slice(0, 10))
      .sort()
      .at(-1) ?? null;
  const recebimento = dataMediaPonderada(vencimentos) ?? ultimaPrevista;

  return {
    faturamento: diasEntre(entrada.abertura, faturamento),
    recebimento: diasEntre(faturamento, recebimento),
    total: diasEntre(entrada.abertura, recebimento),
  };
}
