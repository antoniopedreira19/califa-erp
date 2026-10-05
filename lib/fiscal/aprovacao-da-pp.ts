/**
 * O que a aprovação da PP lê do módulo fiscal (entrega 1 — 02/10/2026),
 * numa leva só e em paralelo:
 *
 * - o cadastro de impostos (CNPJs, regimes, feriados e parâmetros) — o CNPJ
 *   tomador da NF, o regime dele para o crédito e os vencimentos das guias;
 * - as empresas — o CNPJ tomador sugerido para cada PP;
 * - a última PP aprovada com retenção de cada fornecedor das PPs em
 *   avaliação com NF — o "Repetir as da PP-… (mesmo fornecedor)".
 *
 * As notas de saída dos jobs saíram da leitura com a decisão 146
 * (04/10/2026): o crédito de PIS/COFINS não olha mais o job.
 *
 * A página de Contas a Pagar dispara esta leitura logo depois de montar as
 * linhas das PPs e só espera por ela no fim, enquanto as leituras do cartão
 * correm: não soma ida ao banco ao carregamento. Nunca rejeita — erro de
 * leitura fica no log, e a tela segue com o que veio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UltimaRetencao } from "@/components/financeiro/valor-da-baixa";
import type { ImpostoRetido } from "@/lib/types";
import { carregarCadastroFiscal, type CadastroFiscal } from "./cadastro";
import { tomadoresPadrao } from "./nf-da-pp";

export interface FiscalDaAprovacaoPP {
  /** O cadastro de impostos, sem os CNAEs (a aprovação da PP não usa). */
  cadastro: CadastroFiscal;
  /** Empresa da PP → CNPJ tomador sugerido (`fiscal_estabelecimentos.id`). */
  tomadorPadraoPorEmpresa: Record<string, string>;
  /** A matriz California, para a empresa que não estiver no mapa. */
  tomadorPadraoGeral: string | null;
  /** Fornecedor → alíquotas da última PP aprovada com retenção. */
  ultimasRetencoes: Record<string, UltimaRetencao>;
}

export const FISCAL_DA_APROVACAO_VAZIO: FiscalDaAprovacaoPP = {
  cadastro: { regimes: [], estabelecimentos: [], cnaes: [], feriados: [], parametros: [], receitasAnteriores: [] },
  tomadorPadraoPorEmpresa: {},
  tomadorPadraoGeral: null,
  ultimasRetencoes: {},
};

/** Os parâmetros que a aprovação usa (retenções e crédito). */
const PARAMETROS_DA_APROVACAO = new Set([
  "csrf_pis",
  "csrf_cofins",
  "csrf_csll",
  "irrf_servicos",
  "retencoes_dia",
  "credito_pis",
  "credito_cofins",
]);

/**
 * Teto da leitura das PPs com retenção: a mais recente de cada fornecedor
 * está entre as primeiras. Fornecedor cuja última retenção ficou além dele
 * só não ganha o "Repetir".
 */
const LIMITE_DE_PPS_COM_RETENCAO = 500;

export async function carregarFiscalDaAprovacaoPP(
  supabase: SupabaseClient,
  tenantId: string,
  /** As PPs em avaliação com NF anexada — só elas abrem as seções novas. */
  ppsComNf: ReadonlyArray<{ fornecedor_id: string }>,
): Promise<FiscalDaAprovacaoPP> {
  try {
    const fornecedorIds = [
      ...new Set(ppsComNf.map((p) => p.fornecedor_id).filter((id) => id !== "")),
    ];
    const vazio = Promise.resolve({ data: [] as unknown[], error: null });

    const [cadastro, empresasRes, retencoesRes] = await Promise.all([
      carregarCadastroFiscal(supabase, tenantId),
      supabase.from("empresas").select("id, cnpj, principal").eq("tenant_id", tenantId),
      // A última PP aprovada (ou já paga) de cada fornecedor que tem
      // retenção registrada na aprovação. Reprovada depois volta a
      // `rejeitada` e sai daqui.
      fornecedorIds.length > 0
        ? supabase
            .from("pedidos_compra")
            .select(
              "codigo, fornecedor_id, aprovada_em, retencoes:pedidos_compra_retencoes!inner(imposto, aliquota)",
            )
            .eq("tenant_id", tenantId)
            .in("fornecedor_id", fornecedorIds)
            .in("status", ["aprovada", "pago"])
            .not("aprovada_em", "is", null)
            .order("aprovada_em", { ascending: false })
            .limit(LIMITE_DE_PPS_COM_RETENCAO)
        : vazio,
    ]);

    if (empresasRes.error) console.error("[fiscal.aprovacao_pp.empresas]", empresasRes.error.message);
    if (retencoesRes.error) console.error("[fiscal.aprovacao_pp.retencoes]", retencoesRes.error.message);

    const padrao = tomadoresPadrao(
      cadastro.estabelecimentos,
      (empresasRes.data ?? []) as Array<{ id: string; cnpj: string | null; principal: boolean | null }>,
    );

    return {
      cadastro: {
        ...cadastro,
        cnaes: [],
        parametros: cadastro.parametros.filter((p) => PARAMETROS_DA_APROVACAO.has(p.chave)),
      },
      tomadorPadraoPorEmpresa: padrao.porEmpresa,
      tomadorPadraoGeral: padrao.geral,
      ultimasRetencoes: ultimasRetencoesDasPPs(retencoesRes.data),
    };
  } catch (e) {
    console.error("[fiscal.aprovacao_pp]", e instanceof Error ? e.message : e);
    return FISCAL_DA_APROVACAO_VAZIO;
  }
}

const IMPOSTOS: readonly ImpostoRetido[] = ["ISS", "PIS", "COFINS", "CSLL", "IRRF"];

/** PPs aprovadas com retenção, da mais recente → por fornecedor, a primeira. */
export function ultimasRetencoesDasPPs(pps: unknown[] | null): Record<string, UltimaRetencao> {
  const porFornecedor: Record<string, UltimaRetencao> = {};
  for (const pp of (pps ?? []) as Array<{
    codigo: string;
    fornecedor_id: string | null;
    aprovada_em: string | null;
    retencoes: Array<{ imposto: string; aliquota: string | number }> | null;
  }>) {
    if (!pp.fornecedor_id || porFornecedor[pp.fornecedor_id]) continue;
    const aliquotas: Partial<Record<ImpostoRetido, number>> = {};
    for (const r of pp.retencoes ?? []) {
      const imposto = IMPOSTOS.find((i) => i === r.imposto);
      const aliquota = Number(r.aliquota);
      if (imposto && Number.isFinite(aliquota) && aliquota > 0) aliquotas[imposto] = aliquota;
    }
    if (Object.keys(aliquotas).length === 0) continue;
    porFornecedor[pp.fornecedor_id] = {
      referencia: pp.codigo,
      data: (pp.aprovada_em ?? "").slice(0, 10),
      aliquotas,
    };
  }
  return porFornecedor;
}
