import {
  type Trimestre,
  periodoParaFaixaDatas,
} from "../rentabilidade/parse-filtros";
import {
  type StatusFaturamento,
  STATUS_FATURAMENTO,
} from "@/lib/relatorios/faturamento-status";

export type { Trimestre } from "../rentabilidade/parse-filtros";
export { periodoParaFaixaDatas } from "../rentabilidade/parse-filtros";

/** Estado dos filtros vindos da URL, específico do relatório de faturamento. */
export interface FiltrosFaturamento {
  ano: number;
  trimestres: Trimestre[];
  empresasIds: string[];
  regionaisIds: string[];
  clientesIds: string[];
  marcasIds: string[];
  /** Lista de status a manter. Vazio = todos. Aplicado em memória depois
   *  que a view devolve as linhas (status é derivado). */
  statusList: StatusFaturamento[];
  faturamentoMinimo: number | null;
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

const TRIMESTRES_VALIDOS: readonly Trimestre[] = ["Q1", "Q2", "Q3", "Q4"];

export function parseFiltros(searchParams: Params): FiltrosFaturamento {
  const anoParam = Number(pegar(searchParams, "ano"));
  const ano =
    Number.isFinite(anoParam) && anoParam >= 2000 && anoParam <= 2100
      ? anoParam
      : new Date().getFullYear();

  const trimestres = csv(searchParams, "trimestre").filter(
    (t): t is Trimestre => (TRIMESTRES_VALIDOS as readonly string[]).includes(t),
  );

  const statusList = csv(searchParams, "status").filter(
    (s): s is StatusFaturamento =>
      (STATUS_FATURAMENTO as readonly string[]).includes(s),
  );

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
    statusList,
    faturamentoMinimo,
  };
}

export function filtrosParaQueryString(f: FiltrosFaturamento): string {
  const p = new URLSearchParams();
  const anoAtual = new Date().getFullYear();

  if (f.ano !== anoAtual) p.set("ano", String(f.ano));
  if (f.trimestres.length > 0) p.set("trimestre", f.trimestres.join(","));
  if (f.empresasIds.length > 0) p.set("empresa", f.empresasIds.join(","));
  if (f.regionaisIds.length > 0) p.set("regional", f.regionaisIds.join(","));
  if (f.clientesIds.length > 0) p.set("cliente", f.clientesIds.join(","));
  if (f.marcasIds.length > 0) p.set("marca", f.marcasIds.join(","));
  if (f.statusList.length > 0) p.set("status", f.statusList.join(","));
  if (f.faturamentoMinimo !== null) p.set("fatmin", String(f.faturamentoMinimo));

  return p.toString();
}
