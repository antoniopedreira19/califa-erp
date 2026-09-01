import type { ItemBv, TipoCusto, VersaoOrcamentoItem } from "@/lib/types";
import {
  calcularTotaisVersao,
  type QuebraSave,
} from "@/lib/calculos/versao-totais";
import type {
  GrupoRascunho,
  ItemRascunho,
  JobRascunho,
  ParametrosVersao,
} from "./tipos";

/** Ids locais do rascunho. Só servem para o React reconciliar listas e
 *  para o adaptador achar a linha que mudou — nenhum deles chega ao
 *  banco, onde os ids reais nascem no salvamento. */
let sequencia = 0;
export function novoId(prefixo: string): string {
  sequencia += 1;
  return `${prefixo}-${sequencia}`;
}

export const ITEM_VAZIO: Omit<ItemRascunho, "id"> = {
  item: "",
  tipo_custo: "A",
  categoria_id: null,
  valor_unitario_orcado: 0,
  quantidade_orcada: 1,
  dias_meses_orcado: 1,
  valor_unitario_planejado: 0,
  quantidade_planejada: 1,
  dias_meses_planejado: 1,
  planilha_origem: null,
  em_save: false,
  save_consumido: 0,
  bv: null,
};

export function totalOrcadoDe(item: ItemRascunho): number {
  return (
    item.valor_unitario_orcado * item.quantidade_orcada * item.dias_meses_orcado
  );
}

export function totalPlanejadoDe(item: ItemRascunho): number {
  return (
    item.valor_unitario_planejado *
    item.quantidade_planejada *
    item.dias_meses_planejado
  );
}

/**
 * Veste o item do rascunho de `VersaoOrcamentoItem` para a planilha poder
 * ser a mesma da tela da versão. Os campos que só existem no banco viram
 * placeholder — a grade não lê nenhum deles — e os dois totais, que lá são
 * colunas GENERATED, são calculados aqui pela mesma fórmula.
 */
export function comoItemDaVersao(
  item: ItemRascunho,
  grupoId: string,
  ordem: number,
): VersaoOrcamentoItem {
  return {
    id: item.id,
    tenant_id: "",
    versao_orcamento_id: "",
    grupo_id: grupoId,
    ordem,
    planilha_origem: item.planilha_origem,
    item: item.item,
    tipo_custo: item.tipo_custo,
    valor_unitario_orcado: item.valor_unitario_orcado,
    quantidade_orcada: item.quantidade_orcada,
    dias_meses_orcado: item.dias_meses_orcado,
    total_orcado: totalOrcadoDe(item),
    // O editor multi-job não marca save — mas quando reabre um orçamento
    // que já tem, a marca vem junto, senão o fechamento voltaria a ser o
    // de antes do save. Linha nova nasce neutra, e aí os três fechamentos
    // de `calcularTotaisVersao` coincidem.
    em_save: item.em_save === true,
    save_consumido: Number(item.save_consumido ?? 0),
    categoria_id: item.categoria_id,
    valor_unitario_planejado: item.valor_unitario_planejado,
    quantidade_planejada: item.quantidade_planejada,
    dias_meses_planejado: item.dias_meses_planejado,
    total_planejado: totalPlanejadoDe(item),
    // Rascunho não tem BV congelado: nada foi aprovado ainda, então a
    // dedução é sempre calculada a partir do BV que está na tela.
    bv_liquido_planejado: null,
    fornecedor_id: null,
    observacoes: null,
    created_at: "",
    updated_at: "",
  };
}

/** Mesmo disfarce, para o BV: a grade só lê valor, fornecedor, prazo e
 *  situação — e no rascunho a situação é sempre "a negociar". */
export function comoBvDaVersao(item: ItemRascunho): ItemBv | null {
  if (!item.bv) return null;
  return {
    id: `bv-${item.id}`,
    tenant_id: "",
    item_versao_id: item.id,
    // Rascunho não tem job, logo não tem cópia em que pendurar o BV.
    job_item_orcado_id: null,
    fornecedor_id: item.bv.fornecedor_id,
    valor: item.bv.valor,
    prazo_repasse: item.bv.prazo_repasse,
    situacao: "a_negociar",
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

export function itensDoJob(job: JobRascunho): ItemRascunho[] {
  return job.grupos.flatMap((g) => g.itens);
}

export interface TotaisJob {
  orcado: number;
  /** Base da rentabilidade — sem as linhas em save (decisão 028 §9). */
  orcadoRentabilidade: number;
  planejado: number;
  rentabilidade: number;
  /** O que a California emite nota. */
  faturamentoPrevisto: number;
  /** Compromisso total do cliente. */
  valorJob: number;
  imposto: number;
  honorarios: number;
  subtotaisPorTipo: Record<TipoCusto, number>;
  /** A repartição do orçado entre save usado, save gerado e custos do job
   *  — alimenta a divisão por função do save no card de Totais. */
  save: QuebraSave;
  /** Taxa efetivamente usada neste job — a do cabeçalho, ou a detectada na
   *  planilha importada. O consolidado do projeto mostra a média delas. */
  percentualHonorarios: number;
}

/** Honorários vem do cadastro do cliente e vence qualquer outra fonte —
 *  inclusive o percentual escrito dentro da planilha importada (decisão de
 *  11/08/2026). O valor lido da planilha continua no rascunho só para
 *  avisar quem importou que ele foi ignorado: ver `divergenciaHonorarios`. */
export function honorariosDoJob(
  _job: JobRascunho,
  parametros: ParametrosVersao,
): number {
  return parametros.percentual_honorarios;
}

/** Percentual que a planilha trazia quando ele difere do cadastro do
 *  cliente. `null` = sem planilha, ou planilha alinhada com o cadastro. */
export function divergenciaHonorarios(
  job: JobRascunho,
  parametros: ParametrosVersao,
): number | null {
  const daPlanilha = job.percentualHonorariosDetectado;
  if (daPlanilha === null) return null;
  return daPlanilha === parametros.percentual_honorarios ? null : daPlanilha;
}

export function totaisDoJob(
  job: JobRascunho,
  parametros: ParametrosVersao,
): TotaisJob {
  const itens = itensDoJob(job);
  const orcado = itens.reduce((s, it) => s + totalOrcadoDe(it), 0);
  // Base da rentabilidade: sem as linhas em save, que são venda sem
  // execução e não têm custo a comparar (decisão 028 §9).
  const orcadoRentabilidade = itens.reduce(
    (s, it) => s + (it.em_save === true ? 0 : totalOrcadoDe(it)),
    0,
  );
  const planejado = itens.reduce((s, it) => s + totalPlanejadoDe(it), 0);
  const percentualHonorarios = honorariosDoJob(job, parametros);
  const {
    faturamentoPrevisto,
    valorJob,
    imposto,
    honorarios,
    subtotaisPorTipo,
    save,
  } = calcularTotaisVersao(
      itens.map((it) => ({
        tipo_custo: it.tipo_custo,
        total_orcado: totalOrcadoDe(it),
        em_save: it.em_save === true,
        save_consumido: Number(it.save_consumido ?? 0),
      })),
      percentualHonorarios,
      parametros.percentual_imposto,
    );
  return {
    orcado,
    orcadoRentabilidade,
    planejado,
    rentabilidade: orcadoRentabilidade - planejado,
    faturamentoPrevisto,
    valorJob,
    imposto,
    honorarios,
    subtotaisPorTipo,
    save,
    percentualHonorarios,
  };
}

export function contarItens(grupos: GrupoRascunho[]): number {
  return grupos.reduce((s, g) => s + g.itens.length, 0);
}
