/**
 * A conta da Mídia Off (decisão 147).
 *
 * As contas são as das planilhas de referência dos PMs, conferidas célula a
 * célula no protótipo aprovado em 06/10/2026:
 *
 *   unit. negociado = unit. tabela × (1 − desconto)        (ou digitado)
 *   quantidade      = Σ inserções do mês (grade) | qtde × períodos (período)
 *   total negociado = unit. negociado × quantidade
 *   veículo         = total negociado × % do veículo (80 nas referências)
 *   honorários      = % × negociado, ou % × veículo (base "líquido",
 *                     contrato da AMBEV)
 *   total da linha  = veículo + honorários
 *
 * E o fechamento (respostas do Tiago de 04/10/2026):
 *   valor do job          = Σ total das linhas — o cliente paga o total
 *                           orçado, nada por cima;
 *   faturamento previsto  = honorários + veículos em A · Repasse (a nota
 *                           do A · Direto é do veículo direto ao cliente);
 *   impostos              = alíquota × honorários — saem de DENTRO dos
 *                           honorários, não somam ao valor do job;
 *   custo planejado       = Σ veículos (na mídia o planejado é o orçado);
 *   resultado operacional = valor do job − impostos − custo planejado.
 *
 * **Não é `calcularTotaisVersao`.** A conta nacional soma honorários e
 * imposto POR CIMA dos custos; a da mídia decompõe o negociado. Quem lê uma
 * versão de Mídia Off pede o fechamento daqui.
 *
 * Sem banco e sem React: a tela, o servidor e os testes usam a mesma
 * função. Na linha gravada, o ORÇADO é o negociado: `valor_unitario_orcado`
 * é o unitário negociado e `total_orcado` é o total negociado.
 */

import type {
  BaseHonorariosMidia,
  FormaDeCompraMidia,
  TipoCusto,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";

/** As condições de mídia da versão. */
export interface ParametrosMidia {
  /** Honorários da agência, em %. Vêm do cadastro do cliente. */
  honorarios: number;
  /** Alíquota de impostos da versão, em %. Sai de dentro dos honorários. */
  imposto: number;
  base: BaseHonorariosMidia;
  /** A parte do negociado que fica com o veículo, em %. */
  veiculo: number;
}

/** Os parâmetros gravados na versão. */
export function parametrosDaVersao(v: {
  percentual_honorarios: number | string;
  percentual_imposto: number | string;
  base_honorarios: BaseHonorariosMidia | string | null;
  percentual_veiculo: number | string | null;
}): ParametrosMidia {
  return {
    honorarios: Number(v.percentual_honorarios ?? 0),
    imposto: Number(v.percentual_imposto ?? 0),
    base: v.base_honorarios === "liquido" ? "liquido" : "negociado",
    veiculo: Number(v.percentual_veiculo ?? 80),
  };
}

/** A linha da mídia, já no formato que a planilha e a conta leem. */
export interface LinhaMidia {
  id: string;
  /** O grupo do banco: um meio num mês. */
  grupoId: string;
  forma: FormaDeCompraMidia;
  /** A · Direto ou A · Repasse. */
  tipo: "A" | "AR";
  praca: string;
  /** O fornecedor que é o veículo. `null` = linha sem veículo (rascunho). */
  veiculoId: string | null;
  /** Programa, faixa horária ou ponto. */
  descricao: string;
  detalhe: string;
  /** Grade: a peça (A, B…). */
  peca: string;
  formato: string;
  /** Grade: inserções por dia do mês. */
  dias: Record<number, number>;
  /** Período: início e fim, `YYYY-MM-DD`. */
  inicio: string | null;
  fim: string | null;
  /** Período: pontos, placas ou cotas. */
  qtde: number;
  /** Período: quantos períodos. */
  periodos: number;
  unidadePeriodo: string;
  unitTabela: number;
  /** Fração: 0,6 = 60%. */
  desconto: number;
  unitNegociado: number;
}

/** Do item gravado para a linha da planilha. */
export function linhaDoItem(
  it: Pick<
    VersaoOrcamentoItem,
    | "id"
    | "grupo_id"
    | "tipo_custo"
    | "praca"
    | "fornecedor_id"
    | "item"
    | "detalhe"
    | "peca"
    | "formato"
    | "insercoes_por_dia"
    | "data_inicio"
    | "data_fim"
    | "quantidade_orcada"
    | "dias_meses_orcado"
    | "unidade_periodo"
    | "valor_unitario_tabela"
    | "percentual_desconto"
    | "valor_unitario_orcado"
  >,
  forma: FormaDeCompraMidia,
): LinhaMidia {
  const dias: Record<number, number> = {};
  for (const [k, v] of Object.entries(it.insercoes_por_dia ?? {})) {
    const n = Number(v);
    if (n > 0) dias[Number(k)] = n;
  }
  return {
    id: it.id,
    grupoId: it.grupo_id,
    forma,
    tipo: it.tipo_custo === "AR" ? "AR" : "A",
    praca: it.praca ?? "",
    veiculoId: it.fornecedor_id ?? null,
    descricao: it.item ?? "",
    detalhe: it.detalhe ?? "",
    peca: it.peca ?? "",
    formato: it.formato ?? "",
    dias,
    inicio: it.data_inicio ?? null,
    fim: it.data_fim ?? null,
    qtde: Number(it.quantidade_orcada ?? 0),
    periodos: Number(it.dias_meses_orcado ?? 0),
    unidadePeriodo: it.unidade_periodo ?? "",
    unitTabela: Number(it.valor_unitario_tabela ?? 0),
    desconto: Number(it.percentual_desconto ?? 0) / 100,
    unitNegociado: Number(it.valor_unitario_orcado ?? 0),
  };
}

/** O tipo de custo gravado para o tipo da linha. */
export function tipoCustoDaLinha(tipo: LinhaMidia["tipo"]): TipoCusto {
  return tipo === "AR" ? "AR" : "A";
}

export function quantidadeDaLinha(l: Pick<LinhaMidia, "forma" | "dias" | "qtde" | "periodos">): number {
  if (l.forma === "grade") {
    return Object.values(l.dias).reduce((s, n) => s + (Number(n) || 0), 0);
  }
  return (l.qtde || 0) * (l.periodos || 0);
}

export interface ContaDaLinha {
  quantidade: number;
  totalTabela: number;
  totalNegociado: number;
  /** A nota do veículo. */
  notaVeiculo: number;
  /** Os honorários (a "nota da agência" dos PMs). */
  notaAgencia: number;
  total: number;
}

export const CONTA_ZERO: ContaDaLinha = {
  quantidade: 0,
  totalTabela: 0,
  totalNegociado: 0,
  notaVeiculo: 0,
  notaAgencia: 0,
  total: 0,
};

/** A conta de uma linha a partir do total negociado. É a mesma regra de
 *  `contaDaLinha`, para quem só tem o `total_orcado` gravado. */
export function contaDoNegociado(
  totalNegociado: number,
  p: ParametrosMidia,
): Pick<ContaDaLinha, "totalNegociado" | "notaVeiculo" | "notaAgencia" | "total"> {
  const notaVeiculo = totalNegociado * (p.veiculo / 100);
  const base = p.base === "negociado" ? totalNegociado : notaVeiculo;
  const notaAgencia = base * (p.honorarios / 100);
  return { totalNegociado, notaVeiculo, notaAgencia, total: notaVeiculo + notaAgencia };
}

export function contaDaLinha(l: LinhaMidia, p: ParametrosMidia): ContaDaLinha {
  const quantidade = quantidadeDaLinha(l);
  return {
    quantidade,
    totalTabela: l.unitTabela * quantidade,
    ...contaDoNegociado(l.unitNegociado * quantidade, p),
  };
}

export function somar(contas: ContaDaLinha[]): ContaDaLinha {
  return contas.reduce(
    (a, c) => ({
      quantidade: a.quantidade + c.quantidade,
      totalTabela: a.totalTabela + c.totalTabela,
      totalNegociado: a.totalNegociado + c.totalNegociado,
      notaVeiculo: a.notaVeiculo + c.notaVeiculo,
      notaAgencia: a.notaAgencia + c.notaAgencia,
      total: a.total + c.total,
    }),
    CONTA_ZERO,
  );
}

/** Como 100% do negociado se divide, em pontos percentuais. Com honorários
 *  sobre o líquido, 13% viram 10,4% do negociado. */
export function composicao(p: ParametrosMidia): {
  veiculo: number;
  honorarios: number;
  total: number;
  cliente: number;
} {
  const honorarios = p.base === "negociado" ? p.honorarios : (p.honorarios * p.veiculo) / 100;
  const total = p.veiculo + honorarios;
  return { veiculo: p.veiculo, honorarios, total, cliente: Math.max(0, 100 - total) };
}

/** O meio na versão: meio + formato. É a identidade que atravessa os meses
 *  (o mesmo meio em julho e em agosto são dois grupos do banco). */
export interface MeioDaVersao {
  chave: string;
  meio: string;
  formato: string;
  forma: FormaDeCompraMidia;
}

/** "TV Fechada|filme 30"" — sem caixa, como o banco compara. */
export function chaveDoMeio(meio: string, formato: string | null | undefined): string {
  return `${meio.trim().toLowerCase()}|${(formato ?? "").trim().toLowerCase() || "—"}`;
}

export function meioDoGrupo(
  g: Pick<VersaoOrcamentoGrupo, "meio" | "formato" | "forma_compra" | "nome">,
): MeioDaVersao {
  const meio = g.meio ?? g.nome;
  const formato = g.formato ?? "—";
  return {
    chave: chaveDoMeio(meio, formato),
    meio,
    formato,
    forma: g.forma_compra === "grade" ? "grade" : "periodo",
  };
}

export interface FechamentoMidia {
  /** Uma conta por meio, na ordem recebida. */
  porMeio: Array<{ meio: MeioDaVersao; conta: ContaDaLinha }>;
  geral: ContaDaLinha;
  /** Notas dos veículos que faturam direto ao cliente (A · Direto). */
  veiculosDireto: number;
  /** Notas dos veículos que passam pela California (A · Repasse). */
  veiculosRepasse: number;
  honorarios: number;
  /** Sai de dentro dos honorários: não soma ao valor do job. */
  imposto: number;
  /** O que a California emite: honorários + veículos em A · Repasse. */
  faturamentoPrevisto: number;
  valorJob: number;
  /** As notas dos veículos: na mídia, o planejado é o orçado. */
  custoPlanejado: number;
  resultadoOperacional: number;
  /** `null` sem valor de job — a conta não existe. */
  resultadoGeral: number | null;
}

/**
 * O fechamento de um conjunto de linhas (um mês, a campanha). `meios` é a
 * lista de meios na ordem da tela; a linha cai no meio pela `chaveDe`.
 */
export function fechar(
  meios: MeioDaVersao[],
  linhas: LinhaMidia[],
  chaveDe: (l: LinhaMidia) => string,
  p: ParametrosMidia,
): FechamentoMidia {
  const contas = new Map<string, ContaDaLinha[]>();
  let veiculosRepasse = 0;
  for (const l of linhas) {
    const c = contaDaLinha(l, p);
    const k = chaveDe(l);
    const lista = contas.get(k) ?? [];
    lista.push(c);
    contas.set(k, lista);
    if (l.tipo === "AR") veiculosRepasse += c.notaVeiculo;
  }
  const porMeio = meios.map((meio) => ({ meio, conta: somar(contas.get(meio.chave) ?? []) }));
  const geral = somar([...contas.values()].flat());
  return fechamentoDe(geral, veiculosRepasse, p, porMeio);
}

function fechamentoDe(
  geral: ContaDaLinha,
  veiculosRepasse: number,
  p: ParametrosMidia,
  porMeio: FechamentoMidia["porMeio"],
): FechamentoMidia {
  const honorarios = geral.notaAgencia;
  const imposto = honorarios * (p.imposto / 100);
  const valorJob = geral.total;
  const custoPlanejado = geral.notaVeiculo;
  const resultadoOperacional = valorJob - imposto - custoPlanejado;
  return {
    porMeio,
    geral,
    veiculosDireto: geral.notaVeiculo - veiculosRepasse,
    veiculosRepasse,
    honorarios,
    imposto,
    faturamentoPrevisto: honorarios + veiculosRepasse,
    valorJob,
    custoPlanejado,
    resultadoOperacional,
    resultadoGeral: valorJob > 0 ? (resultadoOperacional / valorJob) * 100 : null,
  };
}

/**
 * O fechamento de uma versão de Mídia Off a partir do que está GRAVADO —
 * para quem não monta a planilha (a régua, a aba da versão, a abertura, a
 * visão agregada). Lê só `total_orcado` e `tipo_custo`: o total negociado
 * gravado já é unitário × quantidade × períodos.
 */
export function fechamentoDosItens(
  itens: ReadonlyArray<{ tipo_custo: string; total_orcado: number | string | null }>,
  p: ParametrosMidia,
): FechamentoMidia {
  let negociado = 0;
  let negociadoRepasse = 0;
  for (const it of itens) {
    const n = Number(it.total_orcado ?? 0);
    negociado += n;
    if (it.tipo_custo === "AR") negociadoRepasse += n;
  }
  const c = contaDoNegociado(negociado, p);
  const geral: ContaDaLinha = { ...CONTA_ZERO, ...c };
  return fechamentoDe(geral, contaDoNegociado(negociadoRepasse, p).notaVeiculo, p, []);
}

// ---- Calendário -----------------------------------------------------------

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const INICIAIS = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Os dias que o mês TEM (setembro com 30, fevereiro com 28 ou 29), com a
 *  inicial do dia da semana. `mes` em `YYYY-MM` ou `YYYY-MM-DD`. */
export function diasDoMes(
  mes: string,
): Array<{ dia: number; inicial: string; fimDeSemana: boolean }> {
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => {
    const dow = new Date(Date.UTC(a, m - 1, i + 1)).getUTCDay();
    return { dia: i + 1, inicial: INICIAIS[dow], fimDeSemana: dow === 0 || dow === 6 };
  });
}

/** "Setembro de 2026", ou "set/26" no curto. */
export function nomeDoMesMidia(mes: string, curto = false): string {
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  const n = NOMES_MES[m - 1];
  if (curto) return `${n.slice(0, 3)}/${String(a).slice(2)}`;
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} de ${a}`;
}

/** Primeiro e último dia do mês. */
export function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const m7 = mes.slice(0, 7);
  const [a, mm] = m7.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, mm, 0)).getUTCDate();
  return { inicio: `${m7}-01`, fim: `${m7}-${String(ultimo).padStart(2, "0")}` };
}

// ---- O job da Mídia Off (decisão 167) ------------------------------------

/**
 * O que a California desembolsa num job de Mídia Off: a nota dos veículos
 * em A · Repasse (no A · Direto o veículo cobra direto do cliente). É o
 * "custo previsto" da abertura no financeiro — no nacional, o planejado dos
 * tipos com PP; aqui o planejado da linha é o negociado, e o veículo só
 * recebe a parte dele.
 */
export function desembolsoDaMidia(
  itens: ReadonlyArray<{ tipo_custo: string; total_orcado: number | string | null }>,
  p: ParametrosMidia,
): number {
  const negociadoRepasse = itens
    .filter((i) => i.tipo_custo === "AR")
    .reduce((s, i) => s + Number(i.total_orcado ?? 0), 0);
  return Math.round(contaDoNegociado(negociadoRepasse, p).notaVeiculo * 100) / 100;
}

/** A nota do veículo de uma linha: o custo PLANEJADO dela na mídia. */
export function notaDoVeiculo(negociado: number | string | null, p: ParametrosMidia): number {
  return Math.round(contaDoNegociado(Number(negociado ?? 0), p).notaVeiculo * 100) / 100;
}

/**
 * O planejado da linha do JOB de Mídia Off (decisão 167, entrega 3): a nota
 * do veículo, decomposta como a PP a lê — unitário × quantidade × períodos.
 * É contra ele que a PP do repasse se mede: o "Planejado do item" do painel
 * e do formulário, o aviso de PP acima do planejado e a trava do A · Repasse
 * (`alvoDoRepasse`). A parte do veículo vai no unitário; quantidade e
 * períodos ficam os do orçado, e o total (coluna gerada no banco) fecha com
 * a nota. Seis casas no unitário: 80% de R$ 1.234,56 é R$ 987,648, e o
 * ponto flutuante não pode virar centavo a mais na quantidade.
 */
export function planejadoDaLinhaMidia(
  l: {
    valor_unitario_orcado: number | string | null;
    quantidade_orcada: number | string | null;
    dias_meses_orcado: number | string | null;
  },
  p: ParametrosMidia,
): { valor_unitario_planejado: number; quantidade_planejada: number; dias_meses_planejado: number } {
  const unitario = (Number(l.valor_unitario_orcado ?? 0) * p.veiculo) / 100;
  return {
    valor_unitario_planejado: Math.round(unitario * 1e6) / 1e6,
    quantidade_planejada: Number(l.quantidade_orcada ?? 0),
    dias_meses_planejado: Number(l.dias_meses_orcado ?? 0),
  };
}

/**
 * Quanto as PPs de uma linha A · Repasse precisam somar antes de o item
 * fechar (decisão 062): o orçado no nacional, a nota do veículo na Mídia
 * Off (decisão 167, entrega 3) — o veículo recebe a nota, e o resto do
 * negociado são os honorários e o que fica com o cliente. A nota sai dos
 * parâmetros de HOJE do job (o financeiro pode mudar a parte do veículo,
 * decisão 224), e não do planejado gravado na abertura.
 */
export function alvoDoRepasse(
  totalOrcado: number | string | null,
  midia: ParametrosMidia | null,
): number {
  return midia ? notaDoVeiculo(totalOrcado, midia) : Number(totalOrcado ?? 0);
}

// ---- Entrega 4 (decisão 274): os veículos de cada mês ----------------------

/**
 * Em que pé está a PP do repasse de uma linha A · Repasse. A NF do veículo
 * no A · Repasse chega anexada à PP, e o mês só vai ao faturamento com ela
 * enviada ao financeiro (protótipo aprovado, 23/11/2026):
 * - `a_gerar`: nenhuma PP ativa;
 * - `a_enviar`: alguma PP ainda gerada, ou rejeitada e por reemitir;
 * - `por_fechar`: todas enviadas, mas a linha não disse que acabou (a nota
 *   pode ter mais PPs);
 * - `enviada` / `paga`: pronta.
 */
export type SituacaoDoRepasse = "a_gerar" | "a_enviar" | "por_fechar" | "enviada" | "paga";

export function situacaoDoRepasse(
  pps: ReadonlyArray<{ status: string }>,
  concluida: boolean,
): SituacaoDoRepasse {
  const ativas = pps.filter((p) => p.status !== "cancelada");
  if (ativas.length === 0) return "a_gerar";
  if (ativas.some((p) => p.status === "gerada" || p.status === "rejeitada")) return "a_enviar";
  if (!concluida) return "por_fechar";
  return ativas.every((p) => p.status === "pago") ? "paga" : "enviada";
}

const ORDEM_DO_REPASSE: SituacaoDoRepasse[] = ["a_gerar", "a_enviar", "por_fechar", "enviada", "paga"];

/** A situação que mais falta entre as linhas A · Repasse do veículo no mês;
 *  `null` sem linha A · Repasse. */
export function piorRepasse(lista: ReadonlyArray<SituacaoDoRepasse>): SituacaoDoRepasse | null {
  if (lista.length === 0) return null;
  return lista.reduce((pior, s) => (ORDEM_DO_REPASSE.indexOf(s) < ORDEM_DO_REPASSE.indexOf(pior) ? s : pior));
}

/**
 * O que falta, documento a documento, para o veículo liberar o envio do mês
 * ao faturamento (decisão 274): AP e PI sempre; a NF do veículo no
 * A · Direto; no A · Repasse, a PP do repasse enviada (a NF vem nela).
 * Veículo sem veiculação no mês (nota zero) não pede nada.
 */
export function faltaDoVeiculoNoMes(v: {
  nota: number;
  temDireto: boolean;
  repasse: SituacaoDoRepasse | null;
  temAP: boolean;
  temPI: boolean;
  temNF: boolean;
  /** Decisão 275: o AP ou o PI que existe foi anexado ANTES da extensão do
   *  veículo no mês, e não a cobre (Tiago, 23/11/2026). */
  apAntesDaExtensao?: boolean;
  piAntesDaExtensao?: boolean;
}): string[] {
  if (!(v.nota > 0.004)) return [];
  const falta: string[] = [];
  if (!v.temAP) falta.push(v.apAntesDaExtensao ? "AP da extensão" : "AP");
  if (!v.temPI) falta.push(v.piAntesDaExtensao ? "PI da extensão" : "PI");
  if (v.temDireto && !v.temNF) falta.push("NF");
  if (v.repasse === "a_gerar") falta.push("PP do repasse");
  else if (v.repasse === "a_enviar") falta.push("envio da PP do repasse");
  else if (v.repasse === "por_fechar") falta.push("última PP do repasse");
  return falta;
}

/** Uma linha do job, como o veículo do mês a lê. */
export interface LinhaDoVeiculoNoMes {
  id: string;
  fornecedorId: string | null;
  tipo: string;
  negociado: number;
  meio: string | null;
  /** Só no A · Repasse. */
  repasse: SituacaoDoRepasse | null;
  /** Decisão 275: quando a linha nasceu de uma extensão; `null` fora dela. */
  extensaoEm?: string | null;
}

/** Os documentos de UM veículo no mês. */
export interface DocumentosDoVeiculo<D> {
  ap: D | null;
  pi: D | null;
  nf: D | null;
}

export interface VeiculoNoMes<D> extends DocumentosDoVeiculo<D> {
  veiculoId: string;
  /** `YYYY-MM-01`. */
  mes: string;
  meios: string[];
  tipos: Array<"A" | "AR">;
  /** As linhas do veículo no mês, na ordem da planilha. A primeira é a
   *  âncora do BV do veículo no mês (o BV mora numa linha do job). */
  linhaIds: string[];
  negociado: number;
  nota: number;
  /** A nota só das linhas A · Direto: é contra ela que a NF do veículo se
   *  confere (a do A · Repasse vem na PP). */
  notaDireto: number;
  repasse: SituacaoDoRepasse | null;
  /** Decisão 275: a extensão mais nova do veículo no mês — AP e PI de
   *  antes dela não a cobrem. `null` sem extensão. */
  extensaoEm: string | null;
  /** O AP / o PI anexado existe mas é de antes da extensão. */
  apAntesDaExtensao: boolean;
  piAntesDaExtensao: boolean;
  falta: string[];
}

/**
 * Os veículos de um mês do job de Mídia Off (decisão 274): as linhas do mês
 * agrupadas pelo veículo, com os documentos dele e o que falta para o envio.
 * Linha sem veículo fica de fora — não há a quem pedir documento.
 */
export function veiculosNoMes<D extends { fornecedorId: string; mes: string; tipo: string; criadoEm?: string }>(
  mes: string,
  linhas: ReadonlyArray<LinhaDoVeiculoNoMes>,
  documentos: ReadonlyArray<D>,
  p: ParametrosMidia,
): Array<VeiculoNoMes<D>> {
  const m10 = mes.slice(0, 10);
  const porVeiculo = new Map<string, LinhaDoVeiculoNoMes[]>();
  for (const l of linhas) {
    if (!l.fornecedorId) continue;
    porVeiculo.set(l.fornecedorId, [...(porVeiculo.get(l.fornecedorId) ?? []), l]);
  }
  return [...porVeiculo.entries()].map(([veiculoId, ls]) => {
    const doc = (tipo: string) =>
      documentos.find((d) => d.fornecedorId === veiculoId && d.mes.slice(0, 10) === m10 && d.tipo === tipo) ?? null;
    const tipos = [...new Set(ls.map((l) => (l.tipo === "AR" ? "AR" : "A") as "A" | "AR"))];
    const negociado = Math.round(ls.reduce((s, l) => s + l.negociado, 0) * 100) / 100;
    const nota = Math.round(ls.reduce((s, l) => s + notaDoVeiculo(l.negociado, p), 0) * 100) / 100;
    const notaDireto =
      Math.round(
        ls.filter((l) => l.tipo !== "AR").reduce((s, l) => s + notaDoVeiculo(l.negociado, p), 0) * 100,
      ) / 100;
    const repasse = piorRepasse(ls.filter((l) => l.tipo === "AR").map((l) => l.repasse ?? "a_gerar"));
    const ap = doc("ap");
    const pi = doc("pi");
    const nf = doc("nf");
    const extensaoEm =
      ls.map((l) => l.extensaoEm ?? null).filter((x): x is string => !!x).sort().pop() ?? null;
    // O documento anexado antes da extensão não a cobre (decisão 275).
    const vale = (d: D | null) => d !== null && (!extensaoEm || !d.criadoEm || d.criadoEm >= extensaoEm);
    return {
      veiculoId,
      mes: m10,
      meios: [...new Set(ls.map((l) => l.meio ?? "").filter(Boolean))],
      tipos,
      linhaIds: ls.map((l) => l.id),
      negociado,
      nota,
      notaDireto,
      repasse,
      ap,
      pi,
      nf,
      extensaoEm,
      apAntesDaExtensao: ap !== null && !vale(ap),
      piAntesDaExtensao: pi !== null && !vale(pi),
      falta: faltaDoVeiculoNoMes({
        nota,
        temDireto: tipos.includes("A"),
        repasse,
        temAP: vale(ap),
        temPI: vale(pi),
        temNF: nf !== null,
        apAntesDaExtensao: ap !== null && !vale(ap),
        piAntesDaExtensao: pi !== null && !vale(pi),
      }),
    };
  });
}

/** "AP, PI e NF" — a lista do que falta, em português. */
export function listaDoQueFalta(xs: ReadonlyArray<string>): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
}

/**
 * Como a PP nova do repasse já vem preenchida (decisão 167, entrega 3):
 * o valor que falta para a nota do veículo, decomposto na quantidade e nos
 * períodos da linha quando o unitário fecha no centavo; senão, numa
 * parcela só (1 × 1), para a soma nunca ficar meio centavo abaixo da nota.
 */
export function decomposicaoDoRepasse(
  valor: number,
  quantidade: number,
  periodos: number,
): { unitario: number; quantidade: number; dm: number } {
  const q = quantidade > 0 ? quantidade : 1;
  const d = periodos > 0 ? periodos : 1;
  const unitario = Math.round((valor / (q * d)) * 100) / 100;
  if (Math.abs(unitario * q * d - valor) < 0.005) return { unitario, quantidade: q, dm: d };
  return { unitario: Math.round(valor * 100) / 100, quantidade: 1, dm: 1 };
}

/**
 * A última veiculação da campanha inteira: a maior entre os meses. O job de
 * Mídia Off não encerra antes do dia seguinte a ela (decisão 167, entrega
 * 3). `null` sem data nenhuma.
 */
export function ultimaVeiculacaoDaCampanha(porMes: ReadonlyArray<string | null>): string | null {
  let ultima: string | null = null;
  for (const d of porMes) if (d && (ultima === null || d > ultima)) ultima = d;
  return ultima;
}

/**
 * O custo REALIZADO de uma linha do job de Mídia Off (Tiago, 13/10/2026):
 * no A · Direto, a nota do veículo — o mesmo critério do A nacional, que
 * espelha o planejado; no A · Repasse, as PPs do repasse (entrega 3).
 * Zero antes da abertura no financeiro, como no nacional.
 */
export function realizadoDaLinhaMidia(
  tipo: string,
  negociado: number | string | null,
  somaDasPPs: number,
  p: ParametrosMidia,
  jobAberto: boolean,
): number {
  if (!jobAberto) return 0;
  return tipo === "AR" ? somaDasPPs : notaDoVeiculo(negociado, p);
}

/**
 * Os campos planos do fechamento nacional (`VersaoTotais`) trocados pelos da
 * conta da mídia. Quem grava e mostra os números do job — os espelhos de
 * `jobs`, o cabeçalho, a barra de faturamento — lê só estes campos; a quebra
 * por tipo e os lados (`faturamento`, `job`, `cliente`) não valem na mídia e
 * ninguém os lê lá.
 */
export function comAContaDaMidia<
  T extends {
    honorarios: number;
    imposto: number;
    intTaxes: number;
    intTransactionCosts: number;
    deducoesDoResultado: number;
    faturamentoPrevisto: number;
    valorJob: number;
  },
>(totais: T, f: FechamentoMidia): T {
  return {
    ...totais,
    honorarios: f.honorarios,
    imposto: f.imposto,
    intTaxes: 0,
    intTransactionCosts: 0,
    deducoesDoResultado: f.imposto,
    faturamentoPrevisto: f.faturamentoPrevisto,
    valorJob: f.valorJob,
  };
}

// ---- Fim da veiculação (decisão 167) -------------------------------------

/**
 * A última veiculação de um mês do job: o maior dia com inserção das linhas
 * de grade e o maior fim das linhas de período. O fim pode cair no mês
 * seguinte — a linha que cruza o mês entra inteira no mês em que começa
 * (p17) —, e é ele que conta. O faturamento do mês só libera DEPOIS dela
 * (Tiago, 07 e 13/10/2026). `null` sem data nenhuma nas linhas.
 */
export function ultimaVeiculacaoDoMes(
  mes: string,
  linhas: ReadonlyArray<{
    insercoes_por_dia: Record<string, number | string> | null;
    data_fim: string | null;
  }>,
): string | null {
  const m7 = mes.slice(0, 7);
  let ultima: string | null = null;
  for (const l of linhas) {
    for (const [dia, n] of Object.entries(l.insercoes_por_dia ?? {})) {
      if (!(Number(n) > 0)) continue;
      const iso = `${m7}-${String(Number(dia)).padStart(2, "0")}`;
      if (ultima === null || iso > ultima) ultima = iso;
    }
    const fim = l.data_fim ? l.data_fim.slice(0, 10) : null;
    if (fim && (ultima === null || fim > ultima)) ultima = fim;
  }
  return ultima;
}

/** O dia seguinte, `YYYY-MM-DD`: quando o faturamento do mês libera. */
export function diaSeguinte(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** O mês ainda está em veiculação em `hoje` (`YYYY-MM-DD`)? Sem data nas
 *  linhas, vale o último dia do mês. */
export function mesEmVeiculacao(mes: string, ultima: string | null, hoje: string): boolean {
  return hoje <= (ultima ?? limitesDoMes(mes).fim);
}

// ---- Entrega 5 (decisão 275): encerrar antes e estender -----------------

/** Dias corridos entre duas datas `YYYY-MM-DD`, contando os dois extremos. */
export function diasEntre(inicio: string, fim: string): number {
  const a = Date.parse(`${inicio.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${fim.slice(0, 10)}T12:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

/** A linha da cópia do job, como o corte e a extensão a leem. */
export interface LinhaDaVeiculacao {
  valor_unitario_orcado: number | string | null;
  quantidade_orcada: number | string | null;
  dias_meses_orcado: number | string | null;
  total_orcado: number | string | null;
  insercoes_por_dia: Record<string, number | string> | null;
  data_inicio: string | null;
  data_fim: string | null;
}

/** O que a linha grava no corte: os campos que mudam. */
export interface LinhaCortada {
  quantidade_orcada: number;
  dias_meses_orcado: number;
  insercoes_por_dia: Record<string, number> | null;
  data_fim: string | null;
  /** O negociado que fica (unitário × quantidade × períodos). */
  total: number;
  /** Grade: as inserções que não vão ao ar, por dia. */
  diasCortados: Record<string, number> | null;
  /** Período: dias que ficam no ar e dias do período inteiro. */
  dias: number | null;
  diasDoPeriodo: number | null;
}

/**
 * O negociado sugerido de uma linha por período encerrada antes: o
 * proporcional aos dias que ficaram no ar (Tiago, resposta 1c — sugerido e
 * editável). `dias` zero: a linha não chega a ir ao ar.
 */
export function proporcionalDoPeriodo(
  l: Pick<LinhaDaVeiculacao, "data_inicio" | "data_fim" | "total_orcado">,
  ultimoDia: string,
): { valor: number; dias: number; total: number } {
  const total = Number(l.total_orcado ?? 0);
  if (!l.data_inicio || !l.data_fim) return { valor: total, dias: 0, total: 0 };
  const diasTotal = diasEntre(l.data_inicio, l.data_fim);
  if (ultimoDia < l.data_inicio) return { valor: 0, dias: 0, total: diasTotal };
  if (ultimoDia >= l.data_fim) return { valor: total, dias: diasTotal, total: diasTotal };
  const dias = diasEntre(l.data_inicio, ultimoDia);
  return { valor: Math.round(((total * dias) / diasTotal) * 100) / 100, dias, total: diasTotal };
}

/** A linha ainda tem veiculação depois do dia (`YYYY-MM-DD`)? `mes` é o mês
 *  da linha (`YYYY-MM-01`), que dá o dia das inserções da grade. */
export function veiculaDepois(l: LinhaDaVeiculacao, mes: string, dia: string): boolean {
  if (l.insercoes_por_dia) {
    const m7 = mes.slice(0, 7);
    return Object.entries(l.insercoes_por_dia).some(
      ([d, n]) => Number(n) > 0 && `${m7}-${String(Number(d)).padStart(2, "0")}` > dia,
    );
  }
  return !!l.data_fim && l.data_fim > dia;
}

/**
 * Uma linha encerrada no dia (`ultimoDia`, o último no ar). Grade: as
 * inserções depois do dia saem, e o negociado é o unitário × as que ficam.
 * Período: o fim vira o dia, e o negociado é o `valorPeriodo` (o
 * proporcional, se não vier). `null` quando a linha não muda.
 */
export function cortarLinha(
  l: LinhaDaVeiculacao,
  mes: string,
  ultimoDia: string,
  valorPeriodo?: number | null,
): LinhaCortada | null {
  if (!veiculaDepois(l, mes, ultimoDia)) return null;
  const unit = Number(l.valor_unitario_orcado ?? 0);
  if (l.insercoes_por_dia) {
    const m7 = mes.slice(0, 7);
    const ficam: Record<string, number> = {};
    const cortados: Record<string, number> = {};
    for (const [d, n] of Object.entries(l.insercoes_por_dia)) {
      const q = Number(n);
      if (!(q > 0)) continue;
      if (`${m7}-${String(Number(d)).padStart(2, "0")}` <= ultimoDia) ficam[d] = q;
      else cortados[d] = q;
    }
    const qt = Object.values(ficam).reduce((s, n) => s + n, 0);
    const dm = Number(l.dias_meses_orcado ?? 1) || 1;
    return {
      quantidade_orcada: qt,
      dias_meses_orcado: dm,
      insercoes_por_dia: ficam,
      data_fim: l.data_fim,
      total: Math.round(unit * qt * dm * 100) / 100,
      diasCortados: cortados,
      dias: null,
      diasDoPeriodo: null,
    };
  }
  const p = proporcionalDoPeriodo(l, ultimoDia);
  const valor = Math.max(0, Math.round(Number(valorPeriodo ?? p.valor) * 100) / 100);
  const qt = Number(l.quantidade_orcada ?? 1) || 1;
  // O negociado que fica cabe nos períodos: unitário × quantidade × (a
  // fração dos períodos). Dez casas para o total fechar no centavo.
  const dm = unit * qt > 0 ? Math.round((valor / (unit * qt)) * 1e10) / 1e10 : 0;
  return {
    quantidade_orcada: qt,
    dias_meses_orcado: dm,
    insercoes_por_dia: null,
    data_fim: p.dias === 0 ? l.data_inicio : ultimoDia,
    total: valor,
    diasCortados: null,
    dias: p.dias,
    diasDoPeriodo: p.total,
  };
}

/**
 * A linha de uma extensão (Tiago: "extensão em linha nova", sem planejado),
 * no mesmo unitário da linha de origem. Grade: as inserções por dia do mês
 * da extensão. Período: início, fim e o negociado (o da linha por dia ×
 * os dias, sugerido e editável).
 */
export function linhaDaExtensao(
  base: Pick<LinhaDaVeiculacao, "valor_unitario_orcado" | "quantidade_orcada">,
  ext:
    | { forma: "grade"; dias: Record<string, number> }
    | { forma: "periodo"; inicio: string; fim: string; valor: number },
): {
  quantidade_orcada: number;
  dias_meses_orcado: number;
  insercoes_por_dia: Record<string, number> | null;
  data_inicio: string | null;
  data_fim: string | null;
  total: number;
} {
  const unit = Number(base.valor_unitario_orcado ?? 0);
  if (ext.forma === "grade") {
    const dias = Object.fromEntries(Object.entries(ext.dias).filter(([, n]) => Number(n) > 0));
    const qt = Object.values(dias).reduce((s, n) => s + Number(n), 0);
    return {
      quantidade_orcada: qt,
      dias_meses_orcado: 1,
      insercoes_por_dia: dias,
      data_inicio: null,
      data_fim: null,
      total: Math.round(unit * qt * 100) / 100,
    };
  }
  const qt = Number(base.quantidade_orcada ?? 1) || 1;
  const valor = Math.round(ext.valor * 100) / 100;
  return {
    quantidade_orcada: qt,
    dias_meses_orcado: unit * qt > 0 ? Math.round((valor / (unit * qt)) * 1e10) / 1e10 : 0,
    insercoes_por_dia: null,
    data_inicio: ext.inicio,
    data_fim: ext.fim,
    total: valor,
  };
}

/** O que mudou numa linha do job em relação ao planejado inicial — a
 *  planilha lê para marcar a linha (visão única, opção A). */
export interface InfoDoRealizado {
  status: "igual" | "encerrada" | "cancelada" | "extensao";
  /** A pastilha: "Encerrada em 15/12", "Cancelada", "Extensão". */
  rotulo: string | null;
  /** Grade: as inserções planejadas que não foram ao ar, por dia. */
  diasCortados: Record<string, number> | null;
  /** Período: o fim planejado, quando a linha acabou antes. */
  fimPlanejado: string | null;
  /** Período: "15 de 31 dias" no lugar dos períodos. */
  textoPeriodos: string | null;
  /** A conta planejada inicial da linha (negociado e total), para o valor
   *  riscado. `null` na extensão. */
  contaPlanejada: { totalNegociado: number; total: number } | null;
}

const INFO_IGUAL = {
  status: "igual",
  rotulo: null,
  diasCortados: null,
  fimPlanejado: null,
  textoPeriodos: null,
} as const;

/**
 * A comparação de uma linha de hoje com a dela no planejado inicial (a
 * versão aprovada). `inicial` nulo: a linha nasceu de uma extensão.
 * `encerradaEm`: o último dia no ar do encerramento que a alcançou, para
 * o rótulo da linha da grade.
 */
export function infoDoRealizado(
  atual: LinhaDaVeiculacao,
  inicial: LinhaDaVeiculacao | null,
  encerradaEm: string | null,
  p: ParametrosMidia,
): InfoDoRealizado {
  if (!inicial) {
    return {
      ...INFO_IGUAL,
      status: "extensao",
      rotulo: "Extensão",
      textoPeriodos:
        !atual.insercoes_por_dia && atual.data_inicio && atual.data_fim
          ? `${diasEntre(atual.data_inicio, atual.data_fim)} dias`
          : null,
      contaPlanejada: null,
    };
  }
  const plan = contaDoNegociado(Number(inicial.total_orcado ?? 0), p);
  const contaPlanejada = { totalNegociado: plan.totalNegociado, total: plan.total };
  const totalAtual = Number(atual.total_orcado ?? 0);
  const mudouValor = Math.abs(totalAtual - Number(inicial.total_orcado ?? 0)) >= 0.005;
  const mudouFim = !!inicial.data_fim && atual.data_fim !== inicial.data_fim;
  if (!mudouValor && !mudouFim) return { ...INFO_IGUAL, contaPlanejada };

  const cancelada = !(totalAtual > 0.004);
  const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (inicial.insercoes_por_dia) {
    const cortados: Record<string, number> = {};
    for (const [d, n] of Object.entries(inicial.insercoes_por_dia)) {
      const antes = Number(n);
      const agora = Number(atual.insercoes_por_dia?.[d] ?? 0);
      if (antes > agora) cortados[d] = antes - agora;
    }
    return {
      status: cancelada ? "cancelada" : "encerrada",
      rotulo: cancelada ? "Cancelada" : encerradaEm ? `Encerrada em ${dataBr(encerradaEm)}` : "Alterada",
      diasCortados: Object.keys(cortados).length ? cortados : null,
      fimPlanejado: null,
      textoPeriodos: null,
      contaPlanejada,
    };
  }
  const dias =
    atual.data_inicio && atual.data_fim && !cancelada ? diasEntre(atual.data_inicio, atual.data_fim) : 0;
  const total = inicial.data_inicio && inicial.data_fim ? diasEntre(inicial.data_inicio, inicial.data_fim) : 0;
  return {
    status: cancelada ? "cancelada" : "encerrada",
    rotulo: cancelada ? "Cancelada" : atual.data_fim ? `Encerrada em ${dataBr(atual.data_fim)}` : "Alterada",
    diasCortados: null,
    fimPlanejado: mudouFim ? inicial.data_fim : null,
    textoPeriodos: total ? (cancelada ? "Não foi ao ar" : `${dias} de ${total} dias`) : null,
    contaPlanejada,
  };
}

/** O negociado da linha por período, por dia (base da extensão sugerida). */
export function negociadoPorDia(l: Pick<LinhaDaVeiculacao, "data_inicio" | "data_fim" | "total_orcado">): number {
  if (!l.data_inicio || !l.data_fim) return 0;
  return Number(l.total_orcado ?? 0) / diasEntre(l.data_inicio, l.data_fim);
}

// ---- Leitura de números digitados ----------------------------------------

/** "1.234,56" ou "1234,56" → número. Vazio ou inválido → null. */
export function lerNumero(texto: string): number | null {
  const t = texto.replace(/[R$\s%]/g, "").trim();
  if (t === "") return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** "10,4" — percentual curto, sem zeros à toa. */
export function pctCurto(n: number): string {
  return String(Number(n.toFixed(2))).replace(".", ",");
}
