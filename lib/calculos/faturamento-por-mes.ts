/**
 * O faturamento de cada mês de um job do modelo mensal — Fee e Always On
 * (decisão 078, entrega 3).
 *
 * O mês mora no GRUPO da versão aprovada (`versoes_orcamento_grupos.mes_id`)
 * e o item do job aponta para o grupo. Cada mês fecha pela MESMA conta da
 * planilha (`calcularTotaisVersao`, com os percentuais da versão): é o
 * valor que o envio daquele mês leva para o financeiro e o que a previsão
 * de recebimento daquele mês espera.
 *
 * Função pura: quem chama traz os itens (da cópia do job, com as erratas),
 * os grupos e os meses.
 */

import {
  calcularTotaisVersao,
  type ItemParaTotais,
  type ParametrosInternacionais,
} from "./versao-totais";

export interface MesDoJob {
  id: string;
  /** Primeiro dia do mês, `yyyy-mm-dd`. */
  mes: string;
}

export interface GrupoComMes {
  id: string;
  mes_id: string | null;
}

export type ItemComGrupo = ItemParaTotais & { grupo_id: string };

export interface FaturamentoDoMes {
  mesId: string;
  mes: string;
  /** O que a California emite nota naquele mês. */
  faturamento: number;
  /** Quanto do `faturamento` é receita de save (linhas em save do mês). */
  save: number;
  qtdItens: number;
}

function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Um valor por mês, na ordem dos meses. Item de grupo sem mês não entra
 *  em mês nenhum — num job mensal ele não deveria existir. */
export function faturamentoPorMes(
  meses: MesDoJob[],
  grupos: GrupoComMes[],
  itens: ItemComGrupo[],
  percentualHonorarios: number,
  percentualImposto: number,
  internacional: ParametrosInternacionais | null = null,
): FaturamentoDoMes[] {
  const mesDoGrupo = new Map(grupos.map((g) => [g.id, g.mes_id]));
  return [...meses]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((m) => {
      const itensDoMes = itens.filter((it) => mesDoGrupo.get(it.grupo_id) === m.id);
      const totais = calcularTotaisVersao(
        itensDoMes,
        percentualHonorarios,
        percentualImposto,
        internacional,
      );
      return {
        mesId: m.id,
        mes: m.mes,
        faturamento: centavos(totais.faturamentoPrevisto),
        save: centavos(totais.save.receita),
        qtdItens: itensDoMes.length,
      };
    });
}

/**
 * A data de recebimento de um mês: o dia informado, no mês SEGUINTE ao de
 * referência (Tiago, 14/09/2026 — julho recebe em 20/08). Dia que o mês
 * não tem vira o último dia dele (31 em setembro → 30/09).
 */
export function dataDeRecebimentoDoMes(mes: string, dia: number): string {
  const [ano, mesNum] = mes.slice(0, 7).split("-").map(Number);
  const anoSeguinte = mesNum === 12 ? ano + 1 : ano;
  const mesSeguinte = mesNum === 12 ? 1 : mesNum + 1;
  const ultimoDia = new Date(Date.UTC(anoSeguinte, mesSeguinte, 0)).getUTCDate();
  const diaNoMes = Math.min(Math.max(1, Math.trunc(dia)), ultimoDia);
  return `${anoSeguinte}-${String(mesSeguinte).padStart(2, "0")}-${String(diaNoMes).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// A situação de cada mês na barra de faturamento do job (entrega 3)

/** A enviar → na fila do financeiro → faturado parcial → faturado. Não
 *  existe "devolvido": o envio é definitivo (Tiago, 14/09/2026).
 *
 *  `sem_faturamento`: mês cuja planilha não fatura nada (só custo pago
 *  direto pelo cliente). Não tem o que enviar, e por isso não segura o
 *  encerramento nem a liquidação do job. */
export type SituacaoDoMes =
  | "a_enviar"
  | "na_fila"
  | "faturado_parcial"
  | "faturado"
  | "sem_faturamento";

export interface ParcelaDoEnvio {
  id: string;
  ordem: number;
  valor: number;
  data_vencimento: string;
}

export interface EnvioDoJobComParcelas {
  id: string;
  /** Nulo no envio único dos jobs que não são mensais. */
  mes: string | null;
  valor_faturado: number;
  valor_save: number | null;
  data_faturamento: string;
  numero_po: string | null;
  descricao_nf: string | null;
  portal_url: string | null;
  enviado_em: string;
  parcelas: ParcelaDoEnvio[];
}

/** Item de nota EMITIDA que cobre uma parcela de envio. */
export interface ItemDeNotaDaParcela {
  envio_parcela_id: string;
  valor: number | string;
  faturamento: { numero_nf: string | null; data_emissao: string | null } | null;
}

export interface NotaDoMes {
  numero: string | null;
  dataEmissao: string | null;
  valor: number;
}

export interface MesDeFaturamento extends FaturamentoDoMes {
  envio: EnvioDoJobComParcelas | null;
  /** Quanto das parcelas do envio já saiu em nota emitida. */
  faturado: number;
  notas: NotaDoMes[];
  situacao: SituacaoDoMes;
}

export function situacaoDoMes(
  envio: EnvioDoJobComParcelas | null,
  faturado: number,
): SituacaoDoMes {
  if (!envio) return "a_enviar";
  if (faturado <= 0.004) return "na_fila";
  return faturado >= envio.valor_faturado - 0.01 ? "faturado" : "faturado_parcial";
}

/** Um mês por linha: o valor pela planilha, o envio dele (se houve), as
 *  notas emitidas sobre as parcelas e a situação. */
export function montarFaturamentoMensal({
  meses,
  grupos,
  itens,
  percentualHonorarios,
  percentualImposto,
  envios,
  itensDeNota,
}: {
  meses: MesDoJob[];
  grupos: GrupoComMes[];
  itens: ItemComGrupo[];
  percentualHonorarios: number;
  percentualImposto: number;
  envios: EnvioDoJobComParcelas[];
  itensDeNota: ItemDeNotaDaParcela[];
}): MesDeFaturamento[] {
  const envioPorMes = new Map(
    envios.filter((e) => e.mes !== null).map((e) => [e.mes as string, e]),
  );

  return faturamentoPorMes(
    meses,
    grupos,
    itens,
    percentualHonorarios,
    percentualImposto,
  ).map((m) => {
    const envio = envioPorMes.get(m.mes) ?? null;
    const { faturado, notas } = notasDoEnvio(envio, itensDeNota);
    const situacao: SituacaoDoMes =
      !envio && m.faturamento <= 0 ? "sem_faturamento" : situacaoDoMes(envio, faturado);
    return { ...m, envio, faturado, notas, situacao };
  });
}

/**
 * Quanto do envio já saiu em nota EMITIDA, e quais notas — uma por número e
 * data de emissão, somando os itens que cobrem parcelas do mesmo envio.
 * Serve ao envio de cada mês e ao envio único do job normal, que desde a
 * decisão 087 (16/09/2026) ganhou o mesmo "Ver envio" do mensal.
 */
export function notasDoEnvio(
  envio: EnvioDoJobComParcelas | null,
  itensDeNota: ItemDeNotaDaParcela[],
): { faturado: number; notas: NotaDoMes[] } {
  if (!envio) return { faturado: 0, notas: [] };
  const parcelas = new Set(envio.parcelas.map((par) => par.id));
  let faturado = 0;
  const notas = new Map<string, NotaDoMes>();
  for (const it of itensDeNota) {
    if (!parcelas.has(it.envio_parcela_id)) continue;
    const valor = Number(it.valor ?? 0);
    faturado += valor;
    const chave = `${it.faturamento?.numero_nf ?? "—"}|${it.faturamento?.data_emissao ?? ""}`;
    const nota = notas.get(chave) ?? {
      numero: it.faturamento?.numero_nf ?? null,
      dataEmissao: it.faturamento?.data_emissao ?? null,
      valor: 0,
    };
    nota.valor = centavos(nota.valor + valor);
    notas.set(chave, nota);
  }
  return {
    faturado: centavos(faturado),
    notas: [...notas.values()].sort((a, b) =>
      (a.dataEmissao ?? "").localeCompare(b.dataEmissao ?? ""),
    ),
  };
}

/** O faturamento do job que não é mensal: um envio só (decisão 087). */
export interface FaturamentoDoEnvioUnico {
  envio: EnvioDoJobComParcelas | null;
  faturado: number;
  notas: NotaDoMes[];
  situacao: SituacaoDoMes;
}

export function montarFaturamentoDoEnvioUnico({
  envio,
  itensDeNota,
  semFaturamento,
}: {
  envio: EnvioDoJobComParcelas | null;
  itensDeNota: ItemDeNotaDaParcela[];
  /** Nada a faturar: faturamento previsto zero, como o job pago só por
   *  save (decisão 028 §11). */
  semFaturamento: boolean;
}): FaturamentoDoEnvioUnico {
  const { faturado, notas } = notasDoEnvio(envio, itensDeNota);
  const situacao: SituacaoDoMes =
    !envio && semFaturamento ? "sem_faturamento" : situacaoDoMes(envio, faturado);
  return { envio, faturado, notas, situacao };
}
