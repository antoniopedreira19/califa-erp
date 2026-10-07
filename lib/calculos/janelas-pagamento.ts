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
 * A data-limite de ENVIO da PP (decisão 157, no fim deste arquivo) já
 * trata feriado: os nacionais do cadastro de feriados do Fiscal, que quem
 * chama passa. A janela em si continua como está.
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

// ---------------------------------------------------------------------------
// Data-limite de envio da PP (decisão 157)
// ---------------------------------------------------------------------------

/** O financeiro recebe a PP até 15 dias corridos antes da janela. */
export const DIAS_DE_ANTECEDENCIA_DO_ENVIO = 15;

/**
 * A regra entrou em 08/10/2026. A PP gerada antes dela segue enviável com
 * o vencimento que tem, como a PP anterior às janelas na decisão 077
 * (pergunta 6a): eram 16 PPs geradas e não enviadas, 9 já fora do prazo.
 */
export const INICIO_DO_PRAZO_DE_ENVIO = "2026-10-08";

/** Sábado, domingo ou feriado nacional do cadastro de feriados. */
function ehDiaUtil(ms: number, feriados: ReadonlySet<string>): boolean {
  const diaSemana = new Date(ms).getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  return !feriados.has(utcParaIso(ms));
}

function conjuntoDeFeriados(feriados: Iterable<string>): ReadonlySet<string> {
  return feriados instanceof Set ? feriados : new Set(Array.from(feriados, (f) => f.slice(0, 10)));
}

/**
 * Até quando a PP com este vencimento pode ser enviada ao financeiro
 * (decisão 157, calendário do financeiro de 07/10/2026).
 *
 * A conta parte do dia 08 ou 20 do CALENDÁRIO, não do dia em que o
 * pagamento cai: a janela de 08/11/2026 paga na segunda 09/11, e o limite
 * é 08/11 − 15 = 24/10. Caindo em sábado, domingo ou feriado nacional,
 * volta dia a dia até o dia útil anterior — 24/10/2026 é sábado, então o
 * limite é sexta, 23/10. Null = a data não é janela (PP anterior à regra
 * das janelas): não há prazo de envio a calcular.
 */
export function dataLimiteDeEnvio(
  vencimentoIso: string,
  feriados: Iterable<string> = [],
): string | null {
  const janela = qualJanela(vencimentoIso);
  if (janela === null) return null;
  const ms = isoParaUtc(vencimentoIso);
  if (ms === null) return null;
  const d = new Date(ms);
  const nominal = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), janela);
  const uteis = conjuntoDeFeriados(feriados);
  let limite = nominal - DIAS_DE_ANTECEDENCIA_DO_ENVIO * DIA_MS;
  while (!ehDiaUtil(limite, uteis)) limite -= DIA_MS;
  return utcParaIso(limite);
}

/** Hoje ainda dá para enviar uma PP com este vencimento? */
export function vencimentoAceitaEnvio(
  vencimentoIso: string,
  hojeIso: string,
  feriados: Iterable<string> = [],
): boolean {
  const limite = dataLimiteDeEnvio(vencimentoIso, feriados);
  return limite !== null && hojeIso.slice(0, 10) <= limite;
}

/**
 * As `quantas` primeiras janelas que ainda aceitam envio hoje — o prazo
 * sugerido do formulário é a primeira, e o atalho "Atualizar vencimento"
 * oferece todas. A data-limite anda junto com a janela (a janela seguinte
 * tem sempre limite depois), então a primeira aberta separa as fechadas
 * das abertas.
 */
export function janelasComEnvioAberto(
  hojeIso: string,
  feriados: Iterable<string> = [],
  quantas = 1,
): string[] {
  const uteis = conjuntoDeFeriados(feriados);
  const abertas: string[] = [];
  let janela = proximaJanelaDePagamento(hojeIso);
  // Duas janelas por mês: 6 voltas já passam do mês e meio de antecedência.
  for (let volta = 0; abertas.length < quantas && volta < 6 + quantas; volta++) {
    if (vencimentoAceitaEnvio(janela, hojeIso, uteis)) abertas.push(janela);
    janela = janelaSeguinte(janela);
  }
  return abertas;
}

/** A primeira janela que ainda aceita envio hoje. */
export function primeiraJanelaComEnvioAberto(
  hojeIso: string,
  feriados: Iterable<string> = [],
): string {
  return janelasComEnvioAberto(hojeIso, feriados, 1)[0] ?? janelaSeguinte(hojeIso);
}

/**
 * A PP gerada precisa respeitar o prazo de envio? A gerada antes de
 * 08/10/2026 não (ver `INICIO_DO_PRAZO_DE_ENVIO`). `geradaEm` é o
 * `created_at` da PP, um instante — o dia dele é o de São Paulo.
 */
export function ppSegueOPrazoDeEnvio(geradaEm: string | null | undefined): boolean {
  if (!geradaEm) return true;
  const ms = Date.parse(geradaEm);
  if (Number.isNaN(ms)) return true;
  const dia = new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return dia >= INICIO_DO_PRAZO_DE_ENVIO;
}

/** dd/mm/aaaa, para as mensagens. */
export function isoParaBr(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}

/** Hoje, em ISO, no fuso da casa. Servidor na Vercel roda em UTC: sem o
 *  fuso, depois das 21h o "hoje" já seria amanhã. */
export function hojeEmSaoPauloIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
