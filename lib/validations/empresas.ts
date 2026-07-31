import { z } from "zod";
import { UFS } from "@/lib/utils/formato-fiscal";

/**
 * Schema do formulário de empresa (admin).
 *
 * CNPJ/CEP/telefone entram como texto livre (com ou sem máscara). O schema
 * remove tudo que não é dígito e valida a quantidade. O que vai para o
 * banco é o valor limpo — a coluna tem CHECK de formato.
 *
 * `principal` e `ativo` não estão neste schema: têm ações próprias
 * (`marcarPrincipal`, `desativarEmpresa`) para deixar a intenção explícita
 * na trilha de auditoria.
 */
export const empresaSchema = z.object({
  regional_id: z.string().uuid("Selecione a regional."),
  razao_social: z
    .string()
    .trim()
    .min(2, "Informe a razão social.")
    .max(200, "Máximo 200 caracteres."),
  nome_fantasia: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D+/g, ""))
    .refine((v) => v.length === 14, "CNPJ deve ter 14 dígitos."),
  inscricao_estadual: z
    .string()
    .trim()
    .max(30, "Máximo 30 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  inscricao_municipal: z
    .string()
    .trim()
    .max(30, "Máximo 30 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  logradouro: z
    .string()
    .trim()
    .min(2, "Informe o logradouro.")
    .max(200, "Máximo 200 caracteres."),
  numero: z
    .string()
    .trim()
    .max(20, "Máximo 20 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  complemento: z
    .string()
    .trim()
    .max(100, "Máximo 100 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  bairro: z
    .string()
    .trim()
    .max(100, "Máximo 100 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cidade: z
    .string()
    .trim()
    .min(2, "Informe a cidade.")
    .max(100, "Máximo 100 caracteres."),
  uf: z.enum(UFS as [typeof UFS[number], ...typeof UFS[number][]], {
    errorMap: () => ({ message: "Selecione a UF." }),
  }),
  cep: z
    .string()
    .transform((v) => v.replace(/\D+/g, ""))
    .refine((v) => v.length === 8, "CEP deve ter 8 dígitos."),
  telefone: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\D+/g, "") : ""))
    .refine(
      (v) => v.length === 0 || v.length === 10 || v.length === 11,
      "Telefone deve ter 10 ou 11 dígitos.",
    )
    .transform((v) => (v.length === 0 ? null : v)),
  email: z
    .string()
    .trim()
    .email("E-mail inválido.")
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  local_pagamento: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  instrucoes_nf: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type EmpresaInput = z.infer<typeof empresaSchema>;
