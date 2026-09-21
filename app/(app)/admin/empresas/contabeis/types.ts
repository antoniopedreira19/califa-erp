import type { EmpresaContabil } from "@/lib/types";

export type EmpresaContabilRow = Pick<
  EmpresaContabil,
  | "id"
  | "razao_social"
  | "nome_fantasia"
  | "cnpj"
  | "ativo"
  | "convenio_cnab_santander"
  | "agencia_debito"
  | "agencia_debito_dv"
  | "conta_debito"
  | "conta_debito_dv"
  | "sequencial_arquivo"
  | "endereco_logradouro"
  | "endereco_cidade"
  | "endereco_cep"
  | "endereco_uf"
>;
