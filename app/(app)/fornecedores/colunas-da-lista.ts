import type { Fornecedor } from "@/lib/types";

/** O que a lista mostra de cada fornecedor (decisão 255): só estas colunas
 *  vêm do banco, porque o cadastro passou de 3 mil e o `*` levava a ficha
 *  inteira de todos para o navegador. */
export const COLUNAS_DA_LISTA_DE_FORNECEDORES =
  "id, nome, razao_social, cpf_cnpj, email, telefone, status, tipo_pessoa, cep, banco_codigo, pix_chave";
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
>;
