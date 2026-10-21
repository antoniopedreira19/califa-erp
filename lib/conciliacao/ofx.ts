/**
 * A leitura do extrato OFX (decisão 198), portada do protótipo
 * "Conciliação com o banco" (`prototipo/src/ofx.js`, `lerOfx` e `digitais`).
 *
 * - OFX SGML 1.0x (sem tag de fechamento) e XML 2.x: a mesma leitura serve
 *   aos dois, porque cada valor vai até o próximo `<` ou o fim da linha.
 * - O valor com vírgula ("-1920,00", o do Santander) e o com ponto valem. Com
 *   os dois separadores, o último é o decimal ("1.234,56" e "1,234.56").
 * - A data do movimento é o dia (os 8 primeiros dígitos); a hora e o fuso
 *   ficam de fora. Quando o banco gerou o arquivo (DTSERVER) guarda a hora,
 *   com o fuso do arquivo (Brasília quando ele não diz).
 * - A impressão digital reconhece a linha na reimportação: o FITID do
 *   Santander muda a cada download (carrega a hora da exportação). Ela é a
 *   conta, a data, o valor em centavos, o histórico normalizado e a posição
 *   entre os iguais.
 *
 * O arquivo é dado do usuário: lido como texto, nunca executado, e o
 * conteúdo cru não vai para o banco — só as linhas.
 */

export interface MovimentoDoOfx {
  /** A posição no arquivo, a partir de 0. */
  ordem: number;
  /** TRNTYPE: DEBIT, CREDIT, PAYMENT… */
  tipo: string;
  /** AAAA-MM-DD. */
  data: string;
  /** Com sinal: o que sai é negativo. */
  valor: number;
  fitid: string;
  /** CHECKNUM. */
  documento: string;
  /** MEMO (ou NAME), com os espaços juntados. */
  historico: string;
}

export interface ExtratoDoOfx {
  /** ORG ou BANKID. */
  banco: string;
  /** O código do banco (BANKID): "033" no Santander. */
  bancoId: string;
  /** ACCTID: no Santander, agência + conta. */
  conta: string;
  moeda: string;
  inicio: string | null;
  fim: string | null;
  /** O dia em que o banco gerou o arquivo. */
  geradoEm: string | null;
  /** "HH:MM" da geração, quando o arquivo diz. */
  geradoHora: string | null;
  /** O instante da geração, ISO com fuso, para gravar. */
  geradoInstante: string | null;
  /** LEDGERBAL: o saldo que o banco informa. */
  saldoBanco: number | null;
  saldoEm: string | null;
  movimentos: MovimentoDoOfx[];
}

function tag(bloco: string, nome: string): string | null {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\n]*)`, "i"));
  return m ? m[1].trim() : null;
}

export function dataOfx(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function valorOfx(s: string | null): number {
  if (!s) return 0;
  let v = s.trim().replace(/\s/g, "");
  const virgula = v.lastIndexOf(",");
  const ponto = v.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) {
    // O último separador é o decimal.
    v = virgula > ponto ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (virgula >= 0) {
    v = v.replace(",", ".");
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** O instante do DTSERVER ("20261020091923[-3:GMT]"), ISO com fuso. */
function instanteOfx(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?(?:\[([+-]?\d+(?:\.\d+)?)(?::[A-Z]+)?\])?/i);
  if (!m) return null;
  const [, a, mes, d, h = "00", min = "00", seg = "00", fuso] = m;
  // Sem fuso no arquivo, o banco brasileiro fala em Brasília.
  const horas = fuso === undefined ? -3 : Number(fuso);
  const sinal = horas < 0 ? "-" : "+";
  const abs = Math.abs(horas);
  const hh = String(Math.trunc(abs)).padStart(2, "0");
  const mm = String(Math.round((abs % 1) * 60)).padStart(2, "0");
  return `${a}-${mes}-${d}T${h}:${min}:${seg}${sinal}${hh}:${mm}`;
}

export function lerOfx(texto: string): ExtratoDoOfx {
  const t = texto.replace(/\r/g, "");
  const inicioOfx = t.search(/<OFX>/i);
  const corpo = inicioOfx >= 0 ? t.slice(inicioOfx) : t;
  const blocos = corpo
    .split(/<STMTTRN>/i)
    .slice(1)
    .map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const movimentos: MovimentoDoOfx[] = blocos.map((b, i) => ({
    ordem: i,
    tipo: (tag(b, "TRNTYPE") || "").toUpperCase(),
    data: dataOfx(tag(b, "DTPOSTED")) ?? "",
    valor: valorOfx(tag(b, "TRNAMT")),
    fitid: tag(b, "FITID") || "",
    documento: tag(b, "CHECKNUM") || "",
    historico: (tag(b, "MEMO") || tag(b, "NAME") || "").replace(/\s+/g, " ").trim(),
  }));
  const ledger = corpo.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i);
  const dtServer = tag(corpo, "DTSERVER");
  const hora = dtServer?.match(/^\d{8}(\d{2})(\d{2})/);
  return {
    banco: tag(corpo, "ORG") || tag(corpo, "BANKID") || "",
    bancoId: tag(corpo, "BANKID") || "",
    conta: tag(corpo, "ACCTID") || "",
    moeda: tag(corpo, "CURDEF") || "",
    inicio: dataOfx(tag(corpo, "DTSTART")),
    fim: dataOfx(tag(corpo, "DTEND")),
    geradoEm: dataOfx(dtServer),
    geradoHora: hora ? `${hora[1]}:${hora[2]}` : null,
    geradoInstante: instanteOfx(dtServer),
    saldoBanco: ledger ? valorOfx(tag(ledger[1], "BALAMT")) : null,
    saldoEm: ledger ? dataOfx(tag(ledger[1], "DTASOF")) : null,
    movimentos,
  };
}

/** O histórico para comparar: sem acento, em maiúsculas, espaços juntados. */
export function normalizar(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A impressão digital de cada movimento, na ordem do arquivo. */
export function digitais(movimentos: Array<Pick<MovimentoDoOfx, "data" | "valor" | "historico">>, contaId: string): string[] {
  const vistos = new Map<string, number>();
  return movimentos.map((m) => {
    const base = `${contaId}|${m.data}|${Math.round(m.valor * 100)}|${normalizar(m.historico)}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return `${base}|${n}`;
  });
}

/** O arquivo vem em UTF-8 só quando diz; o padrão dos bancos é o 1252. */
export function decodificarOfx(bytes: ArrayBuffer): string {
  const cabeca = new TextDecoder("latin1").decode(bytes.slice(0, 400));
  const utf8 = /ENCODING:\s*UTF-?8|encoding="utf-?8"|CHARSET:\s*(UTF-?8|NONE)/i.test(cabeca);
  return new TextDecoder(utf8 ? "utf-8" : "windows-1252").decode(bytes);
}

/** O banco pelo código (BANKID): o nome para o cabeçalho e as palavras que
 *  o cadastro (texto livre) costuma trazer. */
const BANCOS: Record<string, { nome: string; chaves: string[] }> = {
  "001": { nome: "Banco do Brasil", chaves: ["banco do brasil", "bb"] },
  "033": { nome: "Santander", chaves: ["santander"] },
  "104": { nome: "Caixa", chaves: ["caixa"] },
  "237": { nome: "Bradesco", chaves: ["bradesco"] },
  "341": { nome: "Itaú", chaves: ["itau"] },
  "077": { nome: "Inter", chaves: ["inter"] },
  "260": { nome: "Nubank", chaves: ["nubank"] },
  "208": { nome: "BTG Pactual", chaves: ["btg"] },
  "102": { nome: "XP", chaves: ["xp"] },
  "336": { nome: "C6 Bank", chaves: ["c6"] },
  "212": { nome: "Banco Original", chaves: ["original"] },
  "422": { nome: "Safra", chaves: ["safra"] },
  "748": { nome: "Sicredi", chaves: ["sicredi"] },
  "756": { nome: "Sicoob", chaves: ["sicoob"] },
};

const codigoDoBanco = (bancoId: string) => bancoId.replace(/\D/g, "").padStart(3, "0").slice(-3);

/** O código do banco do arquivo bate com o banco do cadastro? Código que a
 *  tabela não conhece passa: quem decide é a conta (agência e número). */
export function bancoDoArquivoConfere(bancoId: string, bancoDoCadastro: string): boolean {
  const banco = BANCOS[codigoDoBanco(bancoId)];
  if (!banco) return true;
  const cadastro = normalizar(bancoDoCadastro);
  return banco.chaves.some((c) => cadastro.includes(normalizar(c)));
}

/** A conta do cadastro tem agência e número para reconhecer o arquivo? */
export function contaTemNumero(c: { numero_conta: string | null; numero_conta_dv: string | null }): boolean {
  return `${c.numero_conta ?? ""}${c.numero_conta_dv ?? ""}`.replace(/\D/g, "").length >= 4;
}

/**
 * O ACCTID do arquivo é desta conta? A mesma regra da RPC
 * `importar_extrato`: agência + conta (com o dígito) iguais aos dígitos do
 * arquivo — o Santander manda os dois juntos —, ou o arquivo terminando no
 * número da conta com o dígito.
 */
export function arquivoEhDaConta(
  acctid: string,
  c: { agencia: string | null; numero_conta: string | null; numero_conta_dv: string | null },
): boolean {
  const acct = (acctid || "").replace(/\D/g, "");
  const numero = `${c.numero_conta ?? ""}${c.numero_conta_dv ?? ""}`.replace(/\D/g, "");
  if (!acct || numero.length < 4) return false;
  const cadastro = `${(c.agencia ?? "").replace(/\D/g, "")}${numero}`;
  return acct === cadastro || acct.endsWith(numero);
}

/** O banco para o cabeçalho: "033 · Santander". */
export function rotuloDoBanco(bancoId: string): string {
  if (!bancoId) return "—";
  const codigo = codigoDoBanco(bancoId);
  const banco = BANCOS[codigo];
  return banco ? `${codigo} · ${banco.nome}` : bancoId;
}
