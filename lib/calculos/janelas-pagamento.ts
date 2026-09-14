/**
 * Janelas de pagamento da California — a regra num lugar só (decisão 077).
 *
 * A casa paga em duas janelas por mês: dia 08 e dia 20. Caindo em sábado
 * ou domingo, vale a segunda-feira seguinte. A regra nasceu no cronograma
 * de desembolso da abertura de job (decisão 004, `curva.ts`); em 14/09/2026
 * o prazo da PP passou a obedecer às mesmas janelas, e ela saiu de lá para
 * cá — duas cópias divergiriam na primeira correção.
 *
 * ⚠️ Feriado NÃO é tratado, de propósito (decisão 077, pergunta 1): não
 * existe calendário de feriados no sistema. Duas janelas próximas já caem
 * em feriado — 20/11/2026 (Consciência Negra, nacional) e 08/12/2026
 * (Conceição da Praia, municipal em Salvador) — e hoje o sistema as aceita
 * como dia de pagamento. Quando o calendário existir, o ajuste entra em
 * `ajustarParaDiaUtil` e vale para a abertura e para a PP de uma vez.
 *
 * Datas são ISO `YYYY-MM-DD` tratadas em UTC: é dia de calendário, não
 * instante, e fuso nenhum pode empurrar um 08 para 07.
 */

const DIA_MS = 86_400_000;

export function isoParaUtc(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  const ms = Date.UTC(ano, mes - 1, dia);
  return Number.isNaN(ms) ? null : ms;
}

export function utcParaIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Sábado/domingo (em UTC) empurram para a segunda-feira seguinte. */
function ajustarParaDiaUtil(ms: number): number {
  const diaSemana = new Date(ms).getUTCDay();
  if (diaSemana === 6) return ms + 2 * DIA_MS; // sábado -> segunda
  if (diaSemana === 0) return ms + DIA_MS; // domingo -> segunda
  return ms;
}

/** A janela (dia 08 ou 20 ajustado) de um mês, em ms UTC. Mês fora de
 *  0–11 é normalizado pelo `Date.UTC` — mês 12 é janeiro do ano seguinte. */
function janelaDoMes(ano: number, mesZeroBased: number, dia: 8 | 20): number {
  return ajustarParaDiaUtil(Date.UTC(ano, mesZeroBased, dia));
}

/** Primeira janela de pagamento cuja data é >= a data dada. */
export function proximaJanelaDePagamento(aPartirDeIso: string): string {
  const base = isoParaUtc(aPartirDeIso);
  const baseMs = base ?? Date.UTC(1970, 0, 1);
  const d = new Date(baseMs);
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth();
  // As duas janelas deste mês e as duas do seguinte cobrem qualquer ponto
  // de partida — inclusive um dia 21+ ou um dia 08 que caiu em fim de
  // semana e escorregou.
  const candidatas = [
    janelaDoMes(ano, mes, 8),
    janelaDoMes(ano, mes, 20),
    janelaDoMes(ano, mes + 1, 8),
    janelaDoMes(ano, mes + 1, 20),
  ];
  const alvo = candidatas.find((ms) => ms >= baseMs) ?? candidatas[3];
  return utcParaIso(alvo);
}

/** A janela seguinte à data dada (estritamente depois dela). */
export function janelaSeguinte(depoisDeIso: string): string {
  const ms = isoParaUtc(depoisDeIso);
  if (ms === null) return proximaJanelaDePagamento(depoisDeIso);
  return proximaJanelaDePagamento(utcParaIso(ms + DIA_MS));
}

/** A data é uma janela de pagamento válida (08/20, ajustada)? */
export function ehJanelaDePagamento(iso: string): boolean {
  if (!iso || iso.length < 10) return false;
  return proximaJanelaDePagamento(iso) === iso.slice(0, 10);
}

/**
 * Qual das duas janelas a data é. O 08 escorrega no máximo até o dia 10
 * (sábado → segunda) e o 20 até o 22, então o dia do mês basta para
 * separar. Null = a data não é janela.
 */
export function qualJanela(iso: string): 8 | 20 | null {
  if (!ehJanelaDePagamento(iso)) return null;
  return Number(iso.slice(8, 10)) <= 10 ? 8 : 20;
}

/**
 * A mesma janela, `meses` depois: parcela em 08/10 tem a seguinte na
 * janela do 08 de novembro — que, caindo num domingo, vira 09/11.
 *
 * Data fora das janelas (PP gerada antes da regra, decisão 077 pergunta 6)
 * não tem "mesma janela": vale a primeira janela a partir do mesmo dia,
 * `meses` depois.
 */
export function mesmaJanelaMesesDepois(iso: string, meses: number): string {
  const ms = isoParaUtc(iso);
  if (ms === null) return iso.slice(0, 10);
  const d = new Date(ms);
  const janela = qualJanela(iso);
  if (janela !== null) {
    return utcParaIso(janelaDoMes(d.getUTCFullYear(), d.getUTCMonth() + meses, janela));
  }
  // Dia que não existe no mês de destino (31 → fevereiro) é normalizado
  // pelo `Date.UTC`, e a janela seguinte corrige o resto.
  return proximaJanelaDePagamento(
    utcParaIso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, d.getUTCDate())),
  );
}

/**
 * Vencimentos de uma PP em `n` parcelas: a 1ª é a data dada, e cada
 * seguinte é a mesma janela no mês seguinte (decisão 077).
 *
 * Calculados a partir da 1ª, e não em cadeia: um 20 que escorregou para
 * 21 não pode arrastar a parcela seguinte para uma "janela do 21".
 */
export function vencimentosNasJanelas(primeiraIso: string, n: number): string[] {
  const total = Math.max(1, Math.floor(n));
  return Array.from({ length: total }, (_, i) =>
    i === 0 ? primeiraIso.slice(0, 10) : mesmaJanelaMesesDepois(primeiraIso, i),
  );
}

/** Hoje, em ISO, no fuso da casa. Servidor na Vercel roda em UTC: sem o
 *  fuso, depois das 21h o "hoje" já seria amanhã. */
export function hojeEmSaoPauloIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
