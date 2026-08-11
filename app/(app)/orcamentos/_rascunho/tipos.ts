import type { TipoCusto } from "@/lib/types";

/**
 * O rascunho do orçamento do projeto.
 *
 * Nada aqui existe no banco enquanto o usuário não clicar em "Salvar
 * orçamentos": o editor monta vários orçamentos de job juntos e grava
 * todos de uma vez, cada um na sua versão v1. Por isso os ids são locais
 * (`job-1`, `g-3`, `it-12`) e servem só para o React reconciliar listas.
 *
 * O mesmo formato atravessa a fronteira cliente → servidor no salvamento,
 * então não pode conter `File`, `Map` nem nada que não sobreviva ao JSON.
 * O arquivo da planilha importada viaja à parte, no FormData.
 */

/** BV de um item do rascunho. Vira uma linha em `itens_bv` no salvamento,
 *  sempre em "A negociar" — confirmar é ato do financeiro, na tela da
 *  versão, e não pode acontecer antes do orçamento existir. */
export interface BvRascunho {
  fornecedor_id: string | null;
  valor: number;
  prazo_repasse: string | null;
}

export interface ItemRascunho {
  id: string;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  /** Rastro da linha do XLSX, quando o item veio de importação. */
  planilha_origem: string | null;
  bv: BvRascunho | null;
}

export interface GrupoRascunho {
  id: string;
  nome: string;
  itens: ItemRascunho[];
}

/** Dados do formulário de orçamento — os mesmos campos da tela de sempre. */
export interface DadosOrcamentoRascunho {
  nome: string;
  categoria_id: string | null;
  regional_id: string;
  cidade_id: string;
  gp_responsavel_id: string;
  produtor_id: string;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
}

export interface JobRascunho extends DadosOrcamentoRascunho {
  id: string;
  aberto: boolean;
  /** `null` = ainda sem planilha (mostra importar / criar). */
  origem: "importado" | "manual" | null;
  grupos: GrupoRascunho[];
  /** Nome do arquivo importado, para o rótulo do card. O arquivo em si
   *  fica fora do rascunho serializável (ver `arquivosPorJob` no editor). */
  arquivoNome: string | null;
  /** % de honorários lido da planilha. NÃO é aplicado — o cadastro do
   *  cliente vence. Fica aqui só para avisar quem importou (11/08/2026). */
  percentualHonorariosDetectado: number | null;
}

/** Parâmetros que valem para todas as versões v1 criadas de uma vez. */
export interface ParametrosVersao {
  moeda: string;
  taxa_cambio: number;
  percentual_honorarios: number;
  percentual_imposto: number;
}

// ============================================================
// Visão agregada: orçamentos que já existem no banco
// ============================================================

/**
 * Um orçamento do projeto na tela editável.
 *
 * `origemBanco` presente ⇒ o orçamento já existe: os ids dos grupos e itens
 * são reais e o salvamento reconcilia contra o que está gravado. Ausente ⇒
 * é um orçamento novo, montado ali e criado do zero no salvamento — o mesmo
 * caso do editor de orçamento do projeto.
 */
export interface OrigemBanco {
  orcamentoId: string;
  versaoId: string;
  numeroVersao: number;
  codigo: string;
  statusOrcamento: string;
  statusVersao: string;
  /** `null` = editável. Preenchido, é o motivo de a planilha ser só leitura
   *  (versão aprovada, job já aberto pelo financeiro). */
  bloqueio: string | null;
}

export interface OrcamentoRascunho extends JobRascunho {
  /** Ausente nos orçamentos criados nesta sessão. */
  origemBanco?: OrigemBanco;
  /** Parâmetros próprios: na visão agregada cada orçamento tem os seus. */
  parametros: ParametrosVersao;
}

// ============================================================
// Payload do salvamento (cliente → Server Action)
// ============================================================

export interface ItemPayload {
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  planilha_origem: string | null;
  bv: BvRascunho | null;
}

export interface GrupoPayload {
  nome: string;
  itens: ItemPayload[];
}

export interface JobPayload extends DadosOrcamentoRascunho {
  grupos: GrupoPayload[];
  /** Nome do campo do FormData onde vai o XLSX original, quando o job
   *  veio de importação. O servidor reparseia o arquivo para gravar
   *  `orcamento_importacoes` com contagens em que se pode confiar — os
   *  itens, esses, vêm do payload, porque o usuário pode ter editado a
   *  planilha depois de importar. */
  arquivoCampo: string | null;
}

export interface OrcamentoProjetoPayload extends ParametrosVersao {
  jobs: JobPayload[];
}

// ============================================================
// Payload do "Salvar alterações" (visão agregada)
// ============================================================

/**
 * O estado desejado de UM orçamento que já existe.
 *
 * Vai o estado inteiro, não um diff: o servidor carrega o que está gravado
 * e reconcilia por id. Quem não aparece aqui foi removido; item com `id`
 * é atualizado; item sem `id` é novo. Deixar a conta no servidor evita que
 * o cliente precise rastrear remoções — e é lá que o tenant e as travas de
 * versão aprovada são conferidos de qualquer forma.
 */
export interface ItemEdicaoPayload extends ItemPayload {
  /** `null` = item novo nesta versão. */
  id: string | null;
  /** Id local da linha na tela. O servidor devolve o id real das novas por
   *  aqui, para o editor trocar sem depender de recarregar a página — sem
   *  isso, salvar duas vezes seguidas inseriria a mesma linha de novo. */
  localId: string;
}

export interface GrupoEdicaoPayload {
  /** `null` = grupo novo nesta versão. */
  id: string | null;
  localId: string;
  nome: string;
  itens: ItemEdicaoPayload[];
}

export interface OrcamentoEdicaoPayload {
  orcamentoId: string;
  versaoId: string;
  parametros: ParametrosVersao;
  grupos: GrupoEdicaoPayload[];
}

export interface AlteracoesProjetoPayload {
  /** Orçamentos já gravados cujo conteúdo mudou. */
  editados: OrcamentoEdicaoPayload[];
  /** Orçamentos criados nesta sessão — mesmo caminho do editor multi-jobs. */
  novos: JobPayload[];
  /** Parâmetros dos novos, um conjunto por orçamento. */
  parametrosNovos: ParametrosVersao[];
}

export const PARAMETROS_PADRAO: ParametrosVersao = {
  moeda: "BRL",
  taxa_cambio: 1,
  percentual_honorarios: 0,
  percentual_imposto: 0,
};
