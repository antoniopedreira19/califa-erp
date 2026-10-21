/**
 * As linhas da planilha de títulos (decisão 195): os títulos a pagar e a
 * receber (no tipo das listas reais), as transferências entre contas e os
 * impostos a pagar num formato só — `LinhaDaPlanilha`, de
 * `lib/financeiro/planilha-de-titulos.ts` —, com o título original em `t`
 * para a baixa e as ações. Serve à aba Títulos da conciliação e às listas
 * de Contas a Pagar, Contas a Receber e Impostos a Pagar.
 *
 * Módulo puro — vale no servidor, no cliente e no teste. O que as listas
 * ainda não liam (regional, retenção da aprovação, itens da fatura) chega
 * pronto em `extras` (`lib/data/planilha-de-titulos.ts`).
 */

import type { TituloParaLote } from "@/components/financeiro/baixa-em-lote";
import type { ExtrasDaPlanilha, IdsDaPlanilha } from "@/lib/data/planilha-de-titulos";
import type { ImpostoRetido } from "@/lib/types";
import {
  centrosDosItens,
  jobsDosItens,
  r2,
  rateioPonderado,
  type CentroDaLinha,
  type LinhaDaPlanilha,
  type StatusDaLinha,
  type ValorDaLinha,
} from "@/lib/financeiro/planilha-de-titulos";
import type { TituloRow as TituloAPagar } from "../contas-a-pagar/titulos-pagar-list";
import type { TituloRow as TituloAReceber } from "../contas-a-receber/titulos-list";
import type { ImpostoDaLista } from "../fiscal/impostos/dados";
import {
  chaveDoLoteImposto,
  orgaoDoImposto,
  paraOLoteImposto,
  referenciaDoImposto,
} from "../fiscal/impostos/lote";
import {
  chaveDoLoteAPagar,
  chaveDoLoteAReceber,
  faltaPagar,
  faltaReceber,
  motivoForaDoLoteAPagar,
  motivoForaDoLoteAReceber,
  paraOLoteAPagar,
  paraOLoteAReceber,
} from "./alvos-da-baixa";

export { casaVencimento, somaDias, type FiltroVencimento } from "@/lib/financeiro/planilha-de-titulos";

// ---------------------------------------------------------------------------
// A linha
// ---------------------------------------------------------------------------

interface DoLote {
  /** Por que não entra na baixa em lote; `null` entra. */
  motivoForaDoLote: string | null;
  /** O título no formato do lote; `null` na origem que não entra nele. */
  lote: TituloParaLote | null;
}

export type Linha =
  | (LinhaDaPlanilha & DoLote & { lado: "pagar"; t: TituloAPagar })
  | (LinhaDaPlanilha & DoLote & { lado: "receber" | "transferencia"; t: TituloAReceber })
  | (LinhaDaPlanilha & DoLote & { lado: "imposto"; t: ImpostoDaLista });

export type Lado = Linha["lado"];

// ---------------------------------------------------------------------------
// O contexto: os nomes que a linha mostra
// ---------------------------------------------------------------------------

export interface EntradaDoContexto {
  hoje: string;
  /** Empresa → nome curto. */
  empresas: Record<string, string>;
  tipos: ReadonlyArray<{ id: string; codigo: string; nome: string }>;
  subtipos: ReadonlyArray<{ id: string; nome: string }>;
  cartoes: ReadonlyArray<{ id: string; nome: string; ultimos_4_digitos: string | null }>;
  /** Conta → nome (as pernas da transferência). */
  contas: ReadonlyArray<{ id: string; nome: string }>;
  /** O centro de custo de cada tributo ("03 · Custo Tributário · ISS"),
   *  o mesmo da baixa do imposto (`fiscal/impostos/dialogos.tsx`). */
  centroDoImposto: Record<string, string>;
  extras: ExtrasDaPlanilha;
}

export interface ContextoDasLinhas {
  hoje: string;
  empresas: Record<string, string>;
  tipo: Map<string, string>;
  subtipo: Map<string, string>;
  cartao: Map<string, string>;
  conta: Map<string, string>;
  centroDoImposto: Record<string, string>;
  extras: ExtrasDaPlanilha;
}

export function prepararContexto(e: EntradaDoContexto): ContextoDasLinhas {
  return {
    hoje: e.hoje,
    empresas: e.empresas,
    tipo: new Map(e.tipos.map((t) => [t.id, `${t.codigo} · ${t.nome}`])),
    subtipo: new Map(e.subtipos.map((s) => [s.id, s.nome])),
    cartao: new Map(e.cartoes.map((c) => [c.id, `${c.nome}${c.ultimos_4_digitos ? ` ••••${c.ultimos_4_digitos}` : ""}`])),
    conta: new Map(e.contas.map((c) => [c.id, c.nome])),
    centroDoImposto: e.centroDoImposto,
    extras: e.extras,
  };
}

function centroDoPlano(ctx: ContextoDasLinhas, tipoId: string | null, subtipoId: string | null): CentroDaLinha {
  const rotulo = tipoId ? ctx.tipo.get(tipoId) : undefined;
  if (!rotulo) return { tipo: "definir_na_baixa" };
  const sub = subtipoId ? ctx.subtipo.get(subtipoId) : undefined;
  return { tipo: "plano", rotulo, completo: sub ? `${rotulo} · ${sub}` : rotulo };
}

/** O centro que a baixa gravou ("04 · Custo Fixo" + o subtipo). */
function centroDaBaixa(centro: string | null, subtipo: string | null): CentroDaLinha | null {
  if (!centro || centro === "—") return null;
  return { tipo: "plano", rotulo: centro, completo: subtipo ? `${centro} · ${subtipo}` : centro };
}

const NOME_DO_IMPOSTO: Record<ImpostoRetido, string> = {
  ISS: "ISS",
  PIS: "PIS",
  COFINS: "COFINS",
  CSLL: "CSLL",
  IRRF: "IRRF",
};

function percentual(a: number): string {
  return `${a.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
}

/** As retenções das baixas já feitas, somadas por imposto. */
function retencoesDasBaixas(
  baixas: ReadonlyArray<{ retencoes: ReadonlyArray<{ imposto: ImpostoRetido; aliquota: number | null; valor: number }> }>,
): Array<{ rotulo: string; valor: number }> {
  const soma = new Map<string, number>();
  for (const b of baixas) {
    for (const r of b.retencoes) {
      if (!r.valor) continue;
      const rotulo = r.aliquota ? `${NOME_DO_IMPOSTO[r.imposto]} ${percentual(r.aliquota)}` : NOME_DO_IMPOSTO[r.imposto];
      soma.set(rotulo, r2((soma.get(rotulo) ?? 0) + r.valor));
    }
  }
  return [...soma.entries()].map(([rotulo, valor]) => ({ rotulo, valor }));
}

/** O que já voltou por estorno das baixas (decisão 120). */
function estornadoDasBaixas(baixas: ReadonlyArray<{ estornos: ReadonlyArray<{ valor: number }> }>, extra: ReadonlyArray<{ valor: number }> = []): number {
  const todos = [...baixas.flatMap((b) => b.estornos), ...extra];
  return todos.reduce((s, e) => s + Math.round(e.valor * 100), 0) / 100;
}

/** O que a baixa já movimentou na conta (o líquido). */
function movimentado(baixas: ReadonlyArray<{ movimentado: number }>): number {
  return r2(baixas.reduce((s, b) => s + b.movimentado, 0));
}

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "21/10/2026" de um timestamp: o dia de Brasília. */
function diaBR(instante: string): string {
  const dia = new Date(instante).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

function minusculas(partes: Array<string | null | undefined>): string {
  return partes.filter(Boolean).join(" ").toLowerCase();
}

// ---------------------------------------------------------------------------
// A pagar
// ---------------------------------------------------------------------------

const ETIQUETA_A_PAGAR: Record<TituloAPagar["origem"], LinhaDaPlanilha["etiqueta"]> = {
  pp: { texto: "PP", tom: "neutro" },
  avulso: { texto: "AVULSO", tom: "violeta" },
  recorrencia: { texto: "RECORRÊNCIA", tom: "azul" },
  folha: { texto: "FOLHA", tom: "rosa" },
  desembolso: { texto: "DESEMBOLSO", tom: "ambar" },
  pp_devolucao_verba: { texto: "ESTORNO DE VERBA", tom: "verde_agua" },
  fatura_cartao: { texto: "FATURA", tom: "ardosia" },
};

const ORIGEM_A_PAGAR: Record<TituloAPagar["origem"], LinhaDaPlanilha["origem"]> = {
  pp: "pp",
  avulso: "avulso",
  recorrencia: "recorrencia",
  folha: "folha",
  desembolso: "desembolso",
  pp_devolucao_verba: "verba",
  fatura_cartao: "fatura",
};

/** O lápis da data prevista só onde ele grava (decisão 195, D1):
 *  `repactuarDataPagamento` escreve na parcela da PP e na avulsa. */
const EDITA_DATA_A_PAGAR = new Set<TituloAPagar["origem"]>(["pp", "avulso", "recorrencia", "folha"]);

export function linhaAPagar(t: TituloAPagar, ctx: ContextoDasLinhas): Linha {
  const chave = chaveDoLoteAPagar(t);
  const pago = t.status === "pago";
  const noCartao = pago && t.forma_pagamento === "cartao_credito";
  const verba = t.origem === "pp_devolucao_verba";
  const fatura = t.origem === "fatura_cartao";

  // O valor: o bruto; em aberto e sem baixa, a retenção da aprovação da PP
  // já sai do que vai para a conta (o título fica pelo líquido).
  const aliquotas = t.origem === "pp" && !t.eh_verba && t.baixas.length === 0 && !pago ? ctx.extras.retencaoDaAprovacao[t.id] : undefined;
  const daAprovacao = aliquotas
    ? (Object.entries(aliquotas) as Array<[ImpostoRetido, number]>).map(([imposto, a]) => ({
        rotulo: `${NOME_DO_IMPOSTO[imposto]} ${percentual(a)}`,
        valor: r2((t.valor * a) / 100),
      }))
    : [];
  const retido = r2(daAprovacao.reduce((s, r) => s + r.valor, 0));
  const valor: ValorDaLinha = {
    bruto: t.valor,
    estornado: estornadoDasBaixas(t.baixas, t.baixas.length === 0 ? t.estornos_da_baixa : []),
    retencoes: daAprovacao.length ? daAprovacao : retencoesDasBaixas(t.baixas),
    baixado: pago ? 0 : t.baixado,
    conta: pago ? (t.baixas.length ? movimentado(t.baixas) : t.valor) : r2(faltaPagar(t) - retido),
  };

  const parcial = !pago && t.baixas.length > 0 && faltaPagar(t) > 0.004;
  const status: StatusDaLinha = noCartao
    ? "no_cartao"
    : verba
      ? pago
        ? "devolvido"
        : "a_devolver"
      : pago
        ? "pago"
        : parcial
          ? "parcial"
          : "a_pagar";

  const itens = fatura ? ctx.extras.itensDaFatura[t.id] ?? [] : [];
  const centro: CentroDaLinha = fatura
    ? { tipo: "itens_da_fatura", centros: centrosDosItens(itens) }
    : (pago && centroDaBaixa(t.centro_nome, t.subtipo_nome)) || centroDoPlano(ctx, t.plano_conta_tipo_id, t.plano_conta_subtipo_id);

  const parcela = t.parcela_total > 1 ? ` — parcela ${t.parcela_numero}/${t.parcela_total}` : "";
  const descricao =
    t.origem === "pp"
      ? `${t.origem_label} · ${t.descricao}${parcela}`
      : t.origem === "desembolso" || fatura
        ? `${t.origem_label} · ${t.descricao}${parcela}`
        : `${t.descricao}${parcela}`;
  const etiqueta =
    t.origem === "desembolso" || fatura
      ? { texto: t.origem_label, tom: ETIQUETA_A_PAGAR[t.origem].tom }
      : ETIQUETA_A_PAGAR[t.origem];
  const codigoDaFatura = t.fatura_cartao_id ? ctx.extras.codigoDaFatura[t.fatura_cartao_id] : undefined;
  const complementos = [
    ...(t.origem === "pp" && t.nf_numero ? [`NF ${t.nf_numero}`] : []),
    ...(t.em_remessa ? ["na remessa"] : []),
    // O pago no cartão fica na lista com a fatura em que entrou (decisão 195).
    ...(noCartao ? [codigoDaFatura ? `na fatura ${codigoDaFatura}` : "no cartão"] : []),
  ];

  const job = t.job_codigo && t.job_codigo !== "—" ? { codigo: t.job_codigo, nome: t.job_nome } : null;
  const empresa = t.empresa_id ? ctx.empresas[t.empresa_id] ?? null : null;
  const cartaoPrevisto =
    !pago && t.forma_prevista === "cartao_credito" && t.cartao_previsto_id
      ? ctx.cartao.get(t.cartao_previsto_id) ?? "de crédito"
      : null;

  return {
    lado: "pagar",
    t,
    chave,
    origem: ORIGEM_A_PAGAR[t.origem],
    dataPrevista: t.data_pagamento,
    vencimento: t.venc_original ?? t.data_pagamento,
    pagoEm: pago ? t.pago_em ?? t.data_pagamento : null,
    // O estorno de verba volta para a conta; o estorno de compra no cartão
    // abate a fatura. Os dois são crédito.
    entra: verba || t.estorno_de_avulsa_id !== null,
    transferencia: null,
    contaFixa: null,
    valor,
    descricao,
    etiqueta,
    complementos,
    bv: false,
    contraparte: t.fornecedor_nome || "—",
    job,
    jobsDaFatura: jobsDosItens(itens),
    itensDaFatura: itens,
    centro,
    empresa,
    // A fatura rateia pelos itens: cada um com a regional dele, pesada pelo
    // valor.
    rateio: fatura ? rateioPonderado(itens) : ctx.extras.rateio[chave] ?? [],
    status,
    cartaoPrevisto,
    editaData: EDITA_DATA_A_PAGAR.has(t.origem),
    urgente: t.urgente && !pago ? { justificativa: t.urgente_justificativa } : null,
    avisoDaContraparte: t.cadastro_do_fornecedor_mudou
      ? "Os dados de pagamento do fornecedor mudaram depois desta PP. Ela continua valendo pelos dados que estão no documento dela; o cadastro novo vale para as próximas."
      : null,
    situacaoDaVerba: t.verba_situacao,
    busca: minusculas([descricao, t.origem_label, t.fornecedor_nome, empresa, t.job_codigo, t.job_nome, t.nf_numero]),
    motivoForaDoLote: motivoForaDoLoteAPagar(t),
    lote: paraOLoteAPagar(t),
  };
}

// ---------------------------------------------------------------------------
// A receber (e a transferência entre contas, que mora em Contas a Receber)
// ---------------------------------------------------------------------------

export function linhaAReceber(t: TituloAReceber, ctx: ContextoDasLinhas): Linha {
  const chave = chaveDoLoteAReceber(t);
  const pago = t.status === "pago";
  const nota = t.origem === "nf";
  const transferencia = t.origem === "transferencia";

  const valor: ValorDaLinha = {
    bruto: t.valor,
    estornado: estornadoDasBaixas(t.baixas),
    retencoes: retencoesDasBaixas(t.baixas),
    baixado: pago ? 0 : t.baixado,
    conta: pago ? (t.baixas.length ? movimentado(t.baixas) : t.valor) : faltaReceber(t),
  };
  const parcial = !pago && t.baixas.length > 0 && faltaReceber(t) > 0.004;
  const status: StatusDaLinha = t.status === "cancelado"
    ? "cancelado"
    : transferencia
    ? pago
      ? "transferido"
      : "a_transferir"
    : pago
      ? "recebido"
      : parcial
        ? "parcial"
        : nota && t.data_vencimento < ctx.hoje
          ? "inadimplente"
          : "em_aberto";

  let centro: CentroDaLinha;
  if (transferencia) centro = { tipo: "fora_do_dre" };
  else if (nota) {
    const daNota = ctx.extras.centroDaNota[t.id];
    const daBaixa = t.baixas[0] ? centroDaBaixa(t.baixas[0].centroNome, t.baixas[0].subtipoNome ?? null) : null;
    centro = daNota ? centroDoPlano(ctx, daNota.tipoId, daNota.subtipoId) : daBaixa ?? { tipo: "definir_na_baixa" };
  } else centro = centroDoPlano(ctx, t.plano_conta_tipo_id, t.plano_conta_subtipo_id);

  const pernas = transferencia ? ctx.extras.transferencias[t.id] : undefined;
  const [origemNome, destinoNome] = t.contraparte_nome.split(" → ");
  const descricao = nota
    ? `Recebimento NF ${t.fat_numero_nf}/${t.numero_parcela} — ${t.fat_descricao}`
    : transferencia
      ? `Transferência ${t.codigo_avulsa ?? ""} · ${t.contraparte_nome}`.replace("  ", " ")
      : t.fat_descricao;
  const etiqueta: LinhaDaPlanilha["etiqueta"] = nota
    ? { texto: "NOTA FISCAL", tom: "vermelho" }
    : transferencia
      ? { texto: "TRANSFERÊNCIA", tom: "ceu" }
      : t.origem === "rendimento"
        ? { texto: "RENDIMENTO", tom: "verde" }
        : { texto: "RECEB. AVULSO", tom: "violeta" };
  const complementos = nota
    ? [
        t.total_parcelas > 1 ? `parcela ${t.numero_parcela}/${t.total_parcelas}` : "parcela única",
        // A nota agrupada (decisão 188): vários jobs numa nota só.
        ...(t.jobs.length > 1 ? [`agrupada · ${t.jobs.length} jobs`] : []),
      ]
    : t.codigo_avulsa && !transferencia
      ? [t.codigo_avulsa]
      : [];
  const job =
    t.jobs.length > 0
      ? {
          codigo: t.jobs.length > 1 ? `${t.jobs[0].codigo} +${t.jobs.length - 1}` : t.jobs[0].codigo,
          nome: t.jobs_cobertos.join(" · "),
        }
      : null;
  const empresa = t.empresa_id ? ctx.empresas[t.empresa_id] ?? null : null;

  return {
    lado: transferencia ? "transferencia" : "receber",
    t,
    chave,
    origem: nota ? "nf" : transferencia ? "transferencia" : t.origem === "rendimento" ? "rendimento" : "recebimento_avulso",
    dataPrevista: t.data_previsao_recebimento,
    vencimento: t.data_vencimento,
    pagoEm: pago ? t.pago_em ?? t.data_previsao_recebimento : null,
    entra: !transferencia,
    transferencia: pernas
      ? {
          origemContaId: pernas.origemContaId,
          destinoContaId: pernas.destinoContaId,
          origemNome: ctx.conta.get(pernas.origemContaId) ?? origemNome ?? "—",
          destinoNome: ctx.conta.get(pernas.destinoContaId) ?? destinoNome ?? "—",
        }
      : transferencia
        ? { origemContaId: "", destinoContaId: "", origemNome: origemNome ?? "—", destinoNome: destinoNome ?? "—" }
        : null,
    contaFixa: t.origem === "rendimento" ? t.conta_prevista_id : null,
    valor,
    descricao,
    etiqueta,
    complementos,
    // A nota de BV: o veículo paga à agência (sem job, item que não é
    // avulso — a mesma leitura de `montarTitulosAReceber`).
    bv: nota && t.jobs.length === 0 && (t.jobs_cobertos[0] ?? "").startsWith("BV · "),
    contraparte: t.contraparte_nome,
    job,
    jobsDaFatura: [],
    itensDaFatura: [],
    centro,
    empresa: transferencia ? null : empresa,
    rateio: transferencia ? [] : ctx.extras.rateio[chave] ?? [],
    status,
    cartaoPrevisto: null,
    // O lápis "Editar previsão de recebimento" só existe na nota.
    editaData: nota,
    urgente: null,
    avisoDaContraparte: null,
    situacaoDaVerba: null,
    busca: minusculas([descricao, t.fat_descricao, t.contraparte_nome, empresa, ...t.jobs_cobertos, t.codigo_avulsa]),
    motivoForaDoLote: transferencia ? "Transferência tem baixa própria: dê baixa nela sozinha." : motivoForaDoLoteAReceber(t),
    lote: transferencia ? null : paraOLoteAReceber(t),
  };
}

// ---------------------------------------------------------------------------
// Imposto
// ---------------------------------------------------------------------------

/**
 * O imposto a pagar (módulo fiscal): "Guia de PIS · 09/2026", o DARF ou a
 * guia municipal, o órgão que recebe e a PJ da guia na coluna Empresa.
 * Sempre sai da conta, pelo valor inteiro.
 */
export function linhaDeImposto(t: ImpostoDaLista, ctx: ContextoDasLinhas): Linha {
  const pago = t.status === "pago";
  const referencia = referenciaDoImposto(t);
  const contraparte = orgaoDoImposto(t);
  const completo = ctx.centroDoImposto[t.tributo] ?? ctx.centroDoImposto.OUTRO ?? "03 · Custo Tributário";
  const rotulo = completo.split(" · ").slice(0, 2).join(" · ").replace(/ \(.*$/, "");
  const status: StatusDaLinha =
    t.status === "cancelado" ? "cancelado" : pago ? "pago" : t.vencimento < ctx.hoje ? "vencido" : "a_pagar";
  const descricao = `Guia de ${t.titulo} · ${t.rotulo_competencia}`;
  return {
    lado: "imposto",
    t,
    chave: chaveDoLoteImposto(t),
    origem: "imposto",
    dataPrevista: t.vencimento,
    vencimento: t.vencimento,
    pagoEm: pago ? t.pago_em : null,
    entra: false,
    transferencia: null,
    contaFixa: null,
    valor: { bruto: t.valor, estornado: 0, retencoes: [], baixado: 0, conta: pago ? r2(t.valor + t.multa_juros) : t.valor },
    descricao,
    etiqueta: { texto: "IMPOSTO", tom: "ambar" },
    complementos: [
      `${referencia}${t.local ? ` · ${t.local}` : ""} · ${t.rotulo_competencia}${t.cota_numero ? ` · cota ${t.cota_numero}/${t.cota_total}` : ""}`,
      // O que a lista de Impostos a Pagar dizia nas colunas que saíram.
      ...(t.origem === "diferenca" ? ["complementar"] : t.origem === "avulso" ? [`avulso · ${t.descricao}`] : []),
      ...(t.juros > 0 ? [`${moeda(t.principal)} + juros ${moeda(t.juros)}`] : []),
      ...(t.correcoes[0] ? [`corrigido de ${moeda(t.correcoes[0].de)}`] : []),
      ...(pago && t.multa_juros > 0 ? [`+ multa e juros ${moeda(t.multa_juros)}`] : []),
      ...(t.status === "cancelado"
        ? [`cancelado${t.cancelado_em ? ` em ${diaBR(t.cancelado_em)}` : ""}${t.motivo_cancelamento ? `: ${t.motivo_cancelamento}` : ""}`]
        : []),
    ],
    bv: false,
    contraparte,
    job: null,
    jobsDaFatura: [],
    itensDaFatura: [],
    centro: { tipo: "plano", rotulo, completo },
    empresa: t.pj,
    rateio: t.rateio.flatMap((r) => (r.regional ? [{ regional: r.regional, percentual: r.percentual }] : [])),
    status,
    cartaoPrevisto: null,
    editaData: false,
    urgente: null,
    avisoDaContraparte: null,
    situacaoDaVerba: null,
    busca: minusculas([descricao, referencia, contraparte, t.pj, t.local, t.cnpj, t.rotulo_competencia, t.descricao]),
    motivoForaDoLote: null,
    lote: pago ? null : paraOLoteImposto(t),
  };
}

/** Os ids de cada fonte, para a leitura dos extras da planilha
 *  (`carregarExtrasDaPlanilha`). */
export function idsDaPlanilha(aPagar: TituloAPagar[], aReceber: TituloAReceber[]): IdsDaPlanilha {
  const de = (o: TituloAPagar["origem"]) => aPagar.filter((t) => t.origem === o).map((t) => t.id);
  return {
    ppParcelas: de("pp"),
    avulsasPagar: aPagar
      .filter((t): t is TituloAPagar & { origem: "avulso" | "recorrencia" | "folha" } =>
        t.origem === "avulso" || t.origem === "recorrencia" || t.origem === "folha",
      )
      .map((t) => ({ id: t.id, origem: t.origem })),
    desembolsoParcelas: de("desembolso"),
    devolucoesDeVerba: de("pp_devolucao_verba"),
    faturas: de("fatura_cartao"),
    titulosReceber: aReceber.filter((t) => t.origem === "nf").map((t) => t.id),
    avulsasReceber: aReceber
      .filter((t): t is TituloAReceber & { origem: "recebimento_avulso" | "rendimento" } =>
        t.origem === "recebimento_avulso" || t.origem === "rendimento",
      )
      .map((t) => ({ id: t.conta_avulsa_id ?? t.id, origem: t.origem })),
    transferencias: aReceber.filter((t) => t.origem === "transferencia").map((t) => t.id),
    faturasDosItens: aPagar
      .filter((t) => t.forma_pagamento === "cartao_credito" && t.fatura_cartao_id)
      .map((t) => t.fatura_cartao_id as string),
  };
}

/** Todas as linhas da aba Títulos da conciliação. */
export function montarLinhas(
  aPagar: TituloAPagar[],
  aReceber: TituloAReceber[],
  impostos: ImpostoDaLista[],
  ctx: ContextoDasLinhas,
): Linha[] {
  return [
    ...aPagar.map((t) => linhaAPagar(t, ctx)),
    ...aReceber.map((t) => linhaAReceber(t, ctx)),
    ...impostos.filter((t) => t.status === "a_pagar").map((t) => linhaDeImposto(t, ctx)),
  ];
}
