import type { SupabaseClient } from "@supabase/supabase-js";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";
import {
  SELECT_LANCAMENTO_LINHA,
  montarLinhasDeLancamentos,
  type LinhaSemSaldo,
} from "./lancamento-linha";

/**
 * O EXTRATO DE UMA FATURA DE CARTÃO (decisão 093, entrega 2).
 *
 * A fatura é o extrato da conta-espelho do cartão recortado por
 * `fatura_cartao_id`: cada item confirmado na baixa, cada estorno de
 * compra e cada ajuste do fechamento já é um lançamento com as colunas da
 * conciliação. Este módulo lê esses lançamentos pelo mesmo mapeador da
 * conciliação e junta a eles o que AINDA NÃO é lançamento mas pertence à
 * fatura — o legado roteado na aprovação antes da 093 e o ajuste de um
 * fechamento reaberto —, como linhas "pendentes", para a soma da tela
 * bater com a faixa da fatura e com o que o fechamento vai cobrar.
 *
 * A aba Cartão e a exportação em Excel leem daqui: uma fonte só.
 */

export type StatusFatura = "aberta" | "fechada" | "paga";

export type FaturaResumo = {
  id: string;
  codigo: string;
  cartao_credito_id: string;
  competencia_fechamento: string;
  data_vencimento: string;
  status: StatusFatura;
  valor_cobrado: number | null;
  fechada_em: string | null;
};

/** `item` e `ajuste` são lançamentos; `pendente` ainda vai virar um. */
export type PapelDoItem = "item" | "ajuste" | "pendente";

export type OrigemDoItem = {
  tipo: "avulso" | "pp" | "desembolso";
  /** O id da avulsa, da parcela de PP ou da parcela de desembolso — a
   *  mesma chave que `TituloRow.id` usa na aba, para ligar a linha às
   *  ações (estornar compra, ver a baixa registrada). */
  id: string;
};

export type ItemDaFatura = Omit<LancamentoLinha, "saldo"> & {
  papel: PapelDoItem;
  origem_item: OrigemDoItem | null;
  /** Débitos menos créditos até esta linha — o "Acumulado" da tabela. */
  acumulado: number;
};

export type ExtratoDaFatura = {
  fatura: FaturaResumo;
  itens: ItemDaFatura[];
  kpis: {
    /** Saídas dos itens confirmados (sem ajuste, sem pendente). */
    compras: number;
    /** Entradas dos itens: estornos de compra. Positivo. */
    estornos: number;
    /** Ajustes do fechamento, com sinal. */
    ajustes: number;
    /** O legado que entra no fechamento, com sinal. */
    pendentes: number;
    /** compras − estornos + ajustes + pendentes. */
    total: number;
  };
  /** A baixa da fatura, quando paga: a perna do banco. */
  pagamento: { data: string; conta_nome: string | null } | null;
};

type FaturaRaw = {
  id: string;
  codigo: string;
  cartao_credito_id: string;
  competencia_fechamento: string;
  data_vencimento: string;
  status: StatusFatura;
  valor_cobrado: string | number | null;
  fechada_em: string | null;
};

type RateioRaw = { percentual: number; regional: { nome: string } | null };
type PlanoRaw = { codigo: string; nome: string } | null;
type EmpresaRaw = { nome_fantasia: string | null; razao_social: string | null } | null;
type FornecedorRaw = { nome: string | null; razao_social: string | null } | null;

type AvulsaPendenteRaw = {
  id: string;
  codigo: string | null;
  descricao: string;
  valor: string | number;
  natureza: "entrada" | "saida";
  data_pagamento: string | null;
  data_prevista_pagamento: string | null;
  recorrente_id: string | null;
  estorno_de_avulsa_id: string | null;
  fornecedor: FornecedorRaw;
  tipo: PlanoRaw;
  subtipo: PlanoRaw;
  empresa: EmpresaRaw;
  rateio: RateioRaw[];
};

type ParcelaPendenteRaw = {
  id: string;
  numero: number;
  valor: string | number;
  data_pagamento: string | null;
  data_vencimento: string;
  pedido: {
    codigo: string;
    servico: string;
    fornecedor: FornecedorRaw;
    tipo: PlanoRaw;
    subtipo: PlanoRaw;
    empresa: EmpresaRaw;
    job: { id: string; codigo: string; regional: { nome: string } | null } | null;
    parcelas: Array<{ id: string }>;
  } | null;
};

const SELECT_FATURA =
  "id, codigo, cartao_credito_id, competencia_fechamento, data_vencimento, status, valor_cobrado, fechada_em";

export async function carregarExtratoDaFatura(
  supabase: SupabaseClient,
  tenantId: string,
  faturaId: string,
): Promise<ExtratoDaFatura | null> {
  const [faturaRes, lancsRes, avulsasRes, parcelasRes] = await Promise.all([
    supabase
      .from("faturas_cartao")
      .select(SELECT_FATURA)
      .eq("tenant_id", tenantId)
      .eq("id", faturaId)
      .maybeSingle<FaturaRaw>(),
    supabase
      .from("lancamentos_financeiros")
      .select(
        SELECT_LANCAMENTO_LINHA +
          ", conta_bancaria:contas_bancarias(nome, banco, cartao_credito_id)",
      )
      .eq("tenant_id", tenantId)
      .eq("fatura_cartao_id", faturaId)
      .order("data_movimento", { ascending: true })
      .order("created_at", { ascending: true }),
    // O legado: avulsa roteada antes da 093 (ou ajuste de fechamento
    // reaberto) que aponta para a fatura sem ter virado lançamento.
    supabase
      .from("contas_avulsas")
      .select(
        "id, codigo, descricao, valor, natureza, data_pagamento, data_prevista_pagamento, " +
          "recorrente_id, estorno_de_avulsa_id, " +
          "fornecedor:fornecedores(nome, razao_social), " +
          "tipo:plano_contas_tipos!plano_conta_tipo_id(codigo, nome), " +
          "subtipo:plano_contas_subtipos!plano_conta_subtipo_id(codigo, nome), " +
          "empresa:empresas(nome_fantasia, razao_social), " +
          "rateio:contas_avulsas_regionais(percentual, regional:regionais(nome))",
      )
      .eq("tenant_id", tenantId)
      .eq("fatura_cartao_id", faturaId)
      .eq("status", "aprovada"),
    supabase
      .from("pedidos_compra_parcelas")
      .select(
        "id, numero, valor, data_pagamento, data_vencimento, " +
          "pedido:pedidos_compra!inner(codigo, servico, " +
          "fornecedor:fornecedores(nome, razao_social), " +
          "tipo:plano_contas_tipos!plano_conta_tipo_id(codigo, nome), " +
          "subtipo:plano_contas_subtipos!plano_conta_subtipo_id(codigo, nome), " +
          "empresa:empresas(nome_fantasia, razao_social), " +
          "job:jobs(id, codigo, regional:regionais(nome)), " +
          "parcelas:pedidos_compra_parcelas(id))",
      )
      .eq("tenant_id", tenantId)
      .eq("fatura_cartao_id", faturaId)
      .is("pago_em", null),
  ]);

  const f = faturaRes.data;
  if (!f) return null;

  if (lancsRes.error) console.error("[fatura-cartao.lancamentos]", lancsRes.error.message);
  if (avulsasRes.error) console.error("[fatura-cartao.avulsas]", avulsasRes.error.message);
  if (parcelasRes.error) console.error("[fatura-cartao.parcelas]", parcelasRes.error.message);

  const fatura: FaturaResumo = {
    id: f.id,
    codigo: f.codigo,
    cartao_credito_id: f.cartao_credito_id,
    competencia_fechamento: f.competencia_fechamento,
    data_vencimento: f.data_vencimento,
    status: f.status,
    valor_cobrado: f.valor_cobrado === null ? null : Number(f.valor_cobrado),
    fechada_em: f.fechada_em,
  };

  const brutos = (lancsRes.data ?? []) as unknown as Array<
    Record<string, unknown> & {
      papel_na_fatura: string | null;
      data_movimento: string;
      conta_bancaria: { nome: string; banco: string | null; cartao_credito_id: string | null } | null;
    }
  >;

  // A perna do BANCO do pagamento da fatura (a do cartão é a contrapartida
  // interna). Se houve estorno e novo pagamento, o último pagamento vivo
  // é o que conta: um `pagamento` a mais que `pagamento_estorno`.
  const pagamentos = brutos.filter(
    (l) => l.papel_na_fatura === "pagamento" && !l.conta_bancaria?.cartao_credito_id,
  );
  const estornos = brutos.filter(
    (l) => l.papel_na_fatura === "pagamento_estorno" && !l.conta_bancaria?.cartao_credito_id,
  );
  const pagamentoVivo =
    pagamentos.length > estornos.length ? pagamentos[pagamentos.length - 1] : null;
  const pagamento = pagamentoVivo
    ? {
        data: pagamentoVivo.data_movimento,
        conta_nome: pagamentoVivo.conta_bancaria
          ? `${pagamentoVivo.conta_bancaria.nome}${
              pagamentoVivo.conta_bancaria.banco ? ` · ${pagamentoVivo.conta_bancaria.banco}` : ""
            }`
          : null,
      }
    : null;

  // Só item e ajuste são linhas da fatura. O pagamento dela é assunto da
  // conta que pagou — aparece na conciliação daquela conta.
  const linhas = await montarLinhasDeLancamentos(
    supabase,
    tenantId,
    brutos.filter((l) => l.papel_na_fatura === "item" || l.papel_na_fatura === "ajuste"),
  );

  const confirmados: Array<Omit<ItemDaFatura, "acumulado" | "credito" | "debito">> = linhas.map(
    (l: LinhaSemSaldo) => ({
      ...l,
      papel: l.papel_na_fatura === "ajuste" ? "ajuste" : "item",
      origem_item: l.conta_avulsa_id
        ? { tipo: "avulso", id: l.conta_avulsa_id }
        : l.pedido_compra_parcela_id
          ? { tipo: "pp", id: l.pedido_compra_parcela_id }
          : l.desembolso_parcela_id
            ? { tipo: "desembolso", id: l.desembolso_parcela_id }
            : null,
    }),
  );

  const pendentes: Array<Omit<ItemDaFatura, "acumulado" | "credito" | "debito">> = [];

  for (const a of (avulsasRes.data ?? []) as unknown as AvulsaPendenteRaw[]) {
    const rateio = (a.rateio ?? []).map((r) => ({
      percentual: Number(r.percentual),
      regional_nome: r.regional?.nome ?? "—",
    }));
    pendentes.push({
      id: `pendente-avulsa-${a.id}`,
      data_movimento: a.data_pagamento ?? a.data_prevista_pagamento ?? fatura.data_vencimento,
      descricao: a.descricao,
      natureza: a.natureza,
      valor: Number(a.valor),
      fornecedor_nome: a.fornecedor?.razao_social ?? a.fornecedor?.nome ?? null,
      job_id: null,
      job_codigo: null,
      tipo_codigo: a.tipo?.codigo ?? "",
      tipo_nome: a.tipo?.nome ?? "—",
      subtipo_codigo: a.subtipo?.codigo ?? "",
      subtipo_nome: a.subtipo?.nome ?? "—",
      empresa_nome: a.empresa?.nome_fantasia ?? a.empresa?.razao_social ?? null,
      regional_nome: rateio.length === 1 ? rateio[0].regional_nome : null,
      origem_codigo: a.codigo,
      origem_recorrente: a.recorrente_id != null,
      cartao_label: null,
      documento_label: null,
      documento_path: null,
      origem: "pendente_fatura",
      estornada: false,
      rateio,
      origens: [],
      papel: "pendente",
      origem_item: { tipo: "avulso", id: a.id },
    });
  }

  for (const p of (parcelasRes.data ?? []) as unknown as ParcelaPendenteRaw[]) {
    const pp = p.pedido;
    const total = pp?.parcelas?.length ?? 1;
    pendentes.push({
      id: `pendente-parcela-${p.id}`,
      data_movimento: p.data_pagamento ?? p.data_vencimento,
      descricao: total > 1 ? `${pp?.servico ?? ""} (${p.numero}/${total})` : (pp?.servico ?? ""),
      natureza: "saida",
      valor: Number(p.valor),
      fornecedor_nome: pp?.fornecedor?.razao_social ?? pp?.fornecedor?.nome ?? null,
      job_id: pp?.job?.id ?? null,
      job_codigo: pp?.job?.codigo ?? null,
      tipo_codigo: pp?.tipo?.codigo ?? "",
      tipo_nome: pp?.tipo?.nome ?? "—",
      subtipo_codigo: pp?.subtipo?.codigo ?? "",
      subtipo_nome: pp?.subtipo?.nome ?? "—",
      empresa_nome: pp?.empresa?.nome_fantasia ?? pp?.empresa?.razao_social ?? null,
      regional_nome: pp?.job?.regional?.nome ?? null,
      origem_codigo: pp?.codigo ?? null,
      origem_recorrente: false,
      cartao_label: null,
      documento_label: null,
      documento_path: null,
      origem: "pendente_fatura",
      estornada: false,
      rateio: [],
      origens: [],
      papel: "pendente",
      origem_item: { tipo: "pp", id: p.id },
    });
  }

  // Data crescente; empate mantém o lançamento antes do pendente.
  const todos = [...confirmados, ...pendentes].sort((a, b) =>
    a.data_movimento.localeCompare(b.data_movimento),
  );

  let acumulado = 0;
  const kpis = { compras: 0, estornos: 0, ajustes: 0, pendentes: 0, total: 0 };
  const itens: ItemDaFatura[] = todos.map((l) => {
    const credito = l.natureza === "entrada" ? l.valor : 0;
    const debito = l.natureza === "saida" ? l.valor : 0;
    const assinado = debito - credito;
    acumulado += assinado;
    if (l.papel === "item") {
      kpis.compras += debito;
      kpis.estornos += credito;
    } else if (l.papel === "ajuste") {
      kpis.ajustes += assinado;
    } else {
      kpis.pendentes += assinado;
    }
    return { ...l, credito, debito, acumulado };
  });
  kpis.total = kpis.compras - kpis.estornos + kpis.ajustes + kpis.pendentes;

  return { fatura, itens, kpis, pagamento };
}

// ---------------------------------------------------------------------------
// A fatura vista de dentro do pagamento (decisão 093, entrega 3)
// ---------------------------------------------------------------------------

export type ItemDoCentro = {
  id: string;
  data: string;
  descricao: string;
  fornecedor_nome: string | null;
  job_id: string | null;
  job_codigo: string | null;
  subtipo_nome: string;
  /** Com sinal: estorno de compra negativo. */
  valor: number;
  papel: PapelDoItem;
};

export type CentroDaFatura = {
  tipo_codigo: string;
  tipo_nome: string;
  total: number;
  itens: ItemDoCentro[];
};

/** O que a linha do pagamento da fatura abre na conciliação: primeiro por
 *  centro de custo, dentro de cada um os itens. O total fecha com o
 *  débito da linha. */
export type DetalheDaFatura = {
  fatura_id: string;
  codigo: string;
  competencia_fechamento: string;
  data_vencimento: string;
  total: number;
  centros: CentroDaFatura[];
};

export function agruparPorCentro(extrato: ExtratoDaFatura): DetalheDaFatura {
  const mapa = new Map<string, CentroDaFatura>();
  for (const it of extrato.itens) {
    const chave = `${it.tipo_codigo}|${it.tipo_nome}`;
    const centro = mapa.get(chave) ?? {
      tipo_codigo: it.tipo_codigo,
      tipo_nome: it.tipo_nome,
      total: 0,
      itens: [],
    };
    const valor = it.debito - it.credito;
    centro.total += valor;
    centro.itens.push({
      id: it.id,
      data: it.data_movimento,
      descricao: it.descricao,
      fornecedor_nome: it.fornecedor_nome,
      job_id: it.job_id,
      job_codigo: it.job_codigo,
      subtipo_nome: it.subtipo_nome,
      valor,
      papel: it.papel,
    });
    mapa.set(chave, centro);
  }
  // Maior centro primeiro — é o que se procura quando a fatura surpreende.
  const centros = [...mapa.values()].sort(
    (a, b) => b.total - a.total || a.tipo_codigo.localeCompare(b.tipo_codigo),
  );
  return {
    fatura_id: extrato.fatura.id,
    codigo: extrato.fatura.codigo,
    competencia_fechamento: extrato.fatura.competencia_fechamento,
    data_vencimento: extrato.fatura.data_vencimento,
    total: extrato.kpis.total,
    centros,
  };
}
