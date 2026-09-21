import type { EmpresaContabil } from "@/lib/types";

export type EmpresaContabilRow = Pick<
  EmpresaContabil,
  | "id"
  | "razao_social"
  | "nome_fantasia"
  | "cnpj"
  | "ativo"
  | "endereco_logradouro"
  | "endereco_cidade"
  | "endereco_cep"
  | "endereco_uf"
>;
