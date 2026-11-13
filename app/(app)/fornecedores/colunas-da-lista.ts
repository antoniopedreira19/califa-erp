import type { Fornecedor } from "@/lib/types";

/** As colunas que a lista de Fornecedores lê (decisão 255): só o que ela
 *  mostra, para o cadastro inteiro caber na página. Regime e CNAE entraram
 *  em 12/11/2026 (Tiago), depois do documento. */
export const COLUNAS_DA_LISTA_DE_FORNECEDORES =
  "id, nome, razao_social, cpf_cnpj, email, telefone, status, tipo_pessoa, cep, banco_codigo, pix_chave, regime_tributario, cnae";

export type FornecedorDaLista = Pick<
  Fornecedor,
  | "id"
  | "nome"
  | "razao_social"
  | "cpf_cnpj"
  | "email"
  | "telefone"
  | "status"
  | "tipo_pessoa"
  | "cep"
  | "banco_codigo"
  | "pix_chave"
  | "regime_tributario"
  | "cnae"
>;
