/**
 * A planilha de títulos (decisão 195, task 029 fase 1): os títulos a pagar,
 * a receber, os impostos e as transferências nas colunas do Extrato — Data ·
 * Crédito · Débito · (Saldo previsto) · Descrição · Fornecedor/Cliente · Job
 * · Centro de Custo · TRI · Empresa · REG · Ação —, em Conciliação › Títulos,
 * Contas a Pagar, Contas a Receber e Impostos a Pagar.
 *
 * Aqui mora a linha num formato só, que cada tela monta a partir do seu
 * próprio título, e as regras puras da planilha: em que coluna vai o valor,
 * a sigla da regional, o trimestre, o saldo previsto, os totais e o
 * agrupamento por dia. Vale no servidor, no cliente e no teste.
 *
 * Protótipo aprovado (versão Alternativa):
 * `docs/handoffs/2026-10-21-conciliacao-com-o-banco/prototipo/src/logica.js`
 * (`celulaDoModulo`, `textoDaRegional`, `comSaldoPrevisto`) e `titulos.jsx`.
 */

import type { SituacaoVerba } from "@/lib/types";

// ---------------------------------------------------------------------------
// A linha
// ---------------------------------------------------------------------------

export type LadoDaPlanilha = "pagar" | "receber" | "imposto" | "transferencia";

export type OrigemDaPlanilha =
  | "pp"
  | "avulso"
  | "recorrencia"
  | "folha"
  | "desembolso"
  | "verba"
  | "fatura"
  | "nf"
  | "recebimento_avulso"
  | "rendimento"
  | "transferencia"
  | "imposto";

/** Uma regional e quanto dela cabe ao título. */
export interface ParteDoRateio {
  regional: string;
  percentual: number;
}

/** O que a coluna Centro de Custo mostra. */
export type CentroDaLinha =
  /** O tipo do plano ("02 · Custo Operacional") e, na dica, o centro
   *  inteiro com o subtipo quando há. */
  | { tipo: "plano"; rotulo: string; completo: string }
  /** O desembolso e a nota sem plano: o centro se escolhe na baixa. */
  | { tipo: "definir_na_baixa" }
  /** A transferência entre contas. */
  | { tipo: "fora_do_dre" }
  /** A fatura do cartão: o pagamento fica fora do DRE; os itens entram,
   *  cada um no seu centro (decisão 084). */
  | { tipo: "itens_da_fatura"; centros: Array<{ rotulo: string; valor: number }> };

export type StatusDaLinha =
  | "a_pagar"
  | "parcial"
  | "pago"
  | "no_cartao"
  | "a_devolver"
  | "devolvido"
  | "em_aberto"
  | "inadimplente"
  | "recebido"
  | "a_transferir"
  | "transferido"
  | "vencido"
  | "cancelado";

/** O valor destrinchado do ícone ao lado do valor (retenção e baixa
 *  parcial): o bruto, cada retenção, o que já foi baixado e o que falta. */
export interface ValorDaLinha {
  bruto: number;
  /** O que já voltou por estorno de baixa (decisão 120). */
  estornado: number;
  /** As retenções da aprovação da PP (título ainda sem baixa) ou as das
   *  baixas já feitas. Lista vazia sem retenção. */
  retencoes: Array<{ rotulo: string; valor: number }>;
  /** O que as baixas já quitaram (líquido + retido, decisão 125). */
  baixado: number;
  /** O que mexe na conta: em aberto, o que falta pelo líquido; pago, o
   *  líquido que saiu ou entrou. */
  conta: number;
}

/** Um item da fatura do cartão, embaixo da linha dela. */
export interface ItemDaFatura {
  id: string;
  data: string;
  /** Com sinal: compra positiva, estorno negativo. */
  valor: number;
  descricao: string;
  tipo: "pp" | "avulso" | "recorrencia" | "desembolso" | "estorno" | "ajuste";
  codigo: string | null;
  fornecedor: string | null;
  job: string | null;
  centro: { rotulo: string; completo: string } | null;
  empresa: string | null;
  rateio: ParteDoRateio[];
}

export type TomDaEtiqueta =
  | "neutro"
  | "violeta"
  | "azul"
  | "rosa"
  | "ambar"
  | "verde_agua"
  | "ardosia"
  | "vermelho"
  | "verde"
  | "ceu";

/**
 * A linha da planilha. Todos os campos são obrigatórios de propósito
 * (CLAUDE.md, "tipo de linha estreito"): quem monta a linha de uma origem
 * que não tem o dado manda o valor neutro explícito, e um campo novo não se
 * perde num `.map` sem o verificador avisar.
 */
export interface LinhaDaPlanilha {
  /** A mesma chave da baixa em lote das listas (`pagar|pp|<id>`…). */
  chave: string;
  lado: LadoDaPlanilha;
  origem: OrigemDaPlanilha;
  /** A data da coluna: a data prevista de pagamento ou de recebimento (o
   *  financeiro edita pelo lápis). */
  dataPrevista: string | null;
  /** O vencimento do documento, que nunca muda. É dele que conta o
   *  atraso. */
  vencimento: string | null;
  pagoEm: string | null;
  /** O dinheiro entra na conta: o a receber e o estorno de verba. */
  entra: boolean;
  /** A transferência entre contas: de onde sai e para onde vai. */
  transferencia: {
    origemContaId: string;
    destinoContaId: string;
    origemNome: string;
    destinoNome: string;
  } | null;
  /** A conta que o título já tem (o rendimento, que entra na conta da
   *  aplicação). `null` vale para qualquer conta. */
  contaFixa: string | null;
  valor: ValorDaLinha;
  descricao: string;
  etiqueta: { texto: string; tom: TomDaEtiqueta };
  /** O que vai embaixo da descrição, depois da etiqueta: "NF 602",
   *  "parcela 1/2", "DARF 1708 · 09/2026"… */
  complementos: string[];
  bv: boolean;
  contraparte: string;
  job: { codigo: string; nome: string } | null;
  /** Os jobs dos itens da fatura do cartão (vazio fora dela). */
  jobsDaFatura: string[];
  /** Os itens da fatura do cartão (vazio fora dela). */
  itensDaFatura: ItemDaFatura[];
  centro: CentroDaLinha;
  empresa: string | null;
  rateio: ParteDoRateio[];
  status: StatusDaLinha;
  /** Aprovado para pagar no cartão ("Nome ••••1234"): só a intenção
   *  (decisão 093). */
  cartaoPrevisto: string | null;
  /** O lápis da data prevista: só onde ele grava (PP, avulso, recorrência,
   *  folha e a nota a receber — decisão 195, D1). */
  editaData: boolean;
  /** A PP urgente (decisão 077), com a justificativa da aprovação, enquanto
   *  não paga. */
  urgente: { justificativa: string | null } | null;
  /** O asterisco ao lado do fornecedor: o cadastro mudou depois da PP
   *  (decisão 067). */
  avisoDaContraparte: string | null;
  /** A verba paga: o status é o da prestação (decisão 081). */
  situacaoDaVerba: SituacaoVerba | null;
  busca: string;
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** O que a linha faz com o saldo da conta: + entra, − sai, 0 não mexe
 *  nela (já paga, de outra conta). */
export function efeitoNaConta(l: LinhaDaPlanilha, contaId: string): number {
  if (l.pagoEm || l.status === "cancelado") return 0;
  const v = l.valor.conta;
  if (l.transferencia) {
    if (l.transferencia.origemContaId === contaId) return -v;
    if (l.transferencia.destinoContaId === contaId) return v;
    return 0;
  }
  if (l.contaFixa && l.contaFixa !== contaId) return 0;
  return l.entra ? v : -v;
}

/**
 * Em que coluna o valor vai (a regra "banco", aprovada em 20/10/2026): a
 * coluna é a do sentido do dinheiro no banco, como o Extrato vai mostrar; o
 * DRE fica no centro de custo. A transferência, nos módulos (sem conta),
 * aparece nas duas colunas e fica fora dos totais; na conta, cai na coluna
 * da perna daquela conta.
 */
export function colunaDoValor(
  l: LinhaDaPlanilha,
  contaId: string | null,
): { coluna: "credito" | "debito" | "ambas"; foraDoTotal: boolean } {
  if (l.transferencia) {
    if (contaId === null) return { coluna: "ambas", foraDoTotal: true };
    return {
      coluna: l.transferencia.destinoContaId === contaId ? "credito" : "debito",
      foraDoTotal: false,
    };
  }
  return { coluna: l.entra ? "credito" : "debito", foraDoTotal: false };
}

/** Os totais do rodapé. Só os títulos em aberto. Na conta, pelo efeito no
 *  saldo; nos módulos, pela coluna, com a transferência à parte. */
export function totalDaPlanilha(
  linhas: LinhaDaPlanilha[],
  contaId: string | null,
): { credito: number; debito: number; transferencias: number } {
  let credito = 0;
  let debito = 0;
  let transferencias = 0;
  for (const l of linhas) {
    if (l.pagoEm || l.status === "cancelado") continue;
    if (contaId !== null) {
      const e = efeitoNaConta(l, contaId);
      if (e > 0) credito += e;
      else debito -= e;
      continue;
    }
    const { coluna, foraDoTotal } = colunaDoValor(l, null);
    if (foraDoTotal) transferencias += l.valor.conta;
    else if (coluna === "credito") credito += l.valor.conta;
    else debito += l.valor.conta;
  }
  return { credito: r2(credito), debito: r2(debito), transferencias: r2(transferencias) };
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/** "T1" a "T4". */
export function trimestreDe(iso: string): string {
  const m = Number(iso.slice(5, 7));
  return m <= 3 ? "T1" : m <= 6 ? "T2" : m <= 9 ? "T3" : "T4";
}

/** A data em que o título mexe na conta: o vencido entra como hoje (é o
 *  que sai primeiro); o pago, na data da baixa. */
export function dataEfetiva(l: LinhaDaPlanilha, hoje: string): string {
  if (l.pagoEm) return l.pagoEm;
  const d = l.dataPrevista ?? hoje;
  return d < hoje ? hoje : d;
}

/** Dias entre duas datas ISO (b − a), pelo calendário. */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Como a célula Data conta o prazo (protótipo, 20/10/2026): vencido pelo
 *  vencimento do documento; a data prevista depois dele avisa o atraso;
 *  antes dele, só mostra o vencimento. */
export function situacaoDaData(
  l: LinhaDaPlanilha,
  hoje: string,
):
  | { tipo: "vencido"; dias: number }
  | { tipo: "depois_do_vencimento"; vencimento: string }
  | { tipo: "antes_do_vencimento"; vencimento: string }
  | { tipo: "em_dia" } {
  if (l.pagoEm) return { tipo: "em_dia" };
  const venc = l.vencimento ?? l.dataPrevista;
  if (venc && venc < hoje) return { tipo: "vencido", dias: diasEntre(venc, hoje) };
  if (venc && l.dataPrevista && l.dataPrevista > venc) return { tipo: "depois_do_vencimento", vencimento: venc };
  if (venc && l.dataPrevista && l.dataPrevista !== venc) return { tipo: "antes_do_vencimento", vencimento: venc };
  return { tipo: "em_dia" };
}

// ---------------------------------------------------------------------------
// O saldo previsto (só na Conciliação › Títulos)
// ---------------------------------------------------------------------------

const ORDEM_DO_LADO: Record<LadoDaPlanilha, number> = {
  receber: 0,
  transferencia: 1,
  imposto: 2,
  pagar: 3,
};

/** A ordem da planilha: data prevista (sem data por último); no mesmo dia,
 *  o que entra antes do que sai; depois a descrição. */
export function ordenarLinhas<L extends LinhaDaPlanilha>(linhas: L[]): L[] {
  return [...linhas].sort(
    (a, b) =>
      (a.dataPrevista ?? "9999-12-31").localeCompare(b.dataPrevista ?? "9999-12-31") ||
      ORDEM_DO_LADO[a.lado] - ORDEM_DO_LADO[b.lado] ||
      a.descricao.localeCompare(b.descricao, "pt-BR"),
  );
}

export type LinhaComSaldo<L extends LinhaDaPlanilha = LinhaDaPlanilha> = L & {
  /** O saldo da conta se cada título for baixado nela, na data prevista. */
  saldo: number;
  efeito: number;
};

/** O saldo previsto corrente, na ordem da planilha. Não muda com o filtro,
 *  como o Saldo do Extrato: quem filtra recebe as linhas já com o saldo. */
export function comSaldoPrevisto<L extends LinhaDaPlanilha>(
  linhas: L[],
  saldoHoje: number,
  contaId: string,
): Array<LinhaComSaldo<L>> {
  let s = saldoHoje;
  return ordenarLinhas(linhas).map((l) => {
    const efeito = efeitoNaConta(l, contaId);
    s = r2(s + efeito);
    return { ...l, saldo: s, efeito };
  });
}

/** Os títulos agrupados por dia (o vencido no dia de hoje), na ordem em
 *  que chegam. */
export function agruparPorDia<L extends LinhaDaPlanilha>(
  linhas: L[],
  hoje: string,
): Array<{ data: string; linhas: L[] }> {
  const grupos: Array<{ data: string; linhas: L[] }> = [];
  for (const l of linhas) {
    const d = dataEfetiva(l, hoje);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.data === d) ultimo.linhas.push(l);
    else grupos.push({ data: d, linhas: [l] });
  }
  return grupos;
}

// ---------------------------------------------------------------------------
// A regional (coluna REG)
// ---------------------------------------------------------------------------

/**
 * As siglas de até 3 letras (pedido do Tiago, 20/10/2026). As de 2 letras do
 * cadastro (NE, SP, NO, RJ, SS) ficam como são; o resto vira as 3 primeiras
 * letras em maiúscula (AMBEV vira AMB, Ventura vira VEN).
 */
const SIGLAS: Record<string, string> = {
  Doca: "DOC",
  Agency: "AGE",
  Hitlab: "HIT",
  Teste: "TES",
  "Teste 2": "TE2",
  "Teste 3": "TE3",
};

export function siglaDaRegional(nome: string): string {
  return SIGLAS[nome] ?? nome.slice(0, 3).toUpperCase();
}

function formatarPercentual(p: number): string {
  return `${String(r2(p)).replace(".", ",")}%`;
}

/** A mesma regional repetida (a guia de imposto rateia por empresa e
 *  regional) soma numa parte só; a ordem é do maior para o menor. */
export function juntarRateio(partes: ParteDoRateio[]): ParteDoRateio[] {
  const soma = new Map<string, number>();
  for (const p of partes) soma.set(p.regional, (soma.get(p.regional) ?? 0) + p.percentual);
  return [...soma.entries()]
    .map(([regional, percentual]) => ({ regional, percentual: r2(percentual) }))
    .sort((a, b) => b.percentual - a.percentual || a.regional.localeCompare(b.regional, "pt-BR"));
}

/**
 * O texto da célula REG: a sigla da regional; com rateio entre regionais,
 * "TD" (todas), e a regra do rateio na dica ("Rateio: NE 60% · SP 40%").
 */
export function textoDaRegional(rateio: ParteDoRateio[]): {
  texto: string;
  dica: string | null;
  rateado: boolean;
} {
  const partes = juntarRateio(rateio);
  if (partes.length === 0) return { texto: "—", dica: null, rateado: false };
  if (partes.length === 1) {
    return { texto: siglaDaRegional(partes[0].regional), dica: `${partes[0].regional} · 100%`, rateado: false };
  }
  return {
    texto: "TD",
    dica: `Rateio: ${partes.map((p) => `${p.regional} ${formatarPercentual(p.percentual)}`).join(" · ")}`,
    rateado: true,
  };
}

/**
 * O rateio ponderado pelo valor de cada parte: os itens da fatura do
 * cartão, os jobs de uma nota. Cada parte traz o seu próprio rateio.
 */
export function rateioPonderado(partes: Array<{ valor: number; rateio: ParteDoRateio[] }>): ParteDoRateio[] {
  const soma = new Map<string, number>();
  let total = 0;
  for (const p of partes) {
    const v = Math.abs(p.valor);
    if (v === 0 || p.rateio.length === 0) continue;
    for (const r of p.rateio) soma.set(r.regional, (soma.get(r.regional) ?? 0) + (v * r.percentual) / 100);
    total += v;
  }
  if (total === 0) return [];
  return juntarRateio(
    [...soma.entries()].map(([regional, v]) => ({ regional, percentual: Math.round((v / total) * 10_000) / 100 })),
  );
}

// ---------------------------------------------------------------------------
// O centro de custo da fatura, item a item
// ---------------------------------------------------------------------------

/** Os centros dos itens da fatura, somados por centro, do maior para o
 *  menor. */
export function centrosDosItens(itens: ItemDaFatura[]): Array<{ rotulo: string; valor: number }> {
  const m = new Map<string, number>();
  for (const i of itens) {
    const k = i.centro?.completo ?? "Sem centro de custo";
    m.set(k, r2((m.get(k) ?? 0) + i.valor));
  }
  return [...m.entries()].map(([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor);
}

/** Os jobs dos itens da fatura, sem repetir. */
export function jobsDosItens(itens: ItemDaFatura[]): string[] {
  return [...new Set(itens.map((i) => i.job).filter((j): j is string => !!j))];
}

// ---------------------------------------------------------------------------
// O filtro de vencimento (aba Títulos da conciliação)
// ---------------------------------------------------------------------------

export type FiltroVencimento = "vencidos" | "ate_hoje" | "proximos_7" | "todos";

/** Some `dias` a uma data ISO. */
export function somaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Vencidos (antes de hoje), até hoje (inclusive), os próximos 7 dias (de
 *  hoje a hoje + 7) e todos. Conta pelo vencimento do documento. */
export function casaVencimento(v: string | null, filtro: FiltroVencimento, hoje: string): boolean {
  if (filtro === "todos") return true;
  if (v === null) return false;
  if (filtro === "vencidos") return v < hoje;
  if (filtro === "ate_hoje") return v <= hoje;
  return v >= hoje && v <= somaDias(hoje, 7);
}

/** O último dia do mês de uma data ISO. */
export function fimDoMes(iso: string): string {
  const [a, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0, 10);
}
