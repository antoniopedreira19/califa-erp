/**
 * As contas da conciliação dia a dia (decisão 254), sem tela e sem banco:
 * a ordem do extrato, o saldo do banco depois de cada linha, os dias da
 * conta e os meses (decisão 262) com o que falta em cada um.
 */

import { formatBRL } from "@/lib/format";
import type { SaldoDoDiaEmAberto } from "@/lib/types";
import { fimDoMesDe, nomeDoMes } from "./fechamento";

/** A ordem do extrato: o dia e, dentro dele, a ordem em que o banco mandou. */
export const naOrdemDoExtrato = (
  a: { data: string; ordem: number; id: string },
  b: { data: string; ordem: number; id: string },
) => a.data.localeCompare(b.data) || a.ordem - b.ordem || a.id.localeCompare(b.id);

/** O saldo do banco no fim de um dia, como o servidor o confere no fechamento. */
export interface SaldoBase {
  ate: string;
  saldo: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O saldo do banco depois de cada linha. Parte do saldo do fim do dia `ate`
 * (o da última linha até esse dia) e anda linha a linha: para trás,
 * descontando o que veio depois; para a frente, somando. As ignoradas
 * contam, porque também mexeram no saldo do banco.
 *
 * Vale para as linhas que a tela tem: todas as dos dias em aberto. Com um
 * buraco entre uma linha e o dia `ate` (linha que a tela não leu), o saldo
 * dela sairia errado; por isso a leitura da aba traz os dias abertos inteiros.
 */
export function saldosDoExtrato(
  linhas: Array<{ id: string; data: string; ordem: number; valor: number }>,
  base: SaldoBase | null,
): Map<string, number> {
  const saldos = new Map<string, number>();
  if (!base) return saldos;
  const ord = [...linhas].sort(naOrdemDoExtrato);
  let ultimaAteABase = -1;
  ord.forEach((l, i) => {
    if (l.data <= base.ate) ultimaAteABase = i;
  });
  let s = base.saldo;
  for (let j = ultimaAteABase; j >= 0; j--) {
    saldos.set(ord[j].id, r2(s));
    s -= ord[j].valor;
  }
  s = base.saldo;
  for (let j = ultimaAteABase + 1; j < ord.length; j++) {
    s += ord[j].valor;
    saldos.set(ord[j].id, r2(s));
  }
  return saldos;
}

/** Um dia da conta na barra de dias. */
export interface DiaDaConta {
  data: string;
  /** As linhas do banco do dia. */
  linhas: number;
  /** O que ainda pede ação: linha do banco sem conciliar e baixa sem linha. */
  pendentes: number;
  /** `andamento`: o extrato foi gerado no próprio dia e ainda pode crescer. */
  estado: "fechado" | "pronto" | "pendente" | "andamento";
}

/**
 * Os dias da conta, do mais antigo ao mais novo. Cada entrada é uma linha do
 * banco (resolvida ou não) ou uma baixa do sistema sem linha no banco.
 */
export function diasDaConta(
  entradas: Array<{ data: string; linha: boolean; pendente: boolean }>,
  fechadaAte: string | null,
  /** O último dia completo do extrato (o que o fechamento aceita); nulo, sem extrato completo. */
  completoAte: string | null,
): DiaDaConta[] {
  const por = new Map<string, { linhas: number; pendentes: number }>();
  for (const e of entradas) {
    const d = por.get(e.data) ?? { linhas: 0, pendentes: 0 };
    if (e.linha) d.linhas++;
    if (e.pendente) d.pendentes++;
    por.set(e.data, d);
  }
  return [...por.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, d]) => ({
      data,
      linhas: d.linhas,
      pendentes: d.pendentes,
      estado:
        fechadaAte && data <= fechadaAte ? "fechado" : !completoAte || data > completoAte ? "andamento" : d.pendentes === 0 ? "pronto" : "pendente",
    }));
}

/** O saldo de um dia pela conta do fechamento (`saldos_dos_dias_em_aberto`). */
export type SaldoDoDia = SaldoDoDiaEmAberto;

/**
 * O que o servidor recusaria no saldo do dia, dito antes do clique: o extrato
 * sem saldo ou o saldo do banco diferente do sistema. Nulo, o saldo bate (ou
 * o servidor não informou o dia, e é ele quem decide no clique).
 */
export function avisoDoSaldo(saldos: SaldoDoDia[], data: string): string | null {
  const s = saldos.find((x) => x.data === data);
  if (!s) return null;
  if (s.saldo_banco === null || s.diferenca === null) return "O extrato importado não informa o saldo do banco: importe um arquivo com o saldo para fechar.";
  if (Math.abs(s.diferenca) < 0.005) return null;
  return `O saldo de ${data.slice(8, 10)}/${data.slice(5, 7)} não bate: banco ${formatBRL(s.saldo_banco)}, sistema ${formatBRL(s.saldo_sistema)} (diferença de ${formatBRL(Math.abs(s.diferenca))}).`;
}

/** Um mês com dia em aberto, na linha dos meses (decisão 262): o que falta para fechar. */
export interface MesDaConta {
  /** "2026-10". */
  mes: string;
  /** O último dia do mês: o "Fechar outubro" fecha até ele. */
  fim: string;
  dias: DiaDaConta[];
  /** O que falta para o mês fechar; vazio, pode fechar. */
  faltas: string[];
}

/**
 * Os meses com dia em aberto, em ordem, com o que falta em cada um (decisão
 * 262): as mesmas condições do fechamento, olhadas no último dia do mês. Os
 * meses fecham em ordem; o saldo vem por último, depois das pendências.
 */
export function mesesDaConta(dias: DiaDaConta[], saldos: SaldoDoDia[], completoAte: string | null): MesDaConta[] {
  const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const por = new Map<string, DiaDaConta[]>();
  for (const d of dias) if (d.estado !== "fechado") por.set(d.data.slice(0, 7), [...(por.get(d.data.slice(0, 7)) ?? []), d]);
  const meses: MesDaConta[] = [];
  for (const [mes, ds] of [...por.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fim = fimDoMesDe(ds[0].data);
    const faltas: string[] = [];
    const anterior = meses[meses.length - 1];
    if (anterior) faltas.push(`Feche ${nomeDoMes(anterior.fim)} antes: os meses fecham em ordem.`);
    const comPendencia = ds.filter((d) => d.pendentes > 0);
    const itens = comPendencia.reduce((t, d) => t + d.pendentes, 0);
    if (comPendencia.length)
      faltas.push(
        `${itens === 1 ? "Falta 1 item" : `Faltam ${itens} itens`} em ${comPendencia.length === 1 ? "1 dia" : `${comPendencia.length} dias`} (${comPendencia
          .slice(0, 6)
          .map((d) => ddmm(d.data))
          .join(", ")}${comPendencia.length > 6 ? "…" : ""}).`,
      );
    if (!completoAte || completoAte < fim)
      faltas.push(
        completoAte
          ? `O extrato importado vai até ${ddmm(completoAte)}: o mês fecha quando o extrato chegar a ${ddmm(fim)}.`
          : "Importe o extrato do banco do mês inteiro.",
      );
    if (!faltas.length) {
      const saldo = avisoDoSaldo(saldos, ds[ds.length - 1].data);
      if (saldo) faltas.push(saldo);
    }
    meses.push({ mes, fim, dias: ds, faltas });
  }
  return meses;
}
