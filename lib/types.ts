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
  codigo: string;
  nome: string;
  cliente_id: string;
  responsavel_id: string;
  status: OrcamentoStatus;
  tipo: string | null;
  campanha: string | null;
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
