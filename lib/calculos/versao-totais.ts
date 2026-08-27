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
  /** De quem sai o dinheiro do principal: "PP" quando a California paga o
   *  fornecedor (o custo vira Pedido de Produção e sai do caixa dela);
   *  "BV" quando o cliente paga o fornecedor direto. Quem monta previsão
   *  de desembolso filtra por "PP" — item de calha BV nunca gera previsão
   *  (docs/decisions/004).
   *
   *  NÃO é o mesmo que "tem BV": desde 13/08/2026 o A · Repasse paga o
   *  fornecedor pela California (calha "PP") **e** negocia comissão com
   *  ele (BV). Quem responde por BV é `TIPOS_COM_BV`, mais abaixo. */
  calha: "PP" | "BV";
}

export const REGRAS_TIPO_CUSTO: Record<TipoCusto, RegraTipoCusto> = {
  // A · Direto — cliente paga o fornecedor direto; agência fatura só o honorário.
  A: { fatura: false, valorJob: true, honorarios: true, imposto: false, calha: "BV" },
  // A · Repasse — mesmo A, mas o principal passa pela California.
  AR: { fatura: true, valorJob: true, honorarios: true, imposto: false, calha: "PP" },
  // B · Bi-tributação — faturamento via California, imposto sobre o custo.
  B: { fatura: true, valorJob: true, honorarios: true, imposto: true, calha: "PP" },
  // C · Sem honorários — contrato específico; imposto sim, honorário não.
  C: { fatura: true, valorJob: true, honorarios: false, imposto: true, calha: "PP" },
  // D · Interno — direto ao fornecedor e fora até do valor do job.
  D: { fatura: false, valorJob: false, honorarios: true, imposto: false, calha: "BV" },
  // F · Externo — hoje espelha o A · Direto.
  F: { fatura: false, valorJob: true, honorarios: true, imposto: false, calha: "PP" },
  // F · Interno — como o F · Externo, mas sem honorários da agência.
  FI: { fatura: false, valorJob: true, honorarios: false, imposto: false, calha: "PP" },
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

/**
 * Tipos cuja calha é PP — os únicos em que a California paga o fornecedor
 * e, portanto, os únicos que entram em previsão de desembolso
 * (docs/decisions/004). Derivado de `REGRAS_TIPO_CUSTO`: tipo novo com
 * `calha: "PP"` entra aqui sozinho.
 */
export const TIPOS_CALHA_PP: readonly TipoCusto[] = TIPOS_CUSTO.filter(
  (t) => REGRAS_TIPO_CUSTO[t].calha === "PP",
);

/** O planejado deste item sai do caixa da California? */
export function tipoGeraDesembolso(tipo: TipoCusto): boolean {
  return REGRAS_TIPO_CUSTO[tipo].calha === "PP";
}

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
  { chave: "A", label: "Sub-total A", tipos: ["A", "AR"] },
  { chave: "B", label: "Sub-total B", tipos: ["B"] },
  { chave: "C", label: "Sub-total C", tipos: ["C"] },
  { chave: "D", label: "Sub-total D", tipos: ["D"] },
  { chave: "F", label: "Sub-total F", tipos: ["F", "FI"] },
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
 * Tipos em que existe comissão a negociar com o fornecedor — os únicos
 * que admitem BV. Espelha o trigger `bv_exige_item_com_bv` no Postgres;
 * mudar aqui sem mudar lá deixa a tela oferecendo um BV que o banco
 * recusa.
 *
 * `A` e `D`: o cliente paga o fornecedor direto, e o que sobra para a
 * California é a comissão.
 *
 * `AR` entrou em 13/08/2026 (decisão do time). Ele é o único tipo com as
 * DUAS coisas na mesma linha: o principal passa pela California e é
 * repassado ao fornecedor — segue gerando Pedido de Produção, porque
 * `calha` continua "PP" — e ainda assim há comissão a negociar com esse
 * fornecedor. Antes disso o AR era o "só PP" da tabela.
 *
 * F e FI seguem sem BV.
 */
export const TIPOS_COM_BV: readonly TipoCusto[] = ["A", "AR", "D"];

/** `true` quando o tipo aceita BV. Recebe `string` porque o tipo costuma
 *  chegar do banco ou de um `<select>` sem narrowing. */
export function aceitaBV(tipo: string): boolean {
  return (TIPOS_COM_BV as readonly string[]).includes(tipo);
}

/**
 * Um item, do ponto de vista do fechamento.
 *
 * `em_save` e `save_consumido` são opcionais: item antigo, rascunho e
 * qualquer `.select()` que ainda não os carregue caem no caso sem save, em
 * que os três fechamentos coincidem e o resultado é o de sempre.
 */
export interface ItemParaTotais {
  tipo_custo: TipoCusto;
  total_orcado: number | string | null;
  /** Linha em SAVE — o cliente paga, o serviço não acontece neste projeto.
   *  Sai da base do VALOR DO JOB e permanece na do FATURAMENTO. */
  em_save?: boolean | null;
  /** Quanto desta linha é pago por saldo de save de outro job. Sai da base
   *  do FATURAMENTO (já foi faturado lá) e fica na do VALOR DO JOB. */
  save_consumido?: number | string | null;
}

/**
 * Um dos lados do fechamento. A conta é a mesma dos dois lados — o que
 * muda é o valor efetivo que cada item empresta a ela.
 */
export interface FechamentoLado {
  /** Valor efetivo somado por tipo de custo NESTE lado. */
  subtotaisPorTipo: Record<TipoCusto, number>;
  /** Soma de todos os valores efetivos deste lado. */
  base: number;
  baseHonorarios: number;
  honorarios: number;
  baseImposto: number;
  imposto: number;
  /** Soma dos principais que este lado reconhece. */
  principal: number;
  /** principal + honorários + imposto. */
  total: number;
}

/**
 * Como o orçado de cada tipo se reparte entre as três naturezas — a
 * quebra que o card de Totais mostra em três colunas.
 *
 * As três somam exatamente o subtotal do tipo, por construção:
 *   save usado + save gerado + custos do job = total orçado.
 */
export interface QuebraSave {
  /** Pago por saldo de save de outro job. */
  saveUsado: Record<TipoCusto, number>;
  /** Faturado aqui e guardado como crédito para outro projeto. */
  saveGerado: Record<TipoCusto, number>;
  /** O que este job de fato entrega e cobra. */
  custosDoJob: Record<TipoCusto, number>;
  totalSaveUsado: number;
  totalSaveGerado: number;
  totalCustosDoJob: number;
  /** O FATURAMENTO que as linhas em save geram — principal + honorários +
   *  imposto proporcionais. É o segundo número do save (decisão 023 §4):
   *  o crédito que o cliente tem a gastar é `totalSaveGerado`; este aqui é
   *  o que a nota cobra por causa delas, e é o que migra para quem
   *  consumir.
   *
   *  Sai de rodar o MESMO fechamento sobre a base do save sozinha. As
   *  duas fórmulas são lineares na base, então a fatia é exata e
   *  `receita + (fechamento sobre custos do job) = faturamento previsto`. */
  receita: number;
  /** Quantas linhas geram save, e quantas consomem. */
  itensEmSave: number;
  itensConsumindoSave: number;
}

export interface VersaoTotais {
  /** Soma CRUA dos totais por tipo — o custo, independente de save. */
  subtotaisPorTipo: Record<TipoCusto, number>;
  /** Soma geral de todos os itens. */
  subtotalGeral: number;

  /** O que a California emite nota: base = total − save consumido. */
  faturamento: FechamentoLado;
  /** O compromisso do cliente neste job: base = 0 quando a linha é save. */
  job: FechamentoLado;
  /** A conta como se o save não existisse. É o número de antes de
   *  24/08/2026, e é o que a planilha exportada ao cliente mostra —
   *  num orçamento de save o `job` é zero e o documento sairia vazio. */
  bruto: FechamentoLado;

  /** A repartição do orçado entre save usado, save gerado e custos. */
  save: QuebraSave;
  /** Orçado que serve de base à rentabilidade: o geral menos as linhas em
   *  save, que não têm custo planejado para comparar. */
  orcadoParaRentabilidade: number;

  // --- Campos planos, preservados. Apontam para o lado `job`.
  //
  // `imposto` é o embutido no VALOR DO JOB porque é ele que
  // `calcularResultadoOperacional(valorJob, imposto, custo)` precisa: a
  // conta é `valorJob − imposto − custo`, e o imposto do faturamento daria
  // margem errada em job com save.
  baseHonorarios: number;
  baseImposto: number;
  honorarios: number;
  imposto: number;
  /** **Faturamento previsto** — o que a California emite nota. */
  faturamentoPrevisto: number;
  /** **Valor do job** — o compromisso total do cliente. */
  valorJob: number;
}

const zerado = () =>
  Object.fromEntries(TIPOS_CUSTO.map((t) => [t, 0])) as Record<
    TipoCusto,
    number
  >;

/** Fecha UM lado: subtotais por tipo -> honorários -> imposto -> principal. */
function fecharLado(
  subtotaisPorTipo: Record<TipoCusto, number>,
  percentualHonorarios: number,
  percentualImposto: number,
): FechamentoLado {
  const somarOnde = (lever: keyof RegraTipoCusto) =>
    TIPOS_CUSTO.reduce(
      (s, t) => (REGRAS_TIPO_CUSTO[t][lever] ? s + subtotaisPorTipo[t] : s),
      0,
    );

  const base = TIPOS_CUSTO.reduce((s, t) => s + subtotaisPorTipo[t], 0);
  const baseHonorarios = somarOnde("honorarios");
  const honorarios = baseHonorarios * (percentualHonorarios / 100);
  const baseImposto = somarOnde("imposto") + honorarios;
  const taxa = Math.max(0, Math.min(0.9999, percentualImposto / 100));
  const imposto = taxa > 0 ? (baseImposto * taxa) / (1 - taxa) : 0;

  return {
    subtotaisPorTipo,
    base,
    baseHonorarios,
    honorarios,
    baseImposto,
    imposto,
    principal: 0, // preenchido por quem chama, que sabe qual alavanca usar
    total: 0,
  };
}

/** Aplica a alavanca de principal e fecha o total do lado. */
function comPrincipal(
  lado: FechamentoLado,
  lever: keyof RegraTipoCusto,
): FechamentoLado {
  const principal = TIPOS_CUSTO.reduce(
    (s, t) =>
      REGRAS_TIPO_CUSTO[t][lever] ? s + lado.subtotaisPorTipo[t] : s,
    0,
  );
  return { ...lado, principal, total: principal + lado.honorarios + lado.imposto };
}

/**
 * Fechamento da versão do orçamento (e da cópia orçada do job, que tem a
 * mesma forma).
 *
 * **A conta é uma só, rodada sobre duas bases** (decisão 023). Cada linha
 * empresta um valor diferente a cada lado:
 *
 *     base de faturamento  = total orçado − save consumido
 *     base de valor do job = está em save ? 0 : total orçado
 *
 * Sem nenhuma linha em save as duas bases são iguais ao total orçado, os
 * fechamentos coincidem, e o resultado é exatamente o de antes de
 * 24/08/2026 — é isso que garante que nenhum job existente muda de número.
 *
 * - **Honorários** incidem sobre os tipos com `honorarios: true`.
 * - **Imposto** usa (tipos com `imposto: true`) + honorários, em gross-up:
 *      imposto = base × taxa / (1 − taxa).
 *   Com %imp = 19,53 a taxa é 0,1953 e o multiplicador ≈ 0,2427.
 *
 * Validado contra a planilha oficial "[INT] SJ PEPSI CG - NE - 2026" em
 * 11/08/2026 e contra o design `Orcamento - Versao com Save.dc.html` em
 * 24/08/2026 — ver `scripts/conferir-save.ts`.
 */
export function calcularTotaisVersao(
  itens: ItemParaTotais[],
  percentualHonorarios: number,
  percentualImposto: number,
): VersaoTotais {
  const subtotaisPorTipo = zerado();
  const saveUsado = zerado();
  const saveGerado = zerado();
  const custosDoJob = zerado();
  let itensEmSave = 0;
  let itensConsumindoSave = 0;

  for (const it of itens) {
    // Tipo desconhecido (dado antigo ou enum novo ainda não mapeado) não
    // pode virar `undefined + n = NaN` e contaminar a tela inteira.
    if (subtotaisPorTipo[it.tipo_custo] === undefined) continue;

    const total = Number(it.total_orcado ?? 0);
    const emSave = it.em_save === true;
    // Consumo não pode passar do total da linha nem ser negativo: um dado
    // torto no banco viraria base negativa e imposto negativo.
    const consumido = emSave
      ? 0
      : Math.min(Math.max(Number(it.save_consumido ?? 0), 0), total);

    subtotaisPorTipo[it.tipo_custo] += total;

    if (emSave) {
      saveGerado[it.tipo_custo] += total;
      itensEmSave += 1;
    } else {
      saveUsado[it.tipo_custo] += consumido;
      custosDoJob[it.tipo_custo] += total - consumido;
      if (consumido > 0) itensConsumindoSave += 1;
    }
  }

  const somar = (r: Record<TipoCusto, number>) =>
    TIPOS_CUSTO.reduce((s, t) => s + r[t], 0);

  // As duas bases, montadas a partir da mesma quebra.
  const baseFaturamento = zerado();
  const baseValorJob = zerado();
  for (const t of TIPOS_CUSTO) {
    baseFaturamento[t] = saveGerado[t] + custosDoJob[t];
    baseValorJob[t] = saveUsado[t] + custosDoJob[t];
  }

  const faturamento = comPrincipal(
    fecharLado(baseFaturamento, percentualHonorarios, percentualImposto),
    "fatura",
  );
  const job = comPrincipal(
    fecharLado(baseValorJob, percentualHonorarios, percentualImposto),
    "valorJob",
  );
  const bruto = comPrincipal(
    fecharLado(subtotaisPorTipo, percentualHonorarios, percentualImposto),
    "valorJob",
  );

  const totalSaveGerado = somar(saveGerado);
  const subtotalGeral = somar(subtotaisPorTipo);

  // O faturamento atribuível às linhas em save. Mesmo `fecharLado`, sobre
  // a base do save sozinha — e não uma fórmula nova.
  const receitaDoSave = comPrincipal(
    fecharLado(saveGerado, percentualHonorarios, percentualImposto),
    "fatura",
  ).total;

  return {
    subtotaisPorTipo,
    subtotalGeral,
    faturamento,
    job,
    bruto,
    save: {
      saveUsado,
      saveGerado,
      custosDoJob,
      totalSaveUsado: somar(saveUsado),
      totalSaveGerado,
      totalCustosDoJob: somar(custosDoJob),
      receita: receitaDoSave,
      itensEmSave,
      itensConsumindoSave,
    },
    orcadoParaRentabilidade: subtotalGeral - totalSaveGerado,

    baseHonorarios: job.baseHonorarios,
    baseImposto: job.baseImposto,
    honorarios: job.honorarios,
    imposto: job.imposto,
    faturamentoPrevisto: faturamento.total,
    valorJob: job.total,
  };
}

/** Estado de um item para efeito de errata. */
export interface EstadoItemErrata {
  total: number;
  tipoCusto: TipoCusto;
  /** A linha gera save. */
  emSave?: boolean;
  /** Quanto da linha é pago por save de outro job. */
  saveConsumido?: number;
}

/** Os dois valores efetivos de um estado — as bases da decisão 023. */
function basesDoEstado(e: EstadoItemErrata): {
  faturamento: number;
  job: number;
} {
  if (e.emSave) return { faturamento: e.total, job: 0 };
  const consumido = Math.min(Math.max(e.saveConsumido ?? 0, 0), e.total);
  return { faturamento: e.total - consumido, job: e.total };
}

/**
 * Efeito de UM item quando seu total, tipo de custo, marca de save ou
 * consumo de save mudam por errata.
 *
 * Honorários e imposto incidem sobre SOMAS, e as duas fórmulas são lineares
 * nelas — então o efeito de cada item é exato e a soma dos efeitos
 * individuais fecha com o delta total da errata. É isso que permite mostrar
 * "efeito" linha a linha.
 *
 * Desde 24/08/2026 são **dois deltas independentes**, um por base: os dois
 * lados deixaram de compartilhar honorários e imposto, porque marcar uma
 * linha como save mexe num sem mexer no outro. A linearidade continua
 * valendo dentro de cada lado, então a propriedade que sustenta o card de
 * Erratas continua verdadeira para os dois números.
 *
 * Devolve os dois porque a mudança pode mexer só num: trocar A · Direto por
 * A · Repasse move o faturamento previsto e deixa o valor do job intacto;
 * marcar uma linha como save faz o contrário.
 */
export function calcularEfeitoDaMudanca(
  de: EstadoItemErrata,
  para: EstadoItemErrata,
  percentualHonorarios: number,
  percentualImposto: number,
): { faturamentoPrevisto: number; valorJob: number } {
  const h = percentualHonorarios / 100;
  const taxa = Math.max(0, Math.min(0.9999, percentualImposto / 100));

  const bDe = basesDoEstado(de);
  const bPara = basesDoEstado(para);

  const delta = (lado: "faturamento" | "job", lever: keyof RegraTipoCusto) =>
    (REGRAS_TIPO_CUSTO[para.tipoCusto]?.[lever] ? bPara[lado] : 0) -
    (REGRAS_TIPO_CUSTO[de.tipoCusto]?.[lever] ? bDe[lado] : 0);

  const fechar = (
    lado: "faturamento" | "job",
    leverPrincipal: keyof RegraTipoCusto,
  ) => {
    const deltaHonorarios = delta(lado, "honorarios") * h;
    const deltaBaseImposto = delta(lado, "imposto") + deltaHonorarios;
    const deltaImposto = taxa > 0 ? (deltaBaseImposto * taxa) / (1 - taxa) : 0;
    return delta(lado, leverPrincipal) + deltaHonorarios + deltaImposto;
  };

  return {
    faturamentoPrevisto: fechar("faturamento", "fatura"),
    valorJob: fechar("job", "valorJob"),
  };
}

/**
 * O faturamento que UMA linha em save gera no job de origem: principal +
 * honorários + imposto proporcionais (decisão 023 §4).
 *
 * É o **segundo** número do save. O primeiro é o saldo consumível, que é
 * só o principal. Os dois são verdadeiros e servem a coisas diferentes: o
 * saldo é o que o cliente tem a gastar; isto é o que a nota cobrou.
 *
 * Reaproveita `calcularEfeitoDaMudanca` de 0 até o total em vez de
 * reescrever a conta — a fatia de uma linha é exata porque as fórmulas são
 * lineares.
 *
 * R$ 30.000 tipo B a 10%/19,53% -> R$ 41.009,07.
 * A mesma linha tipo A -> R$ 3.728,10: o principal do A não passa pela
 * California, então só o honorário e o imposto dele migram.
 */
export function receitaDeFaturamentoDaLinha(
  total: number,
  tipoCusto: TipoCusto,
  percentualHonorarios: number,
  percentualImposto: number,
): number {
  return calcularEfeitoDaMudanca(
    { total: 0, tipoCusto },
    { total, tipoCusto },
    percentualHonorarios,
    percentualImposto,
  ).faturamentoPrevisto;
}

/**
 * Quanto da receita da origem migra para o job que consumiu, rateado pelo
 * consumo do **principal** (decisão 023 §4).
 *
 * Consumir R$ 25.000 de um saldo de R$ 30.000 cuja receita foi
 * R$ 41.009,07 migra R$ 34.174,23 — e o resto continua com a origem até
 * alguém consumir.
 */
export function receitaSaveMigrada(
  receitaOrigem: number,
  principal: number,
  consumido: number,
): number {
  if (!(principal > 0)) return 0;
  return receitaOrigem * (Math.min(consumido, principal) / principal);
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
