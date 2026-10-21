/**
 * A fatura em que um pagamento no cartão entra, e as faturas que a baixa
 * pode escolher (decisão 197). Espelha o banco:
 *
 * - a competência é a do FECHAMENTO: o dia do fechamento no mês (o último
 *   dia, se o mês for curto), como `garantir_fatura_aberta_do_cartao`;
 * - pagamento depois do dia do fechamento cai na competência seguinte;
 * - competência já fechada, paga ou cancelada empurra para a próxima;
 * - o vencimento cai no mês seguinte ao fechamento quando o dia dele é menor
 *   ou igual ao do fechamento, como `proxima_fatura_cartao`.
 *
 * A baixa manda ao banco só a competência (`p_fatura_competencia`, o dia 1
 * do mês): ele usa a fatura aberta dela, cria a que ainda não existe e
 * recusa a fechada (`_fatura_da_competencia`). Protótipo: `faturaDestino` e
 * `opcoesDeFatura` em `logica.js`.
 */

export interface CartaoDaFatura {
  id: string;
  dia_vencimento_fatura: number;
  /** Nulo nos cartões antigos: o fechamento cai no dia do vencimento. */
  dia_fechamento_fatura: number | null;
}

export type StatusDaFatura = "aberta" | "fechada" | "paga" | "cancelada";

export interface FaturaDoCartaoNaBaixa {
  id: string;
  codigo: string;
  cartaoId: string;
  /** O dia do fechamento (`competencia_fechamento`), AAAA-MM-DD. */
  competenciaFechamento: string;
  dataVencimento: string;
  status: StatusDaFatura;
}

export interface OpcaoDeFatura {
  /** A competência, AAAA-MM: é o valor do campo e o que vai ao banco. */
  competencia: string;
  fecha: string;
  vence: string;
  /** A fatura que já existe; nula na "Nova fatura". */
  existente: FaturaDoCartaoNaBaixa | null;
  /** A da data do pagamento (o padrão do campo). */
  padrao: boolean;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const iso = (a: number, m: number, d: number) =>
  `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function somaMes(a: number, m: number, n: number): [number, number] {
  const t = a * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** "out/26". */
export function rotuloDaCompetencia(competencia: string): string {
  const [a, m] = competencia.split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
}

/** O dia 1 da competência, como o banco recebe (`p_fatura_competencia`). */
export function competenciaParaOBanco(competencia: string): string {
  return `${competencia.slice(0, 7)}-01`;
}

/** O fechamento e o vencimento de uma competência do cartão. */
export function datasDaCompetencia(
  cartao: CartaoDaFatura,
  a: number,
  m: number,
): { competencia: string; fecha: string; vence: string } {
  const diaFecha = cartao.dia_fechamento_fatura ?? cartao.dia_vencimento_fatura;
  const fecha = iso(a, m, Math.min(diaFecha, ultimoDia(a, m)));
  // Sem dia de fechamento, o banco vence no próprio mês
  // (`proxima_fatura_cartao`, ramo sem fechamento).
  const [av, mv] =
    cartao.dia_fechamento_fatura !== null && cartao.dia_vencimento_fatura <= cartao.dia_fechamento_fatura
      ? somaMes(a, m, 1)
      : [a, m];
  const vence = iso(av, mv, Math.min(cartao.dia_vencimento_fatura, ultimoDia(av, mv)));
  return { competencia: iso(a, m, 1).slice(0, 7), fecha, vence };
}

const competenciaDe = (f: FaturaDoCartaoNaBaixa) => f.competenciaFechamento.slice(0, 7);

/** A fatura em que o pagamento cai pela data, pulando a competência que já fechou. */
export function faturaDestino(
  cartao: CartaoDaFatura,
  data: string,
  faturas: FaturaDoCartaoNaBaixa[],
): OpcaoDeFatura | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  let [a, m] = data.split("-").map(Number) as [number, number];
  const dia = Number(data.slice(8, 10));
  const diaFecha = cartao.dia_fechamento_fatura ?? cartao.dia_vencimento_fatura;
  if (dia > diaFecha) [a, m] = somaMes(a, m, 1);
  for (let i = 0; i < 24; i++) {
    const datas = datasDaCompetencia(cartao, a, m);
    const existente =
      faturas.find((f) => f.cartaoId === cartao.id && competenciaDe(f) === datas.competencia) ?? null;
    if (!existente || existente.status === "aberta") {
      return {
        ...datas,
        fecha: existente?.competenciaFechamento ?? datas.fecha,
        vence: existente?.dataVencimento ?? datas.vence,
        existente,
        padrao: true,
      };
    }
    [a, m] = somaMes(a, m, 1);
  }
  return null;
}

/**
 * As faturas que a baixa no cartão pode escolher: as abertas do cartão, a
 * da data do pagamento se ainda não existir, e a competência seguinte à
 * última, para a compra que o banco lançou na próxima. Fechada e paga não
 * recebem item. `padrao` marca a da data do pagamento.
 */
export function opcoesDeFatura(
  cartao: CartaoDaFatura,
  faturas: FaturaDoCartaoNaBaixa[],
  destino: OpcaoDeFatura | null,
): OpcaoDeFatura[] {
  const doCartao = faturas.filter((f) => f.cartaoId === cartao.id);
  const ops: Omit<OpcaoDeFatura, "padrao">[] = doCartao
    .filter((f) => f.status === "aberta")
    .map((f) => ({
      competencia: competenciaDe(f),
      fecha: f.competenciaFechamento,
      vence: f.dataVencimento,
      existente: f,
    }));
  if (destino && !destino.existente && !ops.some((o) => o.competencia === destino.competencia)) {
    ops.push({ competencia: destino.competencia, fecha: destino.fecha, vence: destino.vence, existente: null });
  }
  ops.sort((x, y) => x.competencia.localeCompare(y.competencia));
  const ultima = ops[ops.length - 1]?.competencia ?? destino?.competencia;
  if (ultima) {
    const [a, m] = somaMes(Number(ultima.slice(0, 4)), Number(ultima.slice(5, 7)), 1);
    const prox = datasDaCompetencia(cartao, a, m);
    if (!doCartao.some((f) => competenciaDe(f) === prox.competencia)) {
      ops.push({ ...prox, existente: null });
    }
  }
  return ops.map((o) => ({ ...o, padrao: o.competencia === destino?.competencia }));
}
