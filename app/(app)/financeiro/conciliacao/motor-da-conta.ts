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
  gruposDeIguais,
  type CentroDoTitulo,
  type GrupoDeIguais,
  type LoteDoMotor,
  type MovimentoDoMotor,
  type ResultadoDoMotor,
  type TituloDoMotor,
} from "@/lib/conciliacao/motor";
import { efeitoNaConta, r2 } from "@/lib/financeiro/planilha-de-titulos";
import type { ResolucaoSozinha } from "@/lib/types";
import type { Linha } from "./linhas-da-aba";
import { diaCoberto, type DadosDaAbaBanco, type LancamentoSemLinha, type LinhaDoBanco } from "./banco-dados";

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

/** O centro de custo, quando o título já tem (o "certo" pede centro). */
function centroDoTitulo(l: Linha): CentroDoTitulo | null {
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

/** O texto da linha resolvida, pelo que está ligado a ela. */
export function resolucaoDaLinha(l: LinhaDoBanco): Resolucao | null {
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
  const texto =
    l.resolvidaSozinha === "manual"
      ? `Baixa feita à mão: ${aspas(primeira)}`
      : l.resolvidaSozinha === "titulo"
        ? `Baixado e conciliado sozinho: ${primeira}${varios}`
        : l.resolvidaSozinha === "remessa"
          ? `Baixa dos ${principais.length} títulos da remessa, numa linha só`
          : l.resolvidaSozinha === "regra"
            ? `Lançado sozinho pela regra: ${primeira}`
            : `Baixa de ${primeira}${varios}`;
  return { estado: "conciliado", sozinho: l.resolvidaSozinha, texto, ligados: l.resolvidaSozinha === "manual" };
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
  dados: Pick<DadosDaAbaBanco, "linhas" | "lancamentos" | "remessas" | "regras" | "periodos">,
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
  const res = casar(pendentes, { titulos, lancamentos: dados.lancamentos, lotes, regras: dados.regras });
  const porId = new Map(res.map((r) => [r.mov.id, r]));
  const resultados: ResultadoDaLinha[] = movimentos.map((m) => {
    const r = porId.get(m.id);
    return r ? { ...r, resolvido: null } : { mov: m, estado: "sem_par", candidatos: [], resolvido: resolucaoDaLinha(m.linha) };
  });
  const usados = new Set(res.flatMap((r) => (r.lancamento ? [r.lancamento.id] : [])));
  const naoApareceu = dados.lancamentos.filter((l) => !usados.has(l.id) && diaCoberto(l.data, dados.periodos));
  return {
    resultados,
    titulos: new Map(titulos.map((t) => [t.id, t])),
    lancamentos: new Map(dados.lancamentos.map((l) => [l.id, l])),
    naoApareceu,
  };
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
    sem: pend.filter((r) => r.estado === "sem_par"),
    conciliados: resolvidos.filter((r) => !r.resolvido?.ligados),
  };
}
