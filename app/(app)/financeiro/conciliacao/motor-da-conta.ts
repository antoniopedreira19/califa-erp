/**
 * O motor de correspondência sobre os dados reais de uma conta (decisão
 * 199): traduz as linhas da planilha de títulos e as remessas para o
 * formato do motor (`lib/conciliacao/motor.ts`), roda o `casar` nas linhas
 * do banco ainda sem solução e separa o resultado nas seções da aba Banco
 * — a versão Alternativa do protótipo (`banco.jsx`, `AbaBancoRecomendada`).
 *
 * Módulo puro: vale no cliente (a aba), no servidor (a automação da
 * importação, decisão 201) e no teste.
 */

import {
  casar,
  diasEntre,
  gruposDeIguais,
  type CentroDoTitulo,
  type GrupoDeIguais,
  type LoteDoMotor,
  type MovimentoDoMotor,
  type ResultadoDoMotor,
  type TituloDoMotor,
} from "@/lib/conciliacao/motor";
import { casarComHistorico } from "@/lib/conciliacao/historico";
import { efeitoNaConta, r2 } from "@/lib/financeiro/planilha-de-titulos";
import type { EntradaDaBaixaEmLote } from "@/lib/financeiro/baixa-em-lote";
import type { ResolucaoSozinha } from "@/lib/types";
import type { Linha } from "./linhas-da-aba";
import {
  diaCoberto,
  diaCompleto,
  type DadosDaAbaBanco,
  type LancamentoSemLinha,
  type LinhaDoBanco,
  type RemessaBaixada,
} from "./banco-dados";

// ---------------------------------------------------------------------------
// Os títulos
// ---------------------------------------------------------------------------

/** A forma prevista do título no vocabulário do histórico do banco
 *  (`formaDoHistorico`): "ted" é a transferência; a guia é do imposto. */
function formaDoTitulo(l: Linha): string | null {
  if (l.lado === "imposto") return "guia";
  if (l.lado !== "pagar") return null;
  const f = l.t.forma_prevista ?? l.t.forma_pagamento;
  return f === "transferencia" ? "ted" : f === "cartao_credito" ? "cartao" : f;
}

/** O centro de custo, quando o título já tem (o "certo" pede centro). O
 *  título que vai pela baixa em lote precisa do par completo, tipo e
 *  subtipo (o lote recusa sem ele); o imposto usa o dele, do banco. */
function centroDoTitulo(l: Linha): CentroDoTitulo | null {
  if (l.lote && l.lote.tipo !== "imposto" && !l.lote.centroDeCusto) return null;
  switch (l.centro.tipo) {
    case "plano":
      return { tipo: l.centro.rotulo, sub: l.centro.completo };
    case "fora_do_dre":
      return { tipo: "Fora do DRE", sub: "transferência entre contas" };
    case "itens_da_fatura":
      return { tipo: "Itens da fatura", sub: "cada item no seu centro" };
    case "definir_na_baixa":
      return null;
  }
}

/** A referência curta do título: "PP-00162", "NF 1196", "DES-00021"… */
function refDoTitulo(l: Linha): string {
  switch (l.lado) {
    case "pagar":
      return ["pp", "desembolso", "fatura_cartao", "pp_devolucao_verba"].includes(l.t.origem) ? l.t.origem_label : l.t.descricao;
    case "receber":
      return l.origem === "nf" ? `NF ${l.t.fat_numero_nf}` : l.t.codigo_avulsa ?? l.t.fat_descricao;
    case "transferencia":
      return l.t.codigo_avulsa ?? "Transferência";
    case "imposto":
      return `Guia de ${l.t.titulo}`;
  }
}

/** O fornecedor ou o cliente do título, para o CNPJ do histórico. */
function parteDoTitulo(l: Linha): string | null {
  return l.lado === "pagar" || l.lado === "receber" ? l.t.parte_id : null;
}

/** O documento do título como a remessa o guarda (`cnab_remessas_itens`):
 *  a parcela da PP ou a conta avulsa. */
function documentoNaRemessa(l: Linha): string | null {
  if (l.lado !== "pagar") return null;
  return ["pp", "avulso", "recorrencia", "folha"].includes(l.t.origem) ? l.t.id : null;
}

/**
 * Os títulos em aberto que mexem nesta conta, no formato do motor. O id é a
 * chave da linha da planilha (`pagar|pp|<id>`…), única entre os lados. O
 * título sem data (a avulsa a receber sem previsão) conta como de hoje, como
 * a planilha o põe no saldo previsto (`dataEfetiva`).
 */
export function titulosDoMotor(
  linhas: Linha[],
  contaId: string,
  documentoDaParte: Record<string, string>,
  hoje: string,
): TituloDoMotor[] {
  const saida: TituloDoMotor[] = [];
  for (const l of linhas) {
    const efeito = efeitoNaConta(l, contaId);
    if (efeito === 0) continue;
    const parte = parteDoTitulo(l);
    const semBaixa = l.valor.baixado === 0;
    saida.push({
      id: l.chave,
      lado: l.lado === "transferencia" ? "transf" : l.lado,
      origem: l.origem,
      ref: refDoTitulo(l),
      contraparte: l.contraparte,
      cnpj: parte ? documentoDaParte[parte] ?? null : null,
      vencimento: l.dataPrevista || l.vencimento || hoje,
      vencOrig: l.vencimento,
      valor: l.valor.bruto,
      // A retenção da aprovação da PP: o título já está pelo líquido.
      retencao: semBaixa ? r2(l.valor.retencoes.reduce((s, x) => s + x.valor, 0)) : 0,
      liquido: Math.abs(efeito),
      baixado: l.valor.baixado,
      forma: formaDoTitulo(l),
      centro: centroDoTitulo(l),
      loteId: null,
      entra: efeito > 0,
    });
  }
  return saida;
}

/**
 * As remessas que ainda podem casar (passo 4): todos os itens com o título
 * em aberto e sem baixa. O total é o que o banco debita — a soma do que
 * cada item pagou (o líquido, decisão 145). Marca nos títulos o `loteId`:
 * o título da remessa não casa sozinho.
 */
export function lotesDoMotor(
  remessas: DadosDaAbaBanco["remessas"],
  linhas: Linha[],
  titulos: TituloDoMotor[],
): LoteDoMotor[] {
  const porChave = new Map(titulos.map((t) => [t.id, t]));
  const porDocumento = new Map<string, TituloDoMotor>();
  for (const l of linhas) {
    const doc = documentoNaRemessa(l);
    const t = porChave.get(l.chave);
    if (doc && t && (t.baixado ?? 0) === 0) porDocumento.set(doc, t);
  }
  const lotes: LoteDoMotor[] = [];
  const jaNumLote = new Set<string>();
  for (const r of remessas) {
    if (r.itens.length === 0) continue;
    const ts = r.itens.map((i) => porDocumento.get(i.origemId));
    if (ts.some((t) => !t || jaNumLote.has(t.id))) continue;
    const doLote = ts as TituloDoMotor[];
    doLote.forEach((t) => {
      t.loteId = r.id;
      jaNumLote.add(t.id);
    });
    lotes.push({
      id: r.id,
      nome: r.nome,
      descricao: r.descricao,
      total: r2(r.itens.reduce((s, i) => s + i.valor, 0)),
      titulos: doLote,
    });
  }
  return lotes;
}

// ---------------------------------------------------------------------------
// O resultado de cada linha do banco
// ---------------------------------------------------------------------------

/** O movimento do banco com a linha de onde veio. */
export interface MovimentoDaLinha extends MovimentoDoMotor {
  id: string;
  linha: LinhaDoBanco;
}

/** A linha já resolvida: conciliada ou ignorada. */
export interface Resolucao {
  estado: "conciliado" | "ignorado";
  sozinho: ResolucaoSozinha | null;
  /** O que a coluna No sistema diz. */
  texto: string;
  /** Ligou uma baixa feita à mão (a seção dela, decisão 199). */
  ligados: boolean;
}

export type ResultadoDaLinha = ResultadoDoMotor<MovimentoDaLinha> & {
  resolvido: Resolucao | null;
};

function aspas(s: string) {
  return `“${s}”`;
}

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** O texto da linha resolvida, pelo jeito como ela se conciliou
 *  (`conciliada_como`, decisão 200) e pelo que está ligado a ela. */
export function resolucaoDaLinha(
  l: LinhaDoBanco,
  regras: ReadonlyMap<string, { centro: string }> = new Map(),
): Resolucao | null {
  if (l.ignorada) {
    return {
      estado: "ignorado",
      sozinho: null,
      texto: `Ignorada: não entra no extrato do sistema${l.ignorada.motivo ? ` · ${aspas(l.ignorada.motivo)}` : ""}`,
      ligados: false,
    };
  }
  if (!l.conciliada) return null;
  const principais = l.ligados.filter((x) => x.origem !== "juros_baixa");
  const primeira = (principais[0] ?? l.ligados[0])?.descricao ?? "lançamento";
  const varios = principais.length > 1 ? ` e mais ${principais.length - 1}` : "";
  const regra = l.regraId ? regras.get(l.regraId)?.centro ?? primeira : primeira;
  const troca = l.datasTrocadas[0];
  let texto: string;
  switch (l.conciliadaComo) {
    case "ligacao":
      texto = `Baixa feita à mão: ${aspas(primeira)}${troca ? ` · data de ${diaMes(troca.de)} para ${diaMes(l.data)}, a do banco` : ""}`;
      break;
    case "correcao":
      texto = l.correcao
        ? `Baixa corrigida de ${moeda(l.correcao.de)} para ${moeda(l.correcao.para)}, o valor do banco · ${aspas(l.correcao.motivo)}`
        : `Baixa corrigida pelo valor do banco: ${primeira}`;
      break;
    case "regra":
      texto = l.resolvidaSozinha === "regra" ? `Lançado sozinho pela regra: ${regra}` : `Avulso lançado pela regra: ${regra}`;
      break;
    case "par":
      texto = "Saída e devolução registradas; nenhum título baixado";
      break;
    case "avulso":
      texto = `Avulso criado e baixado: ${primeira}`;
      break;
    case "historico": {
      const jobs = [...new Set(l.historicos.map((h) => h.job ?? h.descricao ?? "sem job"))];
      texto = `Do histórico da planilha: ${aspas(jobs[0] ?? "jobs até o 3T")}${jobs.length > 1 ? ` e mais ${jobs.length - 1}` : ""}`;
      break;
    }
    default:
      texto =
        l.resolvidaSozinha === "remessa"
          ? `Baixa dos ${principais.length} títulos da remessa, numa linha só`
          : l.resolvidaSozinha === "titulo"
            ? `Baixado e conciliado sozinho: ${primeira}${varios}`
            : `Baixa de ${primeira}${varios}`;
  }
  return { estado: "conciliado", sozinho: l.resolvidaSozinha, texto, ligados: l.conciliadaComo === "ligacao" };
}

export interface ConciliacaoDaConta {
  resultados: ResultadoDaLinha[];
  /** Os títulos do motor, pelo id (a chave da linha da planilha). */
  titulos: Map<string, TituloDoMotor>;
  /** Os lançamentos sem linha, pelo id. */
  lancamentos: Map<string, LancamentoSemLinha>;
  /** As baixas de dias completos já importados que o banco não mostra. */
  naoApareceu: LancamentoSemLinha[];
}

/** Roda o motor nas linhas do banco ainda sem solução. */
export function conciliarConta(
  dados: Pick<DadosDaAbaBanco, "linhas" | "lancamentos" | "remessasBaixadas" | "remessas" | "regras" | "periodos"> &
    Partial<Pick<DadosDaAbaBanco, "historico">>,
  linhasDaPlanilha: Linha[],
  contaId: string,
  documentoDaParte: Record<string, string>,
  hoje: string,
): ConciliacaoDaConta {
  const titulos = titulosDoMotor(linhasDaPlanilha, contaId, documentoDaParte, hoje);
  const lotes = lotesDoMotor(dados.remessas, linhasDaPlanilha, titulos);
  const movimentos: MovimentoDaLinha[] = dados.linhas.map((l) => ({
    id: l.id,
    ordem: l.ordem,
    data: l.data,
    valor: l.valor,
    historico: l.historico,
    tipo: l.tipo ?? undefined,
    linha: l,
  }));
  const pendentes = movimentos.filter((m) => !m.linha.conciliada && !m.linha.ignorada);

  // A cauda do histórico (decisão 211, A6), antes dos títulos: a linha da
  // cauda do mesmo dia e do mesmo valor é dela — um pagamento de job do 3T
  // não vira baixa de um título do 4T de mesmo valor. A baixa feita à mão
  // (passo 1) continua na frente.
  const cauda = dados.historico ?? [];
  const temBaixa = (m: MovimentoDaLinha) =>
    dados.lancamentos.some((l) => Math.round(l.valor * 100) === Math.round(m.valor * 100) && Math.abs(diasEntre(l.data, m.data)) <= 3);
  const doDia = casarComHistorico(pendentes.filter((m) => !temBaixa(m)), cauda, { soNoDia: true });
  const usadasDaCauda = new Set([...doDia.values()].flat());
  const res = casar(pendentes.filter((m) => !doDia.has(m)), {
    titulos,
    lancamentos: dados.lancamentos,
    lotes,
    remessasBaixadas: dados.remessasBaixadas,
    regras: dados.regras,
  });
  // Depois dos títulos: o que ficou sem par procura a cauda até 5 dias e
  // pelas somas do dia.
  const semPar = res.filter((r) => r.estado === "sem_par").map((r) => r.mov);
  const depois = casarComHistorico(semPar, cauda.filter((h) => !usadasDaCauda.has(h)));
  const doHistorico = new Map([...doDia, ...depois]);
  const porId = new Map(res.map((r) => [r.mov.id, r]));
  for (const [m, historicos] of doHistorico) {
    const um = historicos.length === 1;
    porId.set(m.id, {
      mov: m,
      estado: "historico",
      confianca: "alta",
      candidatos: [],
      historicos,
      motivo: um
        ? `A linha do histórico de ${diaMes(historicos[0].data)} com o mesmo valor.`
        : `${historicos.length} linhas do histórico de ${diaMes(historicos[0].data)} que somam o valor do banco.`,
    });
  }
  const regras = new Map(dados.regras.map((g) => [g.id as string, { centro: g.centro }]));
  const resultados: ResultadoDaLinha[] = movimentos.map((m) => {
    const r = porId.get(m.id);
    return r ? { ...r, resolvido: null } : { mov: m, estado: "sem_par", candidatos: [], resolvido: resolucaoDaLinha(m.linha, regras) };
  });
  // O grupo da remessa (passo 1c) usa as baixas que junta.
  const usados = new Set(
    res.flatMap((r) => (r.lancamento ? [r.lancamento.id, ...((r.lancamento as Partial<RemessaBaixada>).membros ?? [])] : [])),
  );
  const naoApareceu = dados.lancamentos.filter((l) => !usados.has(l.id) && diaCoberto(l.data, dados.periodos));
  return {
    resultados,
    titulos: new Map(titulos.map((t) => [t.id, t])),
    lancamentos: new Map([...dados.lancamentos, ...dados.remessasBaixadas].map((l) => [l.id, l])),
    naoApareceu,
  };
}

/**
 * O ⚠ da coluna Banco do Extrato (decisão 202; o `alertasDoExtrato` do
 * protótipo, `main.jsx`): a baixa feita à mão que não bate com a linha do
 * banco (passo 1b) e a que falta num dia que o extrato já cobre por inteiro.
 * Por id de lançamento — todos os que a linha do Extrato junta (a baixa e os
 * juros, as partes da guia). Não precisa dos títulos: os dois casos vêm
 * antes deles no motor.
 */
export function alertasDoExtrato(
  dados: Pick<DadosDaAbaBanco, "linhas" | "lancamentos" | "remessasBaixadas" | "remessas" | "regras" | "periodos">,
  contaId: string,
  hoje: string,
): Record<string, string> {
  const { resultados, naoApareceu, lancamentos } = conciliarConta(dados, [], contaId, {}, hoje);
  const alertas: Record<string, string> = {};
  for (const r of resultados) {
    if (r.resolvido || r.estado !== "divergencia" || !r.lancamento) continue;
    const l = lancamentos.get(r.lancamento.id);
    for (const id of l?.ids ?? [r.lancamento.id]) alertas[id] = `Não bate com o banco. ${r.motivo ?? ""}`.trim();
  }
  const ate = dados.periodos
    .map((p) => diaCompleto(p))
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  if (ate) {
    for (const l of naoApareceu) {
      for (const id of l.ids) {
        alertas[id] = `Não está no extrato do banco até ${diaMes(ate)}: paga em outra conta, com a data errada ou não paga.`;
      }
    }
  }
  return alertas;
}

// ---------------------------------------------------------------------------
// As seções
// ---------------------------------------------------------------------------

export interface SecoesDoBanco {
  divergencia: ResultadoDaLinha[];
  manual: ResultadoDaLinha[];
  alta: ResultadoDaLinha[];
  conferir: ResultadoDaLinha[];
  /** Os grupos de linhas iguais com mais títulos que linhas (em Conferir). */
  grupos: GrupoDeIguais<MovimentoDaLinha>[];
  soma: ResultadoDaLinha[];
  par: ResultadoDaLinha[];
  regra: ResultadoDaLinha[];
  /** A cauda do histórico da planilha (A6). */
  historico: ResultadoDaLinha[];
  sem: ResultadoDaLinha[];
  conciliados: ResultadoDaLinha[];
}

const comCentro = (t: TituloDoMotor | null | undefined) => !!t?.centro;

/** As seções na ordem do protótipo (`AbaBancoRecomendada`). */
export function secoesDoBanco(resultados: ResultadoDaLinha[]): SecoesDoBanco {
  const pend = resultados.filter((r) => !r.resolvido);
  const resolvidos = resultados.filter((r) => r.resolvido);
  // Linhas iguais do banco (mesmo dia, mesmo valor) com títulos empatados
  // viram um grupo só: qual linha fica com qual título não muda o Extrato.
  const grupos = gruposDeIguais(pend) as GrupoDeIguais<MovimentoDaLinha>[];
  const nosGrupos = new Set(grupos.flatMap((g) => g.linhas.map((r) => r.mov.id)));
  const prontoSugestao = (r: ResultadoDaLinha) => r.estado === "sugestao" && r.confianca === "alta" && comCentro(r.titulo);
  const prontaSoma = (r: ResultadoDaLinha) =>
    r.estado === "combinacao" && r.confianca === "alta" && (r.titulos ?? []).every((t) => comCentro(t));
  return {
    divergencia: pend.filter((r) => r.estado === "divergencia"),
    // A baixa feita à mão que bate com o banco aparece sempre, conciliada
    // sozinha ou não (Tiago, 21/10/2026).
    manual: resultados.filter((r) => (!r.resolvido && r.estado === "ja_lancado") || r.resolvido?.ligados),
    alta: pend.filter((r) => prontoSugestao(r) || prontaSoma(r)),
    conferir: pend.filter(
      (r) => !nosGrupos.has(r.mov.id) && ((r.estado === "sugestao" && !prontoSugestao(r)) || r.estado === "diferenca"),
    ),
    grupos,
    soma: pend.filter((r) => r.estado === "soma" || (r.estado === "combinacao" && !prontaSoma(r))),
    par: pend.filter((r) => r.estado === "par"),
    regra: pend.filter((r) => r.estado === "regra"),
    historico: pend.filter((r) => r.estado === "historico"),
    sem: pend.filter((r) => r.estado === "sem_par"),
    conciliados: resolvidos.filter((r) => !r.resolvido?.ligados),
  };
}

// ---------------------------------------------------------------------------
// A automação da importação (decisão 201)
// ---------------------------------------------------------------------------

/** O que se resolve sozinho nesta leitura: o `useEffect` "Na importação, o
 *  que é certo…" do protótipo (`main.jsx`), modo "Baixa sozinho o que é
 *  certo" (especificação 4.7). */
export interface AutomacaoDaLeitura {
  /** A baixa feita à mão que bate (passo 1): liga a qualquer momento, porque
   *  ela pode vir depois da importação. */
  manuais: ResultadoDaLinha[];
  /** As linhas pendentes que ainda não passaram pela avaliação única: a
   *  tela as reserva (`marcar_linhas_avaliadas`) antes de resolver. */
  aAvaliar: string[];
  /** Das que ainda não foram avaliadas, o que se resolve sozinho — mas só
   *  se a reserva devolver a linha: */
  /** o título com confiança alta e centro de custo (passos 3 e 3a); */
  titulos: ResultadoDaLinha[];
  /** a remessa que soma centavo a centavo (passo 4); */
  remessas: ResultadoDaLinha[];
  /** a regra do histórico (passo 6); */
  regras: ResultadoDaLinha[];
  /** a cauda do histórico da planilha (A6). */
  historicos: ResultadoDaLinha[];
}

/** A soma de títulos da mesma contraparte (passo 4b) não se resolve sozinha:
 *  vai para Prontos, um clique. A linha que alguém desfez (`sem_auto`) não se
 *  resolve mais sozinha, nem pela baixa feita à mão. */
export function automacaoDaLeitura(resultados: ResultadoDaLinha[]): AutomacaoDaLeitura {
  const pend = resultados.filter((r) => !r.resolvido);
  const podem = pend.filter((r) => !r.mov.linha.semAuto);
  const novas = podem.filter((r) => !r.mov.linha.avaliada);
  return {
    manuais: podem.filter((r) => r.estado === "ja_lancado" && !!r.lancamento),
    aAvaliar: pend.filter((r) => !r.mov.linha.avaliada).map((r) => r.mov.id),
    titulos: novas.filter((r) => r.estado === "sugestao" && r.confianca === "alta" && comCentro(r.titulo)),
    remessas: novas.filter((r) => r.estado === "soma" && !!r.lote),
    regras: novas.filter((r) => r.estado === "regra" && !!r.regra?.id),
    historicos: novas.filter((r) => r.estado === "historico" && !!r.historicos?.length),
  };
}

/** A faixa verde do que se resolveu sozinho (protótipo, `banco.jsx`). */
export function textoDosSozinhos(resultados: ResultadoDaLinha[]): { quantas: number; partes: string[] } | null {
  const conta = (k: ResolucaoSozinha) => resultados.filter((r) => r.resolvido?.sozinho === k).length;
  const quantas = resultados.filter((r) => r.resolvido?.sozinho).length;
  if (quantas === 0) return null;
  const manual = conta("manual");
  const titulo = conta("titulo");
  const remessa = conta("remessa");
  const regra = conta("regra");
  const historico = conta("historico");
  const partes = [
    manual && `${manual === 1 ? "1 baixa feita à mão que bateu" : `${manual} baixas feitas à mão que bateram`} com o banco`,
    titulo &&
      `${titulo === 1 ? "1 título baixado e conciliado" : `${titulo} títulos baixados e conciliados`} (valor exato, pago na data e pela forma previstas, ou o CNPJ do cliente no histórico; com linhas iguais, quando são tantas quanto os títulos desse valor)`,
    remessa && (remessa === 1 ? "a remessa, que soma centavo a centavo" : `${remessa} remessas, que somam centavo a centavo`),
    regra && `${regra === 1 ? "1 tarifa" : `${regra} tarifas`} pela regra do histórico`,
    historico &&
      `${historico === 1 ? "1 linha" : `${historico} linhas`} do histórico da planilha (jobs até o 3T fora do sistema), pelo valor e pelo dia`,
  ].filter((p): p is string => !!p);
  return { quantas, partes };
}

// ---------------------------------------------------------------------------
// As ações: o que cada título leva à baixa e à conciliação (decisão 200)
// ---------------------------------------------------------------------------

/** O documento de um título, como `conciliar_linha_pelos_documentos` o
 *  procura na conta da linha depois da baixa. */
export type DocumentoDoTitulo = {
  tipo: "pp" | "avulsa" | "titulo_receber" | "desembolso" | "devolucao_verba" | "fatura" | "imposto" | "transferencia";
  id: string;
};

export function documentoDaLinha(l: Linha): DocumentoDoTitulo | null {
  switch (l.lado) {
    case "pagar":
      switch (l.t.origem) {
        case "pp":
          return { tipo: "pp", id: l.t.id };
        case "avulso":
        case "recorrencia":
        case "folha":
          return { tipo: "avulsa", id: l.t.id };
        case "desembolso":
          return { tipo: "desembolso", id: l.t.id };
        case "fatura_cartao":
          return { tipo: "fatura", id: l.t.id };
        case "pp_devolucao_verba":
          return { tipo: "devolucao_verba", id: l.t.id };
        default:
          return null;
      }
    case "receber":
      return l.origem === "nf"
        ? { tipo: "titulo_receber", id: l.t.id }
        : l.t.conta_avulsa_id
          ? { tipo: "avulsa", id: l.t.conta_avulsa_id }
          : null;
    case "transferencia":
      return { tipo: "transferencia", id: l.t.id };
    case "imposto":
      return { tipo: "imposto", id: l.t.id };
  }
}

/** O item da baixa em lote do título, para o "Baixar e conciliar" de um
 *  clique; `null` quando ele não vai pelo lote (desembolso, fatura,
 *  estorno de verba, transferência, o imposto sem guia, o título sem
 *  centro completo) — esses abrem a baixa de um por um. */
export function itemDoLote(l: Linha): EntradaDaBaixaEmLote["itens"][number] | null {
  const t = l.lote;
  if (!t || l.motivoForaDoLote !== null) return null;
  if (t.tipo === "imposto") {
    if (!t.imposto.guiaPath) return null;
    return {
      chave: t.chave,
      rotulo: t.titulo.slice(0, 200),
      alvo: t.alvo,
      aberto: r2(t.aberto),
      centro: null,
      imposto: { multa_juros: 0, guia_path: null, comprovante_path: "" },
    };
  }
  if (!t.centroDeCusto) return null;
  return { chave: t.chave, rotulo: t.titulo.slice(0, 200), alvo: t.alvo, aberto: r2(t.aberto), centro: t.centroDeCusto, imposto: null };
}

/** O banco pagou menos que o título e nenhuma retenção explica: a baixa
 *  aberta pela linha começa parcial com o valor do banco. Só onde há baixa
 *  parcial (PP, avulso, recorrência, nota e recebimento avulso) e o título
 *  não tem retenção da aprovação (aí o líquido já é o do banco). */
export function parcialPeloBanco(
  r: Pick<ResultadoDaLinha, "mov" | "retencaoAliquotas">,
  t: Pick<TituloDoMotor, "liquido" | "retencao" | "origem">,
): number | null {
  const banco = r2(Math.abs(r.mov.valor));
  if (r.retencaoAliquotas || (t.retencao ?? 0) > 0) return null;
  if (!["pp", "avulso", "recorrencia", "nf", "recebimento_avulso"].includes(t.origem)) return null;
  return banco < t.liquido - 0.004 ? banco : null;
}
