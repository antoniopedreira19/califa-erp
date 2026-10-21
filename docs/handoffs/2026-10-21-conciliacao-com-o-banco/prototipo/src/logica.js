import { HOJE } from "./data";

export const r2 = (n) => Math.round(n * 100) / 100;

export function aberto(t) {
  return r2(t.liquido - (t.baixado ?? 0));
}

/** O que a linha faz com o saldo da conta: + entra, − sai, 0 é de outra
 *  conta. */
export function efeitoNaConta(t, contaId) {
  if (t.pagoEm) return 0;
  if (t.origem === "transferencia") {
    if (t.origemConta === contaId) return -aberto(t);
    if (t.destinoConta === contaId) return aberto(t);
    return 0;
  }
  if (t.contaFixa && t.contaFixa !== contaId) return 0;
  const v = aberto(t);
  return t.entra ? v : -v;
}

export function entra(t, contaId = "cs") {
  if (t.origem === "transferencia") return t.destinoConta === contaId;
  return !!t.entra;
}

export function descricaoDoLancamento(t) {
  switch (t.origem) {
    case "pp":
      return `${t.ref} · ${t.titulo}${t.parcela[1] > 1 ? ` — parcela ${t.parcela[0]}/${t.parcela[1]}` : ""}`;
    case "desembolso":
    case "fatura":
      return `${t.ref} · ${t.titulo}`;
    case "nf":
      return `Recebimento ${t.ref}/${t.parcela[0]} — ${t.descricaoNf}`;
    case "imposto":
      return `Guia de ${t.titulo} · ${t.competencia}`;
    case "transferencia":
      return `Transferência ${t.ref} · California Santander → California Investimento`;
    default:
      return t.titulo;
  }
}

/**
 * A regional do título, com as regionais do cadastro (migration
 * 20260908000001): Agência California tem NE, SP, NO, RJ e SS; a CCH, Doca
 * e Agency; a Hitlab, Hitlab; a Empresa Teste, Teste, Teste 2 e Teste 3.
 * Com job, vale a regional do job, 100% (decisão 069); sem job, o rateio do
 * lançamento.
 */
const REGIONAL_DO_JOB = {
  "AMB-1003/26": "NE",
  "AMB-1002/26": "Hitlab",
  "CAL-1007/26": "SP",
  "CAL-1004/26": "RJ",
  "CAL-1003/26": "NE",
  "CAL-1009/26": "SS",
  "TES-1001/26": "Teste",
  "TES-1014/26": "Teste 2",
};
export function regionalDe(t) {
  if (t.origem === "transferencia") return [];
  // A fatura do cartão rateia pelos itens: cada um com a regional dele.
  if (t.faturaId) return rateioDosItens(itensDaFatura(t.faturaId));
  if (t.job && REGIONAL_DO_JOB[t.job.codigo]) return [[REGIONAL_DO_JOB[t.job.codigo], 100]];
  if (t.empresa === "Hitlab") return [["Hitlab", 100]];
  if (t.empresa === "Empresa Teste") return [["Teste", 100]];
  if (t.origem === "folha") return [["NE", 82], ["SP", 18]];
  if (t.lado === "imposto") return [["NE", 70], ["SP", 30]];
  if (t.origem === "recorrencia") return [["NE", 60], ["SP", 40]];
  return [["NE", 100]];
}

/** O que o ⓘ do Extrato mostra para o lançamento que a baixa grava: a
 *  origem (com a etiqueta PP ou Avulsa), o documento e a regional. */
export function detalheDoTitulo(t) {
  const tag = t.origem === "pp" || t.origem === "verba" ? "pp" : ["avulso", "recorrencia", "folha", "rec_avulso", "rendimento"].includes(t.origem) ? "avulsa" : null;
  const codigo =
    t.origem === "pp"
      ? `${t.ref} ${t.parcela[0]}/${t.parcela[1]}`
      : t.origem === "folha"
        ? "Folha 10/2026"
        : t.origem === "recorrencia"
          ? "AV-00199"
          : t.ref;
  const documento = t.origem === "pp" && t.nf ? `NF ${t.nf}` : t.origem === "nf" ? t.ref : t.origem === "imposto" ? t.ref : null;
  return { tag, codigo, recorrente: t.origem === "recorrencia", documento, rateio: regionalDe(t) };
}

export function lancamentoDaBaixa(t, { data, contaId, valor, juros = 0, centro }) {
  const sinal = entra(t, contaId) ? 1 : -1;
  return {
    id: `lb-${t.id}-${Math.random().toString(36).slice(2, 7)}`,
    data,
    valor: r2(sinal * (valor + juros)),
    descricao: descricaoDoLancamento(t),
    fornecedor: t.origem === "imposto" || t.origem === "transferencia" ? null : t.contraparte,
    job: t.job?.codigo ?? null,
    centro: t.origem === "transferencia" ? { tipo: "—", sub: "Transferência entre contas · fora do DRE" } : centro ?? t.centro,
    empresa: t.origem === "transferencia" ? null : t.empresa,
    conciliado: false,
    tituloId: t.id,
    juros,
    contaId,
    faturaId: t.faturaId ?? null,
    detalhe: detalheDoTitulo(t),
  };
}

/** O que a correção da baixa feita à mão muda: ela passa a ter o valor e a
 *  data do banco. A diferença para o título vira juros e multa só onde
 *  eles existem (boleto e guia); no resto, muda o valor pago do título. */
export function correcaoDaBaixa(lanc, mov, t) {
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

/** Linhas da planilha de títulos, na ordem da data, com o saldo previsto
 *  corrente (o vencido conta como hoje: é o que sai primeiro). */
export function comSaldoPrevisto(titulos, saldoHoje, contaId) {
  const ordenados = [...titulos].sort(
    (a, b) =>
      a.vencimento.localeCompare(b.vencimento) ||
      ordemLado(a) - ordemLado(b) ||
      a.titulo.localeCompare(b.titulo, "pt-BR"),
  );
  let s = saldoHoje;
  return ordenados.map((t) => {
    s = r2(s + efeitoNaConta(t, contaId));
    return { t, saldo: s, efeito: efeitoNaConta(t, contaId) };
  });
}

export function dataEfetiva(t) {
  return t.vencimento < HOJE ? HOJE : t.vencimento;
}

function ordemLado(t) {
  return { receber: 0, transf: 1, imposto: 2, pagar: 3 }[t.lado] ?? 4;
}

export function casaVencimento(v, filtro) {
  if (filtro === "todos") return true;
  if (!v) return false;
  if (filtro === "vencidos") return v < HOJE;
  if (filtro === "ate_hoje") return v <= HOJE;
  return v >= HOJE && v <= "2026-10-27";
}

/** O motivo de o título não entrar no lote (decisão 140). */
export function motivoForaDoLote(t, { cartaoNoLote = false } = {}) {
  // Hoje o aprovado no cartão não entra no lote. Nas versões novas entra: se
  // a forma do lote for cartão, todos vão para a fatura (Tiago, 20/10/2026).
  if (!cartaoNoLote && t.formaPrevista === "cartao") return "Previsto no cartão de crédito: dê baixa nele sozinho, para o item entrar na fatura.";
  if (t.origem === "fatura") return "Fatura de cartão tem baixa própria: dê baixa nela sozinha.";
  if (t.origem === "desembolso") return "Desembolso: dê baixa nele sozinho, para escolher o centro de custo.";
  if (t.origem === "verba") return "Estorno de verba tem baixa própria.";
  if (t.origem === "rendimento") return "Rendimento tem baixa própria: dê baixa nele sozinho.";
  if (t.origem === "transferencia") return "Transferência tem baixa própria: dê baixa nela sozinha.";
  if (t.foraDoCadastro) return "Pagamento fora do cadastro: para onde vai o dinheiro só aparece na baixa dela.";
  return null;
}

export const ORIGEM_DO_LOTE = {
  pp: "PP",
  avulso: "Avulso",
  recorrencia: "Recorrência",
  folha: "Folha",
  nf: "Nota fiscal",
  rec_avulso: "Recebimento avulso",
  imposto: "Imposto",
};

// ---------------------------------------------------------------------------
// A coluna Regional (as quatro formas que o Tiago pediu para comparar)
// ---------------------------------------------------------------------------

/** 0 sem a coluna · 1 Trimestre + Regional · 2 TRI + Regional · 3 TRI +
 *  Regional abreviada · 4 TRI + REG abreviada. */
export const FORMAS_REGIONAL = [
  [0, "Sem a coluna"],
  [1, "Trimestre + Regional"],
  [2, "TRI + Regional"],
  [3, "TRI + Regional abreviada"],
  [4, "TRI + REG abreviada"],
];

// Até 3 letras (pedido do Tiago): as de 2 letras ficam como são.
const SIGLA = { Doca: "DOC", Agency: "AGE", Hitlab: "HIT", Teste: "TES", "Teste 2": "TE2", "Teste 3": "TE3" };

/** O texto da célula: o nome (ou a sigla de 3 letras) da regional; com
 *  rateio entre regionais, "Todos" ("TD" abreviado), e a regra do rateio
 *  no título — pedido do Tiago. */
export function textoDaRegional(rateio, abreviada) {
  if (!rateio || rateio.length === 0) return { texto: "—", titulo: undefined };
  const ord = [...rateio].sort((a, b) => b[1] - a[1]);
  const nome = (r) => (abreviada ? SIGLA[r] ?? r.slice(0, 3).toUpperCase() : r);
  if (ord.length === 1) return { texto: nome(ord[0][0]), titulo: `${ord[0][0]} · 100%` };
  return {
    texto: abreviada ? "TD" : "Todos",
    titulo: `Rateio: ${ord.map(([r, p]) => `${r} ${String(p).replace(".", ",")}%`).join(" · ")}`,
    rateio: true,
  };
}

export function colunasDaRegional(forma) {
  return {
    comRegional: forma > 0,
    rotuloTrimestre: forma >= 2 ? "TRI" : "Trimestre",
    larguraTrimestre: forma >= 2 ? 58 : 104,
    rotuloRegional: forma === 4 ? "REG" : "Regional",
    larguraRegional: forma === 4 ? 64 : forma === 3 ? 100 : 116,
    abreviada: forma >= 3,
  };
}

/** A versão alternativa leva tudo da recomendada; muda só o desenho da
 *  Conciliação automática (seções da recomendada, colunas da pedida). */
export function comoRecomendada(v) {
  return v === "recomendada" || v === "alternativa";
}

// ---------------------------------------------------------------------------
// Cartão de crédito (decisões 031, 032, 084 e 093)
// ---------------------------------------------------------------------------

// As faturas como estão agora: o App registra a cada mudança, para a
// regional e o ⓘ da fatura acharem os itens dela.
let faturasVivas = [];
export function registrarFaturas(fs) {
  faturasVivas = fs;
}
export function itensDaFatura(faturaId) {
  return faturasVivas.find((f) => f.id === faturaId)?.itens ?? [];
}
export function faturaPorId(faturaId) {
  return faturasVivas.find((f) => f.id === faturaId) ?? null;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-10" → "out/26". */
export function rotuloCompetencia(comp) {
  const [a, m] = comp.split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
}
const iso = (a, m, d) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const somaMes = (a, m, n) => {
  const t = a * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
};

/** A fatura em que um pagamento no cartão cai (garantir_fatura_aberta_do_cartao):
 *  depois do dia do fechamento, vai para o mês seguinte; o vencimento cai no
 *  mês seguinte ao fechamento quando o dia dele é menor ou igual ao do
 *  fechamento. Competência já fechada ou paga empurra para a próxima. */
export function faturaDestino(cartao, data, faturas = []) {
  let [a, m] = data.split("-").map(Number);
  const dia = Number(data.slice(8, 10));
  if (dia > cartao.fechamento) [a, m] = somaMes(a, m, 1);
  for (let i = 0; i < 24; i++) {
    const competencia = iso(a, m, 1).slice(0, 7);
    const existente = faturas.find((f) => f.cartao === cartao.id && f.competencia === competencia);
    if (!existente || existente.status === "aberta") {
      const [av, mv] = cartao.vencimento <= cartao.fechamento ? somaMes(a, m, 1) : [a, m];
      return {
        competencia,
        fecha: iso(a, m, cartao.fechamento),
        vence: iso(av, mv, cartao.vencimento),
        existente: existente ?? null,
        pulou: i > 0,
      };
    }
    [a, m] = somaMes(a, m, 1);
  }
  return null;
}

/** As datas de uma competência do cartão: fechamento e vencimento. */
function datasDaCompetencia(cartao, a, m) {
  const [av, mv] = cartao.vencimento <= cartao.fechamento ? somaMes(a, m, 1) : [a, m];
  return { competencia: iso(a, m, 1).slice(0, 7), fecha: iso(a, m, cartao.fechamento), vence: iso(av, mv, cartao.vencimento) };
}

/** As faturas que a baixa no cartão pode escolher (pedido do Tiago,
 *  20/10/2026): as abertas do cartão, a da data do pagamento se ainda não
 *  existir, e a competência seguinte à última, para a compra que o banco
 *  lançou na próxima. Fechada e paga não recebem item. `padrao` marca a da
 *  data do pagamento. */
export function opcoesDeFatura(cartao, faturas, destino) {
  const doCartao = faturas.filter((f) => f.cartao === cartao.id);
  const ops = doCartao.filter((f) => f.status === "aberta").map((f) => ({ id: f.id, competencia: f.competencia, fecha: f.fecha, vence: f.vence, existente: f }));
  if (destino && !destino.existente && !ops.some((o) => o.competencia === destino.competencia))
    ops.push({ id: `nova-${destino.competencia}`, competencia: destino.competencia, fecha: destino.fecha, vence: destino.vence, existente: null });
  ops.sort((a, b) => a.competencia.localeCompare(b.competencia));
  const ultima = ops[ops.length - 1]?.competencia ?? destino?.competencia;
  if (ultima) {
    const [a, m] = somaMes(Number(ultima.slice(0, 4)), Number(ultima.slice(5, 7)), 1);
    const prox = datasDaCompetencia(cartao, a, m);
    if (!doCartao.some((f) => f.competencia === prox.competencia)) ops.push({ id: `nova-${prox.competencia}`, ...prox, existente: null });
  }
  return ops.map((o) => ({ ...o, padrao: o.competencia === destino?.competencia }));
}

/** O rateio de regional dos itens da fatura, ponderado pelo valor. */
export function rateioDosItens(itens) {
  const soma = {};
  let total = 0;
  itens.forEach((i) => {
    const v = Math.abs(i.valor);
    regionalDe({ job: i.job, empresa: i.empresa, origem: i.tipo }).forEach(([r, p]) => {
      soma[r] = (soma[r] ?? 0) + (v * p) / 100;
    });
    total += v;
  });
  if (!total) return [];
  return Object.entries(soma)
    .map(([r, v]) => [r, Math.round((v / total) * 10000) / 100])
    .sort((x, y) => y[1] - x[1]);
}

/** Total da fatura: compras − estornos + ajustes. */
export function totalDosItens(itens) {
  return r2(itens.reduce((s, i) => s + i.valor, 0));
}

/** O centro de custo da fatura, item a item, somado por tipo · subtipo. */
export function centrosDosItens(itens) {
  const m = new Map();
  itens.forEach((i) => {
    const k = `${i.centro.tipo} · ${i.centro.sub}`;
    m.set(k, r2((m.get(k) ?? 0) + i.valor));
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Em que coluna o valor vai, nos módulos (Contas a Pagar, Impostos, Contas a
// Receber). Duas regras para comparar (pedido do Tiago, 20/10/2026):
//   "dre"   — a pedida: o que abate a despesa (estorno de verba) ou o custo
//             (BV) vai com sinal de menos na coluna da despesa, o Débito;
//   "banco" — a recomendada: a coluna é a do banco, como o Extrato vai
//             mostrar; o DRE fica no centro de custo.
// ---------------------------------------------------------------------------
export function celulaDoModulo(t, modulo, regra) {
  if (t.origem === "transferencia") return { coluna: regra === "banco" ? "ambas" : "debito", sinal: 1, fora: true };
  if (regra === "banco") return { coluna: entra(t) ? "credito" : "debito", sinal: 1, fora: false };
  if (modulo === "pagar") return { coluna: "debito", sinal: t.entra ? -1 : 1, fora: false };
  if (t.bv) return { coluna: "debito", sinal: -1, fora: false };
  return { coluna: "credito", sinal: 1, fora: false };
}
