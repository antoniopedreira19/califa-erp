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
 *    ou depois, que somam a linha do banco: as do mesmo job, todas as do
 *    dia, ou duas a três delas. A planilha às vezes divide um pagamento do
 *    banco entre jobs, ou junta numa linha o que o banco recebe em várias.
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
      if (cents(h.valor) !== cents(m.valor)) continue;
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

  // 2. Várias linhas da cauda do mesmo dia que somam a linha do banco.
  for (const m of ordenados) {
    if (pares.has(m)) continue;
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const dia = somaDias(m.data, d);
      const doDia = [...livres].filter((h) => h.data === dia && Math.sign(h.valor) === Math.sign(m.valor));
      if (doDia.length < 2) continue;
      const achou = somaQueBate(doDia, m.valor);
      if (achou) {
        for (const h of achou) livres.delete(h);
        pares.set(m, achou);
        break;
      }
    }
  }
  return pares;
}

/** As do mesmo job, todas do dia, ou duas a três delas, que somam o valor. */
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
