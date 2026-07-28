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
}

// ---------- Task 007: projetos ----------

export type ProjetoStatus = "ativo" | "arquivado";

export interface Projeto {
  id: string;
  tenant_id: string;
  codigo: string;
  nome: string;
  campanha: string | null;
  cliente_id: string;
  responsavel_id: string;
  status: ProjetoStatus;
  data_inicio_prevista: string;
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
  projeto_id: string;
  codigo: string;
  nome: string;
  status: OrcamentoStatus;
  tipo: string | null;
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
