/**
 * A receita de um CNPJ num período, por empresa gerencial e regional — a
 * base que divide a guia entre as regionais (decisão 277).
 *
 * - De outubro/2026 em diante (`PRIMEIRA_COMPETENCIA`): as notas de saída do
 *   sistema emitidas pelo CNPJ no período, pela empresa e regional dos jobs
 *   (a avulsa, pelas regionais dela).
 * - Antes: as notas do histórico da planilha (`historico_notas`), pelo
 *   estabelecimento do CNPJ, com a regional do job da planilha
 *   (`historico_jobs.regional_id` ou a divisão `rateio_regional`, cujos
 *   códigos são os nomes das regionais — AGE é a Agency e DOC a Doca).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotaSaidaFiscal, RateioDaGuia } from "./apuracao";
import { r2, ultimoDiaDoMes } from "./datas";

export interface ParteDaReceita {
  empresa_id: string;
  empresa_nome: string;
  regional_id: string | null;
  regional_nome: string | null;
  valor: number;
}

/** "2026-10" → 01/10 a 31/10; "2026-T3" → 01/07 a 30/09. */
export function periodoDe(competencia: string): { inicio: string; fim: string } {
  if (competencia.includes("-T")) {
    const [ano, t] = competencia.split("-T").map(Number);
    const mesIni = String((t - 1) * 3 + 1).padStart(2, "0");
    const mesFim = `${ano}-${String(t * 3).padStart(2, "0")}`;
    return { inicio: `${ano}-${mesIni}-01`, fim: ultimoDiaDoMes(mesFim) };
  }
  return { inicio: `${competencia}-01`, fim: ultimoDiaDoMes(competencia) };
}

/** Soma por empresa × regional e põe o % de cada parte (a base do rateio). */
export function baseDaReceita(partes: ParteDaReceita[]): RateioDaGuia[] {
  const m = new Map<string, ParteDaReceita>();
  for (const p of partes) {
    if (!(p.valor > 0)) continue;
    const k = `${p.empresa_id}|${p.regional_id ?? ""}`;
    const atual = m.get(k);
    if (atual) atual.valor = r2(atual.valor + p.valor);
    else m.set(k, { ...p, valor: r2(p.valor) });
  }
  const lista = [...m.values()].sort((a, b) => b.valor - a.valor);
  const soma = lista.reduce((s, x) => s + x.valor, 0);
  return lista.map((x) => ({ ...x, pct: soma > 0 ? r2((x.valor / soma) * 100) : 0 }));
}

/** As notas do sistema emitidas pelos estabelecimentos do CNPJ no período. */
export function receitaDasNotas(notas: NotaSaidaFiscal[], estabelecimentos: Set<string>, inicio: string, fim: string): ParteDaReceita[] {
  return notas
    .filter((n) => estabelecimentos.has(n.estabelecimento_id) && n.emissao >= inicio && n.emissao <= fim)
    .flatMap((n) =>
      n.jobs.map((j) => ({
        empresa_id: j.empresa_id,
        empresa_nome: j.empresa_nome,
        regional_id: j.regional_id,
        regional_nome: j.regional_nome,
        valor: j.valor,
      })),
    );
}

/** O código da regional na planilha → o nome da regional no sistema. */
const NOME_DO_CODIGO: Record<string, string> = { AGE: "Agency", DOC: "Doca" };

export interface NotaDoHistorico {
  empresa_id: string | null;
  empresa_nome: string;
  valor: number;
  regional_id: string | null;
  rateio_regional: Record<string, number> | null;
}

/** Reparte as notas do histórico pelas regionais do job (id resolvido ou a divisão por código). */
export function receitaDoHistorico(
  notas: NotaDoHistorico[],
  regionaisPorEmpresa: Map<string, Array<{ id: string; nome: string }>>,
): ParteDaReceita[] {
  const out: ParteDaReceita[] = [];
  for (const n of notas) {
    if (!n.empresa_id || !(n.valor > 0)) continue;
    const regs = regionaisPorEmpresa.get(n.empresa_id) ?? [];
    const base = { empresa_id: n.empresa_id, empresa_nome: n.empresa_nome };
    if (n.regional_id) {
      out.push({ ...base, regional_id: n.regional_id, regional_nome: regs.find((r) => r.id === n.regional_id)?.nome ?? null, valor: n.valor });
      continue;
    }
    const div = Object.entries(n.rateio_regional ?? {}).filter(([, f]) => Number(f) > 0);
    const somaDiv = div.reduce((s, [, f]) => s + Number(f), 0);
    if (!div.length || somaDiv <= 0) {
      out.push({ ...base, regional_id: null, regional_nome: null, valor: n.valor });
      continue;
    }
    for (const [codigo, f] of div) {
      const nome = NOME_DO_CODIGO[codigo.toUpperCase()] ?? codigo.toUpperCase();
      const reg = regs.find((r) => r.nome.toUpperCase() === nome.toUpperCase());
      out.push({ ...base, regional_id: reg?.id ?? null, regional_nome: reg?.nome ?? null, valor: r2((n.valor * Number(f)) / somaDiv) });
    }
  }
  return out;
}

/** Lê as notas do histórico do CNPJ no período (pelo nome do estabelecimento). */
export async function carregarNotasDoHistorico(
  supabase: SupabaseClient,
  tenantId: string,
  nomesDosEstabelecimentos: string[],
  inicio: string,
  fim: string,
): Promise<NotaDoHistorico[]> {
  if (!nomesDosEstabelecimentos.length) return [];
  const { data, error } = await supabase
    .from("historico_notas")
    .select("empresa_id, empresa_nome, valor, job_chave, situacao, carga:historico_cargas!inner(situacao)")
    .eq("tenant_id", tenantId)
    .eq("carga.situacao", "ativa")
    .in("estabelecimento", nomesDosEstabelecimentos)
    .gte("emissao", inicio)
    .lte("emissao", fim);
  if (error) throw new Error(`[fiscal.receita.historico] ${error.message}`);
  type Linha = { empresa_id: string | null; empresa_nome: string | null; valor: number | string; job_chave: string | null; situacao: string | null };
  const linhas = ((data ?? []) as Linha[]).filter((l) => !/cancel/i.test(l.situacao ?? ""));
  const chaves = [...new Set(linhas.map((l) => l.job_chave).filter((c): c is string => !!c))];
  const jobs = new Map<string, { regional_id: string | null; rateio_regional: Record<string, number> | null }>();
  for (let i = 0; i < chaves.length; i += 200) {
    const { data: js, error: e2 } = await supabase
      .from("historico_jobs")
      .select("chave, regional_id, rateio_regional, carga:historico_cargas!inner(situacao)")
      .eq("tenant_id", tenantId)
      .eq("carga.situacao", "ativa")
      .in("chave", chaves.slice(i, i + 200));
    if (e2) throw new Error(`[fiscal.receita.historico_jobs] ${e2.message}`);
    for (const j of (js ?? []) as Array<{ chave: string; regional_id: string | null; rateio_regional: Record<string, number> | null }>) {
      jobs.set(j.chave, { regional_id: j.regional_id, rateio_regional: j.rateio_regional });
    }
  }
  return linhas.map((l) => {
    const j = l.job_chave ? jobs.get(l.job_chave) : undefined;
    return {
      empresa_id: l.empresa_id,
      empresa_nome: l.empresa_nome ?? "—",
      valor: Number(l.valor),
      regional_id: j?.regional_id ?? null,
      rateio_regional: j?.rateio_regional ?? null,
    };
  });
}
