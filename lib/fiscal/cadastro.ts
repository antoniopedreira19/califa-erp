/**
 * Leitura do cadastro de impostos (módulo fiscal, entrega 1 — 02/10/2026).
 *
 * Uma função só, usada pelo Faturar, pela aprovação da PP e pela tela do
 * cadastro: as cinco tabelas `fiscal_*` em paralelo, e os helpers que juntam
 * cada CNPJ ao regime da PJ dele (`EstabelecimentoDoCalculo`) e escolhem os
 * CNAEs vigentes numa data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FiscalCnae,
  FiscalEstabelecimento,
  FiscalFeriado,
  FiscalParametro,
  FiscalRegime,
} from "@/lib/types";
import type { CnaeDoCalculo, EstabelecimentoDoCalculo, ParametrosDeRetencao } from "./calculos";
import { PARAMETROS_DE_RETENCAO_PADRAO } from "./calculos";
import type { FeriadoDoVencimento } from "./datas";

export interface CadastroFiscal {
  regimes: FiscalRegime[];
  estabelecimentos: FiscalEstabelecimento[];
  cnaes: FiscalCnae[];
  feriados: FiscalFeriado[];
  parametros: FiscalParametro[];
}

export async function carregarCadastroFiscal(supabase: SupabaseClient, tenantId: string): Promise<CadastroFiscal> {
  const [regimes, estabelecimentos, cnaes, feriados, parametros] = await Promise.all([
    supabase.from("fiscal_regimes").select("*").eq("tenant_id", tenantId).order("vigencia_inicio"),
    supabase.from("fiscal_estabelecimentos").select("*").eq("tenant_id", tenantId).order("ordem").order("nome"),
    supabase.from("fiscal_cnaes").select("*").eq("tenant_id", tenantId).order("codigo").order("subitem", { nullsFirst: true }),
    supabase.from("fiscal_feriados").select("*").eq("tenant_id", tenantId).order("data"),
    supabase.from("fiscal_parametros").select("*").eq("tenant_id", tenantId).order("chave"),
  ]);
  for (const r of [regimes, estabelecimentos, cnaes, feriados, parametros]) {
    if (r.error) console.error("[fiscal.cadastro]", r.error.message);
  }
  return {
    regimes: (regimes.data ?? []) as FiscalRegime[],
    estabelecimentos: (estabelecimentos.data ?? []) as FiscalEstabelecimento[],
    cnaes: ((cnaes.data ?? []) as FiscalCnae[]).map((c) => ({
      ...c,
      // numeric chega como string do PostgREST
      aliquota_iss: c.aliquota_iss === null ? null : Number(c.aliquota_iss),
      aliquota_pis: Number(c.aliquota_pis),
      aliquota_cofins: Number(c.aliquota_cofins),
    })),
    feriados: (feriados.data ?? []) as FiscalFeriado[],
    parametros: ((parametros.data ?? []) as FiscalParametro[]).map((p) => ({ ...p, valor: Number(p.valor) })),
  };
}

/** Vigente na data: começou até ela e não terminou antes. */
const vigenteEm = (inicio: string, fim: string | null, data: string) => inicio <= data && (fim === null || fim >= data);

/** O regime da PJ do CNPJ na data (lucro real quando não houver registro). */
export function regimeDaPJ(cad: CadastroFiscal, empresaContabilId: string, data: string) {
  const r = cad.regimes
    .filter((x) => x.empresa_contabil_id === empresaContabilId && vigenteEm(x.vigencia_inicio, x.vigencia_fim, data))
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0];
  return { regime: r?.regime ?? "lucro_real", regime_caixa: r?.regime_caixa ?? false };
}

/** O CNPJ pronto para os cálculos: com o regime da PJ e o município da matriz. */
export function estabelecimentoDoCalculo(cad: CadastroFiscal, estab: FiscalEstabelecimento, data: string): EstabelecimentoDoCalculo {
  const matriz =
    cad.estabelecimentos.find((e) => e.empresa_contabil_id === estab.empresa_contabil_id && e.papel === "matriz") ?? estab;
  const { regime, regime_caixa } = regimeDaPJ(cad, estab.empresa_contabil_id, data);
  return {
    id: estab.id,
    nome: estab.nome,
    municipio: estab.municipio,
    iss_dia: estab.iss_dia,
    iss_retido_dia: estab.iss_retido_dia,
    iss_regra: estab.iss_regra,
    municipio_da_matriz: matriz.municipio,
    regime,
    regime_caixa,
  };
}

/** Os CNAEs ativos e vigentes de um CNPJ numa data, em ordem de código e subitem. */
export function cnaesVigentes(cad: CadastroFiscal, estabelecimentoId: string, data: string): FiscalCnae[] {
  return cad.cnaes.filter(
    (c) => c.estabelecimento_id === estabelecimentoId && c.ativo && vigenteEm(c.vigencia_inicio, c.vigencia_fim, data),
  );
}

/**
 * Todos os CNAEs do grupo, um por código + subitem (para o CNAE sugerido do
 * envio para faturamento, que ainda não sabe o CNPJ que vai emitir).
 */
export function cnaesDoGrupo(cad: CadastroFiscal): FiscalCnae[] {
  const vistos = new Map<string, FiscalCnae>();
  for (const c of cad.cnaes) {
    if (!c.ativo) continue;
    const chave = `${c.codigo}|${c.subitem ?? ""}`;
    if (!vistos.has(chave)) vistos.set(chave, c);
  }
  return [...vistos.values()].sort((a, b) => a.codigo.localeCompare(b.codigo) || (a.subitem ?? "").localeCompare(b.subitem ?? ""));
}

export function feriadosDoCalculo(cad: CadastroFiscal): FeriadoDoVencimento[] {
  return cad.feriados.map((f) => ({ data: f.data, nome: f.nome, municipio: f.municipio }));
}

export function parametrosDeRetencao(cad: CadastroFiscal): ParametrosDeRetencao {
  const v = (chave: keyof ParametrosDeRetencao) => cad.parametros.find((p) => p.chave === chave)?.valor;
  return {
    csrf_pis: v("csrf_pis") ?? PARAMETROS_DE_RETENCAO_PADRAO.csrf_pis,
    csrf_cofins: v("csrf_cofins") ?? PARAMETROS_DE_RETENCAO_PADRAO.csrf_cofins,
    csrf_csll: v("csrf_csll") ?? PARAMETROS_DE_RETENCAO_PADRAO.csrf_csll,
    irrf_servicos: v("irrf_servicos") ?? PARAMETROS_DE_RETENCAO_PADRAO.irrf_servicos,
    retencoes_dia: v("retencoes_dia") ?? PARAMETROS_DE_RETENCAO_PADRAO.retencoes_dia,
  };
}

export function cnaeDoCalculo(c: FiscalCnae): CnaeDoCalculo {
  return {
    id: c.id,
    codigo: c.codigo,
    subitem: c.subitem,
    descricao: c.descricao,
    aliquota_iss: c.aliquota_iss,
    aliquota_pis: c.aliquota_pis,
    aliquota_cofins: c.aliquota_cofins,
    cumulativo: c.cumulativo,
  };
}

/** "19.437.976/0001-54". */
export function formatarCnpj(cnpj: string | null) {
  if (!cnpj) return "CNPJ a informar";
  const d = cnpj.replace(/\D/g, "").padStart(14, "0");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
