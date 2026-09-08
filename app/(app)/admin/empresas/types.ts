import type { UF } from "@/lib/types";

export interface EmpresaRow {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  cep: string;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: UF;
  telefone: string | null;
  email: string | null;
  local_pagamento: string | null;
  instrucoes_nf: string | null;
  principal: boolean;
  ativo: boolean;
}
