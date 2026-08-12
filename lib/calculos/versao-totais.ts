import type { TipoCusto, VersaoOrcamentoItem } from "@/lib/types";

/**
 * Regra de cada tipo de custo, como matriz de alavancas.
 *
 * As quatro colunas são as únicas perguntas que o fechamento faz sobre um
 * item. Manter isso como DADO, e não como `if` espalhado, é o que permitiu
 * subdividir A e F sem reescrever a conta: tipo novo é uma linha a mais.
 *
 * Validado contra a planilha oficial "[INT] SJ PEPSI CG - NE - 2026" em
 * 11/08/2026 — as 5 abas batem em honorários, imposto e valor do job.
 */
export interface RegraTipoCusto {
  /** O principal entra no **faturamento previsto** — o que a California
   *  emite nota. Falso quando o cliente paga o fornecedor diretamente. */
  fatura: boolean;
  /** O principal entra no **valor do job** — o compromisso total do
   *  cliente, somando o que passa pela agência e o que vai direto. */
  valorJob: boolean;
  /** Entra na base de honorários (aplicada sobre o principal). */
  honorarios: boolean;
  /** Entra na base de imposto (junto com os honorários, em gross-up). */
  imposto: boolean;
}

export const REGRAS_TIPO_CUSTO: Record<TipoCusto, RegraTipoCusto> = {
  // A · Direto — cliente paga o fornecedor direto; agência fatura só o honorário.
  A: { fatura: false, valorJob: true, honorarios: true, imposto: false },
  // A · Repasse — mesmo A, mas o principal passa pela California.
  AR: { fatura: true, valorJob: true, honorarios: true, imposto: false },
  // B · Bi-tributação — faturamento via California, imposto sobre o custo.
  B: { fatura: true, valorJob: true, honorarios: true, imposto: true },
  // C · Sem honorários — contrato específico; imposto sim, honorário não.
  C: { fatura: true, valorJob: true, honorarios: false, imposto: true },
  // D · Interno — direto ao fornecedor e fora até do valor do job.
  D: { fatura: false, valorJob: false, honorarios: true, imposto: false },
  // F · Externo — hoje espelha o A · Direto.
  F: { fatura: false, valorJob: true, honorarios: true, imposto: false },
  // F · Interno — como o F · Externo, mas sem honorários da agência.
  FI: { fatura: false, valorJob: true, honorarios: false, imposto: false },
};

/**
 * Ordem de exibição dos tipos, igual à do enum no Postgres.
 *
 * Tupla literal (e não `Object.keys`) porque `z.enum` exige tupla — assim os
 * schemas de validação e as telas leem da mesma lista.
 */
export const TIPOS_CUSTO = [
  "A",
  "AR",
  "B",
  "C",
  "D",
  "F",
  "FI",
] as const satisfies readonly TipoCusto[];

// Guarda de exaustividade: se um tipo novo entrar em `TipoCusto` e alguém
// esquecer de listá-lo acima, isto para de compilar em vez de sumir das
// telas silenciosamente.
type TipoForaDaLista = Exclude<TipoCusto, (typeof TIPOS_CUSTO)[number]>;
const _todosOsTiposListados: TipoForaDaLista extends never
  ? true
  : ["Falta tipo em TIPOS_CUSTO"] = true;
void _todosOsTiposListados;

/**
 * Agrupamento de EXIBIÇÃO do fechamento por tipo de custo.
 *
 * A conta continua por tipo — A · Direto e A · Repasse têm alavancas
 * diferentes em `REGRAS_TIPO_CUSTO` (um fatura pela California, o outro
 * não), e o mesmo vale para F · Externo e F · Interno. O que muda aqui é só
 * a leitura do fechamento: quem olha o painel quer o custo A e o custo F
 * fechados, não a quebra interna deles.
 *
 * Fonte única das linhas do "Fechamento do orçado · por tipo de custo" nas
 * quatro telas que mostram esse bloco (versão do orçamento, projeto do
 * orçamento, projeto de jobs e realizado do job).
 */
export const LINHAS_FECHAMENTO_POR_TIPO = [
  { chave: "A", label: "Custo A", tipos: ["A", "AR"] },
  { chave: "B", label: "B · Bi-trib.", tipos: ["B"] },
  { chave: "C", label: "C · Sem honor.", tipos: ["C"] },
  { chave: "D", label: "D · Interno", tipos: ["D"] },
  { chave: "F", label: "Custo F", tipos: ["F", "FI"] },
] as const satisfies ReadonlyArray<{
  chave: string;
  label: string;
  tipos: readonly TipoCusto[];
}>;

// Mesma guarda de exaustividade de `TIPOS_CUSTO`: tipo novo que ninguém
// encaixar numa linha some do fechamento sem avisar. Aqui isso vira erro de
// compilação.
type TipoForaDoFechamento = Exclude<
  TipoCusto,
  (typeof LINHAS_FECHAMENTO_POR_TIPO)[number]["tipos"][number]
>;
const _todosOsTiposNoFechamento: TipoForaDoFechamento extends never
  ? true
  : ["Falta tipo em LINHAS_FECHAMENTO_POR_TIPO"] = true;
void _todosOsTiposNoFechamento;

/** Soma os subtotais dos tipos que compõem uma linha do fechamento. */
export function somarLinhaFechamento(
  subtotaisPorTipo: Record<TipoCusto, number>,
  tipos: readonly TipoCusto[],
): number {
  return tipos.reduce((s, t) => s + (subtotaisPorTipo[t] ?? 0), 0);
}

/**
 * Tipos em que o cliente paga o fornecedor diretamente — os únicos que
 * admitem BV. Espelha o trigger `bv_exige_item_com_bv` no Postgres; mudar
 * aqui sem mudar lá deixa a tela oferecendo um BV que o banco recusa.
 *
 * A · Repasse fica de fora de propósito: nele o dinheiro passa pela
 * California, então não há comissão direta a negociar. F também não tem BV.
 */
export const TIPOS_COM_BV: readonly TipoCusto[] = ["A", "D"];

/** `true` quando o tipo aceita BV. Recebe `string` porque o tipo costuma
 *  chegar do banco ou de um `<select>` sem narrowing. */
export function aceitaBV(tipo: string): boolean {
  return (TIPOS_COM_BV as readonly string[]).includes(tipo);
}

export interface VersaoTotais {
  /** Soma dos totais por tipo. */
  subtotaisPorTipo: Record<TipoCusto, number>;
  /** Soma geral de todos os itens — o custo, independente de quem fatura. */
  subtotalGeral: number;
  /** Base sobre a qual incidem honorários. */
  baseHonorarios: number;
  /** Base sobre a qual incide o imposto (inclui os honorários). */
  baseImposto: number;
  /** Honorários calculados: baseHonorarios × %honor. */
  honorarios: number;
  /** Imposto em regime gross-up: base × taxa / (1 − taxa). */
  imposto: number;
  /**
   * **Faturamento previsto** — o que a California emite nota.
   * Só o principal dos tipos com `fatura: true`, mais honorários e imposto.
   */
  faturamentoPrevisto: number;
  /**
   * **Valor do job** — o compromisso total do cliente, somando o que passa
   * pela agência e o que ele paga direto ao fornecedor. É o número que a
   * planilha oficial chama de FATURAMENTO.
   */
  valorJob: number;
}

/**
 * Fechamento da versão do orçamento (e da cópia orçada do job, que tem a
 * mesma forma).
 *
 * - **Honorários** incidem sobre os tipos com `honorarios: true`.
 * - **Imposto** usa (tipos com `imposto: true`) + honorários, em gross-up:
 *   a agência precisa faturar bruto o bastante para que, depois do imposto
 *   descontado, sobre exatamente a base líquida —
 *      imposto = base × taxa / (1 − taxa).
 *   Com %imp = 19,53 a taxa é 0,1953 e o multiplicador ≈ 0,2427.
 * - **Faturamento previsto** e **valor do job** compartilham honorários e
 *   imposto; mudam só em quais principais entram.
 */
export function calcularTotaisVersao(
  // Aceita tanto o item da versão quanto a cópia orçada do job — as duas
  // têm tipo de custo e total, que é tudo que a conta precisa.
  itens: Array<Pick<VersaoOrcamentoItem, "tipo_custo" | "total_orcado">>,
  percentualHonorarios: number,
  percentualImposto: number,
): VersaoTotais {
  const subtotaisPorTipo = Object.fromEntries(
    TIPOS_CUSTO.map((t) => [t, 0]),
  ) as Record<TipoCusto, number>;

  for (const it of itens) {
    // Tipo desconhecido (dado antigo ou enum novo ainda não mapeado) não
    // pode virar `undefined + n = NaN` e contaminar a tela inteira.
    if (subtotaisPorTipo[it.tipo_custo] === undefined) continue;
    subtotaisPorTipo[it.tipo_custo] += Number(it.total_orcado ?? 0);
  }

  const somarOnde = (lever: keyof RegraTipoCusto) =>
    TIPOS_CUSTO.reduce(
      (s, t) => (REGRAS_TIPO_CUSTO[t][lever] ? s + subtotaisPorTipo[t] : s),
      0,
    );

  const subtotalGeral = TIPOS_CUSTO.reduce(
    (s, t) => s + subtotaisPorTipo[t],
    0,
  );

  const baseHonorarios = somarOnde("honorarios");
  const honorarios = baseHonorarios * (percentualHonorarios / 100);

  const baseImposto = somarOnde("imposto") + honorarios;
  const taxa = Math.max(0, Math.min(0.9999, percentualImposto / 100));
  const imposto = taxa > 0 ? (baseImposto * taxa) / (1 - taxa) : 0;

  return {
    subtotaisPorTipo,
    subtotalGeral,
    baseHonorarios,
    baseImposto,
    honorarios,
    imposto,
    faturamentoPrevisto: somarOnde("fatura") + honorarios + imposto,
    valorJob: somarOnde("valorJob") + honorarios + imposto,
  };
}

/**
 * Efeito de UM item quando seu total e/ou tipo de custo mudam por errata.
 *
 * Honorários e imposto incidem sobre SOMAS, e as duas fórmulas são lineares
 * nelas — então o efeito de cada item é exato e a soma dos efeitos
 * individuais fecha com o delta total da errata. É isso que permite mostrar
 * "efeito" linha a linha.
 *
 * Devolve os dois números porque a mudança de tipo pode mexer num sem mexer
 * no outro: trocar A · Direto por A · Repasse move o faturamento previsto e
 * deixa o valor do job intacto.
 */
export function calcularEfeitoDaMudanca(
  de: { total: number; tipoCusto: TipoCusto },
  para: { total: number; tipoCusto: TipoCusto },
  percentualHonorarios: number,
  percentualImposto: number,
): { faturamentoPrevisto: number; valorJob: number } {
  const h = percentualHonorarios / 100;
  const taxa = Math.max(0, Math.min(0.9999, percentualImposto / 100));

  const delta = (lever: keyof RegraTipoCusto) =>
    (REGRAS_TIPO_CUSTO[para.tipoCusto]?.[lever] ? para.total : 0) -
    (REGRAS_TIPO_CUSTO[de.tipoCusto]?.[lever] ? de.total : 0);

  const deltaHonorarios = delta("honorarios") * h;
  const deltaBaseImposto = delta("imposto") + deltaHonorarios;
  const deltaImposto = taxa > 0 ? (deltaBaseImposto * taxa) / (1 - taxa) : 0;
  const comum = deltaHonorarios + deltaImposto;

  return {
    faturamentoPrevisto: delta("fatura") + comum,
    valorJob: delta("valorJob") + comum,
  };
}

/**
 * Rentabilidade de um bloco: o que sobra do orçado depois de descontar o
 * custo (planejado OU realizado). Percentual sempre sobre o **orçado**, que
 * é a base usada na tela da versão do orçamento — o mesmo rótulo precisa
 * significar a mesma coisa nas duas telas.
 *
 * Retorna `percentual: null` quando não há custo lançado (sem base =
 * travessão, em vez de um "100%" que só diz que ninguém preencheu nada).
 */
export function calcularRentabilidade(
  orcado: number,
  custo: number,
): { rentabilidade: number; percentual: number | null } {
  const rentabilidade = orcado - custo;
  const percentual =
    custo > 0 && orcado > 0 ? (rentabilidade / orcado) * 100 : null;
  return { rentabilidade, percentual };
}

/**
 * Rentabilidade simples: soma dos totais orçados menos soma dos totais
 * planejados. Percentual em relação ao total orçado.
 *
 * Retorna `percentualRentabilidade: null` quando não há planejado (não
 * planejado = mostrar travessão em vez de "100%").
 */
export function calcularTotaisPlanejados(
  itens: Array<Pick<VersaoOrcamentoItem, "total_orcado" | "total_planejado">>,
): {
  totalOrcado: number;
  totalPlanejado: number;
  rentabilidade: number;
  percentualRentabilidade: number | null;
} {
  const totalOrcado = itens.reduce(
    (sum, it) => sum + Number(it.total_orcado ?? 0),
    0,
  );
  const totalPlanejado = itens.reduce(
    (sum, it) => sum + Number(it.total_planejado ?? 0),
    0,
  );
  const { rentabilidade, percentual: percentualRentabilidade } =
    calcularRentabilidade(totalOrcado, totalPlanejado);

  return { totalOrcado, totalPlanejado, rentabilidade, percentualRentabilidade };
}

/**
 * Resultado da versão sob a ótica do desembolso esperado pela agência.
 *
 * - Resultado operacional = valor do job − impostos − custo planejado.
 * - Resultado geral = resultado operacional ÷ valor do job (em %).
 *
 * A base é o **valor do job**, não o faturamento previsto: o custo que
 * entra na conta é o do job inteiro, então a receita também precisa ser a
 * do job inteiro. Usar o faturamento previsto aqui faria o resultado cair
 * pelo valor dos custos pagos direto ao fornecedor, que a agência nem
 * desembolsa (decisão do Tiago em 11/08/2026).
 *
 * Sem planejado lançado a conta não existe: retorna `null` nos dois campos
 * em vez de um número inflado (receita inteira virando "lucro").
 *
 * Fonte única do card de Totais e do resumo do cabeçalho da versão.
 */
export function calcularResultadoOperacional(
  valorJob: number,
  imposto: number,
  custoPlanejado: number,
): { resultadoOperacional: number | null; resultadoGeral: number | null } {
  if (custoPlanejado <= 0) {
    return { resultadoOperacional: null, resultadoGeral: null };
  }
  const resultadoOperacional = valorJob - imposto - custoPlanejado;
  const resultadoGeral =
    valorJob > 0 ? (resultadoOperacional / valorJob) * 100 : null;
  return { resultadoOperacional, resultadoGeral };
}

/**
 * Soma dos totais realizados por item.
 * Usado pelo card de Totais do job e por subtotal do grupo.
 */
export function calcularTotaisRealizado(
  itens: { total_realizado: number }[],
): { totalRealizado: number } {
  const totalRealizado = itens.reduce(
    (s, i) => s + Number(i.total_realizado ?? 0),
    0,
  );
  return { totalRealizado };
}

/**
 * Variacao Realizado vs Planejado.
 * - variacaoRS: realizado - planejado (positivo = estouro; negativo = economia)
 * - variacaoPct: relativo ao planejado. null quando planejado eh 0 (sem base).
 */
export function calcularVariacao(
  realizado: number,
  planejado: number,
): { variacaoRS: number; variacaoPct: number | null } {
  const variacaoRS = realizado - planejado;
  const variacaoPct = planejado > 0 ? (variacaoRS / planejado) * 100 : null;
  return { variacaoRS, variacaoPct };
}
