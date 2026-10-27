// Comitê de Aprovações (decisão 223): leituras comuns às telas de quem envia
// (versão do orçamento e PP) e ao módulo. As regras e a conta de "precisa
// do Comitê" moram no banco (`comite_situacao_da_versao`, gatilhos da 204);
// aqui só se lê e se dá forma.
import type { createClient } from "@/lib/supabase/server";
import {
  REGRAS_PADRAO_DO_COMITE,
  motivosDaVersaoNoComite,
  type RegrasDoComite,
} from "@/lib/calculos/limites-orcamento";
import type { ComiteConfigRow, ComitePedidoStatus } from "@/lib/types";

type Supabase = ReturnType<typeof createClient>;

export function regrasDaLinha(row: ComiteConfigRow | null): RegrasDoComite {
  if (!row) return REGRAS_PADRAO_DO_COMITE;
  return {
    resultadoLigado: row.resultado_ligado,
    resultadoMinimo: Number(row.resultado_minimo),
    planejadoLigado: row.planejado_ligado,
    ppLigado: row.pp_ligado,
    linhasVermelhas: row.linhas_vermelhas,
    toleranciaLigada: row.tolerancia_ligada,
    toleranciaValor: Number(row.tolerancia_valor),
    toleranciaPct: Number(row.tolerancia_pct),
    adminDireto: row.admin_direto,
  };
}

export async function carregarRegrasDoComite(supabase: Supabase, tenantId: string): Promise<RegrasDoComite> {
  const { data } = await supabase
    .from("comite_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle<ComiteConfigRow>();
  return regrasDaLinha(data ?? null);
}

/** Membro do Comitê (a barra lateral e o módulo). O administrador decide
 *  também, mas por ser administrador — ver `pode_decidir_no_comite`. */
export async function souMembroDoComite(supabase: Supabase, tenantId: string, userId: string): Promise<boolean> {
  const { count } = await supabase
    .from("comite_membros")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

/** O pedido como as telas de quem envia o mostram. */
export interface PedidoDoComite {
  id: string;
  status: ComitePedidoStatus;
  motivo: string;
  enviadoPor: string;
  enviadoEm: string;
  decididoPor: string | null;
  decididoEm: string | null;
  comentario: string | null;
}

export const SELECT_PEDIDO =
  "id, status, motivo, enviado_em, decidido_em, comentario, " +
  "enviado:profiles!comite_pedidos_enviado_por_fkey(nome), decidido:profiles!comite_pedidos_decidido_por_fkey(nome)";

export interface PedidoComNomes {
  id: string;
  status: ComitePedidoStatus;
  motivo: string;
  enviado_em: string;
  decidido_em: string | null;
  comentario: string | null;
  enviado: { nome: string } | null;
  decidido: { nome: string } | null;
}

export function pedidoDaLinha(p: PedidoComNomes): PedidoDoComite {
  return {
    id: p.id,
    status: p.status,
    motivo: p.motivo,
    enviadoPor: p.enviado?.nome ?? "—",
    enviadoEm: p.enviado_em,
    decididoPor: p.decidido?.nome ?? null,
    decididoEm: p.decidido_em,
    comentario: p.comentario,
  };
}

/** A versão diante do Comitê: o que a barra de aprovação precisa saber. */
export interface ComiteDaVersao {
  /** Os motivos que pegam agora, em frases. Vazio: nenhuma regra pega. */
  motivos: string[];
  /** Qual regra pega: o quadro do motivo lista os itens ou o resultado. */
  pegaPlanejado: boolean;
  pegaResultado: boolean;
  resultadoMinimo: number;
  /** Precisa solicitar a aprovação: alguma regra pega, quem está na tela
   *  não aprova direto e nenhuma aprovação anterior do orçamento cobre a
   *  versão (volta ao Comitê só se piorar). */
  precisa: boolean;
  /** Já aprovada pelo Comitê antes, e não piorou: aprova direto. */
  coberta: boolean;
  /** O último pedido desta versão, menos os cancelados. */
  pedido: PedidoDoComite | null;
  /** Outra versão do orçamento aguardando o Comitê (o rótulo dela). */
  outraVersaoPendente: string | null;
}

export async function carregarComiteDaVersao(
  supabase: Supabase,
  tenantId: string,
  versao: { id: string; orcamento_id: string },
  interno: boolean,
): Promise<ComiteDaVersao> {
  const [situacaoRes, regras, pedidosRes] = await Promise.all([
    supabase.rpc("comite_situacao_da_versao", { p_versao_id: versao.id }),
    carregarRegrasDoComite(supabase, tenantId),
    supabase
      .from("comite_pedidos")
      .select(`${SELECT_PEDIDO}, versao_orcamento_id, versao:versoes_orcamento!comite_pedidos_versao_orcamento_id_fkey(numero_versao)`)
      .eq("tenant_id", tenantId)
      .eq("tipo", "versao")
      .eq("orcamento_id", versao.orcamento_id)
      .neq("status", "cancelado")
      .order("enviado_em", { ascending: false })
      .limit(20),
  ]);
  const s = (situacaoRes.data ?? null) as {
    regra?: boolean;
    planejado?: boolean;
    resultado?: boolean;
    itens_acima?: number;
    resultado_geral?: number | null;
    coberta?: boolean;
    direto?: boolean;
  } | null;
  const motivos = s?.regra
    ? motivosDaVersaoNoComite(
        regras,
        { itensAcima: Number(s.itens_acima ?? 0), resultadoGeral: s.resultado_geral ?? null },
        interno,
      )
    : [];
  const pedidos = (pedidosRes.data ?? []) as unknown as Array<
    PedidoComNomes & { versao_orcamento_id: string; versao: { numero_versao: number } | null }
  >;
  const desta = pedidos.find((p) => p.versao_orcamento_id === versao.id) ?? null;
  const outra = pedidos.find((p) => p.status === "pendente" && p.versao_orcamento_id !== versao.id) ?? null;
  const coberta = s?.coberta === true;
  return {
    motivos,
    pegaPlanejado: motivos.length > 0 && s?.planejado === true,
    pegaResultado: motivos.length > 0 && s?.resultado === true,
    resultadoMinimo: regras.resultadoMinimo,
    precisa: motivos.length > 0 && !s?.direto && !coberta,
    coberta: motivos.length > 0 && coberta,
    pedido: desta ? pedidoDaLinha(desta) : null,
    outraVersaoPendente: outra ? `v${outra.versao?.numero_versao ?? "?"}` : null,
  };
}

/** A versão aguardando o Comitê é só leitura (o banco também trava). */
export function versaoAguardandoComite(c: ComiteDaVersao | null): boolean {
  return c?.pedido?.status === "pendente";
}

/* ---- PPs ------------------------------------------------------------------ */

/**
 * O Comitê na planilha do job: as regras, quem aprova direto e, por id de
 * PP a emitir (que é o id da PP quando ela é gerada), o último pedido e o
 * maior valor aprovado — herdado pela PP reemitida, pela cadeia de
 * `refaz_pp_id` (volta ao Comitê só se ficar mais cara).
 */
export interface ComiteDaPP {
  regras: RegrasDoComite;
  aprovaDireto: boolean;
  pedidos: Record<string, PedidoDoComite>;
  valorAprovado: Record<string, number>;
}

/** Telas que não geram PP (financeiro): nada pede o Comitê nelas. */
export const COMITE_DA_PP_SEM_ACAO: ComiteDaPP = {
  regras: REGRAS_PADRAO_DO_COMITE,
  aprovaDireto: false,
  pedidos: {},
  valorAprovado: {},
};

export async function carregarComiteDaPP(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
  aprovaDiretoPeloPapel: boolean,
): Promise<ComiteDaPP> {
  const [regras, pedidosRes, aEmitirRes] = await Promise.all([
    carregarRegrasDoComite(supabase, tenantId),
    supabase
      .from("comite_pedidos")
      .select(`${SELECT_PEDIDO}, pp_a_emitir_id, snapshot`)
      .eq("tenant_id", tenantId)
      .eq("tipo", "pp")
      .eq("job_id", jobId)
      .neq("status", "cancelado")
      .order("enviado_em", { ascending: true }),
    supabase
      .from("pedidos_compra_a_emitir")
      .select("id, refaz_pp_id")
      .eq("tenant_id", tenantId)
      .eq("job_id", jobId),
  ]);
  if (pedidosRes.error) console.error("[comite.pps_do_job]", pedidosRes.error.message);
  const linhas = (pedidosRes.data ?? []) as unknown as Array<
    PedidoComNomes & { pp_a_emitir_id: string; snapshot: { valor?: number } }
  >;
  const pedidos: Record<string, PedidoDoComite> = {};
  const aprovadoDireto = new Map<string, number>();
  for (const l of linhas) {
    // Em ordem de envio: o último sobrescreve.
    pedidos[l.pp_a_emitir_id] = pedidoDaLinha(l);
    if (l.status === "aprovado") {
      const v = Number(l.snapshot?.valor ?? 0);
      aprovadoDireto.set(l.pp_a_emitir_id, Math.max(aprovadoDireto.get(l.pp_a_emitir_id) ?? 0, v));
    }
  }
  const refaz = new Map<string, string | null>(
    ((aEmitirRes.data ?? []) as { id: string; refaz_pp_id: string | null }[]).map((a) => [a.id, a.refaz_pp_id]),
  );
  const valorAprovado: Record<string, number> = {};
  for (const id of refaz.keys()) {
    let atual: string | null = id;
    let maior: number | null = null;
    for (let passo = 0; atual && passo < 30; passo++) {
      const v = aprovadoDireto.get(atual);
      if (v !== undefined) maior = Math.max(maior ?? 0, v);
      atual = refaz.get(atual) ?? null;
    }
    if (maior !== null) valorAprovado[id] = maior;
  }
  return {
    regras,
    aprovaDireto: aprovaDiretoPeloPapel && regras.adminDireto,
    pedidos,
    valorAprovado,
  };
}

/** O maior valor aprovado pelo Comitê para a PP (ou a que ela refaz). */
export async function valorAprovadoNoComite(
  supabase: Supabase,
  tenantId: string,
  ppId: string,
): Promise<number | null> {
  let atual: string | null = ppId;
  let maior: number | null = null;
  for (let passo = 0; atual && passo < 30; passo++) {
    const id: string = atual;
    const pedidosQ = supabase
      .from("comite_pedidos")
      .select("snapshot")
      .eq("tenant_id", tenantId)
      .eq("tipo", "pp")
      .eq("status", "aprovado")
      .eq("pp_a_emitir_id", id)
      .returns<{ snapshot: { valor?: number } }[]>();
    const aEmitirQ = supabase
      .from("pedidos_compra_a_emitir")
      .select("refaz_pp_id")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle<{ refaz_pp_id: string | null }>();
    const [pedidosRes, aEmitirRes] = await Promise.all([pedidosQ, aEmitirQ]);
    for (const p of pedidosRes.data ?? []) {
      maior = Math.max(maior ?? 0, Number(p.snapshot?.valor ?? 0));
    }
    const proximo: string | null = aEmitirRes.data?.refaz_pp_id ?? null;
    atual = proximo;
  }
  return maior;
}

/* ---- A página aberta pela caixa do Comitê --------------------------------- */

/** O pedido que a página do orçamento ou do job mostra no modo do Comitê. */
export interface PedidoEmDecisao {
  id: string;
  tipo: "versao" | "pp";
  situacao: ComitePedidoStatus;
  motivo: string;
  enviadoPor: string;
  enviadoEm: string;
  decididoPor: string | null;
  decididoEm: string | null;
  comentario: string | null;
  itemRealizadoId: string | null;
  ppAEmitirId: string | null;
}

/**
 * `?comite=<pedido>`: só vale para quem decide (membro ou administrador) e
 * para o pedido desta versão (`alvoId` = versão) ou deste job (`alvoId` =
 * job). Fora disso a página abre como sempre.
 */
export async function carregarPedidoEmDecisao(
  supabase: Supabase,
  tenantId: string,
  pedidoId: string,
  alvoId: string,
): Promise<PedidoEmDecisao | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return null;
  const [podeRes, pedidoRes] = await Promise.all([
    supabase.rpc("pode_decidir_no_comite", { p_tenant_id: tenantId }),
    supabase
      .from("comite_pedidos")
      .select(`${SELECT_PEDIDO}, tipo, versao_orcamento_id, job_id, item_realizado_id, pp_a_emitir_id`)
      .eq("id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (podeRes.data !== true || !pedidoRes.data) return null;
  const p = pedidoRes.data as unknown as PedidoComNomes & {
    tipo: "versao" | "pp";
    versao_orcamento_id: string | null;
    job_id: string | null;
    item_realizado_id: string | null;
    pp_a_emitir_id: string | null;
  };
  const alvo = p.tipo === "versao" ? p.versao_orcamento_id : p.job_id;
  if (alvo !== alvoId) return null;
  const base = pedidoDaLinha(p);
  return {
    id: base.id,
    tipo: p.tipo,
    situacao: base.status,
    motivo: base.motivo,
    enviadoPor: base.enviadoPor,
    enviadoEm: base.enviadoEm,
    decididoPor: base.decididoPor,
    decididoEm: base.decididoEm,
    comentario: base.comentario,
    itemRealizadoId: p.item_realizado_id,
    ppAEmitirId: p.pp_a_emitir_id,
  };
}

/** A PP a emitir aguardando o Comitê não se edita, não se gera e não se exclui. */
export async function ppAguardandoComite(supabase: Supabase, tenantId: string, aEmitirId: string): Promise<boolean> {
  const { count } = await supabase
    .from("comite_pedidos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("tipo", "pp")
    .eq("pp_a_emitir_id", aEmitirId)
    .eq("status", "pendente");
  return (count ?? 0) > 0;
}
