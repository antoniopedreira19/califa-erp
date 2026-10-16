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
 * Desde a decisão 172 (14/10/2026) a PP urgente também pode cair numa
 * QUARTA DE EXCEÇÕES, escolhida até a sexta anterior; e a parcela seguinte
 * pula a janela que vem logo depois da anterior, podendo ser adiada à mão.
 * Desde 16/10/2026 (revisão da 172) a verba também cai na quarta, urgente
 * ou não. As regras estão no fim deste arquivo.
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
  // Decisão 172: a quarta de exceções tem a sua data-limite, a sexta
  // anterior. A quarta só chega gravada numa PP urgente ou de verba — as
  // portas de gravação recusam a quarta nas outras —, então aqui basta a data.
  if (janela === null) return dataLimiteDaQuarta(vencimentoIso, feriados);
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

// ---------------------------------------------------------------------------
// Quarta de exceções e datas das parcelas (decisão 172)
// ---------------------------------------------------------------------------

/** A data é uma quarta-feira? */
export function ehQuarta(iso: string): boolean {
  const ms = isoParaUtc(iso);
  return ms !== null && new Date(ms).getUTCDay() === 3;
}

/**
 * Até quando a PP com vencimento numa quarta de exceções é escolhida e
 * chega ao financeiro: a sexta anterior (5 dias antes). Caindo em feriado
 * nacional, volta ao dia útil anterior — a quarta 25/11/2026 tem limite na
 * quinta 19/11, porque 20/11 é a Consciência Negra. Null = não é quarta, ou
 * a quarta é feriado nacional (21/04/2027): não há pagamento nela.
 */
export function dataLimiteDaQuarta(
  quartaIso: string,
  feriados: Iterable<string> = [],
): string | null {
  if (!ehQuarta(quartaIso)) return null;
  const uteis = conjuntoDeFeriados(feriados);
  if (uteis.has(quartaIso.slice(0, 10))) return null;
  let limite = isoParaUtc(quartaIso)! - 5 * DIA_MS;
  while (!ehDiaUtil(limite, uteis)) limite -= DIA_MS;
  return utcParaIso(limite);
}

/**
 * A PP pode cair numa quarta de exceções? A urgente (decisão 172) e, desde
 * 16/10/2026, toda verba, urgente ou não: o cartão Flash da produção é pago
 * às quartas, e as verbas vinham marcadas urgentes só para chegar à data
 * (11 das 14 verbas entre 14 e 16/10).
 */
export function ppAceitaQuarta(pp: { urgente: boolean; verba: boolean }): boolean {
  return pp.urgente || pp.verba;
}

/** Hoje a quarta ainda aceita PP (urgente ou de verba)? */
export function quartaDeExcecoesAberta(
  iso: string,
  hojeIso: string,
  feriados: Iterable<string> = [],
): boolean {
  const limite = dataLimiteDaQuarta(iso, feriados);
  return limite !== null && hojeIso.slice(0, 10) <= limite;
}

/**
 * O que a data pode ser como prazo (1º vencimento) da PP hoje: janela com
 * envio aberto, quarta de exceções (só na PP que aceita a quarta — a
 * urgente e a verba, ver `ppAceitaQuarta`) ou nada. A quarta que também é
 * janela (o 08 ou o 20 numa quarta) segue só a regra da janela — senão a
 * data teria duas datas-limite de envio.
 */
export function tipoDoPrazo(
  iso: string,
  hojeIso: string,
  feriados: Iterable<string>,
  quartaLiberada: boolean,
): "janela" | "quarta" | null {
  if (!iso || iso.slice(0, 10) < hojeIso.slice(0, 10)) return null;
  const uteis = conjuntoDeFeriados(feriados);
  if (ehJanelaDePagamento(iso) && vencimentoAceitaEnvio(iso, hojeIso, uteis)) return "janela";
  if (quartaLiberada && !ehJanelaDePagamento(iso) && quartaDeExcecoesAberta(iso, hojeIso, uteis)) return "quarta";
  return null;
}

/**
 * A primeira data que o prazo da PP pode ter hoje: a primeira janela com
 * envio aberto ou, na PP que aceita a quarta, a quarta de exceções, se
 * vier antes.
 */
export function primeiraDataPossivelDoPrazo(
  hojeIso: string,
  feriados: Iterable<string>,
  quartaLiberada: boolean,
): string {
  const uteis = conjuntoDeFeriados(feriados);
  const janela = primeiraJanelaComEnvioAberto(hojeIso, uteis);
  if (!quartaLiberada) return janela;
  let ms = isoParaUtc(hojeIso)!;
  const ate = isoParaUtc(janela)!;
  for (; ms < ate; ms += DIA_MS) {
    const iso = utcParaIso(ms);
    if (tipoDoPrazo(iso, hojeIso, uteis, true) === "quarta") return iso;
  }
  return janela;
}

/**
 * A primeira data possível da parcela seguinte: pula a janela que vem logo
 * depois da anterior. Parcela em 09/11 → 08/12 (pulou 20/11); quarta 21/10
 * → 20/11 (pulou 09/11); quarta 04/11 → 20/11 (pulou 09/11). Para quem está
 * numa janela, é a mesma janela no mês seguinte, como antes da 172.
 */
export function primeiraDataDaProximaParcela(anteriorIso: string): string {
  // Sem a anterior (prazo ainda vazio) não há o que calcular.
  if (isoParaUtc(anteriorIso) === null) return "";
  return janelaSeguinte(janelaSeguinte(anteriorIso));
}

export interface DataDaParcela {
  data: string;
  /** A data foi adiada à mão (depois da primeira data possível). */
  ajustada: boolean;
}

/**
 * Refaz as datas das parcelas a partir do prazo: a 1ª é o prazo; cada
 * seguinte é a primeira data possível depois da anterior — menos a adiada à
 * mão, que fica enquanto continuar possível (janela e depois da primeira
 * data possível). A adiada que ficou cedo demais, porque a anterior andou,
 * vai para a primeira data possível e volta a ser padrão. Sem prazo (o campo
 * limpo, ou a urgência recém-ligada), as datas padrão ficam vazias e a
 * adiada fica, até o prazo voltar.
 */
export function acomodarDatasDasParcelas(
  prazoIso: string,
  parcelas: ReadonlyArray<DataDaParcela>,
): DataDaParcela[] {
  let anterior = prazoIso.slice(0, 10);
  return parcelas.map((p, i) => {
    if (i === 0) return { data: anterior, ajustada: false };
    const minima = primeiraDataDaProximaParcela(anterior);
    const data = p.data.slice(0, 10);
    const fica = p.ajustada && ehJanelaDePagamento(data) && data > minima;
    const final = fica ? data : minima;
    anterior = final;
    return { data: final, ajustada: fica };
  });
}

/**
 * As datas da 2ª parcela em diante estão certas? Cada uma é janela e não
 * vem antes da primeira data possível depois da anterior. Devolve o número
 * da primeira parcela errada (2, 3…) ou null. É a trava do servidor: a tela
 * já só oferece datas assim.
 */
export function parcelaForaDaRegra(datas: ReadonlyArray<string>): number | null {
  for (let i = 1; i < datas.length; i++) {
    const data = datas[i].slice(0, 10);
    if (!ehJanelaDePagamento(data) || data < primeiraDataDaProximaParcela(datas[i - 1])) return i + 1;
  }
  return null;
}
