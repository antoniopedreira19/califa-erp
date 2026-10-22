/**
 * O fechamento da conciliação com o banco (task 029, fase 4, decisão 205):
 * o que a tela decide sem o banco — se o botão "Fechar a conciliação até
 * dd/mm" liga e por que não, a mensagem da trava e a linha do histórico.
 *
 * As condições em si (até onde dá para fechar, as linhas pendentes, os
 * lançamentos sem linha e os saldos) vêm do banco, pela mesma função que
 * `fechar_conciliacao` confere (`condicoes_do_fechamento`): o botão e a
 * recusa nunca divergem. Protótipo: `fecharPeriodo`, `reabrirPeriodo`,
 * `bloqueado` e `diaCompleto` em `main.jsx`; `BannerDoFechamento` e
 * `ReabrirDialog` em `banco.jsx`.
 */

import type { CondicoesDoFechamento } from "@/lib/types";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { formatBRL } from "@/lib/format";

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
}

export const SEM_FECHAMENTO: FechamentoDaConta = { ativo: null, ultimo: null, registros: [], condicoes: null };

/**
 * A linha do histórico da faixa (especificação, seção 6.4): "fechada até
 * 19/10 em 21/10/2026 · reaberta em 22/10/2026 por Fulano: “motivo”".
 */
export function linhaDoHistorico(registros: RegistroDoFechamento[]): string {
  const eventos: Array<{ em: string; texto: string }> = [];
  for (const r of registros) {
    eventos.push({ em: r.fechadoEm, texto: `fechada até ${diaMes(r.ate)} em ${formatDiaBr(r.fechadoEm)}` });
    if (r.reabertoEm) {
      eventos.push({
        em: r.reabertoEm,
        texto: `reaberta em ${formatDiaBr(r.reabertoEm)}${r.reabertoPor ? ` por ${r.reabertoPor}` : ""}${r.motivo ? `: “${r.motivo}”` : ""}`,
      });
    }
  }
  return eventos
    .sort((a, b) => a.em.localeCompare(b.em))
    .map((e) => e.texto)
    .join(" · ");
}

/** Quantos eventos o histórico tem (a faixa do fechado só o mostra com mais
 *  de um, como o protótipo). */
export function eventosDoHistorico(registros: RegistroDoFechamento[]): number {
  return registros.reduce((n, r) => n + (r.reabertoEm ? 2 : 1), 0);
}

export interface BotaoDoFechamento {
  /** Até onde o botão fecha; `null` sem extrato importado. */
  ate: string | null;
  /** O fechamento ativo já cobre esse dia: o botão diz "fechada até". */
  jaFechada: boolean;
  /** As três condições valem. */
  podeFechar: boolean;
  /** O que falta, em frases curtas, para a dica do botão. */
  faltas: string[];
}

/**
 * O botão "Fechar a conciliação até dd/mm" (especificação, seção 6.2): liga
 * com nenhuma linha do banco pendente até lá, nenhum lançamento sem linha
 * do banco e o saldo do dia batendo. Com um fechamento ativo, só fecha mais
 * adiante.
 */
export function botaoDoFechamento(
  condicoes: CondicoesDoFechamento | null,
  ativoAte: string | null,
): BotaoDoFechamento {
  const ate = condicoes?.ate ?? null;
  if (!condicoes || !ate) return { ate: null, jaFechada: false, podeFechar: false, faltas: [] };
  const jaFechada = !!ativoAte && ate <= ativoAte;
  const faltas: string[] = [];
  const pendentes = condicoes.linhas_pendentes ?? 0;
  const semLinha = condicoes.sem_linha ?? 0;
  if (pendentes > 0) {
    faltas.push(
      `${pendentes === 1 ? "1 linha do banco" : `${pendentes} linhas do banco`} até ${diaMes(ate)} sem conciliar`,
    );
  }
  if (semLinha > 0) {
    faltas.push(`${semLinha === 1 ? "1 lançamento" : `${semLinha} lançamentos`} sem linha no extrato do banco`);
  }
  if (condicoes.diferenca === null || condicoes.diferenca === undefined) {
    faltas.push("o extrato não informou o saldo do banco");
  } else if (Math.abs(condicoes.diferenca) > 0.004) {
    faltas.push(`o saldo de ${diaMes(ate)} não bate (diferença de ${formatBRL(Math.abs(condicoes.diferenca))})`);
  }
  return { ate, jaFechada, podeFechar: !jaFechada && faltas.length === 0, faltas };
}
