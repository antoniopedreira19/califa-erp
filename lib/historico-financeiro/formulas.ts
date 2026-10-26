/**
 * O pedaço de fórmula do Google Sheets que a validação (E3) do histórico
 * financeiro refaz — decisão 211.
 *
 * As DREs da planilha são somas e subtrações de SUMIFS sobre as abas das
 * contas ("SUMIFS('Conta California BB'!$C:$C,'Conta California BB'!$J:$J,C612)
 * - SUMIFS(…$B:$B…)"). As abas Gerencial fazem o mesmo por regional e, no
 * rateio, multiplicam a soma dos lançamentos "TD" pelo percentual da regional,
 * que mora numa célula da própria aba ("-(SUMIFS(…,\"TD\"))*E133"). A
 * validação refaz cada uma sobre os dados da extração (E1) e sobre os
 * padronizados (E2). Fórmula com qualquer outra coisa (SUM, outra função,
 * célula somada como valor) volta `null` e conta como "não verificável".
 *
 * O critério segue o Google Sheets: texto sem diferença de maiúscula, com os
 * curingas * e ?; número; e comparação (">=01/01/2023"), com data no formato
 * do Brasil. Espaço sobrando conta: "CO 1T 2026 " não é "CO 1T 2026".
 */
import { indiceDaColuna } from "./csv";

export type Intervalo = { aba: string | null; coluna: number; linhaDe: number | null; linhaAte: number | null };
export type Criterio = { tipo: "celula"; ref: string } | { tipo: "texto"; valor: string } | { tipo: "numero"; valor: number };
export type No =
  | { tipo: "numero"; valor: number }
  | { tipo: "celula"; ref: string }
  | { tipo: "soma"; partes: { sinal: 1 | -1; no: No }[] }
  | { tipo: "produto"; partes: { divide: boolean; no: No }[] }
  | { tipo: "somase"; soma: Intervalo; criterios: { intervalo: Intervalo; criterio: Criterio }[] };

type Token =
  | { t: "numero"; v: number }
  | { t: "texto"; v: string }
  | { t: "ref"; aba: string | null; de: string; ate: string | null }
  | { t: "funcao"; v: string }
  | { t: "simbolo"; v: string };

const REF = /^(\$?[A-Za-z]{1,3}\$?\d*)(?::(\$?[A-Za-z]{1,3}\$?\d*))?/;

function tokens(formula: string): Token[] | null {
  const f = formula.trim().replace(/^=/, "");
  const saida: Token[] = [];
  let i = 0;
  const lerRef = (aba: string | null) => {
    const m = REF.exec(f.slice(i));
    if (!m) return false;
    saida.push({ t: "ref", aba, de: m[1], ate: m[2] ?? null });
    i += m[0].length;
    return true;
  };
  const lerEntreAspas = (aspa: string) => {
    let texto = "";
    i++;
    while (i < f.length) {
      if (f[i] === aspa) {
        if (f[i + 1] === aspa) {
          texto += aspa;
          i += 2;
          continue;
        }
        i++;
        return texto;
      }
      texto += f[i++];
    }
    return null;
  };
  while (i < f.length) {
    const ch = f[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"') {
      const texto = lerEntreAspas('"');
      if (texto === null) return null;
      saida.push({ t: "texto", v: texto });
    } else if (ch === "'") {
      const aba = lerEntreAspas("'");
      if (aba === null || f[i] !== "!") return null;
      i++;
      if (!lerRef(aba)) return null;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+([eE][-+]?\d+)?/.exec(f.slice(i));
      if (!m) return null;
      saida.push({ t: "numero", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_$]/.test(ch)) {
      const palavra = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(f.slice(i))![0];
      const depois = f[i + palavra.length];
      if (depois === "(") {
        saida.push({ t: "funcao", v: palavra.toUpperCase() });
        i += palavra.length;
      } else if (depois === "!") {
        i += palavra.length + 1;
        if (!lerRef(palavra)) return null;
      } else if (!lerRef(null)) {
        return null;
      }
    } else {
      saida.push({ t: "simbolo", v: ch });
      i++;
    }
  }
  return saida;
}

function intervalo(t: Token & { t: "ref" }): Intervalo | null {
  const parte = (ref: string) => {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d*)$/.exec(ref);
    return m ? { coluna: indiceDaColuna(m[1]), linha: m[2] ? Number(m[2]) : null } : null;
  };
  const de = parte(t.de);
  const ate = t.ate ? parte(t.ate) : de;
  if (!de || !ate || de.coluna !== ate.coluna) return null;
  return { aba: t.aba, coluna: de.coluna, linhaDe: de.linha, linhaAte: ate.linha };
}

/**
 * Texto da fórmula → árvore, ou `null` se ela usa algo além de números, +, −,
 * ×, ÷, parênteses, SUMIFS e célula da própria aba como fator depois de × ou ÷.
 */
export function lerFormula(formula: string): No | null {
  const ts = tokens(formula);
  if (!ts) return null;
  let p = 0;
  const simbolo = (v: string) => {
    const t = ts[p];
    return t?.t === "simbolo" && t.v === v;
  };

  const somase = (): No | null => {
    p++; // o nome da função
    if (!simbolo("(")) return null;
    p++;
    const argumentos: Token[] = [];
    while (!simbolo(")")) {
      const t = ts[p];
      if (!t || (t.t !== "ref" && t.t !== "texto" && t.t !== "numero")) return null;
      argumentos.push(t);
      p++;
      if (simbolo(",")) p++;
      else if (!simbolo(")")) return null;
    }
    p++;
    if (argumentos.length < 3 || argumentos.length % 2 === 0 || argumentos[0].t !== "ref") return null;
    const soma = intervalo(argumentos[0]);
    if (!soma) return null;
    const criterios: { intervalo: Intervalo; criterio: Criterio }[] = [];
    for (let k = 1; k < argumentos.length; k += 2) {
      const faixa = argumentos[k];
      const valor = argumentos[k + 1];
      if (faixa.t !== "ref") return null;
      const intervaloDoCriterio = intervalo(faixa);
      if (!intervaloDoCriterio) return null;
      let criterio: Criterio;
      if (valor.t === "texto") criterio = { tipo: "texto", valor: valor.v };
      else if (valor.t === "numero") criterio = { tipo: "numero", valor: valor.v };
      else if (valor.t === "ref" && valor.aba === null && valor.ate === null) criterio = { tipo: "celula", ref: valor.de.replace(/\$/g, "").toUpperCase() };
      else return null;
      criterios.push({ intervalo: intervaloDoCriterio, criterio });
    }
    return { tipo: "somase", soma, criterios };
  };

  const primario = (): No | null => {
    const t = ts[p];
    if (!t) return null;
    if (t.t === "numero") {
      p++;
      return { tipo: "numero", valor: t.v };
    }
    if (simbolo("(")) {
      p++;
      const dentro = expressao();
      if (!dentro || !simbolo(")")) return null;
      p++;
      return dentro;
    }
    if (t.t === "funcao" && t.v === "SUMIFS") return somase();
    return null;
  };

  // A célula só entra como fator depois de × ou ÷ (o percentual do rateio). Somada, ela traria
  // para a conta o valor que a própria planilha calculou, e a fórmula bateria consigo mesma.
  const termo = (): No | null => {
    const primeiro = primario();
    if (!primeiro) return null;
    const partes: { divide: boolean; no: No }[] = [{ divide: false, no: primeiro }];
    while (simbolo("*") || simbolo("/")) {
      const divide = simbolo("/");
      p++;
      const t = ts[p];
      let no: No | null;
      if (t?.t === "ref") {
        if (t.aba !== null || t.ate !== null) return null;
        p++;
        no = { tipo: "celula", ref: t.de.replace(/\$/g, "").toUpperCase() };
      } else {
        no = primario();
      }
      if (!no) return null;
      partes.push({ divide, no });
    }
    return partes.length === 1 ? primeiro : { tipo: "produto", partes };
  };

  const expressao = (): No | null => {
    const partes: { sinal: 1 | -1; no: No }[] = [];
    do {
      let sinal: 1 | -1 = 1;
      while (simbolo("+") || simbolo("-")) {
        if (simbolo("-")) sinal = sinal === 1 ? -1 : 1;
        p++;
      }
      const no = termo();
      if (!no) return null;
      partes.push({ sinal, no });
    } while (simbolo("+") || simbolo("-"));
    return partes.length === 1 && partes[0].sinal === 1 ? partes[0].no : { tipo: "soma", partes };
  };

  const arvore = expressao();
  return arvore && p === ts.length ? arvore : null;
}

// ---------------------------------------------------------------- critério

export type Predicado = { casa: (valor: string) => boolean; igualA?: string };

const ehNumero = (texto: string) => /^-?\d+(\.\d+)?(E[-+]?\d+)?$/i.test(texto.trim());

function dataDoCriterio(texto: string): string | null {
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(texto.trim()) ? texto.trim() : null;
}

function comparar<T extends string | number>(a: T, b: T, operador: string): boolean {
  if (operador === "<") return a < b;
  if (operador === ">") return a > b;
  if (operador === "<=") return a <= b;
  return a >= b;
}

function curinga(padrao: string): RegExp {
  let re = "";
  for (let i = 0; i < padrao.length; i++) {
    const ch = padrao[i];
    if (ch === "~" && i + 1 < padrao.length) re += padrao[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "*") re += "[\\s\\S]*";
    else if (ch === "?") re += "[\\s\\S]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

/** O critério de um SUMIFS como o Google Sheets o aplica. */
export function predicadoDoCriterio(criterio: string | number): Predicado {
  if (typeof criterio === "number") return { casa: (v) => ehNumero(v) && Number(v) === criterio };
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(criterio)!;
  const operador = m[1] ?? "";
  const alvo = m[2];
  if (operador === "" || operador === "=" || operador === "<>") {
    let igual: Predicado;
    if (alvo === "") igual = { casa: (v) => v === "" };
    else if (ehNumero(alvo)) igual = { casa: (v) => (ehNumero(v) ? Number(v) === Number(alvo) : v.toLowerCase() === alvo.toLowerCase()) };
    else if (/[*?~]/.test(alvo)) {
      const re = curinga(alvo);
      igual = { casa: (v) => re.test(v) };
    } else {
      const a = alvo.toLowerCase();
      igual = { casa: (v) => v.toLowerCase() === a, igualA: a };
    }
    return operador === "<>" ? { casa: (v) => !igual.casa(v) } : igual;
  }
  const data = dataDoCriterio(alvo);
  if (data) return { casa: (v) => /^\d{4}-\d{2}-\d{2}/.test(v) && comparar(v.slice(0, 10), data, operador) };
  if (ehNumero(alvo)) return { casa: (v) => ehNumero(v) && comparar(Number(v), Number(alvo), operador) };
  return { casa: () => false };
}

// ---------------------------------------------------------------- avaliação

/**
 * As linhas das abas de uma fonte (a extração ou o padronizado). Em cada
 * linha, a posição 0 é o número da linha na planilha e a posição i é a
 * coluna i. O índice por valor exato poupa varrer a aba inteira a cada SUMIFS.
 */
export class Fonte {
  private readonly indices = new Map<string, Map<string, number[]>>();

  constructor(
    private readonly abas: ReadonlyMap<string, readonly (readonly string[])[]>,
    private readonly colunasDisponiveis?: ReadonlyMap<string, ReadonlySet<number>>,
  ) {}

  linhas(aba: string): readonly (readonly string[])[] | null {
    return this.abas.get(aba) ?? null;
  }

  temColuna(aba: string, coluna: number): boolean {
    const colunas = this.colunasDisponiveis?.get(aba);
    return colunas ? colunas.has(coluna) : true;
  }

  indice(aba: string, coluna: number): Map<string, number[]> {
    const chave = `${aba}|${coluna}`;
    let indice = this.indices.get(chave);
    if (!indice) {
      indice = new Map();
      (this.abas.get(aba) ?? []).forEach((linha, i) => {
        const valor = (linha[coluna] ?? "").toLowerCase();
        const lista = indice!.get(valor);
        if (lista) lista.push(i);
        else indice!.set(valor, [i]);
      });
      this.indices.set(chave, indice);
    }
    return indice;
  }
}

const dentro = (linha: number, i: Intervalo) => (i.linhaDe === null || linha >= i.linhaDe) && (i.linhaAte === null || linha <= i.linhaAte);

/**
 * Valor da árvore sobre uma fonte. `valorDaCelula` dá o valor das células da
 * própria aba da fórmula usadas como critério (o C611 de "REC 1T 2026") ou
 * como fator (o percentual do rateio). Volta `null` quando a fonte não tem a
 * aba ou a coluna, quando o fator é texto e na divisão por zero.
 */
export function avaliar(no: No, fonte: Fonte, valorDaCelula: (ref: string) => string, abaDaFormula: string): number | null {
  if (no.tipo === "numero") return no.valor;
  if (no.tipo === "celula") {
    const texto = valorDaCelula(no.ref).trim();
    if (texto === "") return 0;
    return ehNumero(texto) ? Number(texto) : null;
  }
  if (no.tipo === "soma") {
    let total = 0;
    for (const parte of no.partes) {
      const valor = avaliar(parte.no, fonte, valorDaCelula, abaDaFormula);
      if (valor === null) return null;
      total += parte.sinal * valor;
    }
    return total;
  }
  if (no.tipo === "produto") {
    let total = 1;
    for (const parte of no.partes) {
      const valor = avaliar(parte.no, fonte, valorDaCelula, abaDaFormula);
      if (valor === null || (parte.divide && valor === 0)) return null;
      total = parte.divide ? total / valor : total * valor;
    }
    return total;
  }
  const aba = no.soma.aba ?? abaDaFormula;
  const linhas = fonte.linhas(aba);
  if (!linhas) return null;
  if (no.criterios.some((c) => (c.intervalo.aba ?? abaDaFormula) !== aba)) return null;
  if (!fonte.temColuna(aba, no.soma.coluna) || no.criterios.some((c) => !fonte.temColuna(aba, c.intervalo.coluna))) return null;
  const criterios = no.criterios.map((c) => {
    // Célula vazia como critério vale zero no Google Sheets: não casa com a célula vazia.
    const valor = c.criterio.tipo === "celula" ? valorDaCelula(c.criterio.ref) || 0 : c.criterio.valor;
    return { intervalo: c.intervalo, predicado: predicadoDoCriterio(valor) };
  });
  const comIndice = criterios.find((c) => c.predicado.igualA !== undefined);
  const candidatas = comIndice ? fonte.indice(aba, comIndice.intervalo.coluna).get(comIndice.predicado.igualA!) ?? [] : linhas.map((_, i) => i);
  let total = 0;
  for (const i of candidatas) {
    const linha = linhas[i];
    const numero = Number(linha[0]);
    if (!dentro(numero, no.soma)) continue;
    if (!criterios.every((c) => dentro(numero, c.intervalo) && c.predicado.casa(linha[c.intervalo.coluna] ?? ""))) continue;
    const texto = linha[no.soma.coluna] ?? "";
    if (texto !== "" && ehNumero(texto)) total += Number(texto);
  }
  return total;
}

/** As colunas, aba por aba, que os SUMIFS da árvore leem: a somada e as dos critérios. */
export function colunasDaFormula(no: No, abaDaFormula: string): { aba: string; coluna: number }[] {
  if (no.tipo === "numero" || no.tipo === "celula") return [];
  if (no.tipo === "soma" || no.tipo === "produto") return no.partes.flatMap((p) => colunasDaFormula(p.no, abaDaFormula));
  return [no.soma, ...no.criterios.map((c) => c.intervalo)].map((i) => ({ aba: i.aba ?? abaDaFormula, coluna: i.coluna }));
}

/** As abas que a árvore soma. */
export function abasDaFormula(no: No, abaDaFormula: string): string[] {
  if (no.tipo === "numero" || no.tipo === "celula") return [];
  if (no.tipo === "soma" || no.tipo === "produto") return [...new Set(no.partes.flatMap((p) => abasDaFormula(p.no, abaDaFormula)))];
  return [no.soma.aba ?? abaDaFormula];
}
