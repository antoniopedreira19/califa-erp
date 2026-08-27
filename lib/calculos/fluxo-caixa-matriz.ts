/**
 * A matriz período × natureza do fluxo de caixa, montada a partir das
 * linhas de `vw_fluxo_caixa`.
 *
 * Função PURA, e num módulo sem import de servidor, por dois motivos:
 *
 *   * a aba do job monta a matriz no servidor, com as linhas de um job;
 *   * a visão agregada do projeto monta no CLIENTE, e remonta a cada
 *     filtro de job ou de conta bancária — sem ida ao servidor, porque
 *     as linhas já desceram todas.
 *
 * As três classes vêm prontas da view (migration 20260817000006) e são o
 * que o protótipo desenha como sub-linhas de cada natureza:
 *
 *   movimento — dinheiro que já entrou ou saiu da conta
 *   titulo    — documento em aberto (PP, avulsa, título a receber)
 *   previsao  — a curva da abertura, ainda sem documento
 */

export type ClasseFluxo = "movimento" | "titulo" | "previsao";
export type NaturezaFluxo = "entrada" | "saida";

export const CLASSES_FLUXO: ClasseFluxo[] = [
  "movimento",
  "titulo",
  "previsao",
];

/** Uma linha da view, já normalizada. */
export interface LinhaFluxo {
  jobId: string;
  contaBancariaId: string | null;
  classe: ClasseFluxo;
  natureza: NaturezaFluxo;
  dataEvento: string;
  valor: number;
  /** Código do documento ("PP-00009 3/3", "NF 900123/2"). */
  codigo: string;
  descricao: string;
  /** `vw_fluxo_caixa.origem_tipo` — pp, titulo, previsao_custo, … */
  origemTipo: string;
  /**
   * `lancamentos_financeiros.origem`, só nas linhas de movimento.
   *
   * É o que distingue uma baixa de um estorno: as duas chegam como
   * `origem_tipo = 'lancamento'`, e sem isso o estorno de PP — que entra
   * como ENTRADA, porque o dinheiro volta para a conta — se lê como
   * recebimento de cliente.
   */
  origemLancamento: string | null;
}

/**
 * Um documento por trás de uma célula da matriz.
 *
 * A tela abre isso no hover e no clique de cada valor (decisão do Tiago,
 * 26/08/2026): o número sozinho não diz de onde veio, e na linha de
 * movimento convivem recebimento de cliente e estorno de PP, que somam
 * juntos mas não significam a mesma coisa.
 */
export interface ItemComposicao {
  chave: string;
  jobId: string;
  /** "Recebimento de título", "Estorno de PP", "Cronograma de desembolsos"… */
  rotulo: string;
  codigo: string;
  descricao: string;
  data: string;
  valor: number;
  /** Estorno recebe tratamento visual próprio na composição. */
  estorno: boolean;
  /**
   * A natureza da linha. Só importa na composição do LÍQUIDO, onde
   * entrada e saída convivem na mesma célula e uma subtrai a outra — nas
   * demais células a linha inteira já é de uma natureza só.
   */
  natureza: NaturezaFluxo;
}

/**
 * Chave de uma célula na composição.
 *
 * `liquido` é o escopo da linha "Líquido do período", que soma as duas
 * naturezas do mês; nele `classe` é sempre `total`.
 */
export function chaveComposicao(
  escopo: NaturezaFluxo | "liquido",
  classe: ClasseFluxo | "total",
  indiceMes: number,
): string {
  return `${escopo}-${classe}-${indiceMes}`;
}

const ROTULO_LANCAMENTO: Record<string, string> = {
  pp_baixa: "Baixa de PP",
  pp_baixa_estornada: "Baixa de PP (estornada)",
  pp_estorno: "Estorno de PP",
  titulo_baixa: "Recebimento de título",
  titulo_baixa_estornada: "Recebimento (estornado)",
  titulo_estorno: "Estorno de recebimento",
  avulsa_baixa: "Conta avulsa paga",
  avulsa_baixa_estornada: "Conta avulsa (estornada)",
  avulsa_estorno: "Estorno de conta avulsa",
  desembolso_baixa: "Desembolso pago",
  desembolso_baixa_estornada: "Desembolso (estornado)",
  desembolso_estorno: "Estorno de desembolso",
  manual: "Lançamento manual",
};

const ROTULO_ORIGEM: Record<string, string> = {
  pp: "PP a pagar",
  avulsa: "Conta avulsa",
  recorrente: "Conta recorrente",
  desembolso: "Desembolso",
  titulo: "Título a receber",
  previsao_custo: "Cronograma de desembolsos",
  previsao_recebimento: "Previsão de recebimento",
  envio_parcela: "Faturamento previsto",
};

/** O que a linha é, em português, para a composição da célula. */
export function rotuloDaLinha(l: LinhaFluxo): string {
  if (l.origemTipo === "lancamento") {
    return (
      ROTULO_LANCAMENTO[l.origemLancamento ?? ""] ?? "Movimento na conta"
    );
  }
  return ROTULO_ORIGEM[l.origemTipo] ?? l.origemTipo;
}

/**
 * Estorno é qualquer ponta do par que o estorno cria: o lançamento
 * original, que fica marcado `_estornada`, e o contra-lançamento.
 *
 * Os dois continuam somando na linha de movimento — o extrato da conta é
 * esse, o dinheiro saiu e voltou (decisão do Tiago, 26/08/2026). Quem
 * separa é a composição, não o total.
 */
export function ehEstorno(l: LinhaFluxo): boolean {
  const o = l.origemLancamento ?? "";
  return o.endsWith("_estorno") || o.endsWith("_estornada");
}

export interface DetalheFluxo {
  chave: string;
  jobId: string;
  codigo: string;
  descricao: string;
  vencimento: string;
  valor: number;
  situacao: string;
}

/** A contribuição de um job dentro de uma sub-linha, mês a mês. */
export interface ContribuicaoDeJob {
  jobId: string;
  valores: number[];
}

export interface MatrizFluxo {
  /** Colunas: "AAAA-MM", em ordem. */
  meses: string[];
  /** Índice do mês corrente; -1 quando fora da faixa. */
  indiceEmCurso: number;
  entradas: Record<ClasseFluxo, number[]>;
  saidas: Record<ClasseFluxo, number[]>;
  liquido: number[];
  saldo: number[];
  saldoHoje: number;
  saldoFim: number;
  ultimoMesLabel: string;
  detalhesReceber: DetalheFluxo[];
  detalhesPagar: DetalheFluxo[];
  /**
   * Chave `${natureza}-${classe}` → quanto cada job pôs naquela
   * sub-linha, mês a mês. É o que a visão agregada abre ao clicar.
   */
  porJob: Record<string, ContribuicaoDeJob[]>;
  /**
   * `chaveComposicao(natureza, classe, mês)` → os documentos que formam
   * aquela célula. Esparso: célula vazia não tem chave.
   *
   * Cada linha entra DUAS vezes — na chave da sua classe e na chave
   * `total` da natureza —, porque a tela mostra as duas e o usuário pode
   * abrir qualquer uma. São referências para o mesmo objeto, não cópias.
   */
  composicao: Record<string, ItemComposicao[]>;
}

/** "2026-08" → "08/2026", como o protótipo rotula a coluna. */
export function rotuloMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${m}/${ano}`;
}

function mesDe(iso: string): string {
  return iso.slice(0, 7);
}

export function montarMatrizFluxo(
  linhas: LinhaFluxo[],
  hoje: string,
): MatrizFluxo {
  const mesAtual = mesDe(hoje);

  // A faixa é a dos próprios eventos — do primeiro ao último —, e não uma
  // janela fixa: job de duas semanas não precisa de seis colunas, e
  // projeto de um ano não cabe nelas. O mês corrente entra sempre, porque
  // é a coluna "Em curso".
  const mesesComEvento = new Set(linhas.map((l) => mesDe(l.dataEvento)));
  mesesComEvento.add(mesAtual);
  const meses = preencherVaos([...mesesComEvento].sort());

  const indice = new Map(meses.map((m, i) => [m, i]));
  const zeros = () => meses.map(() => 0);

  const entradas = {
    movimento: zeros(),
    titulo: zeros(),
    previsao: zeros(),
  } as Record<ClasseFluxo, number[]>;
  const saidas = {
    movimento: zeros(),
    titulo: zeros(),
    previsao: zeros(),
  } as Record<ClasseFluxo, number[]>;

  const detalhesReceber: DetalheFluxo[] = [];
  const detalhesPagar: DetalheFluxo[] = [];
  const porJob: Record<string, ContribuicaoDeJob[]> = {};
  const composicao: Record<string, ItemComposicao[]> = {};

  linhas.forEach((l, ordem) => {
    const i = indice.get(mesDe(l.dataEvento));
    if (i === undefined) return;

    const alvo = l.natureza === "entrada" ? entradas : saidas;
    alvo[l.classe][i] += l.valor;

    const chave = `${l.natureza}-${l.classe}`;
    const lista = porJob[chave] ?? (porJob[chave] = []);
    let contrib = lista.find((c) => c.jobId === l.jobId);
    if (!contrib) {
      contrib = { jobId: l.jobId, valores: zeros() };
      lista.push(contrib);
    }
    contrib.valores[i] += l.valor;

    const item: ItemComposicao = {
      // `ordem` entra na chave porque o mesmo documento pode aparecer
      // duas vezes na mesma célula — a parcela 3/3 da PP-00009 foi
      // baixada e estornada duas vezes, no mesmo dia e no mesmo valor.
      chave: `${l.jobId}-${l.codigo}-${l.dataEvento}-${ordem}`,
      jobId: l.jobId,
      rotulo: rotuloDaLinha(l),
      codigo: l.codigo,
      descricao: l.descricao,
      data: l.dataEvento,
      valor: l.valor,
      estorno: ehEstorno(l),
      natureza: l.natureza,
    };
    for (const k of [
      chaveComposicao(l.natureza, l.classe, i),
      chaveComposicao(l.natureza, "total", i),
      // O líquido do período é entradas menos saídas: a composição dele
      // é o mês inteiro, das duas naturezas, e o sinal é quem separa.
      chaveComposicao("liquido", "total", i),
    ]) {
      (composicao[k] ?? (composicao[k] = [])).push(item);
    }

    if (l.classe === "titulo") {
      const detalhe: DetalheFluxo = {
        chave: `${l.jobId}-${l.codigo}-${l.dataEvento}-${detalhesReceber.length + detalhesPagar.length}`,
        jobId: l.jobId,
        codigo: l.codigo,
        descricao: l.descricao,
        vencimento: l.dataEvento,
        valor: l.valor,
        situacao: l.dataEvento < hoje ? "Vencido" : "Em aberto",
      };
      if (l.natureza === "entrada") detalhesReceber.push(detalhe);
      else detalhesPagar.push(detalhe);
    }
  });

  // Dentro de cada célula: entradas antes de saídas, e o mais recente
  // primeiro. A ordem por natureza só muda alguma coisa na célula do
  // líquido, a única onde as duas convivem — nas demais a chave já é de
  // uma natureza só e a comparação é inócua.
  for (const itens of Object.values(composicao)) {
    itens.sort((a, b) => {
      if (a.natureza !== b.natureza) return a.natureza === "entrada" ? -1 : 1;
      return a.data < b.data ? 1 : a.data > b.data ? -1 : 0;
    });
  }

  const liquido = meses.map(
    (_, i) =>
      CLASSES_FLUXO.reduce((s, c) => s + entradas[c][i], 0) -
      CLASSES_FLUXO.reduce((s, c) => s + saidas[c][i], 0),
  );

  let acumulado = 0;
  const saldo = liquido.map((v) => (acumulado += v));

  const indiceEmCurso = indice.get(mesAtual) ?? -1;

  // Saldo de HOJE: só o que passou pela conta, e só até hoje.
  //
  // Decisão do Tiago, 26/08/2026. Era o acumulado da COLUNA do mês
  // corrente, somando as três classes — e por isso engolia a previsão
  // rolada. A previsão vencida sem documento rola para frente (decisão
  // 018 §3): a do JOB-0013 caiu em 27/08, amanhã, mas ainda dentro de
  // agosto, então a coluna a incluía e o card mostrava R$ 104.064,87
  // "já movimentados" num job sem um centavo na conta.
  //
  // A régua passa a ser a que o subtítulo do card sempre prometeu:
  // entradas menos saídas JÁ MOVIMENTADAS. Título em aberto fica de
  // fora mesmo vencido — a PP não paga não é dinheiro que saiu.
  //
  // Contado direto das linhas, e não pela matriz, para não depender do
  // recorte mensal nem do teto de 36 colunas.
  let saldoHoje = 0;
  for (const l of linhas) {
    if (l.classe !== "movimento") continue;
    if (l.dataEvento.slice(0, 10) > hoje) continue;
    saldoHoje += l.natureza === "entrada" ? l.valor : -l.valor;
  }

  return {
    meses,
    indiceEmCurso,
    entradas,
    saidas,
    liquido,
    saldo,
    detalhesReceber,
    detalhesPagar,
    saldoHoje,
    saldoFim: saldo[saldo.length - 1] ?? 0,
    ultimoMesLabel: meses.length > 0 ? rotuloMes(meses[meses.length - 1]) : "—",
    porJob,
    composicao,
  };
}

/**
 * Mês sem evento nenhum ainda precisa de coluna: buraco no meio da matriz
 * faria o saldo acumulado parecer saltar de um mês para outro três meses
 * à frente.
 */
function preencherVaos(meses: string[]): string[] {
  if (meses.length === 0) return [];
  const saida: string[] = [];
  const [anoIni, mesIni] = meses[0].split("-").map(Number);
  const [anoFim, mesFim] = meses[meses.length - 1].split("-").map(Number);

  let ano = anoIni;
  let mes = mesIni;
  // Teto de 36 colunas: faixa maior que isso tem data errada na origem, e
  // uma matriz infinita trava a tela em vez de mostrar o problema.
  while (
    (ano < anoFim || (ano === anoFim && mes <= mesFim)) &&
    saida.length < 36
  ) {
    saida.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return saida;
}
