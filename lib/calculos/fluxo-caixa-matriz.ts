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

  for (const l of linhas) {
    const i = indice.get(mesDe(l.dataEvento));
    if (i === undefined) continue;

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
  }

  const liquido = meses.map(
    (_, i) =>
      CLASSES_FLUXO.reduce((s, c) => s + entradas[c][i], 0) -
      CLASSES_FLUXO.reduce((s, c) => s + saidas[c][i], 0),
  );

  let acumulado = 0;
  const saldo = liquido.map((v) => (acumulado += v));

  const indiceEmCurso = indice.get(mesAtual) ?? -1;

  return {
    meses,
    indiceEmCurso,
    entradas,
    saidas,
    liquido,
    saldo,
    detalhesReceber,
    detalhesPagar,
    // Acumulado até o mês corrente. Sem mês corrente na faixa (tudo no
    // passado ou tudo no futuro) o número honesto é o acumulado do que já
    // passou, ou zero.
    saldoHoje:
      indiceEmCurso >= 0
        ? saldo[indiceEmCurso]
        : meses.length > 0 && meses[0] > mesAtual
          ? 0
          : (saldo[saldo.length - 1] ?? 0),
    saldoFim: saldo[saldo.length - 1] ?? 0,
    ultimoMesLabel: meses.length > 0 ? rotuloMes(meses[meses.length - 1]) : "—",
    porJob,
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
