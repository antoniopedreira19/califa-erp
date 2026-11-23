/**
 * A linha da planilha que é de um título do sistema (decisão 262, D2; revisão
 * de 17/11/2026).
 *
 * Na Conciliação automática, a linha da planilha que paga um título que está
 * em aberto no sistema não é oferecida: no lugar dela vem o título. Ligar a
 * linha do banco à linha da planilha fechava a conta e deixava o título em
 * aberto — o pagamento contava duas vezes. O reconhecimento, nesta ordem:
 *
 * 1. Pelo código da PP no texto da planilha. A planilha escreve "PP-00634",
 *    "PP00634", "PP 634", "PP-634": todos viram "PP-00634".
 * 2. Pela chave do custo fixo: o fornecedor e a descrição iguais (decisão 235).
 * 3. Pela PP aberta com o mesmo valor e o mesmo titular (17/11/2026): uma
 *    linha sem código ("Controller", com o nome da titular abreviado) era a
 *    PP-00634, e a linha da planilha foi oferecida e escolhida; a baixa foi
 *    dada à mão depois, contando duas vezes. Vale só quando a planilha não cita
 *    PP nenhuma (a que cita PP já paga é, em geral, pagamento em duplicidade),
 *    com o titular pelo começo do nome (o nome mais curto, de 8 letras ou
 *    mais, é o começo do outro: "Fulana de Tal" casa com "Fulana de Tal dos
 *    Santos", e "Fulana Souza" não casa com "Fulana Lima"), a data prevista da
 *    PP a até 20 dias e uma única PP e uma única linha da planilha no par. Na
 *    dúvida, nada se esconde.
 *
 * E a linha da planilha de PP já paga (revisão de 23/11/2026, `eDePpPaga`):
 * não há título em aberto para ficar no lugar dela, e ela sai da lista antes
 * do motor e da tabela (`banco-dados.ts`).
 */

export interface LinhaDaPlanilha {
  id: string;
  data: string;
  /** Com sinal: a saída é negativa. */
  valor: number;
  descricao: string;
  /** O fornecedor como a planilha escreveu ("Flash App | Tais Andrade"). */
  quem: string | null;
}

export interface TituloEmAberto {
  id: string;
  /** A data prevista do pagamento. */
  data: string;
  /** Com sinal, como a linha da planilha. */
  valor: number;
  descricao: string;
  /** O titular (a contraparte do título). */
  quem: string | null;
  /** A origem do título: "pp", "avulso", "recorrencia"… */
  origem: string;
  /** O código e a parcela ("PP-00634 1/1"). */
  ref: string;
}

/** Até quantos dias da data prevista da PP o pagamento sem código ainda é dela. */
export const DIAS_DA_PP_SEM_CODIGO = 20;

/** Sem acento, caixa e pontuação. */
export const normalizar = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** O primeiro código de PP do texto, no formato do sistema ("PP-00634"); nulo, nenhum. */
export function codigoDePp(texto: string | null | undefined): string | null {
  const m = (texto ?? "").match(/\bPP[\s-]?0*(\d{1,5})\b/i);
  return m ? `PP-${m[1].padStart(5, "0")}` : null;
}

/** Todos os códigos de PP do texto, sem repetir ("PP01028 PP01027 - Reembolso"). */
export function codigosDePp(texto: string | null | undefined): string[] {
  const vistos = new Set<string>();
  for (const m of (texto ?? "").matchAll(/\bPP[\s-]?0*(\d{1,5})\b/gi)) vistos.add(`PP-${m[1].padStart(5, "0")}`);
  return [...vistos];
}

/** O texto da planilha que registra outro movimento da PP, não o pagamento dela. */
const OUTRO_MOVIMENTO = /DUPLIC|DEVOLU|ESTORN|N[AÃ]O\s+EFETUAD/i;

/**
 * A linha da planilha que é o pagamento de PP já paga no sistema (revisão de
 * 23/11/2026). A PP paga sai da lista de títulos em aberto, e a linha da
 * planilha dela voltava a ser oferecida — e proposta pelo motor — para outra
 * linha do banco de mesmo valor: em 17/11, 19 linhas do banco foram ligadas à
 * planilha de PPs que já estavam baixadas e conciliadas noutra linha, e a PP
 * contou duas vezes. Sai da lista a saída cujas PPs citadas estão todas pagas;
 * fica a que a planilha marca como duplicidade, devolução, estorno ou PIX não
 * efetuado (é outro movimento, com linha do banco própria).
 */
export function eDePpPaga(linha: { valor: number; descricao: string | null }, pagas: ReadonlySet<string>): boolean {
  if (linha.valor >= 0 || OUTRO_MOVIMENTO.test(linha.descricao ?? "")) return false;
  const codigos = codigosDePp(linha.descricao);
  return codigos.length > 0 && codigos.every((c) => pagas.has(c));
}

/** O titular da PP e o fornecedor da planilha são a mesma pessoa: em alguma
 *  parte (separada por "|"), o nome mais curto (8 letras ou mais) é o começo do
 *  outro; mais curto que isso, só igual. */
export function nomesBatem(a: string | null | undefined, b: string | null | undefined): boolean {
  const partes = (s: string | null | undefined) =>
    (s ?? "")
      .split("|")
      .map(normalizar)
      .filter((p) => p.length >= 4);
  for (const x of partes(a))
    for (const y of partes(b)) {
      const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
      if (curto.length >= 8 ? longo.startsWith(curto) : curto === longo) return true;
    }
  return false;
}

const centavos = (v: number) => Math.round(v * 100);
const dias = (a: string, b: string) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** De cada linha da planilha que é de um título em aberto: o id do título. */
export function donosDaPlanilha(planilha: LinhaDaPlanilha[], titulos: TituloEmAberto[]): Map<string, string> {
  const dono = new Map<string, string>();
  const semCodigo: LinhaDaPlanilha[] = [];
  for (const x of planilha) {
    const codigo = codigoDePp(x.descricao);
    if (codigo) {
      const t = titulos.find((t) => t.ref.includes(codigo) || t.descricao.includes(codigo));
      if (t) dono.set(x.id, t.id);
      continue;
    }
    const chave = titulos.find(
      (t) => !!normalizar(x.quem) && normalizar(t.quem) === normalizar(x.quem) && normalizar(t.descricao) === normalizar(x.descricao),
    );
    if (chave) dono.set(x.id, chave.id);
    else semCodigo.push(x);
  }
  // 3. A PP aberta pelo valor e pelo titular: só o par único dos dois lados.
  const pps = titulos.filter((t) => t.origem === "pp");
  const casa = (x: LinhaDaPlanilha, t: TituloEmAberto) =>
    centavos(t.valor) === centavos(x.valor) && dias(t.data, x.data) <= DIAS_DA_PP_SEM_CODIGO && nomesBatem(t.quem, x.quem);
  for (const x of semCodigo) {
    const ts = pps.filter((t) => casa(x, t));
    if (ts.length !== 1) continue;
    const outras = semCodigo.filter((y) => casa(y, ts[0]));
    if (outras.length === 1) dono.set(x.id, ts[0].id);
  }
  return dono;
}
