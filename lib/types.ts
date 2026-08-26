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
  /** Percentual de honorários padrão do cliente. É com ele que toda versão
   *  de orçamento do cliente nasce; o campo fica travado nas telas de
   *  criação e só `administrador` altera, pelo "Editar" da versão. Mudar
   *  aqui não mexe em versões já criadas. */
  percentual_honorarios_padrao: number;
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

/** Espelha o enum `public.tipo_custo` no Postgres, na mesma ordem.
 *  `A` = A · Direto e `F` = F · Externo — as letras "cruas" ficaram com o
 *  comportamento que já era o delas antes da subdivisão, então os dados
 *  gravados não precisaram de backfill.
 *  As alavancas de cálculo de cada tipo estão em `REGRAS_TIPO_CUSTO`
 *  (lib/calculos/versao-totais.ts). */
export type TipoCusto = "A" | "AR" | "B" | "C" | "D" | "F" | "FI";

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
  /** BV líquido congelado na aprovação da versão — quanto o PLANEJADO
   *  deduz na vista Líquido. `null` enquanto a versão está aberta: aí a
   *  dedução é calculada na hora, a partir do BV vigente. Depois da
   *  aprovação o BV ainda muda (na planilha do job), e o planejado NÃO
   *  pode acompanhar — por isso o congelamento. */
  bv_liquido_planejado: number | null;
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
      return "A · Direto";
    case "AR":
      return "A · Repasse";
    case "B":
      return "B · Bi-trib.";
    case "C":
      return "C · Sem honor.";
    case "D":
      return "D · Interno";
    case "F":
      return "F · Externo";
    case "FI":
      return "F · Interno";
  }
}

// ---------- BV por item (bonificação do fornecedor) ----------

/** Situação da negociação do BV com o fornecedor.
 *  `cancelado` zera o valor para efeito de conta — o registro fica no
 *  item como histórico do que foi negociado e caiu. */
export type BvSituacao =
  | "a_negociar"
  | "confirmado"
  | "recebido"
  | "cancelado";

export const BV_SITUACOES: BvSituacao[] = [
  "a_negociar",
  "confirmado",
  "recebido",
  "cancelado",
];

export function bvSituacaoLabel(s: BvSituacao): string {
  switch (s) {
    case "a_negociar":
      return "A negociar";
    case "confirmado":
      return "Confirmado";
    case "recebido":
      return "Recebido";
    case "cancelado":
      return "Cancelado";
  }
}

/** BV de um item de custo tipo A: a parcela que o fornecedor devolve à
 *  California. Registro único por item (`uniq_bv_item`), compartilhado
 *  entre a tela de Orçamentos e a de Jobs — as duas apontam para o mesmo
 *  item da versão. */
export interface ItemBv {
  id: string;
  tenant_id: string;
  item_versao_id: string;
  /** Opcional no orçamento: dá pra lançar o valor antes de fechar com
   *  quem. Fica em falta destacada no acompanhamento do job. */
  fornecedor_id: string | null;
  valor: number;
  prazo_repasse: string | null;
  situacao: BvSituacao;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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

/**
 * O escopo 'job' existiu até 19/08/2026 como vocabulário só do
 * financeiro. A decisão 019 fez a categoria do job ser a do orçamento, e
 * a migration `20260819000001` apagou as linhas — ver o handoff do
 * financeiro.
 */
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
  switch (e) {
    case "projeto":
      return "Projeto";
    case "orcamento":
      return "Orçamento";
  }
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
  /** Produto que representa a marca do cliente — a matriz, quando não há
   *  outras marcas no guarda-chuva. Existe um por cliente, nasce junto
   *  com ele e não pode ser apagado, inativado nem renomeado à mão: o
   *  nome acompanha o nome fantasia. Trigger `trg_cliente_produtos_padrao`
   *  garante isso no banco, não só na server action. */
  padrao: boolean;
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
  /**
   * O que a California emite nota: Σ(AR, B, C) + honorários + imposto.
   * Difere de `valor_total` pelos principais que o cliente paga direto ao
   * fornecedor (A, D, F). Gravado no envio do job e atualizado por errata.
   */
  faturamento_previsto: number | null;
  /** Valor do job congelado na abertura — base do card de Erratas. */
  valor_job_abertura: number | null;
  /** Faturamento previsto congelado na abertura — base do card de Erratas. */
  faturamento_previsto_abertura: number | null;
  /** Data prevista para o faturamento, informada no envio do job. */
  data_prevista_faturamento: string | null;
  /**
   * Contexto livre da produção, lido no modal de conferência do financeiro.
   * Aparece na tela como **Descritivo do Job** desde 17/08/2026 — a coluna
   * e o campo continuam `observacoes` (só o rótulo mudou).
   */
  observacoes: string | null;
  status: JobStatus;
  motivo_rejeicao: string | null;
  /**
   * Nome do job NO FINANCEIRO. Quando nulo, vale `nome` (o da produção).
   * São dois nomes de propósito: o financeiro renomeia para o uso dele
   * sem renomear o job do GP. Use `nomeDoJobNoFinanceiro()`.
   */
  nome_financeiro: string | null;
  /**
   * Categoria do job (categorias_dominio, escopo 'orcamento'). Herdada do
   * orçamento de origem na abertura, onde o financeiro pode trocá-la sem
   * alterar o orçamento. Nulo é estado legítimo: os 4 jobs mais antigos
   * vieram de orçamentos anteriores à obrigatoriedade da categoria e
   * ficaram sem uma na migração de 19/08/2026.
   */
  categoria_id: string | null;
  competencia_trimestre: number | null;
  competencia_ano: number | null;
  /**
   * Cópia, no instante da abertura, do planejado dos itens de calha PP
   * (AR, B, C, F, FI) — só o que a California desembolsa. Itens A e D
   * são pagos direto pelo cliente e ficam fora (docs/decisions/004).
   * Zero é legítimo: job 100% A/D abre sem curva. Errata posterior NÃO
   * reescreve — a previsão de caixa não é retroativa.
   */
  custo_previsto_total: number | null;
  data_abertura_financeiro: string | null;
  aberto_por: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Tipo de contato do job. Hoje a aplicação só grava 'cobranca' — quem
 * recebe a cobrança no cliente. O CHECK do banco já aceita 'pagamento'
 * para não exigir migration se o contato de pagamento voltar à mesa
 * (a ideia foi descartada em 17/08/2026 — docs/decisions/012).
 */
export type JobContatoTipo = "cobranca" | "pagamento";

/**
 * Contato informado no modal "Enviar job para abertura", uma linha por
 * pessoa. É contato DO JOB, não do cadastro do cliente: muda de job para
 * job (praça, evento, área que aprovou a verba), por isso é digitado na
 * abertura em vez de herdado de `clientes`.
 */
export interface JobContato {
  id: string;
  tenant_id: string;
  job_id: string;
  tipo: JobContatoTipo;
  nome: string;
  /** Telefone — o único campo opcional da linha. */
  numero: string | null;
  email: string;
  /** Posição no formulário: o primeiro é o contato principal na prática. */
  ordem: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/** Um portal de fornecedor do cliente, onde a NF é lançada. */
export interface ClientePortal {
  id: string;
  tenant_id: string;
  cliente_id: string;
  nome: string;
  url: string;
  ativo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A liberação do job pela produção para o financeiro faturar.
 *
 * Um por job. Enquanto não existe, o job não aparece na fila de
 * faturamento — a `vw_faturamento_pendente` exige este registro.
 */
export interface JobEnvioFaturamento {
  id: string;
  tenant_id: string;
  job_id: string;
  /** Cópia do `faturamento_previsto` no instante do envio. */
  valor_faturado: number;
  numero_po: string | null;
  /** Vencimento acordado com o cliente. */
  data_faturamento: string;
  cnae: string;
  portal_id: string | null;
  /** Snapshot da URL: o cadastro do portal pode mudar depois. */
  portal_url: string | null;
  enviado_em: string;
  enviado_por: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Uma parcela do faturamento do job — em quantas notas ele será faturado.
 *
 * Informada pela produção no envio (decisão do Tiago, 17/08/2026). Cada
 * parcela é uma linha da aba Faturamento; a NF emitida a consome, total
 * ou parcialmente. Não confundir com `JobPrevisaoRecebimento`, que diz
 * quando o dinheiro entra, não em quantas notas o job sai.
 */
export interface JobEnvioFaturamentoParcela {
  id: string;
  tenant_id: string;
  envio_id: string;
  job_id: string;
  ordem: number;
  valor: number;
  /** Vencimento acordado com o cliente para esta parcela. */
  data_vencimento: string;
  created_at: string;
  updated_at: string;
}

/** Uma data da curva de desembolso do job. */
export interface JobPrevisaoCusto {
  id: string;
  tenant_id: string;
  job_id: string;
  ordem: number;
  data_prevista: string;
  valor: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Uma parcela da previsão de recebimento do job — o outro lado da curva
 * de desembolso, gravado na mesma abertura. A soma das parcelas fecha com
 * `jobs.faturamento_previsto`.
 *
 * Previsão não é título: quando a NF sai, nasce um `titulos_receber` que
 * ABATE esta previsão na leitura do fluxo de caixa. Nada aqui é apagado
 * pelo faturamento.
 */
export interface JobPrevisaoRecebimento {
  id: string;
  tenant_id: string;
  job_id: string;
  ordem: number;
  data_prevista: string;
  valor: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * O nome que o financeiro vê. Cai para o nome da produção enquanto o job
 * não tiver sido aberto (ou se quem abriu não renomeou).
 */
export function nomeDoJobNoFinanceiro(job: {
  nome: string;
  nome_financeiro?: string | null;
}): string {
  const financeiro = job.nome_financeiro?.trim();
  return financeiro && financeiro.length > 0 ? financeiro : job.nome;
}

/** "3T/2026" — vazio enquanto a competência não tiver sido registrada. */
export function competenciaLabel(
  trimestre: number | null,
  ano: number | null,
): string {
  if (!trimestre || !ano) return "—";
  return `${trimestre}T/${ano}`;
}

/**
 * "3º tri · 2026" — a forma por extenso, usada na ficha do job no módulo de
 * Jobs (handoff "Job · Informações — Cabeçalho", 19/08/2026). A Central
 * Financeira segue com `competenciaLabel`, que é compacta porque lá o campo
 * divide linha com outros seis. Mora aqui junto da irmã para as duas nunca
 * divergirem por descuido.
 */
export function competenciaLabelLongo(
  trimestre: number | null,
  ano: number | null,
): string {
  if (!trimestre || !ano) return "—";
  return `${trimestre}º tri · ${ano}`;
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
 * `encerrado` continua FORA de `JOB_STATUS_TRANSICOES` de propósito, mesmo
 * agora que o fluxo existe (13/08/2026): encerrar não é troca de status
 * solta. Exige o job já enviado para faturamento, nenhuma PP e nenhum BV
 * em aberto, e passa pelo resumo de fechamento. Quem faz é a action
 * `encerrarJob`, não `atualizarStatusJob`.
 */
export const ENCERRAMENTO_INDISPONIVEL =
  "Encerre pelo resumo de fechamento, na barra de ações do rodapé";

/** PP que ainda não saiu do caixa — impede o encerramento do job. */
export const PP_STATUS_EM_ABERTO: PPStatus[] = ["em_avaliacao", "aprovada"];

/** BV que ainda não foi recebido — impede o encerramento do job. */
export const BV_SITUACAO_EM_ABERTO: BvSituacao[] = [
  "a_negociar",
  "confirmado",
];

/**
 * Job encerrado é histórico: não aceita edição, PP nova, BV novo nem
 * lançamento de realizado. A regra mora aqui para as telas e as actions
 * lerem do mesmo lugar.
 */
export function jobEstaCongelado(status: JobStatus): boolean {
  return status === "encerrado" || status === "cancelado";
}

/**
 * Onde o REALIZADO pode ser lançado. Desde 17/08/2026 inclui os dois
 * status de pré-abertura: a produção começa a gastar antes de o
 * financeiro abrir o job, e esconder a planilha até lá obrigava a
 * anotar valores fora do sistema. O que a abertura libera é o que tem
 * consequência financeira — ver `jobAceitaAcoesPlanilha`.
 */
export function jobAceitaRealizado(status: JobStatus): boolean {
  return (
    status === "aberto" ||
    status === "em_producao" ||
    status === "aguardando_abertura" ||
    status === "rejeitado_financeiro"
  );
}

/**
 * Errata, BV e Pedido de Produção: só com o job já aberto pelo
 * financeiro. São as ações que mexem no orçado ou geram documento de
 * pagamento — antes da abertura o job ainda pode ser devolvido, e nada
 * disso pode ter saído.
 */
export function jobAceitaAcoesPlanilha(status: JobStatus): boolean {
  return status === "aberto" || status === "em_producao";
}

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

/**
 * Realizado de um item do job.
 *
 * ⚠️ Desde 21/08/2026 NADA aqui é digitado. A linha nasce zerada no envio
 * para abertura (ela é a âncora que a PP referencia) e os quatro números
 * são reescritos pelo trigger `trg_pp_recalcula_realizado` a cada PP
 * emitida, editada ou cancelada:
 *
 * - `total_realizado` — soma das PPs não canceladas;
 * - `quantidade_realizada` — soma das quantidades dessas PPs;
 * - `valor_unitario_realizado` — total ÷ quantidade;
 * - `dias_meses_realizado` — 1 quando há PP, 0 quando não há.
 *
 * Item `A` e `D` nunca geram PP, então a linha deles fica em zero e a
 * aplicação lê o ORÇADO no lugar (`realizadoBrutoDoItem`). Não tente ler
 * o realizado de um item direto desta tabela sem passar por lá.
 */
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
  fornecedor_id: string | null;
  empresa_id: string;
  servico: string;
  quantidade: number;
  especificacoes: string | null;
  valor: number;
  prazo_pagamento: string;
  pdf_path: string;
  emitida_por: string | null;
  // Verba de Produção (subtipo de PP — pago ao responsável em vez do fornecedor)
  verba_producao: boolean;
  responsavel_verba_id: string | null;
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
 * volta pra `em_avaliacao`. Por isso ela continua ocupando o SALDO do
 * item — quem devolve saldo é só o cancelamento. (Até 17/08/2026 quem
 * dizia isso era o índice `uniq_pp_ativa_por_item_realizado`, que
 * permitia uma PP ativa por item; ele saiu quando as PPs parciais
 * entraram, e a regra passou para o trigger `pp_valida_saldo_do_item`.)
 */
export type PPStatus = "em_avaliacao" | "aprovada" | "pago" | "rejeitada" | "cancelada";

export function ppStatusLabel(s: PPStatus): string {
  switch (s) {
    case "em_avaliacao":
      return "Em avaliação";
    case "aprovada":
      return "Aprovada";
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
  /** Cópia de `versoes_orcamento_itens.bv_liquido_planejado` feita no
   *  envio para abertura. Editar o BV na planilha do job não mexe aqui:
   *  o valor novo só se materializa no REALIZADO, e só na confirmação. */
  bv_liquido_planejado: number | null;
}

export interface JobErrata {
  id: string;
  tenant_id: string;
  job_id: string;
  titulo: string;
  justificativa: string | null;
  custo_orcado_antes: number;
  custo_orcado_depois: number;
  valor_job_antes: number;
  valor_job_depois: number;
  /** `null` nas erratas anteriores a 11/08/2026: o faturamento previsto
   *  daquele momento não é reconstituível. */
  faturamento_previsto_antes: number | null;
  faturamento_previsto_depois: number | null;
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
  /** Efeito deste item no valor do job. */
  efeito_valor_job: number;
  /** Efeito no faturamento previsto. `null` nas erratas antigas. */
  efeito_faturamento_previsto: number | null;
}

/** Errata com os itens e o autor, como o card do histórico precisa. */
export interface JobErrataComItens extends JobErrata {
  autor_nome: string | null;
  itens: JobErrataItem[];
}

// ---------- Comunicação do job ----------

export type ChatArea = "producao" | "financeiro";
export type ChatEscopo = "geral" | "pps";

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
  escopo: ChatEscopo;
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
      icone:
        | "folder-open"
        | "file-pen-line"
        | "tags"
        | "file-text"
        | "check-circle"
        | "x-circle"
        | "ban";
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

/**
 * Uma parcela do Pedido de Produção — um vencimento próprio, com valor
 * próprio e (desde a Tela 2.3) documento próprio.
 *
 * PP sem parcelamento tem exatamente UMA parcela, 1/1: não existe PP sem
 * parcela, nem no legado (a migration `20260817000002` backfillou todas).
 * É isso que deixa as listas e o PDF tratarem os dois casos igual.
 *
 * `pago_em` / `pago_por` são da baixa por parcela, que a Tela 3.2
 * ("Títulos a Pagar") passou a fazer: quem se baixa é a parcela, e a PP
 * só vira `pago` quando a última é quitada.
 */
export interface PedidoCompraParcela {
  id: string;
  tenant_id: string;
  pedido_compra_id: string;
  numero: number;
  /**
   * Vencimento ORIGINAL — o prazo que a produção negociou com o
   * fornecedor, impresso no PDF. Nunca muda depois da emissão.
   */
  data_vencimento: string;
  valor: number;
  pdf_path: string | null;
  /**
   * Quando o financeiro vai pagar ESTA parcela. Nasce na aprovação da PP
   * (`aprovar_pp_com_data`, que desloca todas pelo mesmo delta) e é
   * repactuável pelo lápis da aba Títulos a Pagar. Diferente de
   * `data_vencimento` = título repactuado, exibido em vermelho.
   * Nulo enquanto a PP está em avaliação.
   */
  data_pagamento: string | null;
  /**
   * A primeira data de pagamento já definida. Congelada por trigger no
   * banco — repactuar não a altera. É metade do histórico que o pop-up
   * de edição exibe (a outra metade é `data_vencimento`).
   */
  data_pagamento_primeira: string | null;
  pago_em: string | null;
  pago_por: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/** PP com os campos que as telas de lista mostram junto. */
export interface PedidoCompraNaLista extends PedidoCompra {
  emitida_por_nome: string | null;
  grupo_nome: string | null;
  /** Sempre ao menos uma, ordenada por `numero`. */
  parcelas: PedidoCompraParcela[];
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

export interface PPVerbaDevolucao {
  id: string;
  tenant_id: string;
  empresa_id: string;
  prestacao_id: string;
  pedido_compra_id: string;
  valor: number;
  data_pagamento: string;
  data_pagamento_primeira: string;
  pago_em: string | null;
  pago_por: string | null;
  lancamento_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PPVerbaPrestacao {
  id: string;
  tenant_id: string;
  pedido_compra_id: string;
  valor_gasto: number;
  valor_devolvido: number;
  fechada_em: string;
  fechada_por: string;
}

export interface PPVerbaPrestacaoAnexo {
  id: string;
  tenant_id: string;
  prestacao_id: string;
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
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanoContaSubtipo {
  id: string;
  tenant_id: string;
  tipo_id: string;
  codigo: string;
  nome: string;
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
  | "avulsa_baixa"
  | "avulsa_baixa_estornada"
  | "avulsa_estorno"
  | "titulo_baixa"
  | "titulo_baixa_estornada"
  | "titulo_estorno"
  | "desembolso_baixa"
  | "desembolso_baixa_estornada"
  | "desembolso_estorno"
  | "pp_devolucao_verba"
  | "pp_devolucao_verba_estornada"
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
  /**
   * Parcela de PP que este lançamento quitou (Tela 3.2). Nulo quando o
   * lançamento não veio de baixa de parcela — avulsa, título a receber,
   * manual, e as baixas de PP inteira anteriores a 17/08/2026.
   */
  pedido_compra_parcela_id: string | null;
  conta_avulsa_id: string | null;
  /**
   * Desembolso que este lançamento quitou (via desembolso_baixa) ou estornou.
   * Nulo em outras origens.
   */
  desembolso_id: string | null;
  /**
   * Parcela do desembolso que este lançamento quitou. Nulo em lançamento
   * que não veio de baixa de parcela de desembolso.
   */
  desembolso_parcela_id: string | null;
  /**
   * Devolução de verba que este lançamento quitou (via pp_devolucao_verba)
   * ou estornou. Nulo em outras origens.
   */
  pp_verba_devolucao_id: string | null;
  /**
   * Forma de pagamento efetivamente usada na baixa. Nulo em lançamentos
   * anteriores a 25/08/2026 e em origem 'manual' sem forma definida.
   */
  forma_pagamento: FormaPagamento | null;
  /** Cartão usado quando forma = cartao_credito. */
  cartao_credito_id: string | null;
  estorno_de_lancamento_id: string | null;
  origem: OrigemLancamento;
  criado_por: string;
  created_at: string;
}

// ---------- Task 008: contas a receber (faturamento) ----------

export type FaturamentoOrigemTipo = "job" | "bv" | "avulso";
export type FaturamentoStatus = "emitido" | "cancelado";
export type TituloReceberStatus = "em_aberto" | "pago" | "cancelado";

export function faturamentoStatusLabel(s: FaturamentoStatus): string {
  return s === "emitido" ? "Emitido" : "Cancelado";
}

export function tituloReceberStatusLabel(s: TituloReceberStatus): string {
  switch (s) {
    case "em_aberto":
      return "Em aberto";
    case "pago":
      return "Pago";
    case "cancelado":
      return "Cancelado";
  }
}

export interface Faturamento {
  id: string;
  tenant_id: string;
  empresa_id: string;
  origem_tipo: FaturamentoOrigemTipo;
  /**
   * Origem única da nota, quando existe. NULO em NF agrupada (vários
   * jobs) e em avulso — nesses casos a verdade está em
   * `faturamento_itens`.
   */
  origem_id: string | null;
  cliente_id: string | null;
  fornecedor_id: string | null;
  numero_nf: string;
  /** Fora das telas desde a Tela 3.3; continua gravada, default "1". */
  serie: string;
  data_emissao: string;
  valor_total: number;
  descricao: string;
  anexo_nf_path: string;
  /**
   * Preenchido só no faturamento avulso (campo "Centro de custo" do
   * formulário). Em job/BV é nulo: a classificação que vale para o DRE é
   * a escolhida na baixa do título.
   */
  plano_conta_tipo_id: string | null;
  plano_conta_subtipo_id: string | null;
  status: FaturamentoStatus;
  cancelado_em: string | null;
  cancelado_por: string | null;
  motivo_cancelamento: string | null;
  emitido_em: string;
  emitido_por: string;
}

/**
 * O que uma NF cobre, e por quanto — uma linha por job ou BV.
 *
 * É o que sustenta ao mesmo tempo a NF agrupada (vários jobs numa nota) e
 * o faturamento parcial (valor menor que o saldo da parcela).
 */
export interface FaturamentoItem {
  id: string;
  tenant_id: string;
  faturamento_id: string;
  origem_tipo: FaturamentoOrigemTipo;
  origem_id: string | null;
  /** Parcela do envio consumida. Só existe em item de job. */
  envio_parcela_id: string | null;
  valor: number;
  created_at: string;
}

export interface TituloReceber {
  id: string;
  tenant_id: string;
  empresa_id: string;
  faturamento_id: string;
  numero_parcela: number;
  valor: number;
  /** O que a nota diz. Imutável depois de emitida — trigger no banco. */
  data_vencimento: string;
  /** Quando o financeiro espera receber. Repactuável pelo lápis. */
  data_previsao_recebimento: string | null;
  /** Primeira previsão registrada. Congelada por trigger. */
  data_previsao_recebimento_primeira: string | null;
  status: TituloReceberStatus;
  pago_em: string | null;
  pago_por: string | null;
  conta_bancaria_recebimento_id: string | null;
  lancamento_id: string | null;
  cancelado_em: string | null;
  cancelado_por: string | null;
  created_at: string;
}

// ---------- Forma de pagamento e cartões (20/08/2026) ----------

export type FormaPagamento =
  | "pix"
  | "transferencia"
  | "boleto"
  | "cartao_credito";

export const formaPagamentoLabel = (f: FormaPagamento): string =>
  ({
    pix: "PIX",
    transferencia: "Transferência",
    boleto: "Boleto",
    cartao_credito: "Cartão de Crédito",
  })[f];

export type BandeiraCartao =
  | "visa"
  | "master"
  | "elo"
  | "amex"
  | "hipercard"
  | "outra";

export const bandeiraCartaoLabel = (b: BandeiraCartao): string =>
  ({
    visa: "Visa",
    master: "Mastercard",
    elo: "Elo",
    amex: "American Express",
    hipercard: "Hipercard",
    outra: "Outra",
  })[b];

export interface CartaoCredito {
  id: string;
  tenant_id: string;
  nome: string;
  banco: string;
  bandeira: BandeiraCartao;
  ultimos_4_digitos: string;
  dono: string;
  dia_vencimento_fatura: number;
  ativo: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

// ---------- Task 012: contas_avulsas ----------

export type ContaAvulsaStatus = "aprovada" | "baixada";

export const contaAvulsaStatusLabel = (s: ContaAvulsaStatus): string =>
  ({
    aprovada: "Aprovada",
    baixada: "Baixada",
  })[s];

export type FrequenciaRecorrencia = "quinzenal" | "mensal" | "anual";

export const frequenciaRecorrenciaLabel = (f: FrequenciaRecorrencia): string =>
  ({
    quinzenal: "Quinzenal",
    mensal: "Mensal",
    anual: "Anual",
  })[f];

export interface ContaAvulsaRecorrente {
  id: string;
  tenant_id: string;
  empresa_id: string;
  descricao: string;
  valor: string; // numeric → string do supabase-js
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  frequencia: FrequenciaRecorrencia;
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  proxima_data: string; // YYYY-MM-DD
  data_fim: string | null; // YYYY-MM-DD
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  ativo: boolean;
  criado_por: string;
  created_at: string;
  updated_at: string;
}

export interface ContaAvulsa {
  id: string;
  tenant_id: string;
  empresa_id: string;
  descricao: string;
  valor: string; // numeric → string do supabase-js
  natureza: NaturezaLancamento;
  /**
   * Vencimento ORIGINAL — a data informada na criação (ou a data da
   * ocorrência, quando gerada por recorrência). A partir da Tela 3.2 é a
   * coluna "Venc. original" da aba Títulos a Pagar.
   */
  data_prevista_pagamento: string | null; // YYYY-MM-DD
  /** Data de pagamento vigente, repactuável. Nasce igual à original. */
  data_pagamento: string | null; // YYYY-MM-DD
  /** Primeira data de pagamento definida. Congelada por trigger. */
  data_pagamento_primeira: string | null; // YYYY-MM-DD
  status: ContaAvulsaStatus;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  pago_em: string | null;
  pago_por: string | null;
  conta_bancaria_baixa_id: string | null;
  recorrente_id: string | null;
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  criado_por: string;
  created_at: string;
  updated_at: string;
}

// ---------- Tela 3.2: título a pagar (visão unificada) ----------

/**
 * De onde o título veio. Não é coluna de banco: a aba "Títulos a Pagar"
 * não tem tabela própria (decisão do plano: sem tabela-espelho). Ela
 * nasce da união de duas fontes, e a origem se deduz assim:
 *
 *   pp          → parcela de `pedidos_compra_parcelas` de PP aprovada
 *   avulso      → `contas_avulsas` com `recorrente_id` nulo
 *   recorrencia → `contas_avulsas` com `recorrente_id` preenchido
 *                 (a ocorrência que `gerar_ocorrencias_recorrentes` cria)
 */
export type OrigemTitulo = "pp" | "avulso" | "recorrencia" | "desembolso" | "pp_devolucao_verba";

export const origemTituloLabel = (o: OrigemTitulo, ppCodigo?: string | null): string =>
  o === "pp" ? (ppCodigo ?? "PP")
    : o === "avulso" ? "AVULSO"
    : o === "recorrencia" ? "RECORRÊNCIA"
    : o === "desembolso" ? "DESEMBOLSO"
    : "DEVOLUÇÃO VERBA";

/** `a_pagar` enquanto não há baixa; `pago` depois dela. */
export type TituloPagarStatus = "a_pagar" | "pago";

export interface ContaAvulsaAnexo {
  id: string;
  tenant_id: string;
  conta_avulsa_id: string;
  arquivo_path: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  arquivo_mimetype: string;
  created_by: string | null;
  created_at: string;
}

export interface ContaAvulsaHistorico {
  id: string;
  tenant_id: string;
  conta_avulsa_id: string;
  campo_alterado: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  alterado_por: string;
  alterado_em: string;
}

// ---------- Task 014: rateio regional de contas avulsas ----------

export interface ContaAvulsaRateio {
  id: string;
  tenant_id: string;
  conta_avulsa_id: string;
  regional_id: string;
  percentual: string;  // numeric → string do supabase-js
  created_at: string;
}

export interface ContaAvulsaRecorrenteRateio {
  id: string;
  tenant_id: string;
  recorrente_id: string;
  regional_id: string;
  percentual: string;
  created_at: string;
}

/** Linha de rateio no cliente (com percentual como número — o form).
 *  Fonte-verdade: schema Zod em lib/validations/conta-avulsa.ts. */
export type { RateioLinhaInput } from "@/lib/validations/conta-avulsa";

// ---------- Desembolsos (20/08/2026) ----------

export type DesembolsoStatus =
  | "em_avaliacao"
  | "aprovada"
  | "pago"
  | "rejeitada"
  | "cancelada";

export const desembolsoStatusLabel = (s: DesembolsoStatus): string =>
  ({
    em_avaliacao: "Em avaliação",
    aprovada: "Aprovada",
    pago: "Pago",
    rejeitada: "Rejeitada",
    cancelada: "Cancelada",
  })[s];

export interface Desembolso {
  id: string;
  tenant_id: string;
  codigo: string;
  empresa_id: string;
  descricao: string;
  valor: string; // numeric → string
  status: DesembolsoStatus;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  data_prevista_pagamento: string | null;
  motivo_rejeicao: string | null;
  motivo_cancelamento: string | null;
  criado_por: string;
  aprovada_por: string | null;
  aprovada_em: string | null;
  rejeitada_por: string | null;
  rejeitada_em: string | null;
  cancelada_por: string | null;
  cancelada_em: string | null;
  pago_em: string | null;
  pago_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesembolsoParcela {
  id: string;
  tenant_id: string;
  desembolso_id: string;
  numero: number;
  data_vencimento: string;
  data_pagamento: string | null;
  data_pagamento_primeira: string | null;
  valor: string;
  pago_em: string | null;
  pago_por: string | null;
  created_at: string;
  updated_at: string;
}
