import { createClient } from "@/lib/supabase/server";

/**
 * O fluxo de caixa de UM job — a aba "Fluxo de Caixa do Job" do protótipo
 * "Abertura de Job — Financeiro".
 *
 * Tudo sai de `vw_fluxo_caixa` filtrada por `job_id`. A view já resolve
 * as três classes que o protótipo desenha como sub-linhas de cada
 * natureza (migration 20260817000006):
 *
 *   movimento — dinheiro que já entrou ou saiu da conta
 *   titulo    — documento em aberto (PP, avulsa, título a receber)
 *   previsao  — a curva da abertura, ainda sem documento
 *
 * E já resolve o abatimento: previsão coberta por PP ou por nota some da
 * classe `previsao` e reaparece em `titulo` ou `movimento`, consumida da
 * data mais próxima para a mais distante. Refazer essa conta aqui era o
 * caminho garantido para esta tela divergir do Fluxo de Caixa geral.
 */

export type ClasseFluxo = "movimento" | "titulo" | "previsao";

export interface DetalheFluxo {
  chave: string;
  codigo: string;
  descricao: string;
  vencimento: string;
  valor: number;
  situacao: string;
}

export interface FluxoDoJob {
  /** Colunas da matriz: "AAAA-MM", em ordem. */
  meses: string[];
  /** Índice do mês corrente dentro de `meses`; -1 quando fora da faixa. */
  indiceEmCurso: number;
  /** [natureza][classe][índice do mês] = valor. */
  entradas: Record<ClasseFluxo, number[]>;
  saidas: Record<ClasseFluxo, number[]>;
  liquido: number[];
  saldo: number[];
  /** Documentos por trás das linhas de título, para a linha expansível. */
  detalhesReceber: DetalheFluxo[];
  detalhesPagar: DetalheFluxo[];
  saldoHoje: number;
  saldoFim: number;
  /** Rótulo do último mês projetado — vira a nota do card. */
  ultimoMesLabel: string;
}

interface LinhaView {
  classe: ClasseFluxo;
  situacao: string;
  origem_tipo: string;
  origem_id: string | null;
  data_evento: string;
  valor: number | string;
  natureza: "entrada" | "saida";
  descricao: string | null;
}

const CLASSES: ClasseFluxo[] = ["movimento", "titulo", "previsao"];

function mesDe(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-08" → "08/2026". Espelha o `rotuloMes` de `fluxo-caixa-job.tsx`
 *  — o componente não pode importar valor daqui sem arrastar
 *  `next/headers` para o bundle do cliente. */
function rotuloMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${m}/${ano}`;
}

export async function carregarFluxoDoJob(
  tenantId: string,
  jobId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<FluxoDoJob> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("vw_fluxo_caixa")
    .select(
      "classe, situacao, origem_tipo, origem_id, data_evento, valor, natureza, descricao",
    )
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .order("data_evento", { ascending: true });

  if (error) {
    console.error("[fluxo-do-job]", error.message);
  }

  const linhas = ((data ?? []) as any[]).map(
    (l): LinhaView => ({
      classe: l.classe,
      situacao: l.situacao,
      origem_tipo: l.origem_tipo,
      origem_id: l.origem_id,
      data_evento: l.data_evento,
      valor: l.valor,
      natureza: l.natureza,
      descricao: l.descricao,
    }),
  );

  const mesAtual = mesDe(hoje);

  // A faixa de meses é a do próprio job — do primeiro evento ao último —,
  // e não uma janela fixa: job de duas semanas não precisa de seis
  // colunas, e job de um ano não cabe nelas. O mês corrente entra sempre,
  // porque é a coluna "Em curso" do protótipo.
  const mesesComEvento = new Set(linhas.map((l) => mesDe(l.data_evento)));
  mesesComEvento.add(mesAtual);
  const ordenados = [...mesesComEvento].sort();
  const meses = preencherVaos(ordenados);

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

  for (const l of linhas) {
    const i = indice.get(mesDe(l.data_evento));
    if (i === undefined) continue;
    const valor = Number(l.valor ?? 0);
    const alvo = l.natureza === "entrada" ? entradas : saidas;
    alvo[l.classe][i] += valor;

    if (l.classe === "titulo") {
      const { codigo, descricao } = repartirDescricao(l);
      const detalhe: DetalheFluxo = {
        chave: `${l.origem_tipo}-${l.origem_id ?? i}-${l.data_evento}-${detalhesReceber.length + detalhesPagar.length}`,
        codigo,
        descricao,
        vencimento: l.data_evento,
        valor,
        situacao: l.data_evento < hoje ? "Vencido" : "Em aberto",
      };
      if (l.natureza === "entrada") detalhesReceber.push(detalhe);
      else detalhesPagar.push(detalhe);
    }
  }

  const liquido = meses.map(
    (_, i) =>
      CLASSES.reduce((s, c) => s + entradas[c][i], 0) -
      CLASSES.reduce((s, c) => s + saidas[c][i], 0),
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
    // "Saldo do job hoje" é o acumulado até o mês corrente. Sem mês
    // corrente na faixa (job inteiro no passado ou no futuro) o número
    // honesto é o acumulado do que já passou, ou zero.
    saldoHoje:
      indiceEmCurso >= 0
        ? saldo[indiceEmCurso]
        : meses.length > 0 && meses[0] > mesAtual
          ? 0
          : (saldo[saldo.length - 1] ?? 0),
    saldoFim: saldo[saldo.length - 1] ?? 0,
    ultimoMesLabel: meses.length > 0 ? rotuloMes(meses[meses.length - 1]) : "—",
  };
}

/**
 * Mês sem evento nenhum ainda precisa de coluna: buraco no meio da
 * matriz faria o saldo acumulado parecer saltar de um mês para outro
 * três meses à frente.
 */
function preencherVaos(meses: string[]): string[] {
  if (meses.length === 0) return [];
  const saida: string[] = [];
  const [anoIni, mesIni] = meses[0].split("-").map(Number);
  const [anoFim, mesFim] = meses[meses.length - 1].split("-").map(Number);

  let ano = anoIni;
  let mes = mesIni;
  // Teto de 36 colunas: job que passe disso tem data errada, e uma
  // matriz infinita trava a tela em vez de mostrar o problema.
  while ((ano < anoFim || (ano === anoFim && mes <= mesFim)) && saida.length < 36) {
    saida.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return saida;
}

/**
 * Separa código e descrição da linha expandida.
 *
 * `vw_fluxo_caixa.descricao` já vem montada e carrega o código dentro
 * dela — "PP PP-00009 3/3 — Locação de som e luz", "Título NF 900123/2",
 * "Desembolso DES-00001 1/3 — ...".
 * O protótipo mostra os dois em colunas separadas, então o que a view
 * juntou é desfeito aqui, e não numa coluna nova do banco: a view é lida
 * por três telas e mexer nela para uma seria caro à toa.
 */
function repartirDescricao(l: LinhaView): {
  codigo: string;
  descricao: string;
} {
  const bruto = (l.descricao ?? "").trim();
  const semPrefixo = bruto.replace(/^(PP|Título|Avulsa|Desembolso)\s+/i, "");
  const [codigo, ...resto] = semPrefixo.split(" — ");

  return {
    codigo: codigo.trim() || rotuloDaOrigem(l.origem_tipo),
    descricao: resto.join(" — ").trim() || rotuloDaOrigem(l.origem_tipo),
  };
}

function rotuloDaOrigem(origem: string): string {
  if (origem === "pp") return "Pedido de produção";
  if (origem === "titulo") return "Título a receber";
  if (origem === "avulsa") return "Conta avulsa";
  // `desembolso` entrou na view em 20/08/2026, pela frente do Antonio
  // (migration 20260820000010). Um job pode ter desembolso em aberto, e
  // sem esta linha o rótulo cairia no fallback e mostraria a string crua.
  if (origem === "desembolso") return "Desembolso";
  return origem;
}
