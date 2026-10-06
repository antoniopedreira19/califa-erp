import type { CategoriaModeloPlanilha, TipoCusto } from "@/lib/types";
import type { EstagioFunil } from "@/lib/calculos/funil";
import { ALIQUOTA_IMPOSTO_PADRAO } from "@/lib/impostos";

/**
 * O estado da visão agregada: os orçamentos do projeto como a tela os edita.
 *
 * Até 06/10/2026 isto era um rascunho que só ia ao banco no "Salvar
 * alterações". Desde a decisão 148 cada alteração grava na hora e os ids
 * são os do banco. Sobra um id local só na linha em branco que o "Criar
 * planilha" e o "Novo grupo" abrem (`it-12`): ela fica na tela até ganhar
 * descrição, como a linha provisória da tela da versão.
 */

/** O BV de um item no formato da tela. Na agregada a janela do BV lê e
 *  grava a lista do banco (`bvsPorItem`); este campo só acompanha o item. */
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
  /** A linha vira crédito para outro job (decisão 028). O editor
   *  multi-job não MARCA save — quem marca é a tela da versão —, mas
   *  precisa carregar a marca para o fechamento não mentir ao reabrir um
   *  orçamento que já tem save. */
  em_save?: boolean;
  /** Quanto do principal desta linha é pago por crédito de outro job.
   *  Ausente = zero: item novo e planilha importada nascem sem save. */
  save_consumido?: number;
  bv: BvRascunho | null;
}

export interface GrupoRascunho {
  id: string;
  nome: string;
  /** Mês do grupo no orçamento de Fee ou Always On (decisão 078): o id em
   *  `versoes_orcamento_meses`. `null` nos outros modelos. Obrigatório — o
   *  grupo sem mês some de todas as telas do mensal. */
  mesId: string | null;
  itens: ItemRascunho[];
}

/** Dados do formulário de orçamento — os mesmos campos da tela de sempre. */
export interface DadosOrcamentoRascunho {
  nome: string;
  categoria_id: string | null;
  /** Serviço do job. Desceu do projeto em 02/09/2026 (decisão 037) e lê
   *  `categorias_dominio` com escopo `projeto`. */
  servico_id: string | null;
  /** Adianta o Descritivo do envio para abertura. */
  descritivo: string | null;
  regional_id: string;
  cidade_id: string;
  gp_responsavel_id: string;
  produtor_id: string;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
}

export interface JobRascunho extends DadosOrcamentoRascunho {
  id: string;
  /** Nome da cidade, só para o rótulo do card. Fica fora de
   *  `DadosOrcamentoRascunho` de propósito: o payload manda `cidade_id` e
   *  o servidor resolve o nome sozinho. Vem junto porque a tela não tem
   *  mais a lista completa de cidades para consultar por id — o combobox
   *  busca no servidor e só ele conhece o par. */
  cidade_nome: string;
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
  // ---- Cadeia internacional (decisão 072).
  //
  // São colunas da VERSÃO, e por isso moram aqui. O que NÃO mora aqui é o
  // modelo de planilha: ele é da categoria do orçamento, e está em
  // `OrcamentoRascunho.modeloPlanilha`.
  //
  // Obrigatórios: campo opcional num tipo montado à mão é como o valor do
  // servidor some sem ninguém notar (CLAUDE.md).
  percentual_int_taxes: number;
  int_transaction_costs: number;
  moeda_estrangeira: string | null;
  cambio_compra: number | null;
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
  statusOrcamento: string;
  statusVersao: string;
  /** `null` = editável. Preenchido, é o motivo de a planilha ser só leitura
   *  (versão aprovada, job já aberto pelo financeiro). */
  bloqueio: string | null;
  /** Estágio do funil comercial (`lib/calculos/funil.ts`) — o chip dos
   *  seletores "Exibir" e "Exportar" da visão agregada. Opcional porque o
   *  editor multi-jobs, que também usa este tipo, não carrega jobs. */
  estagio?: EstagioFunil;
}

export interface OrcamentoRascunho extends JobRascunho {
  /** Ausente nos orçamentos criados nesta sessão. */
  origemBanco?: OrigemBanco;
  /** Parâmetros próprios: na visão agregada cada orçamento tem os seus. */
  parametros: ParametrosVersao;
  /** Qual fechamento este orçamento usa — da categoria dele (decisão 072).
   *
   *  Fica FORA de `parametros` de propósito: os de lá são colunas da
   *  versão, que o usuário edita no modal; este é da categoria, e o
   *  usuário não mexe nele. Num projeto com orçamento nacional e
   *  internacional, cada linha fecha pela sua cadeia e o consolidado soma
   *  os fechamentos — a mesma ideia que o card já usa para taxas
   *  diferentes. */
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Os meses da versão, no orçamento de Fee ou Always On (decisão 078):
   *  o card os empilha, cada um com a sua planilha. Vazio nos outros
   *  modelos. Na agregada eles não mudam — criar, apagar e copiar mês é da
   *  tela do orçamento (Tiago, 16/09/2026). */
  meses: { id: string; mes: string }[];
}

// ============================================================
// A planilha lida na importação (`importar-planilha-modal.tsx`)
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

/** Parâmetros de um orçamento NOVO nos editores multi e agregado. Os
 *  honorários chegam por cima, do cadastro do cliente; a alíquota de
 *  imposto já vem escolhida desde 03/09/2026. */
export const PARAMETROS_PADRAO: ParametrosVersao = {
  moeda: "BRL",
  taxa_cambio: 1,
  percentual_honorarios: 0,
  percentual_imposto: ALIQUOTA_IMPOSTO_PADRAO,
  // Orçamento novo nasce nacional: quem define o internacional é a
  // categoria escolhida no formulário, e aí `criarVersaoInicial` grava os
  // valores de partida (decisão 072).
  percentual_int_taxes: 0,
  int_transaction_costs: 0,
  moeda_estrangeira: null,
  cambio_compra: null,
};
