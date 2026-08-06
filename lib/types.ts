/**
 * Tipos compartilhados do domínio ERP California.
 * Espelham os enums e tabelas criados pela migration da Task 001.
 */

export type AppRole = "administrador" | "gestao_projetos" | "financeiro";

export type TenantStatus = "ativo" | "inativo";

export type TenantMemberStatus = "ativo" | "inativo";

export interface Tenant {
  id: string;
  nome: string;
  slug: string;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  nome: string;
  email: string;
  role: AppRole;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: AppRole;
  status: TenantMemberStatus;
  created_at: string;
  updated_at: string;
}

export interface TenantMembership {
  tenant: Tenant;
  role: AppRole;
  status: TenantMemberStatus;
}

export interface SessionContext {
  profile: Profile;
  memberships: TenantMembership[];
  /** Tenant "ativo" — no MVP é sempre o primeiro (Agência California). */
  activeTenant: Tenant;
  /** Role do usuário dentro do tenant ativo. */
  activeRole: AppRole;
}

export function isAdmin(role: AppRole): boolean {
  return role === "administrador";
}

export function roleLabel(role: AppRole): string {
  switch (role) {
    case "administrador":
      return "Administrador";
    case "gestao_projetos":
      return "Gestão de Projetos";
    case "financeiro":
      return "Financeiro";
  }
}

// ---------- Task 002: clientes e fornecedores ----------

export type TipoPessoa = "fisica" | "juridica";
export type CadastroStatus = "ativo" | "inativo";

// ---------- Task fornecedor-dados-completos: endereço, banco, PIX ----------

export type TipoContaBancariaFornecedor = "corrente" | "poupanca" | "pagamento";
export type PixTipoChave = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export type UF =
  | "AC" | "AL" | "AP" | "AM" | "BA" | "CE" | "DF" | "ES" | "GO"
  | "MA" | "MT" | "MS" | "MG" | "PA" | "PB" | "PR" | "PE" | "PI"
  | "RJ" | "RN" | "RS" | "RO" | "RR" | "SC" | "SP" | "SE" | "TO";

// ---------- Task 009: empresas (múltiplos CNPJs por tenant) ----------

export interface Empresa {
  id: string;
  tenant_id: string;
  regional_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;                  // 14 dígitos
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: UF;
  cep: string;                   // 8 dígitos
  telefone: string | null;       // 10 ou 11 dígitos
  email: string | null;
  local_pagamento: string | null;
  instrucoes_nf: string | null;
  principal: boolean;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Cliente {
  id: string;
  tenant_id: string;
  nome_fantasia: string;
  codigo_curto: string;
  razao_social: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  observacoes: string | null;
  status: CadastroStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Fornecedor {
  id: string;
  tenant_id: string;
  tipo_pessoa: TipoPessoa;
  nome: string;
  razao_social: string | null;
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
  observacoes: string | null;
  status: CadastroStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  // Endereço estruturado (Task fornecedor-dados-completos)
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: UF | null;

  // Dados bancários
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  agencia_dv: string | null;
  conta: string | null;
  conta_dv: string | null;
  tipo_conta: TipoContaBancariaFornecedor | null;

  // PIX
  pix_tipo: PixTipoChave | null;
  pix_chave: string | null;
}

// ---------- Task 007: projetos ----------

export type ProjetoStatus = "ativo" | "arquivado";

export interface Projeto {
  id: string;
  tenant_id: string;
  empresa_id: string;
  codigo: string;
  nome: string;
  /** Saiu do formulário no handoff de 30/07/2026; a coluna e os dados
   *  gravados continuam (a busca da lista ainda casa por campanha). */
  campanha: string | null;
  categoria_id: string | null;
  cliente_id: string;
  /** Produto do cadastro do cliente (`cliente_produtos`). Herdado pelo job
   *  na abertura. Nullable no banco por causa dos projetos anteriores a
   *  06/08/2026; obrigatório no formulário. */
  produto_id: string | null;
  /** Compatibilidade: primeiro responsável selecionado. A lista completa
   *  vive em `projeto_responsaveis`. Não confundir com `created_by`, que
   *  registra quem cadastrou o projeto. */
  responsavel_id: string;
  /** Compatibilidade: primeira regional selecionada. A lista completa vive
   *  em `projeto_regionais`. */
  regional_id: string | null;
  /** Legado: Cidade saiu do formulário do projeto em 06/08/2026 e passou a
   *  ser informada no orçamento. A coluna e os dados continuam. */
  cidade_id: string | null;
  status: ProjetoStatus;
  data_inicio_prevista: string;
  data_fim_prevista: string | null;
  descricao: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function projetoStatusLabel(s: ProjetoStatus): string {
  switch (s) {
    case "ativo":
      return "Ativo";
    case "arquivado":
      return "Arquivado";
  }
}

// ---------- Task 003: orçamentos ----------

export type OrcamentoStatus =
  | "rascunho"
  | "em_revisao"
  | "enviado_cliente"
  | "aprovado"
  | "job_criado"
  | "recusado"
  | "cancelado";

export interface Orcamento {
  id: string;
  tenant_id: string;
  empresa_id: string;
  projeto_id: string;
  codigo: string;
  nome: string;
  status: OrcamentoStatus;
  versao_aprovada_id: string | null;
  categoria_id: string | null;
  /** Uma das regionais cadastradas no projeto. */
  regional_id: string | null;
  cidade_id: string | null;
  /** Vira `jobs.responsavel_id` na abertura. */
  gp_responsavel_id: string | null;
  /** Vira `jobs.produtor_id` na abertura. */
  produtor_id: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Status editáveis via UI. `aprovado` e `job_criado` são setados pelo
 *  sistema em Tasks 004 e 005 e ficam bloqueados aqui. */
export const ORCAMENTO_STATUS_EDITAVEIS: OrcamentoStatus[] = [
  "rascunho",
  "em_revisao",
  "enviado_cliente",
  "recusado",
  "cancelado",
];

export function orcamentoStatusLabel(s: OrcamentoStatus): string {
  switch (s) {
    case "rascunho":
      return "Rascunho";
    case "em_revisao":
      return "Em revisão";
    case "enviado_cliente":
      return "Enviado ao cliente";
    case "aprovado":
      return "Aprovado";
    case "job_criado":
      return "Job criado";
    case "recusado":
      return "Recusado";
    case "cancelado":
      return "Cancelado";
  }
}

// ---------- Task 004: versões e itens ----------

export type VersaoOrcamentoStatus =
  | "rascunho"
  | "em_revisao"
  | "enviada_cliente"
  | "aprovada"
  | "reprovada"
  | "substituida"
  | "cancelada";

export type TipoCusto = "A" | "B" | "C" | "D";

export interface VersaoOrcamento {
  id: string;
  tenant_id: string;
  orcamento_id: string;
  numero_versao: number;
  nome: string | null;
  status: VersaoOrcamentoStatus;
  moeda: string;
  taxa_cambio: number;
  percentual_honorarios: number;
  percentual_imposto: number;
  aprovado_em: string | null;
  aprovado_por: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VersaoOrcamentoGrupo {
  id: string;
  tenant_id: string;
  versao_orcamento_id: string;
  nome: string;
  ordem: number;
  created_at: string;
  updated_at: string;
}

export interface Categoria {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface VersaoOrcamentoItem {
  id: string;
  tenant_id: string;
  versao_orcamento_id: string;
  grupo_id: string;
  ordem: number;
  planilha_origem: string | null;
  item: string;
  tipo_custo: TipoCusto;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  total_orcado: number;
  /** Categoria (opcional). Vive por versão, criada via botão "Nova
   *  categoria" ou auto-preenchida pelo import da col B da planilha. */
  categoria_id: string | null;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  total_planejado: number;
  /** Legado do modelo antes de haver tabela de fornecedores por item.
   *  Mantido nullable no banco; não é mais usado nas telas. */
  fornecedor_id: string | null;
  /** Legado; não é mais usado nas telas. */
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

/** Status editáveis manualmente. `aprovada` é setada pela ação de
 *  aprovação (Fase E). */
export const VERSAO_STATUS_EDITAVEIS: VersaoOrcamentoStatus[] = [
  "rascunho",
  "em_revisao",
  "enviada_cliente",
  "reprovada",
  "substituida",
  "cancelada",
];

export function versaoStatusLabel(s: VersaoOrcamentoStatus): string {
  switch (s) {
    case "rascunho":
      return "Rascunho";
    case "em_revisao":
      return "Em revisão";
    case "enviada_cliente":
      return "Enviada ao cliente";
    case "aprovada":
      return "Aprovada";
    case "reprovada":
      return "Reprovada";
    case "substituida":
      return "Substituída";
    case "cancelada":
      return "Cancelada";
  }
}

/** Rótulos curtos dos tipos de custo (aparecem em tabelas/badges). */
export function tipoCustoLabel(t: TipoCusto): string {
  switch (t) {
    case "A":
      return "A · Fat. direto";
    case "B":
      return "B · Bi-trib.";
    case "C":
      return "C · Sem honor.";
    case "D":
      return "D · Interno";
  }
}

// ---------- Task 004 fase F: importação de planilha ----------

export interface OrcamentoImportacao {
  id: string;
  tenant_id: string;
  orcamento_id: string;
  versao_orcamento_id: string | null;
  arquivo_path: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  aba_origem: string | null;
  linhas_lidas: number;
  linhas_importadas: number;
  linhas_ignoradas: number;
  warnings: ImportacaoWarning[];
  created_by: string | null;
  created_at: string;
}

/** Aviso emitido pelo parser da planilha durante o preview / importação. */
export interface ImportacaoWarning {
  /** Linha 1-based do XLSX onde o problema apareceu. */
  linha: number;
  /** Coluna (letra) opcional para navegação. */
  coluna?: string;
  /** Mensagem legível pelo admin. */
  motivo: string;
  /** Severidade: 'ignorada' = linha descartada; 'ajuste' = importada com fallback. */
  severidade: "ignorada" | "ajuste";
}

// ---------- Categorias de domínio (projeto + orçamento) ----------

export type CategoriaDominioEscopo = "projeto" | "orcamento";

export interface CategoriaDominio {
  id: string;
  tenant_id: string;
  escopo: CategoriaDominioEscopo;
  nome: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function categoriaDominioEscopoLabel(e: CategoriaDominioEscopo): string {
  return e === "projeto" ? "Projeto" : "Orçamento";
}

// ---------- Regionais ----------

export interface Regional {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Cidades ----------

/** Cadastro próprio (não é o texto livre de `jobs.cidade`): o projeto
 *  referencia por FK para padronizar o dado. */
export interface Cidade {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Produtos do cliente ----------

/** Escopo é o CLIENTE, não o tenant: cada cliente tem sua própria lista,
 *  gerenciada dentro da tela dele. O código é sequencial por cliente. */
export interface ClienteProduto {
  id: string;
  tenant_id: string;
  cliente_id: string;
  nome: string;
  codigo: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Jobs ----------

/**
 * `em_producao` continua no enum do banco mas saiu do fluxo: ele nunca
 * separou nada — todos os gates de negócio aceitavam `aberto` OU
 * `em_producao` de forma idêntica, e a única diferença era ser um degrau
 * obrigatório até o encerramento. Job aberto pelo financeiro fica
 * "Aberto" até ser encerrado.
 */
export type JobStatus =
  | "aguardando_abertura"
  | "rejeitado_financeiro"
  | "aberto"
  | "em_producao"
  | "encerrado"
  | "cancelado";

export interface Job {
  id: string;
  tenant_id: string;
  empresa_id: string;
  codigo: string;
  projeto_id: string;
  orcamento_id: string;
  versao_orcamento_aprovada_id: string;
  nome: string;
  produto: string | null;
  regional_id: string | null;
  cidade: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  /** GP responsável, herdado do orçamento na abertura. */
  responsavel_id: string;
  /** Produtor responsável, herdado do orçamento na abertura. */
  produtor_id: string | null;
  valor_total: number | null;
  status: JobStatus;
  motivo_rejeicao: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Transições "livres" (sem role gate). Ações que exigem gate financeiro
 * (aprovar/rejeitar abertura) OU input adicional (motivo) têm server actions
 * próprias e NÃO estão nesta tabela.
 */
export const JOB_STATUS_TRANSICOES: Record<JobStatus, JobStatus[]> = {
  aguardando_abertura: ["cancelado"],
  rejeitado_financeiro: ["cancelado"],
  aberto: ["cancelado"],
  // Legado: nenhum job novo entra aqui. Mantido pra não travar quem já
  // estivesse neste status caso apareça de algum backup.
  em_producao: ["cancelado"],
  encerrado: [],
  cancelado: [],
};

/**
 * `encerrado` NÃO entra em JOB_STATUS_TRANSICOES de propósito: o fluxo de
 * encerramento ainda não existe, e a tela renderiza esse botão desabilitado
 * à parte. Deixá-lo na tabela geraria um botão ativo que encerraria o job
 * sem nenhum processo por trás.
 */
export const ENCERRAMENTO_INDISPONIVEL =
  "Em breve — o fluxo de encerramento ainda não existe";

export function jobStatusLabel(s: JobStatus): string {
  switch (s) {
    case "aguardando_abertura":
      return "Aguardando abertura";
    case "rejeitado_financeiro":
      return "Rejeitado pelo financeiro";
    case "aberto":
      return "Aberto";
    case "em_producao":
      return "Em produção";
    case "encerrado":
      return "Encerrado";
    case "cancelado":
      return "Cancelado";
  }
}

export interface JobItemRealizado {
  id: string;
  tenant_id: string;
  job_id: string;
  item_id: string;
  valor_unitario_realizado: number;
  quantidade_realizada: number;
  dias_meses_realizado: number;
  total_realizado: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Task 010: Pedidos de Produção ----------
// Tabela e colunas seguem `pedidos_compra` por compatibilidade; o nome
// visível ao usuário é "Pedido de Produção", igual ao PDF emitido.

export interface PedidoCompra {
  id: string;
  tenant_id: string;
  codigo: string;
  item_realizado_id: string;
  job_id: string;
  fornecedor_id: string;
  empresa_id: string;
  servico: string;
  quantidade: number;
  especificacoes: string | null;
  valor: number;
  prazo_pagamento: string;
  pdf_path: string;
  emitida_por: string | null;
  // Fase 2
  status: PPStatus;
  prazo_pagamento_financeiro: string | null;
  cancelada_por: string | null;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  // Ciclo de avaliação do financeiro
  pago_em: string | null;
  pago_por: string | null;
  rejeitada_por: string | null;
  rejeitada_em: string | null;
  motivo_rejeicao: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Ciclo de vida da PP. Nasce em `em_avaliacao` (o GP emitiu, o financeiro
 * ainda não olhou) e termina em `pago`, `rejeitada` ou `cancelada`.
 *
 * `rejeitada` não é terminal de verdade: o GP corrige e reenvia, e a PP
 * volta pra `em_avaliacao`. Por isso o unique parcial por item continua
 * valendo pra ela — quem libera o item é só o cancelamento.
 */
export type PPStatus = "em_avaliacao" | "pago" | "rejeitada" | "cancelada";

export function ppStatusLabel(s: PPStatus): string {
  switch (s) {
    case "em_avaliacao":
      return "Em avaliação";
    case "pago":
      return "Pago";
    case "rejeitada":
      return "Rejeitado";
    case "cancelada":
      return "Cancelada";
  }
}

/** Só PP em avaliação ou rejeitada pode ser cancelada — paga, não. */
export function podeCancelarPP(s: PPStatus): boolean {
  return s === "em_avaliacao" || s === "rejeitada";
}

// ---------- Erratas: orçado próprio do job ----------

/**
 * Cópia do item orçado que pertence ao job. Nasce igual ao item da versão
 * aprovada e só muda por errata — a versão aprovada em si continua sendo o
 * registro do que o cliente aprovou.
 */
export interface JobItemOrcado {
  id: string;
  tenant_id: string;
  job_id: string;
  /** Item de origem na versão. Liga com `jobs_itens_realizado.item_id`. */
  item_versao_id: string;
  grupo_id: string;
  ordem: number;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  total_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  total_planejado: number;
  created_at: string;
  updated_at: string;
}

/**
 * Item como a Planilha Interna consome: os valores vêm da cópia orçada do
 * job, mas `id` continua sendo o id do item na VERSÃO — é a chave que
 * `jobs_itens_realizado` e a geração de PP usam. `orcado_id` é o alvo da
 * errata.
 */
export interface ItemPlanilhaJob {
  id: string;
  orcado_id: string;
  grupo_id: string;
  ordem: number;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  total_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  total_planejado: number;
}

export interface JobErrata {
  id: string;
  tenant_id: string;
  job_id: string;
  titulo: string;
  justificativa: string | null;
  custo_orcado_antes: number;
  custo_orcado_depois: number;
  faturamento_antes: number;
  faturamento_depois: number;
  created_by: string | null;
  created_at: string;
}

export interface JobErrataItem {
  id: string;
  tenant_id: string;
  errata_id: string;
  job_item_orcado_id: string | null;
  item_nome: string;
  grupo_nome: string;
  tipo_custo_de: TipoCusto;
  tipo_custo_para: TipoCusto;
  valor_unitario_de: number;
  valor_unitario_para: number;
  total_de: number;
  total_para: number;
  efeito_faturamento: number;
}

/** Errata com os itens e o autor, como o card do histórico precisa. */
export interface JobErrataComItens extends JobErrata {
  autor_nome: string | null;
  itens: JobErrataItem[];
}

// ---------- Comunicação do job ----------

export type ChatArea = "producao" | "financeiro";

export function chatAreaLabel(a: ChatArea): string {
  return a === "financeiro" ? "Financeiro" : "Produção";
}

/**
 * A área de quem fala vem do papel, nunca do formulário — o rótulo
 * "Produção"/"Financeiro" só significa algo se ninguém puder se passar
 * pelo outro time.
 *
 * Mora aqui, e não junto das actions, porque arquivo `"use server"` exige
 * que todo export seja async.
 */
export function areaDoPapel(role: string): ChatArea {
  return role === "financeiro" || role === "administrador"
    ? "financeiro"
    : "producao";
}

export interface JobMensagem {
  id: string;
  tenant_id: string;
  job_id: string;
  autor_id: string;
  area: ChatArea;
  texto: string;
  created_at: string;
}

/** Tom do valor exibido no card automático. */
export type ChatTom = "positivo" | "negativo" | "neutro" | "texto";

export interface ChatLinha {
  texto: string;
  valor: string;
  tom: ChatTom;
}

/**
 * Um item da thread. Cards de sistema são montados na leitura a partir de
 * `jobs` e `jobs_erratas` — não existem como registro.
 */
export type ItemChat =
  | {
      tipo: "sistema";
      id: string;
      icone: "folder-open" | "file-pen-line" | "tags";
      cor: "azul" | "verde" | "bege" | "vermelho";
      titulo: string;
      quando: string;
      resumo: string;
      valor: string | null;
      valorTom: Exclude<ChatTom, "texto">;
      linhas: ChatLinha[];
      /** ISO, só pra ordenar a thread. */
      em: string;
    }
  | {
      tipo: "pessoa";
      id: string;
      autor: string;
      area: ChatArea;
      quando: string;
      texto: string;
      em: string;
    };

/** PP com os campos que as telas de lista mostram junto. */
export interface PedidoCompraNaLista extends PedidoCompra {
  emitida_por_nome: string | null;
  grupo_nome: string | null;
  anexos: Array<{
    id: string;
    arquivo_nome_original: string;
    arquivo_tamanho_bytes: number;
  }>;
}

export interface PedidoCompraAnexo {
  id: string;
  tenant_id: string;
  pedido_compra_id: string;
  arquivo_path: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  arquivo_mimetype: string;
  created_by: string | null;
  created_at: string;
}

export const PP_ANEXO_MIMETYPES_ACEITOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PPAnexoMimetype = (typeof PP_ANEXO_MIMETYPES_ACEITOS)[number];

export const PP_ANEXO_TAMANHO_MAX_BYTES = 8 * 1024 * 1024;
export const PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES = 25 * 1024 * 1024;

// ---------- Task 011: contas_bancarias (lançamentos_financeiros) ----------

export type TipoContaBancaria =
  | "corrente"
  | "poupanca"
  | "investimento"
  | "caixa";

export const tipoContaBancariaLabel = (t: TipoContaBancaria): string =>
  ({
    corrente: "Conta corrente",
    poupanca: "Poupança",
    investimento: "Investimento",
    caixa: "Caixa",
  })[t];

export interface ContaBancaria {
  id: string;
  tenant_id: string;
  empresa_id: string;
  nome: string;
  banco: string;
  agencia: string | null;
  numero_conta: string | null;
  tipo: TipoContaBancaria;
  saldo_inicial: string; // numeric vem como string do Supabase — parse com Number(...)
  saldo_inicial_data: string; // YYYY-MM-DD
  ativo: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
}

// ---------- Task 011: plano de contas (tipos + subtipos) ----------

export type NaturezaPadraoTipo = "entrada" | "saida" | "ambos";

export interface PlanoContaTipo {
  id: string;
  tenant_id: string;
  codigo: string;
  nome: string;
  natureza_padrao: NaturezaPadraoTipo;
  ordem: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanoContaSubtipo {
  id: string;
  tenant_id: string;
  tipo_id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

// ---------- Task 011: lançamentos financeiros ----------

export type NaturezaLancamento = "entrada" | "saida";

export type OrigemLancamento =
  | "pp_baixa"
  | "pp_baixa_estornada"
  | "pp_estorno"
  | "manual";

export interface LancamentoFinanceiro {
  id: string;
  tenant_id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  data_movimento: string; // YYYY-MM-DD
  valor: string; // numeric — Number(...)
  natureza: NaturezaLancamento;
  descricao: string;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  pedido_compra_id: string | null;
  estorno_de_lancamento_id: string | null;
  origem: OrigemLancamento;
  criado_por: string;
  created_at: string;
}
