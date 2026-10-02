/**
 * A montagem do pedido de aprovação de uma guia (módulo fiscal, entrega 2 —
 * Apuração, 02/10/2026). Lógica pura, sem banco: a Server Action
 * (`./actions.ts`) recalcula a guia no servidor e passa por aqui antes de
 * chamar `aprovar_guia_fiscal`; os testes (`./aprovacao.test.ts`) também.
 *
 * Do cliente vem só o que a pessoa decide na tela: o valor da guia da
 * contabilidade, a justificativa, se compensa o ISS a recuperar, a cota
 * única e os juros das cotas. O calculado, a memória, as compensações e o
 * rateio saem da guia recalculada.
 *
 * Regras (protótipo aprovado, `memoria-dialog.tsx`):
 * - vale o valor da guia; o calculado fica guardado ao lado, e a diferença
 *   entre os dois exige justificativa (10 caracteres, a trava do banco);
 * - sem a compensação do ISS a recuperar, a guia volta ao valor cheio;
 * - IRPJ/CSLL: as cotas são recalculadas sobre o VALOR DA GUIA
 *   (`cotasDe`), com os juros que a pessoa ajustou na 2ª e na 3ª; a cota
 *   única é o valor inteiro no 1º vencimento, sem juros;
 * - a diferença (guia aprovada cujo cálculo mudou) vira UM título
 *   complementar; o calculado guardado é o apurado inteiro de hoje, que é o
 *   que a próxima comparação usa (`estadoDaGuia`).
 */
import { formatBRL } from "@/lib/format";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import {
  cotasDe,
  titulosDaAprovacao,
  type AprovacaoFiscal,
  type Cota,
  type EstadoGuia,
  type Guia,
  type ItemMemoria,
  type RateioDaGuia,
} from "@/lib/fiscal/apuracao";
import { dataBr, r2 } from "@/lib/fiscal/datas";

/** O mínimo da justificativa: a trava de `fiscal_aprovacoes` e de `aprovar_guia_fiscal`. */
export const JUSTIFICATIVA_MINIMA = 10;

/** O que a pessoa decide na tela. */
export interface EntradaDaAprovacao {
  valor_guia: number;
  justificativa: string;
  /** Compensar nesta guia o ISS a recuperar sugerido (só ISS de município que compensa). */
  usar_compensacao: boolean;
  /** IRPJ/CSLL: pagar em cota única. */
  cota_unica: boolean;
  /** IRPJ/CSLL: os juros (%) de cada cota, pelo índice; a 1ª é sempre sem juros. */
  juros_pct: number[] | null;
}

/** Um título como `aprovar_guia_fiscal` recebe em `p_titulos`. */
export interface TituloDoPedido {
  cota_numero: number | null;
  cota_total: number | null;
  juros_pct: number | null;
  vencimento: string;
  principal: number;
  juros: number;
  valor: number;
  descricao: string;
  rateio: Array<{ empresa_id: string; regional_id: string | null; valor: number }>;
}

/** Os parâmetros de `aprovar_guia_fiscal`, menos o tenant e o caminho da guia. */
export interface PedidoDeAprovacao {
  p_chave: string;
  p_tributo: string;
  p_empresa_contabil_id: string;
  p_estabelecimento_id: string | null;
  p_competencia: string;
  p_periodo: "mensal" | "trimestral";
  p_rotulo_competencia: string;
  p_titulo: string;
  p_codigo_receita: string | null;
  p_valor_calculado: number;
  p_valor_guia: number;
  p_justificativa: string | null;
  p_diferenca: boolean;
  p_compensacoes: string[];
  p_cotas: Cota[] | null;
  p_memoria: ItemMemoria[];
  p_rateio: RateioDaGuia[];
  p_titulos: TituloDoPedido[];
}

export type ResultadoDaMontagem = { ok: true; pedido: PedidoDeAprovacao } | { ok: false; message: string };

/** O apurado sem as linhas de compensação: o valor cheio da guia. */
export function apuradoSemCompensacao(g: Pick<Guia, "memoria">): number {
  return Math.max(0, r2(g.memoria.filter((m) => m.grupo !== "compensacao").reduce((s, m) => s + m.valor, 0)));
}

/**
 * O valor com que a guia da contabilidade se compara na tela e no servidor:
 * na diferença, o complementar (o que o cálculo subiu desde a aprovação; se
 * caiu, zero); sem a compensação sugerida, o valor cheio; senão, o apurado.
 */
export function calculadoParaAGuia(
  g: Pick<Guia, "apurado" | "memoria" | "compensacoes">,
  estado: EstadoGuia,
  delta: number,
  usarCompensacao: boolean,
): number {
  if (estado === "diferenca") return Math.max(0, r2(delta));
  const temCompensacao = (g.compensacoes ?? []).length > 0;
  if (temCompensacao && !usarCompensacao) return apuradoSemCompensacao(g);
  return g.apurado;
}

/**
 * As cotas do IRPJ/CSLL sobre o valor da guia: as de `cotasDe`, com os juros
 * ajustados na 2ª e na 3ª; na cota única, o valor inteiro no 1º vencimento.
 */
export function cotasDaAprovacao(
  valorGuia: number,
  competencia: string,
  cidadeDaMatriz: string,
  cad: CadastroFiscal,
  cotaUnica: boolean,
  jurosPct: number[] | null,
): Cota[] {
  if (valorGuia <= 0) return [];
  const base = cotasDe(valorGuia, competencia, cidadeDaMatriz, cad);
  if (cotaUnica) return [{ numero: 1, vencimento: base[0].vencimento, principal: r2(valorGuia), jurosPct: 0, juros: 0 }];
  return base.map((c, i) => {
    const pedido = i === 0 ? c.jurosPct : jurosPct?.[i];
    const jp = pedido === undefined || pedido === null || !Number.isFinite(pedido) ? c.jurosPct : r2(pedido);
    return { ...c, jurosPct: jp, juros: r2((c.principal * jp) / 100) };
  });
}

export function montarPedidoDeAprovacao(e: {
  guia: Guia;
  estado: EstadoGuia;
  delta: number;
  /** A aprovação original da guia (na diferença: a data e o valor aprovados). */
  aprovacao?: Pick<AprovacaoFiscal, "data" | "valor_guia"> | null;
  entrada: EntradaDaAprovacao;
  cadastro: CadastroFiscal;
  /** Hoje em São Paulo ("AAAA-MM-DD"). */
  hoje: string;
  /** O município da matriz da PJ: o vencimento das cotas. */
  cidadeDaMatriz: string;
}): ResultadoDaMontagem {
  const { guia: g, estado, entrada } = e;
  if (estado === "em_curso") {
    return { ok: false, message: "A competência ainda está em curso: a guia só se aprova depois do fechamento." };
  }
  if (estado === "aprovada") return { ok: false, message: "Esta guia já foi aprovada." };

  if (!Number.isFinite(entrada.valor_guia) || entrada.valor_guia < 0) {
    return { ok: false, message: "Informe o valor da guia." };
  }
  const valorGuia = r2(entrada.valor_guia);
  const diferenca = estado === "diferenca";
  const temCompensacao = !diferenca && (g.compensacoes ?? []).length > 0;
  const usar = temCompensacao && entrada.usar_compensacao;

  const calculado = calculadoParaAGuia(g, estado, e.delta, usar);
  const justificativa = entrada.justificativa.trim();
  if (Math.abs(r2(valorGuia - calculado)) >= 0.01 && justificativa.length < JUSTIFICATIVA_MINIMA) {
    return {
      ok: false,
      message: `Explique a diferença entre a guia da contabilidade e o valor calculado (mínimo ${JUSTIFICATIVA_MINIMA} caracteres).`,
    };
  }

  // O calculado que se guarda: na diferença, o apurado inteiro de hoje (é o
  // que a próxima comparação usa); nas outras, o mesmo da tela.
  const valorCalculado = diferenca ? g.apurado : calculado;

  // A trava do banco compara o valor da guia com o calculado guardado. Na
  // diferença eles não se comparam (o complementar é só a parte que mudou):
  // sem texto da pessoa, a justificativa registra de onde veio o valor.
  let textoFinal: string | null = justificativa || null;
  if (diferenca && Math.abs(r2(valorGuia - valorCalculado)) >= 0.01 && justificativa.length < JUSTIFICATIVA_MINIMA) {
    const anterior = r2(g.apurado - e.delta);
    const quando = e.aprovacao?.data ? ` (aprovado em ${dataBr(e.aprovacao.data)})` : "";
    textoFinal =
      e.delta > 0
        ? `Complementar: o calculado subiu de ${formatBRL(anterior)}${quando} para ${formatBRL(g.apurado)}.`
        : `Saldo a compensar: o calculado caiu de ${formatBRL(anterior)}${quando} para ${formatBRL(g.apurado)}.`;
  }

  const compensacoes = usar ? (g.compensacoes ?? []).map((c) => c.id) : [];
  const memoria = temCompensacao && !usar ? g.memoria.filter((m) => m.grupo !== "compensacao") : g.memoria;

  let cotas: Cota[] | null = null;
  if (g.periodo === "trimestral" && !diferenca) {
    for (const jp of entrada.juros_pct ?? []) {
      if (jp !== null && (!Number.isFinite(jp) || jp < 0 || jp > 100)) {
        return { ok: false, message: "Os juros das cotas precisam ficar entre 0% e 100%." };
      }
    }
    cotas = cotasDaAprovacao(valorGuia, g.competencia, e.cidadeDaMatriz, e.cadastro, entrada.cota_unica, entrada.juros_pct);
  }

  const aprovacao: AprovacaoFiscal = {
    chave: g.chave,
    data: e.hoje,
    valor_calculado: valorCalculado,
    valor_guia: valorGuia,
    diferenca,
    compensacoes_usadas: compensacoes,
    cotas,
  };
  const titulos = titulosDaAprovacao(g, aprovacao);

  // As travas do banco, conferidas antes: os principais fecham com a guia e
  // cada rateio fecha com o valor do seu título, sem parte zerada.
  const somaPrincipal = r2(titulos.reduce((s, t) => s + t.principal, 0));
  if (Math.abs(somaPrincipal - valorGuia) >= 0.005) {
    return { ok: false, message: `Os títulos (${formatBRL(somaPrincipal)}) não fecham com o valor da guia (${formatBRL(valorGuia)}).` };
  }
  const pTitulos: TituloDoPedido[] = [];
  for (const t of titulos) {
    const rateio = t.rateio
      .filter((r) => r.valor > 0)
      .map((r) => ({ empresa_id: r.empresa_id, regional_id: r.regional_id, valor: r2(r.valor) }));
    const soma = r2(rateio.reduce((s, r) => s + r.valor, 0));
    if (!rateio.length || Math.abs(soma - t.valor) >= 0.005) {
      return {
        ok: false,
        message: "Esta guia não tem como repartir o valor entre as empresas e regionais (nenhuma nota ou custo com job).",
      };
    }
    pTitulos.push({
      cota_numero: t.cota_numero,
      cota_total: t.cota_total,
      juros_pct: t.juros_pct,
      vencimento: t.vencimento,
      principal: t.principal,
      juros: t.juros,
      valor: t.valor,
      descricao: t.descricao,
      rateio,
    });
  }

  return {
    ok: true,
    pedido: {
      p_chave: g.chave,
      p_tributo: g.tributo,
      p_empresa_contabil_id: g.empresa_contabil_id,
      p_estabelecimento_id: g.estabelecimento_id,
      p_competencia: g.competencia,
      p_periodo: g.periodo,
      p_rotulo_competencia: g.rotulo_competencia,
      p_titulo: g.titulo,
      p_codigo_receita: g.codigo,
      p_valor_calculado: valorCalculado,
      p_valor_guia: valorGuia,
      p_justificativa: textoFinal,
      p_diferenca: diferenca,
      p_compensacoes: compensacoes,
      p_cotas: cotas,
      p_memoria: memoria,
      p_rateio: g.rateio,
      p_titulos: pTitulos,
    },
  };
}
