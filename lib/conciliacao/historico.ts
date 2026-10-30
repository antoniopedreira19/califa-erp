/**
 * A cauda do histórico na conciliação (decisão 211, A6).
 *
 * Os movimentos de outubro dos jobs até o 3T que não existem no sistema
 * ficam no histórico da planilha (a carga `cauda`), e a linha do banco que os
 * paga ou recebe se concilia "do histórico", sem lançamento. Aqui, o par de
 * cada linha do banco com as linhas da cauda da mesma conta:
 *
 * 1. a linha da cauda de mesmo valor, até `janela` dias (a mais perto);
 * 2. (fora do `soNoDia`) as linhas da cauda do mesmo dia, até 3 dias antes
 *    ou depois, e do **mesmo favorecido**, que somam a linha do banco: as do
 *    mesmo job, todas as do favorecido no dia, ou duas a três delas. A
 *    planilha às vezes divide um pagamento do banco entre jobs. Um PIX ou TED
 *    paga um favorecido só: somar favorecidos diferentes casava por
 *    coincidência de valor (30/10/2026, 29 ligações desfeitas), e a linha da
 *    cauda sem favorecido só casa sozinha, pelo valor.
 *
 * O imposto retido na fonte (a descrição diz "retido na fonte") não é pago pela
 * agência: a planilha lança a nota cheia e, no mesmo dia, uma linha por
 * imposto retido, com o cliente como favorecido. Ele nunca casa com uma saída
 * nem sozinho; só entra no recebimento do mesmo cliente, junto da nota: a
 * nota mais as retenções dela dão o líquido que o banco recebeu.
 *
 * Função pura: recebe as linhas do banco ainda sem solução e as linhas da
 * cauda ainda sem linha do banco, e devolve o par de cada linha resolvida.
 */
import { diasEntre, somaDias } from "./motor";

/** Uma linha da cauda do histórico, ainda sem linha do banco. */
export interface HistoricoDoMotor {
  id: string;
  data: string;
  /** Com sinal: o que entra é positivo, como a linha do banco. */
  valor: number;
  job: string | null;
  descricao: string | null;
  /** O fornecedor ou o cliente da planilha: a soma só junta linhas do mesmo. */
  fornecedor: string | null;
}

/** O imposto retido na fonte pelo cliente (IR, CSLL, PIS, COFINS, ISS): a
 *  planilha escreve "Imposto retido na fonte …" ou "ISS retido na fonte". O
 *  "ISS retido" da folha de PJ e da PP é pagamento de verdade e não entra. */
export function ehRetencao(h: Pick<HistoricoDoMotor, "descricao">): boolean {
  return /\bRETIDOS? NA FONTE\b/.test(
    (h.descricao ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase(),
  );
}

/** O favorecido normalizado (sem acento, maiúsculas, só letras e números);
 *  `null` quando a planilha não diz. */
export function favorecidoDe(h: Pick<HistoricoDoMotor, "fornecedor">): string | null {
  const n = (h.fornecedor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return n || null;
}

type Movimento = { id?: string; data: string; valor: number };

const cents = (v: number) => Math.round(v * 100);

/** Até quantas linhas da cauda do dia a soma de duas ou três procura. */
const MAX_CANDIDATAS = 30;

export function casarComHistorico<M extends Movimento>(
  movimentos: M[],
  historico: HistoricoDoMotor[],
  opcoes: { soNoDia?: boolean } = {},
): Map<M, HistoricoDoMotor[]> {
  const livres = new Set(historico);
  const pares = new Map<M, HistoricoDoMotor[]>();
  const ordenados = [...movimentos].sort((a, b) => a.data.localeCompare(b.data));
  const janela = opcoes.soNoDia ? 0 : 5;

  // 1. Uma linha da cauda de mesmo valor, a mais perto.
  for (const m of ordenados) {
    let melhor: HistoricoDoMotor | null = null;
    for (const h of livres) {
      if (ehRetencao(h) || cents(h.valor) !== cents(m.valor)) continue;
      const d = Math.abs(diasEntre(m.data, h.data));
      if (d > janela) continue;
      if (!melhor || d < Math.abs(diasEntre(m.data, melhor.data))) melhor = h;
    }
    if (melhor) {
      livres.delete(melhor);
      pares.set(m, [melhor]);
    }
  }
  if (opcoes.soNoDia) return pares;

  // 2. Várias linhas da cauda do mesmo dia e do mesmo favorecido que somam a
  //    linha do banco.
  for (const m of ordenados) {
    if (pares.has(m)) continue;
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const dia = somaDias(m.data, d);
      const porFavorecido = new Map<string, HistoricoDoMotor[]>();
      const retencoes = new Map<string, HistoricoDoMotor[]>();
      for (const h of livres) {
        if (h.data !== dia) continue;
        const f = favorecidoDe(h);
        if (!f) continue;
        if (ehRetencao(h)) {
          if (m.valor > 0 && h.valor < 0) retencoes.set(f, [...(retencoes.get(f) ?? []), h]);
          continue;
        }
        if (Math.sign(h.valor) !== Math.sign(m.valor)) continue;
        porFavorecido.set(f, [...(porFavorecido.get(f) ?? []), h]);
      }
      let achou: HistoricoDoMotor[] | null = null;
      for (const [f, doFavorecido] of porFavorecido) {
        const rets = retencoes.get(f) ?? [];
        if (rets.length) achou = notaComRetencoes(doFavorecido, rets, m.valor);
        if (!achou && doFavorecido.length >= 2) achou = somaQueBate(doFavorecido, m.valor);
        if (achou) break;
      }
      if (achou) {
        for (const h of achou) livres.delete(h);
        pares.set(m, achou);
        break;
      }
    }
  }
  return pares;
}

/** Até quantas retenções a nota leva (IR, CSLL, PIS, COFINS e ISS, com folga). */
const MAX_RETENCOES = 6;

/** O recebimento: uma nota do cliente mais as retenções dele no dia que
 *  somam o líquido do banco, centavo a centavo. */
function notaComRetencoes(notas: HistoricoDoMotor[], retencoes: HistoricoDoMotor[], valor: number): HistoricoDoMotor[] | null {
  const alvo = cents(valor);
  const rets = retencoes.slice(0, MAX_CANDIDATAS);
  for (const nota of notas) {
    const falta = alvo - cents(nota.valor);
    if (falta >= 0) continue;
    const escolhidas: HistoricoDoMotor[] = [];
    const busca = (i: number, resto: number): boolean => {
      if (resto === 0 && escolhidas.length > 0) return true;
      if (escolhidas.length >= MAX_RETENCOES || i >= rets.length) return false;
      for (let j = i; j < rets.length; j++) {
        const v = cents(rets[j].valor);
        if (v < resto) continue;
        escolhidas.push(rets[j]);
        if (busca(j + 1, resto - v)) return true;
        escolhidas.pop();
      }
      return false;
    };
    if (busca(0, falta)) return [nota, ...escolhidas];
  }
  return null;
}

/** Entre as linhas de um favorecido no dia: as do mesmo job, todas, ou duas a
 *  três delas, que somam o valor. */
function somaQueBate(doDia: HistoricoDoMotor[], valor: number): HistoricoDoMotor[] | null {
  const alvo = cents(valor);
  const soma = (hs: HistoricoDoMotor[]) => hs.reduce((s, h) => s + cents(h.valor), 0);
  const porJob = new Map<string, HistoricoDoMotor[]>();
  for (const h of doDia) {
    if (!h.job) continue;
    porJob.set(h.job, [...(porJob.get(h.job) ?? []), h]);
  }
  for (const g of porJob.values()) if (g.length >= 2 && soma(g) === alvo) return g;
  if (soma(doDia) === alvo) return doDia;
  const c = doDia.slice(0, MAX_CANDIDATAS);
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const ij = cents(c[i].valor) + cents(c[j].valor);
      if (ij === alvo) return [c[i], c[j]];
      for (let k = j + 1; k < c.length; k++) {
        if (ij + cents(c[k].valor) === alvo) return [c[i], c[j], c[k]];
      }
    }
  }
  return null;
}
