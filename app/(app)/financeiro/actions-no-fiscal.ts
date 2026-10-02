"use server";

/**
 * Módulo fiscal (entrega 2, 02/10/2026): o que o bloco "No fiscal" das
 * baixas precisa para dizer o efeito de cada baixa na Apuração — lido
 * quando o diálogo abre, à parte, para não atrasar a abertura.
 *
 * - `lerFiscalDaParcela`: a parcela de PP, pela NF do fornecedor registrada
 *   na aprovação (emissão e CNPJ tomador).
 * - `lerFiscalDaNota`: a nota de saída, pelo CNPJ emissor e o CNAE escolhidos
 *   no Faturar, e a guia de ISS do mês dela, se já aprovada.
 * - `lerFiscalDoLote`: as parcelas e os títulos de nota de uma baixa em lote.
 *
 * Junto vai o cadastro mínimo (CNPJs, feriados e o parâmetro do dia de
 * vencimento): a tela refaz a conta a cada mudança de data, valor e retidos
 * (`lib/fiscal/no-fiscal.ts`). Entra só o que o motor da apuração também
 * conta (`lib/fiscal/apuracao-fatos.ts`); o resto devolve `null`, e o bloco
 * não aparece.
 *
 * Só leitura. Mesma trava das baixas: admin ou financeiro, com
 * `acao_negada` no audit.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { MUNICIPIOS_QUE_COMPENSAM_ISS, PRIMEIRA_COMPETENCIA } from "@/lib/fiscal/apuracao";
import type { FeriadoDoVencimento } from "@/lib/fiscal/datas";
import type {
  FiscalDoLote,
  FiscalDoPagamento,
  FiscalDoRecebimento,
  ParametroComVigencia,
  PJDoFiscal,
  RegimeComVigencia,
} from "@/lib/fiscal/no-fiscal";
import type { RegimeTributarioPJ, RegraDeVencimentoFiscal } from "@/lib/types";

type Resultado<T> = { ok: true; fiscal: T | null } | { ok: false; message: string };

const SEM_PERMISSAO = "Apenas admin ou financeiro pode executar esta ação.";
const ERRO_DA_LEITURA = "Não foi possível buscar o efeito desta baixa no fiscal.";

/** Lote de ids por consulta: a lista vai na URL do PostgREST. */
const POR_CONSULTA = 50;

async function travaDoFinanceiro(acaoTentada: string, entidadeTipo: string, entidadeId: string | null) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false as const };
  }
  return { ok: true as const, tenantId: session.activeTenant.id, supabase: createClient() };
}

// ---------------------------------------------------------------------------
// O cadastro mínimo
// ---------------------------------------------------------------------------

interface EstabDoBanco {
  id: string;
  empresa_contabil_id: string;
  nome: string;
  papel: "matriz" | "filial";
  municipio: string;
  uf: string;
  iss_retido_dia: number;
  iss_regra: RegraDeVencimentoFiscal;
}

interface CadastroMinimo {
  estabelecimentos: EstabDoBanco[];
  feriados: FeriadoDoVencimento[];
  /** Por chave (`retencoes_dia`, `pis_cofins_dia`). */
  parametros: Map<string, ParametroComVigencia[]>;
  regimes: RegimeComVigencia[];
}

async function lerCadastroMinimo(
  supabase: SupabaseClient,
  tenantId: string,
  chaves: string[],
): Promise<CadastroMinimo | null> {
  const [estabs, feriados, parametros, regimes] = await Promise.all([
    supabase
      .from("fiscal_estabelecimentos")
      .select("id, empresa_contabil_id, nome, papel, municipio, uf, iss_retido_dia, iss_regra")
      .eq("tenant_id", tenantId)
      .order("ordem")
      .order("nome"),
    supabase.from("fiscal_feriados").select("data, nome, municipio").eq("tenant_id", tenantId),
    supabase
      .from("fiscal_parametros")
      .select("chave, valor, vigencia_inicio")
      .eq("tenant_id", tenantId)
      .in("chave", chaves),
    supabase
      .from("fiscal_regimes")
      .select("empresa_contabil_id, regime, regime_caixa, vigencia_inicio, vigencia_fim")
      .eq("tenant_id", tenantId),
  ]);
  for (const r of [estabs, feriados, parametros, regimes]) {
    if (r.error) {
      console.error("[no-fiscal.cadastro]", r.error.message);
      return null;
    }
  }
  const porChave = new Map<string, ParametroComVigencia[]>();
  for (const p of (parametros.data ?? []) as Array<{ chave: string; valor: number | string; vigencia_inicio: string }>) {
    const valor = Number(p.valor);
    if (!Number.isFinite(valor)) continue;
    porChave.set(p.chave, [...(porChave.get(p.chave) ?? []), { valor, vigencia_inicio: p.vigencia_inicio }]);
  }
  return {
    estabelecimentos: (estabs.data ?? []) as EstabDoBanco[],
    feriados: (feriados.data ?? []) as FeriadoDoVencimento[],
    parametros: porChave,
    regimes: ((regimes.data ?? []) as Array<{
      empresa_contabil_id: string;
      regime: RegimeTributarioPJ;
      regime_caixa: boolean | null;
      vigencia_inicio: string;
      vigencia_fim: string | null;
    }>).map((r) => ({ ...r, regime_caixa: Boolean(r.regime_caixa) })),
  };
}

/** A PJ de um CNPJ, pela matriz (a mesma escolha de `matriz` e `nomeDaPJ` do motor). */
function pjDoEstab(cad: CadastroMinimo, estab: EstabDoBanco): PJDoFiscal {
  const daPJ = cad.estabelecimentos.filter((e) => e.empresa_contabil_id === estab.empresa_contabil_id);
  const matriz = daPJ.find((e) => e.papel === "matriz") ?? daPJ[0] ?? estab;
  return {
    id: estab.empresa_contabil_id,
    nome: matriz.nome.split(" · ")[0].trim() || matriz.nome,
    municipio_da_matriz: matriz.municipio,
  };
}

// ---------------------------------------------------------------------------
// A NF do fornecedor registrada na aprovação da PP
// ---------------------------------------------------------------------------

interface PPDoBanco {
  status: string;
  nf_numero: string | null;
  nf_data_emissao: string | null;
  nf_valor: number | string | null;
  nf_tomador_estabelecimento_id: string | null;
  nf_registrada_em: string | null;
  job_id: string | null;
}

const SELECT_PP =
  "pp:pedidos_compra!pedido_compra_id(status, nf_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, nf_registrada_em, job_id)";

/** O mesmo filtro de `carregarFatosFiscais`: o que o motor conta como NF de fornecedor. */
function entraNaApuracao(pp: PPDoBanco | null): pp is PPDoBanco & { nf_data_emissao: string; nf_tomador_estabelecimento_id: string } {
  return Boolean(
    pp &&
      (pp.status === "aprovada" || pp.status === "pago") &&
      pp.nf_registrada_em &&
      pp.nf_data_emissao &&
      pp.nf_valor !== null &&
      pp.nf_tomador_estabelecimento_id &&
      pp.job_id,
  );
}

/**
 * A baixa de uma parcela de PP. `fiscal: null` quando a PP não tem a NF
 * registrada na aprovação (ou o CNPJ tomador saiu do cadastro): a baixa
 * não gera guia na Apuração.
 */
export async function lerFiscalDaParcela(parcelaId: unknown): Promise<Resultado<FiscalDoPagamento>> {
  const id = z.string().uuid().safeParse(parcelaId);
  if (!id.success) return { ok: false, message: ERRO_DA_LEITURA };

  const trava = await travaDoFinanceiro("pedido_compra.no_fiscal_lido", "pedido_compra", id.data);
  if (!trava.ok) return { ok: false, message: SEM_PERMISSAO };

  const [parcela, cad] = await Promise.all([
    trava.supabase
      .from("pedidos_compra_parcelas")
      .select(SELECT_PP)
      .eq("id", id.data)
      .eq("tenant_id", trava.tenantId)
      .maybeSingle<{ pp: PPDoBanco | null }>(),
    lerCadastroMinimo(trava.supabase, trava.tenantId, ["retencoes_dia"]),
  ]);
  if (parcela.error || !cad) {
    if (parcela.error) console.error("[no-fiscal.parcela]", parcela.error.message);
    return { ok: false, message: ERRO_DA_LEITURA };
  }
  const pp = parcela.data?.pp ?? null;
  if (!entraNaApuracao(pp)) return { ok: true, fiscal: null };
  const tomador = cad.estabelecimentos.find((e) => e.id === pp.nf_tomador_estabelecimento_id);
  if (!tomador) return { ok: true, fiscal: null };

  return {
    ok: true,
    fiscal: {
      nf: { numero: pp.nf_numero ?? "—", emissao: pp.nf_data_emissao },
      tomador: {
        nome: tomador.nome,
        municipio: tomador.municipio,
        uf: tomador.uf,
        iss_retido_dia: tomador.iss_retido_dia,
        iss_regra: tomador.iss_regra,
      },
      pj: pjDoEstab(cad, tomador),
      feriados: cad.feriados,
      dia_das_retencoes: cad.parametros.get("retencoes_dia") ?? [],
      primeira_competencia: PRIMEIRA_COMPETENCIA,
    },
  };
}

// ---------------------------------------------------------------------------
// A nota de saída
// ---------------------------------------------------------------------------

interface NotaDoBanco {
  numero_nf: string;
  data_emissao: string;
  status: string;
  estabelecimento_id: string | null;
  fiscal_cnae_id: string | null;
}

interface CnaeDoBanco {
  id: string;
  estabelecimento_id: string;
  codigo: string;
  subitem: string | null;
  aliquota_pis: number | string;
  aliquota_cofins: number | string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  ativo: boolean;
}

/** O CNAE da nota na versão vigente na emissão (a mesma escolha do motor). */
function cnaeVigenteNaEmissao(cnaes: CnaeDoBanco[], escolhidoId: string, emissao: string): CnaeDoBanco | null {
  const escolhido = cnaes.find((c) => c.id === escolhidoId);
  if (!escolhido) return null;
  const vigente = cnaes
    .filter(
      (c) =>
        c.estabelecimento_id === escolhido.estabelecimento_id &&
        c.codigo === escolhido.codigo &&
        (c.subitem ?? "") === (escolhido.subitem ?? "") &&
        c.vigencia_inicio <= emissao &&
        (c.vigencia_fim === null || c.vigencia_fim >= emissao),
    )
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0];
  return vigente ?? escolhido;
}

interface AprovacaoDoBanco {
  data: string;
  diferenca: boolean;
  titulos: Array<{ origem: string; status: string; pago_em: string | null }> | null;
}

/**
 * A baixa de um título de nota fiscal (`notaId` = `faturamentos.id`).
 * `fiscal: null` quando a nota não diz por qual CNPJ saiu (as de antes do
 * módulo fiscal) ou não está emitida: o motor não a conta.
 */
export async function lerFiscalDaNota(notaId: unknown): Promise<Resultado<FiscalDoRecebimento>> {
  const id = z.string().uuid().safeParse(notaId);
  if (!id.success) return { ok: false, message: ERRO_DA_LEITURA };

  const trava = await travaDoFinanceiro("faturamento.no_fiscal_lido", "faturamento", id.data);
  if (!trava.ok) return { ok: false, message: SEM_PERMISSAO };
  const { supabase, tenantId } = trava;

  const [nota, cnaes, cad] = await Promise.all([
    supabase
      .from("faturamentos")
      .select("numero_nf, data_emissao, status, estabelecimento_id, fiscal_cnae_id")
      .eq("id", id.data)
      .eq("tenant_id", tenantId)
      .maybeSingle<NotaDoBanco>(),
    supabase
      .from("fiscal_cnaes")
      .select("id, estabelecimento_id, codigo, subitem, aliquota_pis, aliquota_cofins, vigencia_inicio, vigencia_fim, ativo")
      .eq("tenant_id", tenantId),
    lerCadastroMinimo(supabase, tenantId, ["pis_cofins_dia"]),
  ]);
  if (nota.error || cnaes.error || !cad) {
    console.error("[no-fiscal.nota]", nota.error?.message ?? cnaes.error?.message ?? "cadastro");
    return { ok: false, message: ERRO_DA_LEITURA };
  }
  const n = nota.data;
  if (!n || n.status !== "emitido" || !n.estabelecimento_id || !n.fiscal_cnae_id) return { ok: true, fiscal: null };
  const emissor = cad.estabelecimentos.find((e) => e.id === n.estabelecimento_id);
  const emissao = n.data_emissao.slice(0, 10);
  const cnae = cnaeVigenteNaEmissao((cnaes.data ?? []) as CnaeDoBanco[], n.fiscal_cnae_id, emissao);
  if (!emissor || !cnae) return { ok: true, fiscal: null };

  // A guia de ISS próprio do mês da emissão: vale a aprovação original (a
  // diferença não a substitui — `aprovacaoPorChave` do motor).
  const aprovacoes = await supabase
    .from("fiscal_aprovacoes")
    .select("data, diferenca, titulos:impostos_a_pagar(origem, status, pago_em)")
    .eq("tenant_id", tenantId)
    .eq("chave", `iss|${emissor.id}|${emissao.slice(0, 7)}`)
    .order("aprovada_em");
  if (aprovacoes.error) {
    console.error("[no-fiscal.aprovacoes]", aprovacoes.error.message);
    return { ok: false, message: ERRO_DA_LEITURA };
  }
  let original: AprovacaoDoBanco | null = null;
  for (const a of (aprovacoes.data ?? []) as AprovacaoDoBanco[]) if (!a.diferenca || !original) original = a;
  const pagamento = original?.titulos?.find((t) => t.origem === "apuracao" && t.status === "pago" && t.pago_em);

  const pj = pjDoEstab(cad, emissor);
  return {
    ok: true,
    fiscal: {
      nota: { numero: n.numero_nf, emissao },
      emissor: { nome: emissor.nome, municipio: emissor.municipio, uf: emissor.uf },
      pj,
      regimes: cad.regimes.filter((r) => r.empresa_contabil_id === pj.id),
      cnae: { aliquota_pis: Number(cnae.aliquota_pis), aliquota_cofins: Number(cnae.aliquota_cofins) },
      guia_iss: original ? { aprovada_em: original.data, paga_em: pagamento?.pago_em ?? null } : null,
      compensa_iss: MUNICIPIOS_QUE_COMPENSAM_ISS.has(emissor.municipio),
      feriados: cad.feriados,
      dia_do_pis_cofins: cad.parametros.get("pis_cofins_dia") ?? [],
      primeira_competencia: PRIMEIRA_COMPETENCIA,
    },
  };
}

// ---------------------------------------------------------------------------
// A baixa em lote
// ---------------------------------------------------------------------------

const entradaDoLote = z.object({
  parcelas: z.array(z.string().uuid()).max(200),
  titulos: z.array(z.string().uuid()).max(200),
});

function emPartes(ids: string[]): string[][] {
  const partes: string[][] = [];
  for (let i = 0; i < ids.length; i += POR_CONSULTA) partes.push(ids.slice(i, i + POR_CONSULTA));
  return partes;
}

/**
 * A baixa em lote: as parcelas de PP (`pedidos_compra_parcelas.id`) e os
 * títulos de nota (`titulos_receber.id`) selecionados. Só entram nos mapas
 * os que a Apuração conta; o resto fica de fora.
 */
export async function lerFiscalDoLote(entrada: unknown): Promise<Resultado<FiscalDoLote>> {
  const parsed = entradaDoLote.safeParse(entrada);
  if (!parsed.success) return { ok: false, message: ERRO_DA_LEITURA };

  const trava = await travaDoFinanceiro("titulos.no_fiscal_do_lote_lido", "titulo_pagar", null);
  if (!trava.ok) return { ok: false, message: SEM_PERMISSAO };
  const { supabase, tenantId } = trava;
  const { parcelas, titulos } = parsed.data;

  const [resParcelas, resTitulos, cad] = await Promise.all([
    Promise.all(
      emPartes(parcelas).map((ids) =>
        supabase.from("pedidos_compra_parcelas").select(`id, ${SELECT_PP}`).in("id", ids).eq("tenant_id", tenantId),
      ),
    ),
    Promise.all(
      emPartes(titulos).map((ids) =>
        supabase
          .from("titulos_receber")
          .select("id, nota:faturamentos!faturamento_id(status, estabelecimento_id, fiscal_cnae_id)")
          .in("id", ids)
          .eq("tenant_id", tenantId),
      ),
    ),
    lerCadastroMinimo(supabase, tenantId, ["retencoes_dia"]),
  ]);
  const erro = [...resParcelas, ...resTitulos].find((r) => r.error)?.error;
  if (erro || !cad) {
    console.error("[no-fiscal.lote]", erro?.message ?? "cadastro");
    return { ok: false, message: ERRO_DA_LEITURA };
  }

  const estab = (id: string | null) => (id ? cad.estabelecimentos.find((e) => e.id === id) : undefined);
  const porParcela: Record<string, PJDoFiscal> = {};
  for (const r of resParcelas.flatMap((x) => (x.data ?? []) as unknown as Array<{ id: string; pp: PPDoBanco | null }>)) {
    if (!entraNaApuracao(r.pp)) continue;
    const tomador = estab(r.pp.nf_tomador_estabelecimento_id);
    if (tomador) porParcela[r.id] = pjDoEstab(cad, tomador);
  }
  const porTitulo: Record<string, PJDoFiscal> = {};
  for (const r of resTitulos.flatMap(
    (x) =>
      (x.data ?? []) as unknown as Array<{
        id: string;
        nota: { status: string; estabelecimento_id: string | null; fiscal_cnae_id: string | null } | null;
      }>,
  )) {
    if (!r.nota || r.nota.status !== "emitido" || !r.nota.fiscal_cnae_id) continue;
    const emissor = estab(r.nota.estabelecimento_id);
    if (emissor) porTitulo[r.id] = pjDoEstab(cad, emissor);
  }

  return {
    ok: true,
    fiscal: {
      parcelas: porParcela,
      titulos: porTitulo,
      regimes: cad.regimes,
      feriados: cad.feriados,
      dia_das_retencoes: cad.parametros.get("retencoes_dia") ?? [],
      primeira_competencia: PRIMEIRA_COMPETENCIA,
    },
  };
}
