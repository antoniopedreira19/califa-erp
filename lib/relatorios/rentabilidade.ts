import type { LinhaJobRentabilidade } from "@/lib/types";
import { calcularResultadoOperacional } from "@/lib/calculos/versao-totais";

/** Modo do toggle Previsto | Realizado (spec §3.3). */
export type ModoRentabilidade = "previsto" | "realizado";

/** Toggle de visualização Cliente | Marca | Job (spec §5.2). */
export type VisaoRentabilidade = "cliente" | "marca" | "job";

/**
 * As 4 bases somadas + o resultado da fórmula.
 *
 * `resultadoOperacional` e `resultadoGeral` são `null` quando a fórmula
 * não roda (custo <= 0 ou faturamento = 0) — a UI mostra travessão.
 */
export interface BasesAgregadas {
  faturamento: number;
  imposto: number;
  custo: number;
  bv: number;
  resultadoOperacional: number | null;
  resultadoGeral: number | null;
}

/** Um grupo da tabela (cliente, marca ou o próprio job na visão flat). */
export interface GrupoRentabilidade {
  chave: string;
  rotulo: string;
  bases: BasesAgregadas;
  /** Jobs individuais dentro do grupo. Na visão "job" tem 1 elemento (ele mesmo). */
  jobs: LinhaJobRentabilidade[];
  /** Representatividade sobre o total do universo filtrado. */
  representatividadePct: number;
}

/**
 * Threshold do badge verde da Rent%. Calibrado pelos mockups
 * (Deezer 29,6% verde, Prefeitura Ambev 7,0% laranja). Constante
 * exportada pra facilitar ajuste sem caça em várias telas.
 */
export const THRESHOLD_RENT_VERDE = 20;

/**
 * Fórmula-central do Result. Op + Rent% sobre bases já somadas.
 * Fonte-única para: linha total da tabela, linhas de job individual,
 * comparativo, e agregarBases. Evita 4 implementações inline da mesma conta.
 *
 * `custo - bv` porque BV retorna pra agência, restituindo custo (decisão 022,
 * mesma lógica de components/resumo-resultado.tsx). `resultadoGeral` volta
 * `null` quando faturamento = 0 — `calcularResultadoOperacional` só olha o
 * custo, então precisamos travar o % aqui.
 */
export function computarResultado(bases: {
  faturamento: number;
  imposto: number;
  custo: number;
  bv: number;
}): { resultadoOperacional: number | null; resultadoGeral: number | null } {
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    bases.faturamento,
    bases.imposto,
    bases.custo - bases.bv,
  );
  const resultadoGeralFinal = bases.faturamento > 0 ? resultadoGeral : null;
  return { resultadoOperacional, resultadoGeral: resultadoGeralFinal };
}

/**
 * Soma as bases das linhas e roda a fórmula UMA vez sobre a soma.
 * A regra dura da spec §3.9: `Rent% do grupo` não é média dos `Rent%`
 * dos jobs — é `Result.Op / Faturamento` recalculado das somas.
 */
export function agregarBases(
  linhas: LinhaJobRentabilidade[],
  modo: ModoRentabilidade,
): BasesAgregadas {
  const faturamento = linhas.reduce(
    (s, l) => s + (modo === "previsto" ? l.faturamento_previsto : l.faturamento_realizado),
    0,
  );
  const imposto = linhas.reduce(
    (s, l) => s + (modo === "previsto" ? l.imposto_previsto : l.imposto_realizado),
    0,
  );
  const custo = linhas.reduce((s, l) => s + l.custo_realizado, 0);
  const bv = linhas.reduce((s, l) => s + l.bv_realizado, 0);

  const { resultadoOperacional, resultadoGeral } = computarResultado({
    faturamento,
    imposto,
    custo,
    bv,
  });
  return { faturamento, imposto, custo, bv, resultadoOperacional, resultadoGeral };
}

/**
 * Agrupa por dimensão (cliente/marca/job), roda `agregarBases` em cada
 * grupo e calcula representatividade % sobre o total.
 *
 * `resolveRotulo` faz o de/para chave → nome legível — o caller passa um
 * `Map<id, nome>` já carregado (evita N queries a partir daqui).
 */
export function agruparEComputar(
  linhas: LinhaJobRentabilidade[],
  visao: VisaoRentabilidade,
  modo: ModoRentabilidade,
  resolveRotulo: (chave: string) => string,
): GrupoRentabilidade[] {
  const chaveDe = (l: LinhaJobRentabilidade): string | null => {
    if (visao === "cliente") return l.cliente_id;
    if (visao === "marca") return l.marca_id;
    return l.job_id;
  };

  const porChave = new Map<string, LinhaJobRentabilidade[]>();
  for (const l of linhas) {
    const c = chaveDe(l);
    if (c === null) continue; // linha sem marca não entra na visão marca
    const lista = porChave.get(c) ?? [];
    lista.push(l);
    porChave.set(c, lista);
  }

  const totalFaturamento = linhas.reduce(
    (s, l) => s + (modo === "previsto" ? l.faturamento_previsto : l.faturamento_realizado),
    0,
  );

  const grupos: GrupoRentabilidade[] = [];
  for (const [chave, jobs] of porChave) {
    const bases = agregarBases(jobs, modo);
    const representatividadePct =
      totalFaturamento > 0 ? (bases.faturamento / totalFaturamento) * 100 : 0;
    grupos.push({
      chave,
      rotulo: resolveRotulo(chave),
      bases,
      jobs,
      representatividadePct,
    });
  }

  // Ordena por faturamento desc (padrão da tabela).
  grupos.sort((a, b) => b.bases.faturamento - a.bases.faturamento);
  return grupos;
}

/** Classifica o badge da coluna Rent% pelo threshold. */
export function classificarRentBadge(pct: number | null): "verde" | "laranja" | "vermelho" {
  if (pct === null) return "laranja"; // travessão herda cor neutra
  if (pct >= THRESHOLD_RENT_VERDE) return "verde";
  if (pct >= 0) return "laranja";
  return "vermelho";
}
