import type { ModoRentabilidade, VisaoRentabilidade } from "@/lib/relatorios/rentabilidade";

/** Um trimestre do calendário. */
export type Trimestre = "Q1" | "Q2" | "Q3" | "Q4";
const TRIMESTRES: readonly Trimestre[] = ["Q1", "Q2", "Q3", "Q4"];

/** Estado dos filtros vindos da URL. */
export interface FiltrosRentabilidade {
  ano: number;
  trimestres: Trimestre[];
  empresasIds: string[];
  regionaisIds: string[];
  clientesIds: string[];
  marcasIds: string[];
  /** null = sem filtro. Aplicado depois da agregação (filtra grupo). */
  faturamentoMinimo: number | null;
  modo: ModoRentabilidade;
  visao: VisaoRentabilidade;
  /** Ano do 2º período pra comparar. null = comparativo desligado. */
  compararAno: number | null;
}

type Params = Record<string, string | string[] | undefined>;

function pegar(params: Params, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

function csv(params: Params, key: string): string[] {
  const v = pegar(params, key);
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Lê searchParams e devolve o estado dos filtros com defaults. */
export function parseFiltros(searchParams: Params): FiltrosRentabilidade {
  const anoParam = Number(pegar(searchParams, "ano"));
  const ano = Number.isFinite(anoParam) && anoParam >= 2000 && anoParam <= 2100
    ? anoParam
    : new Date().getFullYear();

  const trimestres = csv(searchParams, "trimestre").filter(
    (t): t is Trimestre => (TRIMESTRES as readonly string[]).includes(t),
  );

  const modoParam = pegar(searchParams, "modo");
  const modo: ModoRentabilidade = modoParam === "realizado" ? "realizado" : "previsto";

  const visaoParam = pegar(searchParams, "visao");
  const visao: VisaoRentabilidade =
    visaoParam === "marca" || visaoParam === "job" ? visaoParam : "cliente";

  const compararRaw = Number(pegar(searchParams, "comparar"));
  const compararAno =
    Number.isFinite(compararRaw) && compararRaw >= 2000 && compararRaw <= 2100
      ? compararRaw
      : null;

  const fatMinRaw = Number(pegar(searchParams, "fatmin"));
  const faturamentoMinimo =
    Number.isFinite(fatMinRaw) && fatMinRaw > 0 ? fatMinRaw : null;

  return {
    ano,
    trimestres,
    empresasIds: csv(searchParams, "empresa"),
    regionaisIds: csv(searchParams, "regional"),
    clientesIds: csv(searchParams, "cliente"),
    marcasIds: csv(searchParams, "marca"),
    faturamentoMinimo,
    modo,
    visao,
    compararAno,
  };
}

/** Serializa filtros pra query string. Omite campos com valor default. */
export function filtrosParaQueryString(f: FiltrosRentabilidade): string {
  const p = new URLSearchParams();
  const anoAtual = new Date().getFullYear();

  if (f.ano !== anoAtual) p.set("ano", String(f.ano));
  if (f.trimestres.length > 0) p.set("trimestre", f.trimestres.join(","));
  if (f.empresasIds.length > 0) p.set("empresa", f.empresasIds.join(","));
  if (f.regionaisIds.length > 0) p.set("regional", f.regionaisIds.join(","));
  if (f.clientesIds.length > 0) p.set("cliente", f.clientesIds.join(","));
  if (f.marcasIds.length > 0) p.set("marca", f.marcasIds.join(","));
  if (f.faturamentoMinimo !== null) p.set("fatmin", String(f.faturamentoMinimo));
  if (f.modo !== "previsto") p.set("modo", f.modo);
  if (f.visao !== "cliente") p.set("visao", f.visao);
  if (f.compararAno !== null) p.set("comparar", String(f.compararAno));

  return p.toString();
}

/**
 * Traduz um período (ano + trimestres) em faixa de datas
 * `data_abertura_financeiro`. Sem trimestres = ano inteiro.
 */
export function periodoParaFaixaDatas(
  ano: number,
  trimestres: Trimestre[],
): { inicio: string; fim: string }[] {
  if (trimestres.length === 0) {
    return [{ inicio: `${ano}-01-01`, fim: `${ano}-12-31` }];
  }
  const map: Record<Trimestre, { m0: number; m1: number }> = {
    Q1: { m0: 1, m1: 3 },
    Q2: { m0: 4, m1: 6 },
    Q3: { m0: 7, m1: 9 },
    Q4: { m0: 10, m1: 12 },
  };
  return trimestres.map((t) => {
    const { m0, m1 } = map[t];
    const ultDia = new Date(ano, m1, 0).getDate();
    return {
      inicio: `${ano}-${String(m0).padStart(2, "0")}-01`,
      fim: `${ano}-${String(m1).padStart(2, "0")}-${ultDia}`,
    };
  });
}
