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
