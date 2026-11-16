/**
 * O fechamento da conciliação com o banco (task 029, fase 4, decisão 205;
 * por mês desde a decisão 262): o que a tela decide sem o banco — os meses
 * fechados e abertos, o que continua fechado ao reabrir um mês, a mensagem
 * da trava e o texto de cada registro do histórico.
 *
 * As condições em si (até onde dá para fechar, as linhas pendentes, os
 * lançamentos sem linha e os saldos) vêm do banco, pela mesma função que
 * `fechar_conciliacao` confere (`condicoes_do_fechamento`): o botão e a
 * recusa nunca divergem. Protótipo: `fecharPeriodo`, `reabrirPeriodo`,
 * `bloqueado` e `diaCompleto` em `main.jsx`; `BannerDoFechamento` e
 * `ReabrirDialog` em `banco.jsx`.
 */

import type { CondicoesDoFechamento, SaldoDoDiaEmAberto } from "@/lib/types";
import { formatDiaBr } from "@/lib/formatar-data-hora";

/** "19/10": o dia e o mês de uma data ISO. */
export function diaMes(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** A mensagem da trava (especificação, seção 6.3), igual à do banco. */
export function mensagemDoPeriodoFechado(ate: string): string {
  return `Período fechado até ${diaMes(ate)}: reabra a conciliação para mudar esse lançamento.`;
}

/** A data cai no período fechado da conta? */
export function noPeriodoFechado(data: string | null | undefined, fechadoAte: string | null | undefined): boolean {
  return !!data && !!fechadoAte && data.slice(0, 10) <= fechadoAte;
}

/** Um registro do fechamento, como a tela o lê (com os nomes). */
export interface RegistroDoFechamento {
  id: string;
  ate: string;
  fechadoEm: string;
  fechadoPor: string;
  reabertoEm: string | null;
  reabertoPor: string | null;
  motivo: string | null;
  ativo: boolean;
  /** Decisão 262: o registro nasceu do "Reabrir" do mês seguinte (o mês
   *  dele continuou fechado), e não de alguém fechando o mês. */
  daReabertura: boolean;
}

/** O fechamento de uma conta: o que vale agora, o último registro (para a
 *  faixa do reaberto) e as condições (só na Conciliação automática). */
export interface FechamentoDaConta {
  /** O fechamento ativo; `null` com a conta aberta. */
  ativo: RegistroDoFechamento | null;
  /** O registro mais novo, ativo ou não: a faixa do "Período reaberto". */
  ultimo: RegistroDoFechamento | null;
  /** Do mais antigo para o mais novo. */
  registros: RegistroDoFechamento[];
  condicoes: CondicoesDoFechamento | null;
  /** O saldo de cada dia em aberto com linha do banco (decisão 254); vazio
   *  fora da Conciliação automática. */
  saldosDosDias: SaldoDoDiaEmAberto[];
}

export const SEM_FECHAMENTO: FechamentoDaConta = { ativo: null, ultimo: null, registros: [], condicoes: null, saldosDosDias: [] };

// ---------------------------------------------------------------------------
// O fechamento por mês (decisão 262)
// ---------------------------------------------------------------------------

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "outubro": o nome do mês de uma data ISO. */
export const nomeDoMes = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1];
export const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** O último dia do mês da data. */
export const fimDoMesDe = (iso: string) =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10);
/** O último dia do mês anterior ao da data. */
export const fimDoMesAnterior = (iso: string) =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
/** O último dia do mês seguinte ao da data. */
export const fimDoMesSeguinte = (iso: string) =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) + 1, 0)).toISOString().slice(0, 10);
/** O fechamento vai até o fim de um mês (os de antes da decisão 262 podem ir até um dia qualquer). */
export const ehFimDoMes = (iso: string | null | undefined) => !!iso && fimDoMesDe(iso) === iso.slice(0, 10);

/** "Outubro fechado"; o fechamento de antes do fechamento por mês, "Fechado até 19/10". */
export function textoDoFechado(ate: string): string {
  return ehFimDoMes(ate) ? `${maiuscula(nomeDoMes(ate))} fechado` : `Fechado até ${diaMes(ate)}`;
}

/**
 * Um registro do histórico, em palavras de mês: "Outubro fechado em
 * 05/11/2026 por Fulano · reaberto em 16/11/2026 por Beltrano: “motivo”".
 * O registro que nasceu do "Reabrir" do mês seguinte diz que o mês continuou fechado.
 */
export function textoDoRegistro(r: RegistroDoFechamento): string {
  const reaberto = r.reabertoEm
    ? ` · reaberto em ${formatDiaBr(r.reabertoEm)}${r.reabertoPor ? ` por ${r.reabertoPor}` : ""}${r.motivo ? `: “${r.motivo.replace(/[.\s]+$/, "")}”` : ""}`
    : "";
  if (r.daReabertura) {
    const qual = ehFimDoMes(r.ate) ? maiuscula(nomeDoMes(r.ate)) : `Até ${dataBR(r.ate)}`;
    return `${qual} continuou fechado ao reabrir ${nomeDoMes(fimDoMesSeguinte(r.ate))} em ${formatDiaBr(r.fechadoEm)}${reaberto}`;
  }
  const qual = ehFimDoMes(r.ate) ? `${maiuscula(nomeDoMes(r.ate))} fechado` : `Fechado até ${dataBR(r.ate)}`;
  return `${qual} em ${formatDiaBr(r.fechadoEm)} por ${r.fechadoPor}${reaberto}`;
}

/** Quem fechou o mês pela primeira vez (o registro do "Reabrir" do mês seguinte não conta). */
export function quemFechouOMes(registros: RegistroDoFechamento[], fim: string): RegistroDoFechamento | null {
  return registros.find((r) => !r.daReabertura && r.ate === fim) ?? null;
}

/** O registro mais novo de um mês que foi reaberto; nulo, o mês nunca foi reaberto. */
export function reaberturaDoMes(registros: RegistroDoFechamento[], fim: string): RegistroDoFechamento | null {
  return registros.filter((r) => r.reabertoEm && fimDoMesDe(r.ate) === fim).pop() ?? null;
}

/**
 * O que continua fechado ao reabrir o mês do fechamento ativo (a mesma
 * regra de `reabrir_mes_da_conciliacao`): o fim do mês anterior, se ele já
 * tinha sido fechado alguma vez; nulo, a conta fica toda aberta.
 */
export function continuaFechadoAoReabrir(f: Pick<FechamentoDaConta, "ativo" | "registros">): string | null {
  const ativo = f.ativo;
  if (!ativo) return null;
  const antes = fimDoMesAnterior(ativo.ate);
  return f.registros.some((r) => r.id !== ativo.id && r.ate <= antes) ? antes : null;
}

export interface MesesDoFechamento {
  /** Os meses fechados que aparecem (os 3 últimos, do mais antigo ao mais novo), pelo fim de cada um. */
  fechados: string[];
  /** Há mês fechado antes dos que aparecem. */
  maisAntigos: boolean;
  /** O fechamento ativo de antes do fechamento por mês, até um dia no meio do mês; nulo, não há. */
  parcialAte: string | null;
  /** Os meses abertos depois do fechado, até o mês de hoje (no máximo 12). */
  abertos: string[];
}

/**
 * Os meses da faixa do fechamento: os fechados (os 3 últimos) e, depois do
 * último fechado, cada mês aberto até o de hoje. Sem nenhum fechamento, nada.
 */
export function mesesDoFechamento(f: Pick<FechamentoDaConta, "ativo" | "ultimo" | "registros">, hoje: string): MesesDoFechamento {
  const vazio: MesesDoFechamento = { fechados: [], maisAntigos: false, parcialAte: null, abertos: [] };
  if (!f.ultimo) return vazio;
  const ativo = f.ativo;
  // O último mês inteiro fechado; sem fechamento ativo, o mês antes do último registro.
  const base = ativo ? (ehFimDoMes(ativo.ate) ? ativo.ate : fimDoMesAnterior(ativo.ate)) : fimDoMesAnterior(f.ultimo.ate);
  const primeiro = fimDoMesDe([...f.registros].map((r) => r.ate).sort()[0] ?? base);
  const fechados: string[] = [];
  if (ativo) for (let m = base; m >= primeiro && fechados.length < 4; m = fimDoMesAnterior(m)) fechados.unshift(m);
  const maisAntigos = fechados.length > 3;
  if (maisAntigos) fechados.shift();
  const abertos: string[] = [];
  const fimDeHoje = fimDoMesDe(hoje);
  for (let m = fimDoMesSeguinte(base); m <= fimDeHoje && abertos.length < 12; m = fimDoMesSeguinte(m)) abertos.push(m);
  return { fechados, maisAntigos, parcialAte: ativo && !ehFimDoMes(ativo.ate) ? ativo.ate : null, abertos };
}
