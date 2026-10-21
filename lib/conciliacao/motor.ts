/**
 * O motor de correspondência da Conciliação automática (decisão 199),
 * portado do protótipo "Conciliação com o banco" (`prototipo/src/ofx.js`,
 * `casar`, na versão recomendada, que a Alternativa aprovada usa). A ordem e
 * os limites de cada passo valem como especificação (seção 4.5).
 *
 * Roda sobre as linhas do banco ainda sem solução, da tentativa mais certa
 * para a menos certa:
 *
 *   1.  a baixa feita à mão que bate (mesmo valor e sinal, até 3 dias);
 *   1b. a baixa feita à mão que diverge (até R$ 1 ou 1%, até 3 dias);
 *   2.  saiu e voltou (a devolução e a saída de mesmo valor no mesmo dia);
 *   3.  o título pelo valor exato, por pontos (data, forma, CNPJ);
 *   3a. linhas iguais em número igual ao de títulos empatados;
 *   3b. a retenção na fonte que explica o banco ter menos;
 *   4.  a remessa (lote) que soma centavo a centavo;
 *   4b. de 2 a 4 títulos da mesma contraparte que somam a linha;
 *   5.  juros e multa no boleto e na guia;
 *   6.  a regra do histórico;
 *   7.  sem correspondência.
 *
 * Função pura: recebe o que o sistema tem e devolve, para cada linha, o
 * estado, a confiança e o motivo. Os nomes dos campos são os do protótipo,
 * para o teste rodar sobre os mesmos dados.
 *
 * Diferença deliberada do protótipo: a remessa (passo 4) só casa com uma
 * linha de saída do banco — no protótipo ela não conferia o sinal.
 */

import { normalizar } from "./ofx";

export type LadoDoTitulo = "pagar" | "receber" | "imposto" | "transf";

/** Um movimento do banco, como o motor o recebe. */
export interface MovimentoDoMotor {
  /** O id da linha em `extrato_linhas` (o protótipo não tem). */
  id?: string;
  ordem: number;
  data: string;
  valor: number;
  historico: string;
  tipo?: string;
}

export interface CentroDoTitulo {
  tipo: string;
  sub: string;
}

/** Um título em aberto, como o motor o recebe. */
export interface TituloDoMotor {
  id: string;
  lado: LadoDoTitulo;
  origem: string;
  ref: string;
  contraparte: string;
  cnpj?: string | null;
  /** A data prevista (o protótipo chama de vencimento). */
  vencimento: string;
  /** O vencimento do documento, quando difere da data prevista. */
  vencOrig?: string | null;
  /** O valor bruto. */
  valor: number;
  /** O retido na aprovação (a PP com retenção já está pelo líquido). */
  retencao?: number;
  /** O que sai ou entra da conta: o aberto, pelo líquido. */
  liquido: number;
  /** O já baixado. */
  baixado?: number;
  /** A forma prevista: pix, transferencia, boleto, guia… */
  forma?: string | null;
  /** O centro de custo, quando o título já tem (o "certo" pede centro). */
  centro?: CentroDoTitulo | null;
  /** A remessa em que o título está (o passo 4 o leva junto). */
  loteId?: string | null;
  /** O título que entra na conta sem ser de receber (o estorno de verba). */
  entra?: boolean;
}

/** Um lançamento da conta ainda não conciliado. */
export interface LancamentoDoMotor {
  id: string;
  data: string;
  /** Com sinal, já com os juros da baixa (decisão 196). */
  valor: number;
  juros?: number;
  descricao: string;
  tituloId?: string | null;
}

export interface LoteDoMotor {
  id: string;
  nome: string;
  descricao?: string;
  total: number;
  titulos: TituloDoMotor[];
}

export interface RegraDoMotor {
  id?: string;
  padrao: string;
  /** "04 · Tarifa bancária". */
  centro: string;
  criadaEm: string;
  usos: number;
  [extra: string]: unknown;
}

export type EstadoDaLinha =
  | "ja_lancado"
  | "divergencia"
  | "par"
  | "sugestao"
  | "diferenca"
  | "soma"
  | "combinacao"
  | "regra"
  | "sem_par";

export type Confianca = "alta" | "media" | "baixa";

export interface ResultadoDoMotor<M extends MovimentoDoMotor = MovimentoDoMotor> {
  mov: M;
  estado: EstadoDaLinha;
  confianca?: Confianca;
  motivo?: string;
  candidatos: Array<{ t: TituloDoMotor; s: number }>;
  lancamento?: LancamentoDoMotor;
  /** Na divergência: o que a baixa tem a mais que o banco. */
  diferencaBaixa?: number;
  par?: ResultadoDoMotor<M>;
  titulo?: TituloDoMotor | null;
  pontos?: number;
  empate?: number;
  iguais?: number;
  retencaoSugerida?: Record<string, number>;
  /** Juros e multa: o banco pagou a mais. */
  diferenca?: number;
  lote?: LoteDoMotor;
  titulos?: TituloDoMotor[];
  regra?: RegraDoMotor;
}

export interface SistemaDoMotor {
  titulos: TituloDoMotor[];
  lancamentos: LancamentoDoMotor[];
  lotes: LoteDoMotor[];
  regras: RegraDoMotor[];
  /** Só o protótipo usa: desloca os vencimentos do exemplo. */
  deslocamento?: number;
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

export function diasEntre(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function somaDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const cents = (v: number) => Math.round(Math.abs(v) * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function fmt(n: number): string {
  return Math.abs(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type FormaDoHistorico = "tarifa" | "concessionaria" | "boleto" | "devolucao" | "pix" | "ted" | "outro";

/** O que o histórico do banco diz sobre a forma do pagamento. */
export function formaDoHistorico(h: string): FormaDoHistorico {
  const n = normalizar(h);
  if (/^TAR /.test(n)) return "tarifa";
  if (n.includes("CONCESSIONARIA")) return "concessionaria";
  if (n.includes("PAGAMENTO DE TITULO")) return "boleto";
  if (n.includes("DEVOLUCAO")) return "devolucao";
  if (n.includes("PIX")) return "pix";
  if (n.includes("TED")) return "ted";
  return "outro";
}

/** A forma de pagamento do sistema que o histórico do banco diz (a baixa
 *  aberta pela linha, decisão 196). Concessionária entra como boleto. */
export function formaDaBaixaPeloHistorico(h: string): "pix" | "transferencia" | "boleto" | null {
  const f = formaDoHistorico(h);
  if (f === "pix") return "pix";
  if (f === "ted") return "transferencia";
  if (f === "boleto" || f === "concessionaria") return "boleto";
  return null;
}

export function cnpjDoHistorico(h: string): string | null {
  const m = (h || "").match(/\b(\d{14})\b/);
  return m ? m[1] : null;
}

// As retenções que mais aparecem, para reconhecer a diferença do banco.
export const RETENCOES_COMUNS: Array<{ nome: string; aliquotas: Record<string, number> }> = [
  { nome: "IRRF 1,5% e PIS/COFINS/CSLL 4,65% (6,15%)", aliquotas: { IRRF: 1.5, PIS: 0.65, COFINS: 3, CSLL: 1 } },
  { nome: "PIS/COFINS/CSLL 4,65%", aliquotas: { PIS: 0.65, COFINS: 3, CSLL: 1 } },
  { nome: "IRRF 1,5%", aliquotas: { IRRF: 1.5 } },
  { nome: "ISS 5%", aliquotas: { ISS: 5 } },
  { nome: "ISS 2%", aliquotas: { ISS: 2 } },
  { nome: "IRRF, PIS/COFINS/CSLL e ISS 5% (11,15%)", aliquotas: { IRRF: 1.5, PIS: 0.65, COFINS: 3, CSLL: 1, ISS: 5 } },
];

function liquidoCom(valor: number, aliquotas: Record<string, number>): number {
  return r2(valor - Object.values(aliquotas).reduce((s, a) => s + r2((valor * a) / 100), 0));
}

/** Os valores retidos, imposto a imposto; o centavo do arredondamento vai
 *  no maior, para o líquido bater com o banco. */
export function valoresRetidos(valor: number, aliquotas: Record<string, number>, liquidoDoBanco?: number): Record<string, number> {
  const v: Record<string, number> = Object.fromEntries(
    Object.entries(aliquotas).map(([k, a]) => [k, r2((valor * a) / 100)]),
  );
  if (liquidoDoBanco !== undefined) {
    const sobra = r2(valor - Object.values(v).reduce((s, x) => s + x, 0) - liquidoDoBanco);
    if (sobra !== 0) {
      const maior = Object.keys(v).sort((a, b) => v[b] - v[a])[0];
      v[maior] = r2(v[maior] + sobra);
    }
  }
  return v;
}

/** A retenção de alíquotas comuns que explica o banco ter menos que o
 *  título (a mesma do passo 3b), para a busca manual. Só para título que
 *  pode ter retenção e que não a tem combinada na aprovação. */
export function retencaoQueExplica(
  t: Pick<TituloDoMotor, "retencao" | "baixado" | "origem" | "valor">,
  valorDoBanco: number,
): { nome: string; retidos: Record<string, number> } | null {
  if ((t.retencao ?? 0) > 0 || (t.baixado ?? 0) > 0) return null;
  if (!["pp", "avulso", "recorrencia", "desembolso", "nf", "rec_avulso", "recebimento_avulso"].includes(t.origem)) return null;
  const combo = RETENCOES_COMUNS.find((c) => Math.abs(liquidoCom(t.valor, c.aliquotas) - valorDoBanco) <= 0.01);
  return combo ? { nome: combo.nome, retidos: valoresRetidos(t.valor, combo.aliquotas, valorDoBanco) } : null;
}

// ---------------------------------------------------------------------------
// O motor
// ---------------------------------------------------------------------------

export function casar<M extends MovimentoDoMotor>(movimentos: M[], sistema: SistemaDoMotor): ResultadoDoMotor<M>[] {
  const { titulos, lancamentos, lotes, regras, deslocamento = 0 } = sistema;
  const usados = new Set<string>();
  const lancUsados = new Set<string>();
  const res: ResultadoDoMotor<M>[] = movimentos.map((m) => ({ mov: m, estado: "sem_par", candidatos: [] }));
  const venc = (t: TituloDoMotor) => somaDias(t.vencimento, deslocamento);
  const forma = (m: MovimentoDoMotor) => formaDoHistorico(m.historico);

  // 1. Já lançado: a baixa feita à mão que bate.
  res.forEach((r) => {
    const l = lancamentos.find(
      (l) =>
        !lancUsados.has(l.id) &&
        cents(l.valor) === cents(r.mov.valor) &&
        Math.sign(l.valor) === Math.sign(r.mov.valor) &&
        Math.abs(diasEntre(somaDias(l.data, deslocamento), r.mov.data)) <= 3,
    );
    if (l) {
      lancUsados.add(l.id);
      r.estado = "ja_lancado";
      r.lancamento = l;
      r.confianca = "alta";
      r.motivo = "Já está no extrato do sistema, lançado à mão. Conciliar só liga as duas linhas.";
    }
  });

  // 1b. Já lançado com outro valor: a baixa não bate com o banco (juros a
  //     mais, dígito trocado). Até R$ 1 ou 1%, na mesma direção, até 3 dias.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    const l = lancamentos.find(
      (l) =>
        !lancUsados.has(l.id) &&
        Math.sign(l.valor) === Math.sign(r.mov.valor) &&
        cents(l.valor) !== cents(r.mov.valor) &&
        Math.abs(Math.abs(l.valor) - Math.abs(r.mov.valor)) <= Math.max(1, Math.abs(r.mov.valor) * 0.01) &&
        Math.abs(diasEntre(somaDias(l.data, deslocamento), r.mov.data)) <= 3,
    );
    if (l) {
      lancUsados.add(l.id);
      r.estado = "divergencia";
      r.lancamento = l;
      r.confianca = "media";
      r.diferencaBaixa = r2(Math.abs(l.valor) - Math.abs(r.mov.valor));
      r.motivo = `A baixa registrou ${fmt(Math.abs(l.valor))}${l.juros ? `, com ${fmt(l.juros)} de juros` : ""}; o banco ${r.mov.valor < 0 ? "debitou" : "creditou"} ${fmt(Math.abs(r.mov.valor))}.`;
    }
  });

  // 2. Saiu e voltou: a devolução e a saída de mesmo valor no mesmo dia.
  res.forEach((r) => {
    if (r.estado !== "sem_par" || forma(r.mov) !== "devolucao") return;
    const outro = res.find(
      (o) =>
        o !== r && o.estado === "sem_par" && cents(o.mov.valor) === cents(r.mov.valor) && o.mov.valor < 0 && o.mov.data === r.mov.data,
    );
    if (outro) {
      const t = titulos.find((t) => !usados.has(t.id) && t.lado === "pagar" && cents(t.liquido) === cents(r.mov.valor));
      r.estado = outro.estado = "par";
      r.par = outro;
      outro.par = r;
      r.titulo = outro.titulo = t || null;
      r.confianca = outro.confianca = "alta";
      r.motivo = outro.motivo = t
        ? `O PIX de ${t.contraparte} saiu e voltou no mesmo dia. As duas linhas entram no extrato e o título continua a pagar.`
        : "Saiu e voltou no mesmo dia. As duas linhas entram no extrato, e nenhum título é baixado.";
    }
  });

  // 3. O título pelo valor exato.
  const pontuar = (m: MovimentoDoMotor, t: TituloDoMotor) => {
    let s = 60;
    const d = Math.abs(diasEntre(venc(t), m.data));
    s += d === 0 ? 20 : d <= 3 ? 15 : d <= 7 ? 5 : d > 20 ? -25 : 0;
    const f = forma(m);
    if (t.forma && (t.forma === f || (f === "boleto" && t.forma === "guia"))) s += 10;
    const cnpj = cnpjDoHistorico(m.historico);
    if (cnpj && t.cnpj && cnpj === t.cnpj.replace(/\D/g, "")) s += 30;
    return s;
  };
  const compativel = (m: MovimentoDoMotor, t: TituloDoMotor) =>
    m.valor < 0 ? t.lado !== "receber" && !t.entra : t.lado === "receber" || !!t.entra;

  const pendentes = res.filter((r) => r.estado === "sem_par");
  const pares: Array<{ r: ResultadoDoMotor<M>; t: TituloDoMotor; s: number }> = [];
  pendentes.forEach((r) => {
    titulos.forEach((t) => {
      if (t.loteId || !compativel(r.mov, t) || cents(t.liquido) !== cents(r.mov.valor)) return;
      pares.push({ r, t, s: pontuar(r.mov, t) });
    });
  });
  pares.sort((a, b) => b.s - a.s);
  pares.forEach(({ r, t, s }) => {
    r.candidatos.push({ t, s });
    if (r.estado !== "sem_par" || usados.has(t.id)) return;
    usados.add(t.id);
    r.estado = "sugestao";
    r.titulo = t;
    r.pontos = s;
  });
  res.forEach((r) => {
    if (r.estado !== "sugestao" || !r.titulo) return;
    const titulo = r.titulo;
    const pontos = r.pontos ?? 0;
    // Vários títulos do mesmo valor: a escolha é pela data, e pede conferência.
    const mesmos = r.candidatos.filter((c) => c.t.id !== titulo.id && c.s >= pontos - 5).length;
    r.empate = mesmos;
    r.confianca = pontos >= 90 && !mesmos ? "alta" : pontos >= 75 ? "media" : "baixa";
    const cnpj = cnpjDoHistorico(r.mov.historico);
    const d = Math.abs(diasEntre(venc(titulo), r.mov.data));
    r.motivo = [
      "valor exato",
      titulo.retencao ? "pelo líquido, depois da retenção" : null,
      cnpj && titulo.cnpj && cnpj === titulo.cnpj.replace(/\D/g, "") ? "CNPJ do histórico é o do cliente" : null,
      d === 0 ? "mesma data" : d === 1 ? "1 dia de diferença" : `${d} dias de diferença`,
      mesmos ? `há ${mesmos + 1} títulos de ${fmt(r.mov.valor)} — confira o fornecedor` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  // 3a. Linhas iguais (mesmo dia, mesmo valor) e o mesmo número de títulos
  //     empatados: cada linha paga um, e qual fica com qual não muda o
  //     Extrato. Com mais títulos que linhas, o empate continua.
  const iguais = new Map<string, ResultadoDoMotor<M>[]>();
  res.forEach((r) => {
    if (r.estado !== "sugestao" || !r.empate) return;
    const k = `${r.mov.data}|${cents(r.mov.valor)}`;
    iguais.set(k, [...(iguais.get(k) ?? []), r]);
  });
  iguais.forEach((linhas) => {
    const empatados = new Set<string>();
    linhas.forEach((r) => {
      if (r.titulo) empatados.add(r.titulo.id);
      r.candidatos.forEach((c) => c.s >= (r.pontos ?? 0) - 5 && empatados.add(c.t.id));
    });
    if (empatados.size !== linhas.length) return;
    linhas.forEach((r) => {
      r.empate = 0;
      r.confianca = "alta";
      r.iguais = linhas.length;
      r.motivo = `valor exato · ${linhas.length} linhas iguais e ${linhas.length} títulos de ${fmt(Math.abs(r.mov.valor))}: cada linha paga um`;
    });
  });

  // 3b. Retenção na fonte: o banco tem menos que a nota, e a diferença bate
  //     com as retenções de sempre. Só para título sem retenção combinada na
  //     aprovação. Não concilia sozinho: a baixa abre com a retenção.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    for (const t of titulos) {
      if (usados.has(t.id) || t.loteId || (t.retencao ?? 0) > 0 || !compativel(r.mov, t)) continue;
      if (Math.abs(diasEntre(venc(t), r.mov.data)) > 10) continue;
      const combo = RETENCOES_COMUNS.find((c) => Math.abs(liquidoCom(t.valor, c.aliquotas) - Math.abs(r.mov.valor)) <= 0.01);
      if (!combo) continue;
      usados.add(t.id);
      r.estado = "diferenca";
      r.titulo = t;
      r.confianca = "media";
      r.retencaoSugerida = valoresRetidos(t.valor, combo.aliquotas, Math.abs(r.mov.valor));
      r.motivo = `O banco tem ${fmt(t.valor - Math.abs(r.mov.valor))} a menos que o título: bate com ${combo.nome} retidos na fonte.`;
      break;
    }
  });

  // 4. Lote: uma linha de saída do banco = a remessa (a folha).
  res.forEach((r) => {
    if (r.estado !== "sem_par" || r.mov.valor >= 0) return;
    const lote = lotes.find((l) => cents(l.total) === cents(r.mov.valor));
    if (lote) {
      r.estado = "soma";
      r.lote = lote;
      r.confianca = "alta";
      r.motivo = `A soma dos ${lote.titulos.length} títulos da ${lote.nome} bate centavo a centavo.`;
      lote.titulos.forEach((t) => usados.add(t.id));
    }
  });

  // 4b. Vários títulos da mesma contraparte numa linha só (2 a 4, vencendo
  //     até 10 dias da data, soma exata). Uma combinação só: alta; mais de
  //     uma: média.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    const cnpj = cnpjDoHistorico(r.mov.historico);
    const alvo = cents(r.mov.valor);
    const porContraparte = new Map<string, TituloDoMotor[]>();
    titulos.forEach((t) => {
      if (usados.has(t.id) || t.loteId || !compativel(r.mov, t) || cents(t.liquido) >= alvo) return;
      if (Math.abs(diasEntre(venc(t), r.mov.data)) > 10) return;
      if (cnpj && t.cnpj && t.cnpj.replace(/\D/g, "") !== cnpj) return;
      porContraparte.set(t.contraparte, [...(porContraparte.get(t.contraparte) ?? []), t]);
    });
    const achadas: TituloDoMotor[][] = [];
    porContraparte.forEach((ts) => {
      const busca = (ini: number, escolhidos: TituloDoMotor[], soma: number): void => {
        if (soma === alvo && escolhidos.length >= 2) {
          achadas.push(escolhidos);
          return;
        }
        if (escolhidos.length === 4 || soma >= alvo) return;
        for (let i = ini; i < ts.length; i++) busca(i + 1, [...escolhidos, ts[i]], soma + cents(ts[i].liquido));
      };
      busca(0, [], 0);
    });
    if (!achadas.length) return;
    const ts = achadas[0];
    ts.forEach((t) => usados.add(t.id));
    r.estado = "combinacao";
    r.titulos = ts;
    r.confianca = achadas.length === 1 ? "alta" : "media";
    r.motivo = `A soma de ${ts.length} títulos de ${ts[0].contraparte} bate centavo a centavo${achadas.length > 1 ? ` · há ${achadas.length} combinações possíveis` : ""}.`;
  });

  // 5. Juros e multa: no boleto pago depois (até 3%, até 10 dias) e na guia
  //    de imposto paga em atraso (até 25%, até 60 dias do vencimento da
  //    guia). Só quando o banco diz que foi boleto ou guia.
  res.forEach((r) => {
    if (r.estado !== "sem_par" || r.mov.valor > 0 || forma(r.mov) !== "boleto") return;
    const cabe = (t: TituloDoMotor) => {
      if (t.lado !== "imposto" && (t.forma !== "boleto" || t.origem === "fatura")) return false;
      const dif = cents(r.mov.valor) - cents(t.liquido);
      if (dif <= 0) return false;
      const vencLegal = somaDias(t.vencOrig ?? t.vencimento, deslocamento);
      if (t.lado === "imposto" && r.mov.data > vencLegal) {
        return dif <= cents(t.liquido) * 0.25 && diasEntre(vencLegal, r.mov.data) <= 60;
      }
      return dif <= cents(t.liquido) * 0.03 && Math.abs(diasEntre(venc(t), r.mov.data)) <= 10;
    };
    const t = titulos.find((t) => !usados.has(t.id) && !t.loteId && compativel(r.mov, t) && cabe(t));
    if (t) {
      usados.add(t.id);
      r.estado = "diferenca";
      r.titulo = t;
      r.diferenca = r2(Math.abs(r.mov.valor) - t.liquido);
      r.confianca = "media";
      const atraso = diasEntre(somaDias(t.vencOrig ?? t.vencimento, deslocamento), r.mov.data);
      r.motivo =
        t.lado === "imposto"
          ? `Guia paga ${atraso} ${atraso === 1 ? "dia" : "dias"} depois do vencimento: os ${fmt(r.diferenca)} a mais entram como multa e juros (11 · Despesa com Juros).`
          : `O banco pagou ${fmt(r.diferenca)} a mais que o título: entra como juros e multa (11 · Despesa com Juros).`;
    }
  });

  // 6. Regras do histórico.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    const regra = regras.find((g) => normalizar(r.mov.historico).startsWith(normalizar(g.padrao)));
    if (regra) {
      r.estado = "regra";
      r.regra = regra;
      r.confianca = "alta";
      r.motivo = `Regra "${regra.padrao}…" → ${regra.centro}. Criada em ${regra.criadaEm}, usada ${regra.usos} ${regra.usos === 1 ? "vez" : "vezes"}.`;
    }
  });

  // 7. O que sobrou.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    r.motivo = r.candidatos.length
      ? `Os títulos de ${fmt(r.mov.valor)} já foram para outras linhas do extrato.`
      : "Nenhum título ou lançamento do sistema tem esse valor.";
  });
  return res;
}

// ---------------------------------------------------------------------------
// Depois do motor
// ---------------------------------------------------------------------------

/** O que conta como certo: confiança alta com centro de custo definido. */
export function ehCerto(r: Pick<ResultadoDoMotor, "estado" | "confianca" | "titulo" | "titulos">): boolean {
  if (r.confianca !== "alta") return false;
  if (r.estado === "sugestao") return !!r.titulo?.centro;
  if (r.estado === "combinacao") return (r.titulos ?? []).every((t) => !!t.centro);
  return false;
}

export interface GrupoDeIguais<M extends MovimentoDoMotor = MovimentoDoMotor> {
  chave: string;
  linhas: ResultadoDoMotor<M>[];
  /** Os títulos do grupo: os escolhidos primeiro, depois os outros do mesmo valor. */
  titulos: TituloDoMotor[];
  /** O título escolhido para cada linha, na ordem das linhas. */
  marcados: string[];
}

/**
 * As linhas iguais do banco (mesmo dia, mesmo valor) com mais títulos que
 * linhas: o banco não diz quem recebeu cada PIX, e qual fica com qual não
 * muda o Extrato. Vêm marcados os títulos que o motor escolheu, um por
 * linha; os outros com o mesmo valor ficam para trocar (`banco.jsx`,
 * `gruposDeIguais`).
 */
export function gruposDeIguais<M extends MovimentoDoMotor>(pend: ResultadoDoMotor<M>[]): GrupoDeIguais<M>[] {
  const por = new Map<string, ResultadoDoMotor<M>[]>();
  pend.forEach((r) => {
    if (r.estado !== "sugestao" || !r.empate) return;
    const k = `${r.mov.data}|${Math.round(r.mov.valor * 100)}`;
    por.set(k, [...(por.get(k) ?? []), r]);
  });
  const atribuidos = new Set(pend.map((r) => r.titulo?.id).filter((x): x is string => !!x));
  return [...por.entries()].map(([chave, linhas]) => {
    const marcados = linhas.map((r) => r.titulo as TituloDoMotor);
    const vistos = new Set(marcados.map((t) => t.id));
    const outros: TituloDoMotor[] = [];
    linhas.forEach((r) =>
      r.candidatos.forEach(({ t }) => {
        if (vistos.has(t.id) || atribuidos.has(t.id)) return;
        vistos.add(t.id);
        outros.push(t);
      }),
    );
    const porData = (a: TituloDoMotor, b: TituloDoMotor) => a.vencimento.localeCompare(b.vencimento) || a.ref.localeCompare(b.ref);
    return {
      chave,
      linhas,
      titulos: [...[...marcados].sort(porData), ...outros.sort(porData)],
      marcados: marcados.map((t) => t.id),
    };
  });
}

/**
 * O que a correção da baixa feita à mão muda (seção 4.6, item 1): ela passa
 * a ter o valor e a data do banco. A diferença para o título vira juros e
 * multa só onde eles existem (boleto e guia); no resto, muda o valor pago.
 */
export function correcaoDaBaixa(
  lanc: Pick<LancamentoDoMotor, "valor" | "juros" | "data">,
  mov: Pick<MovimentoDoMotor, "valor" | "data">,
  t: Pick<TituloDoMotor, "liquido" | "forma" | "origem"> | null,
): {
  antes: { data: string; principal: number; juros: number; total: number };
  depois: { data: string; principal: number; juros: number; total: number };
} {
  const total = Math.abs(lanc.valor);
  const jurosAntes = lanc.juros ?? 0;
  const banco = Math.abs(mov.valor);
  const principal = t ? t.liquido : r2(total - jurosAntes);
  const cabeJuros = !!t && (t.forma === "boleto" || t.forma === "guia" || t.origem === "imposto");
  const juros = cabeJuros ? Math.max(0, r2(banco - principal)) : 0;
  return {
    antes: { data: lanc.data, principal: r2(total - jurosAntes), juros: jurosAntes, total },
    depois: { data: mov.data, principal: r2(banco - juros), juros, total: banco },
  };
}
