"use server";

/**
 * Aprovação das guias da Apuração (módulo fiscal, entrega 2 — protótipo
 * aprovado pelo Tiago em 02/10/2026).
 *
 * O cliente manda só as decisões da pessoa (valor da guia, justificativa,
 * compensação, cota única, juros das cotas e o anexo já enviado ao bucket).
 * A guia é RECALCULADA aqui, com os fatos do banco de agora: o calculado, a
 * memória, as compensações, as cotas e o rateio saem do servidor
 * (`montarPedidoDeAprovacao`), e `aprovar_guia_fiscal` grava a aprovação e
 * os títulos de Impostos a Pagar numa transação, com as mesmas travas.
 *
 * Trava de papel como as vizinhas: admin ou financeiro, com `acao_negada`
 * na auditoria (a função do banco confere de novo).
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { carregarFatosFiscais, type FatosDoBanco } from "@/lib/fiscal/apuracao-fatos";
import { PRIMEIRA_COMPETENCIA, calcularApuracao, estadoDaGuia, type Guia, type RateioDaGuia } from "@/lib/fiscal/apuracao";
import { baseDaReceita, carregarNotasDoHistorico, periodoDe, receitaDasNotas, receitaDoHistorico } from "@/lib/fiscal/receita-do-periodo";
import { rateioPorGerencial } from "@/lib/fiscal/rateio-gerencial";
import { carregarRegrasDoRateio, regrasDoCnpj } from "@/lib/fiscal/rateio-gerencial-dados";
import { montarPedidoDeAprovacao, validarAjusteDaBase, type EntradaDaAprovacao } from "./aprovacao";
import { hojeEmSaoPaulo } from "./dados";

type Err = { ok: false; message: string };

const ROLES_PERMITIDOS = ["administrador", "financeiro"] as const;
const CAMINHO = "/financeiro/fiscal";
const BUCKET = "impostos";

async function checarGate(acaoTentada: string, entidadeId: string | null) {
  const session = await requireSession();
  if (!(ROLES_PERMITIDOS as readonly string[]).includes(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "fiscal_aprovacao",
      entidadeId: entidadeId ?? undefined,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false as const, message: "Apenas admin ou financeiro aprova as guias da apuração." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

/** O que o banco devolve, em português para a tela. */
function mensagemDoBanco(msg: string) {
  if (/uq_fiscal_aprovacao_por_guia|duplicate key/i.test(msg)) return "Esta guia já foi aprovada.";
  return msg;
}

interface Recalculo {
  fatos: FatosDoBanco;
  hoje: string;
  guias: Guia[];
  /** As PJs de teste (decisão 181): a guia em curso delas se aprova. */
  pjsDeTeste: Set<string>;
}

async function recalcular(supabase: ReturnType<typeof createClient>, tenantId: string): Promise<Recalculo> {
  const hoje = hojeEmSaoPaulo();
  const [fatos, testeRes] = await Promise.all([
    carregarFatosFiscais(supabase, tenantId),
    supabase.from("empresas_contabeis").select("id").eq("tenant_id", tenantId).eq("de_teste", true),
  ]);
  if (testeRes.error) throw new Error(`[fiscal.apuracao.pjs_de_teste] ${testeRes.error.message}`);
  return {
    fatos,
    hoje,
    guias: calcularApuracao(fatos.cadastro, fatos.fatos, hoje, fatos.aprovacoes),
    pjsDeTeste: new Set(((testeRes.data ?? []) as Array<{ id: string }>).map((p) => p.id)),
  };
}

/** Monta o pedido de uma guia já recalculada (a cidade da matriz dá o vencimento das cotas). */
function pedidoDa(r: Recalculo, g: Guia, entrada: EntradaDaAprovacao) {
  const estado = estadoDaGuia(g, r.hoje, r.fatos.aprovacoes);
  const matriz =
    r.fatos.cadastro.estabelecimentos.find((e) => e.empresa_contabil_id === g.empresa_contabil_id && e.papel === "matriz") ??
    r.fatos.cadastro.estabelecimentos.find((e) => e.empresa_contabil_id === g.empresa_contabil_id);
  return montarPedidoDeAprovacao({
    guia: g,
    estado: estado.estado,
    delta: estado.delta,
    aprovacao: estado.aprovacao ?? null,
    entrada,
    cadastro: r.fatos.cadastro,
    hoje: r.hoje,
    cidadeDaMatriz: matriz?.municipio ?? "",
    pjDeTeste: r.pjsDeTeste.has(g.empresa_contabil_id),
  });
}

// ---------------------------------------------------------------------------
// Aprovar uma guia (ou a diferença dela)
// ---------------------------------------------------------------------------

const aprovarSchema = z.object({
  chave: z.string().min(3).max(300),
  valor_guia: z.number().finite().min(0, "Informe o valor da guia.").max(1e11),
  justificativa: z.string().max(2000).default(""),
  usar_compensacao: z.boolean().default(true),
  cota_unica: z.boolean().default(false),
  juros_pct: z.array(z.number().finite().nullable()).max(3).nullable().default(null),
  /** O anexo já enviado ao bucket `impostos` pelo navegador. */
  guia_path: z.string().min(3).max(500).nullable().default(null),
  /**
   * Decisão 277: o valor de cada empresa gerencial (o da contabilidade); as
   * regionais dividem pela receita, no servidor. Nulo = o rateio do sistema.
   */
  rateio_gerencial: z
    .array(
      z.object({
        empresa_id: z.string().uuid(),
        valor: z.number().finite().positive("Cada empresa gerencial do rateio precisa de valor."),
        regional_id: z.string().uuid().nullable(),
      }),
    )
    .max(20)
    .nullable()
    .default(null),
  /** Decisão 277: o saldo credor que a contabilidade levou para o mês seguinte (PIS/COFINS não cumulativos). */
  saldo_credor_contabil: z.number().finite().min(0, "O saldo credor não pode ser negativo.").max(1e11).nullable().default(null),
  /**
   * Decisão 277 §9: IRPJ/CSLL do lucro real — o ajuste da base (com sinal:
   * negativo reduz), que vale para as duas guias do CNPJ e trimestre e só se
   * registra com esta aprovação.
   */
  ajuste_base: z
    .object({
      valor: z.number().finite(),
      motivo: z.string().max(500),
    })
    .nullable()
    .default(null),
  /**
   * Decisão 277, entrega 3: a guia já foi paga fora do sistema e o pagamento
   * está no histórico da planilha — o título nasce e já sai de A pagar, sem
   * lançamento. Só na guia de um título (com cotas, cada uma em Impostos a Pagar).
   */
  pago_no_historico: z
    .object({
      pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do pagamento."),
      conta_bancaria_id: z.string().uuid("Selecione a conta que pagou a guia."),
    })
    .nullable()
    .default(null),
});

/** A guia de PIS ou COFINS não cumulativos: a única com saldo credor. */
const temSaldoCredor = (chave: string) => /^(pis|cofins)\|/.test(chave);

export async function aprovarGuia(
  input: unknown,
): Promise<{ ok: true; aprovacaoId: string; titulos: number; pagoNoHistorico: boolean; aviso: string | null } | Err> {
  const parsed = aprovarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const v = parsed.data;
  const gate = await checarGate("fiscal.guia_aprovada", v.chave);
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;

  // O anexo: só no lugar das guias deste tenant, e precisa existir.
  if (v.guia_path) {
    if (!v.guia_path.startsWith(`${tenantId}/guias/`) || v.guia_path.includes("..")) {
      return { ok: false, message: "Anexo inválido. Escolha o arquivo da guia de novo." };
    }
    const { error } = await supabase.storage.from(BUCKET).createSignedUrl(v.guia_path, 30);
    if (error) return { ok: false, message: "O anexo da guia não foi encontrado. Escolha o arquivo de novo." };
  }

  let r: Recalculo;
  try {
    r = await recalcular(supabase, tenantId);
  } catch (e) {
    return { ok: false, message: `Não foi possível recalcular a apuração: ${e instanceof Error ? e.message : String(e)}` };
  }
  let calculada = r.guias.find((x) => x.chave === v.chave);
  if (!calculada) return { ok: false, message: "Esta guia não está mais na apuração. Atualize a página." };
  if (v.saldo_credor_contabil !== null && !temSaldoCredor(v.chave)) {
    return { ok: false, message: "Só a guia de PIS ou COFINS não cumulativos tem saldo credor." };
  }

  // Decisão 277 §9: o ajuste da base do lucro real. O servidor recalcula a
  // guia com ele (a prévia): o calculado, a memória, o rateio e as cotas já
  // saem ajustados, e a aprovação grava o ajuste junto.
  if (v.ajuste_base) {
    const estadoAntes = estadoDaGuia(calculada, r.hoje, r.fatos.aprovacoes).estado;
    const valido = validarAjusteDaBase(calculada, estadoAntes, v.ajuste_base);
    if (!valido.ok) return valido;
    const comAjuste = calcularApuracao(r.fatos.cadastro, r.fatos.fatos, r.hoje, r.fatos.aprovacoes, {
      chave: v.chave,
      valor: v.ajuste_base.valor,
      motivo: v.ajuste_base.motivo,
    }).find((x) => x.chave === v.chave);
    if (!comAjuste?.lucro_real?.ajuste) return { ok: false, message: "Não foi possível recalcular a guia com o ajuste da base." };
    calculada = comAjuste;
  }

  // Decisão 277: o rateio por empresa gerencial (o da contabilidade), com as regionais pela receita.
  let g = calculada;
  if (v.rateio_gerencial && v.valor_guia > 0) {
    let regras;
    try {
      regras = await carregarRegrasDoRateio(supabase, tenantId);
    } catch (e) {
      return { ok: false, message: `Não foi possível ler as empresas do rateio: ${e instanceof Error ? e.message : String(e)}` };
    }
    const rateio = rateioPorGerencial(
      v.rateio_gerencial,
      calculada.rateio,
      regrasDoCnpj(regras, calculada.empresa_contabil_id, calculada.tributo),
      v.valor_guia,
    );
    if (!rateio.ok) return rateio;
    g = { ...calculada, rateio: rateio.rateio };
  }

  const montagem = pedidoDa(r, g, {
    valor_guia: v.valor_guia,
    justificativa: v.justificativa,
    usar_compensacao: v.usar_compensacao,
    cota_unica: v.cota_unica,
    juros_pct: v.juros_pct,
  });
  if (!montagem.ok) return montagem;
  if (v.pago_no_historico && montagem.pedido.p_titulos.length !== 1) {
    return {
      ok: false,
      message:
        montagem.pedido.p_titulos.length === 0
          ? "Sem valor a pagar, não há o que marcar como paga."
          : "Com mais de uma cota, aprove e marque cada cota paga em Impostos a Pagar.",
    };
  }

  const { data, error } = await supabase.rpc("aprovar_guia_fiscal", {
    ...montagem.pedido,
    p_tenant_id: tenantId,
    p_guia_path: v.guia_path,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error.message) };

  // O saldo da contabilidade vai na aprovação recém-criada (à parte: pode ser informado depois também).
  let aviso: string | null = null;
  if (v.saldo_credor_contabil !== null && Math.abs(v.saldo_credor_contabil - calculada.saldo_credor_gerado) >= 0.01) {
    const s = await supabase.rpc("definir_saldo_credor_contabil", {
      p_tenant_id: tenantId,
      p_chave: v.chave,
      p_valor: v.saldo_credor_contabil,
    });
    if (s.error) aviso = `A guia foi aprovada, mas o saldo credor da contabilidade não foi gravado (${s.error.message}). Informe de novo na guia.`;
  }

  // Já paga no histórico: o título recém-criado sai de A pagar, sem lançamento.
  let pagoNoHistorico = false;
  if (v.pago_no_historico) {
    const { data: titulos, error: erroTitulos } = await supabase
      .from("impostos_a_pagar")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("aprovacao_id", String(data));
    const id = !erroTitulos && titulos?.length === 1 ? (titulos[0] as { id: string }).id : null;
    const marca = id
      ? await supabase.rpc("marcar_imposto_pago_no_historico", {
          p_imposto_id: id,
          p_pago_em: v.pago_no_historico.pago_em,
          p_conta_bancaria_id: v.pago_no_historico.conta_bancaria_id,
          p_guia_path: null,
          p_comprovante_path: null,
        })
      : null;
    if (id && !marca?.error) pagoNoHistorico = true;
    else {
      const motivo = marca?.error?.message ?? erroTitulos?.message ?? "título não encontrado";
      console.error("[fiscal.aprovar.pago_no_historico]", motivo);
      aviso = `${aviso ? `${aviso} ` : ""}A guia foi aprovada, mas não foi marcada como paga no histórico (${motivo}). Marque em Impostos a Pagar.`;
    }
    revalidatePath("/financeiro/conciliacao");
    revalidatePath("/financeiro/fluxo-caixa");
  }

  revalidatePath(CAMINHO);
  return { ok: true, aprovacaoId: String(data), titulos: montagem.pedido.p_titulos.length, pagoNoHistorico, aviso };
}

// ---------------------------------------------------------------------------
// O saldo credor da contabilidade, depois da aprovação (decisão 277)
// ---------------------------------------------------------------------------

const saldoSchema = z.object({
  chave: z.string().min(3).max(300),
  /** Nulo volta ao saldo calculado. */
  valor: z.number().finite().min(0, "O saldo credor não pode ser negativo.").max(1e11).nullable(),
});

export async function informarSaldoCredorDaContabilidade(input: unknown): Promise<{ ok: true } | Err> {
  const parsed = saldoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const v = parsed.data;
  if (!temSaldoCredor(v.chave)) return { ok: false, message: "Só a guia de PIS ou COFINS não cumulativos tem saldo credor." };
  const gate = await checarGate("fiscal.saldo_credor_contabil", v.chave);
  if (!gate.ok) return gate;
  const { error } = await gate.supabase.rpc("definir_saldo_credor_contabil", {
    p_tenant_id: gate.session.activeTenant.id,
    p_chave: v.chave,
    p_valor: v.valor,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error.message) };
  revalidatePath(CAMINHO);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Aprovar várias pelo valor calculado
// ---------------------------------------------------------------------------

const loteSchema = z.object({ chaves: z.array(z.string().min(3).max(300)).min(1).max(200) });

/**
 * "Aprovar as N guias pelo valor calculado": cada guia a aprovar vira um
 * imposto a pagar com o calculado (compensação sugerida incluída, cotas do
 * calculado). Diferença não entra (cada uma se aprova sozinha). Uma guia que
 * falha não segura as outras; a resposta diz quais.
 */
export async function aprovarGuiasPeloCalculado(
  input: unknown,
): Promise<{ ok: true; aprovadas: number; falhas: Array<{ titulo: string; message: string }> } | Err> {
  const parsed = loteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Nenhuma guia escolhida." };
  const gate = await checarGate("fiscal.guias_aprovadas_pelo_calculado", null);
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;

  let r: Recalculo;
  try {
    r = await recalcular(supabase, tenantId);
  } catch (e) {
    return { ok: false, message: `Não foi possível recalcular a apuração: ${e instanceof Error ? e.message : String(e)}` };
  }

  let aprovadas = 0;
  const falhas: Array<{ titulo: string; message: string }> = [];
  for (const chave of [...new Set(parsed.data.chaves)]) {
    const g = r.guias.find((x) => x.chave === chave);
    if (!g) {
      falhas.push({ titulo: chave, message: "Esta guia não está mais na apuração." });
      continue;
    }
    const nome = `${g.titulo} · ${g.local}`;
    if (estadoDaGuia(g, r.hoje, r.fatos.aprovacoes).estado !== "a_aprovar") {
      falhas.push({ titulo: nome, message: "Não está mais a aprovar." });
      continue;
    }
    const montagem = pedidoDa(r, g, {
      valor_guia: g.apurado,
      justificativa: "",
      usar_compensacao: true,
      cota_unica: false,
      juros_pct: null,
    });
    if (!montagem.ok) {
      falhas.push({ titulo: nome, message: montagem.message });
      continue;
    }
    const { error } = await supabase.rpc("aprovar_guia_fiscal", {
      ...montagem.pedido,
      p_tenant_id: tenantId,
      p_guia_path: null,
    });
    if (error) falhas.push({ titulo: nome, message: mensagemDoBanco(error.message) });
    else aprovadas++;
  }

  revalidatePath(CAMINHO);
  return { ok: true, aprovadas, falhas };
}

// ---------------------------------------------------------------------------
// Abrir a guia anexada a uma aprovação
// ---------------------------------------------------------------------------

export async function urlDaGuiaAprovada(aprovacaoId: string): Promise<{ ok: true; url: string } | Err> {
  if (!z.string().uuid().safeParse(aprovacaoId).success) return { ok: false, message: "Aprovação inválida." };
  const gate = await checarGate("fiscal.guia_lida", aprovacaoId);
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const { data } = await supabase
    .from("fiscal_aprovacoes")
    .select("guia_path")
    .eq("id", aprovacaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ guia_path: string | null }>();
  if (!data?.guia_path) return { ok: false, message: "Guia não encontrada." };
  const { data: assinada, error } = await supabase.storage.from(BUCKET).createSignedUrl(data.guia_path, 60 * 10);
  if (error || !assinada) return { ok: false, message: "Não foi possível abrir a guia." };
  return { ok: true, url: assinada.signedUrl };
}

// ---------------------------------------------------------------------------
// A Guia da contabilidade (decisão 277, entrega 2b)
// ---------------------------------------------------------------------------

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2]|T[1-4])$/;

/**
 * A receita do CNPJ no período, por empresa e regional: as notas do sistema
 * de outubro/2026 em diante; antes, as do histórico da planilha.
 */
async function receitaDoPeriodo(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  pjId: string,
  competencia: string,
): Promise<{ base: RateioDaGuia[]; fonte: "sistema" | "historico" }> {
  const { inicio, fim } = periodoDe(competencia);
  if (inicio >= `${PRIMEIRA_COMPETENCIA}-01`) {
    const fatos = await carregarFatosFiscais(supabase, tenantId);
    const estabs = new Set(fatos.cadastro.estabelecimentos.filter((e) => e.empresa_contabil_id === pjId).map((e) => e.id));
    return { base: baseDaReceita(receitaDasNotas(fatos.fatos.notas, estabs, inicio, fim)), fonte: "sistema" };
  }
  const [estabsRes, regras] = await Promise.all([
    supabase.from("fiscal_estabelecimentos").select("nome").eq("tenant_id", tenantId).eq("empresa_contabil_id", pjId),
    carregarRegrasDoRateio(supabase, tenantId),
  ]);
  if (estabsRes.error) throw new Error(`[fiscal.receita.estabelecimentos] ${estabsRes.error.message}`);
  const nomes = ((estabsRes.data ?? []) as Array<{ nome: string }>).map((e) => e.nome);
  const notas = await carregarNotasDoHistorico(supabase, tenantId, nomes, inicio, fim);
  const regionaisPorEmpresa = new Map(regras.empresas.map((e) => [e.id, e.regionais]));
  return { base: baseDaReceita(receitaDoHistorico(notas, regionaisPorEmpresa)), fonte: "historico" };
}

const previaSchema = z.object({
  empresa_contabil_id: z.string().uuid(),
  competencia: z.string().regex(COMPETENCIA),
});

/** A receita do período para a prévia do rateio na Guia da contabilidade. */
export async function previaDaReceitaDoPeriodo(
  input: unknown,
): Promise<{ ok: true; base: RateioDaGuia[]; fonte: "sistema" | "historico" } | Err> {
  const parsed = previaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Escolha o CNPJ e a competência." };
  const gate = await checarGate("fiscal.receita_do_periodo_lida", parsed.data.empresa_contabil_id);
  if (!gate.ok) return gate;
  try {
    const r = await receitaDoPeriodo(gate.supabase, gate.session.activeTenant.id, parsed.data.empresa_contabil_id, parsed.data.competencia);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, message: `Não foi possível ler a receita do período: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const guiaDaContabilidadeSchema = z.object({
  tributo: z.enum(["ISS", "ISS_RET", "PIS", "COFINS", "IRPJ", "CSLL", "CSRF", "IRRF", "IOF"], {
    errorMap: () => ({ message: "Escolha o imposto." }),
  }),
  titulo: z.string().trim().min(2).max(120),
  codigo_receita: z.string().trim().max(20).nullable(),
  empresa_contabil_id: z.string().uuid("Escolha o CNPJ."),
  estabelecimento_id: z.string().uuid().nullable(),
  competencia: z.string().regex(COMPETENCIA, "Escolha a competência."),
  rotulo_competencia: z.string().trim().min(1).max(60),
  motivo: z.string().trim().min(10, "Explique por que o sistema não calculou esta guia (mínimo 10 caracteres).").max(500),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o vencimento."),
  valor: z.number().finite().positive("Informe o valor da guia.").max(1e11),
  rateio_gerencial: z
    .array(
      z.object({
        empresa_id: z.string().uuid(),
        valor: z.number().finite().positive("Cada empresa gerencial do rateio precisa de valor."),
        regional_id: z.string().uuid().nullable(),
      }),
    )
    .min(1, "Informe o rateio por empresa gerencial.")
    .max(20),
  guia_path: z.string().min(3).max(500).nullable(),
  /**
   * Entrega 3: a guia já foi paga fora do sistema e o pagamento está no
   * histórico da planilha — entra e já sai de A pagar, sem lançamento.
   */
  pago_no_historico: z
    .object({
      pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do pagamento."),
      conta_bancaria_id: z.string().uuid("Selecione a conta que pagou a guia."),
    })
    .nullable()
    .optional(),
});

/**
 * Lança a guia que o sistema não calcula, já aprovada com o valor da
 * contabilidade: vai para Impostos a Pagar (origem avulso, marcada como da
 * contabilidade) com o rateio por empresa gerencial e as regionais pela
 * receita do período.
 */
export async function lancarGuiaDaContabilidade(
  input: unknown,
): Promise<{ ok: true; id: string; aviso: string | null } | Err> {
  const parsed = guiaDaContabilidadeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const v = parsed.data;
  const gate = await checarGate("fiscal.guia_da_contabilidade", v.empresa_contabil_id);
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const tenantId = session.activeTenant.id;

  if (v.guia_path) {
    if (!v.guia_path.startsWith(`${tenantId}/guias/`) || v.guia_path.includes("..")) {
      return { ok: false, message: "Anexo inválido. Escolha o arquivo da guia de novo." };
    }
    const { error } = await supabase.storage.from(BUCKET).createSignedUrl(v.guia_path, 30);
    if (error) return { ok: false, message: "O anexo da guia não foi encontrado. Escolha o arquivo de novo." };
  }

  let rateio: RateioDaGuia[];
  try {
    const [receita, regras] = await Promise.all([
      receitaDoPeriodo(supabase, tenantId, v.empresa_contabil_id, v.competencia),
      carregarRegrasDoRateio(supabase, tenantId),
    ]);
    const r = rateioPorGerencial(v.rateio_gerencial, receita.base, regrasDoCnpj(regras, v.empresa_contabil_id, v.tributo), v.valor);
    if (!r.ok) return r;
    rateio = r.rateio;
  } catch (e) {
    return { ok: false, message: `Não foi possível montar o rateio: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { data, error } = await supabase.rpc("lancar_guia_da_contabilidade", {
    p_tenant_id: tenantId,
    p_tributo: v.tributo,
    p_titulo: v.titulo,
    p_codigo_receita: v.codigo_receita,
    p_empresa_contabil_id: v.empresa_contabil_id,
    p_estabelecimento_id: v.estabelecimento_id,
    p_competencia: v.competencia,
    p_rotulo_competencia: v.rotulo_competencia,
    p_descricao: `Guia da contabilidade: ${v.motivo}`,
    p_vencimento: v.vencimento,
    p_valor: v.valor,
    p_rateio: rateio.map((x) => ({ empresa_id: x.empresa_id, regional_id: x.regional_id, valor: x.valor })),
    p_guia_path: v.guia_path,
  });
  if (error || typeof data !== "string") return { ok: false, message: error ? mensagemDoBanco(error.message) : "Não foi possível lançar a guia." };

  // Já paga no histórico: marca na sequência. Se a marca falhar, a guia fica
  // lançada (a pagar) e a tela avisa para marcar em Impostos a Pagar.
  let aviso: string | null = null;
  if (v.pago_no_historico) {
    const { error: erroPago } = await supabase.rpc("marcar_imposto_pago_no_historico", {
      p_imposto_id: data,
      p_pago_em: v.pago_no_historico.pago_em,
      p_conta_bancaria_id: v.pago_no_historico.conta_bancaria_id,
      p_guia_path: null,
      p_comprovante_path: null,
    });
    if (erroPago) {
      console.error("[fiscal.guia_da_contabilidade.pago_no_historico]", erroPago.message);
      aviso = `A guia entrou, mas não foi marcada como paga no histórico (${mensagemDoBanco(erroPago.message)}). Marque em Impostos a Pagar.`;
    }
    revalidatePath("/financeiro/conciliacao");
    revalidatePath("/financeiro/fluxo-caixa");
  }

  revalidatePath(CAMINHO);
  return { ok: true, id: data, aviso };
}

