import { z } from "zod";
import { apenasDigitosCnpj, cnpjValido } from "@/lib/utils/cnpj";

export const empresaContabilSchema = z.object({
  razao_social: z
    .string()
    .trim()
    .min(3, "Razão social é obrigatória.")
    .max(200, "Razão social muito longa."),
  nome_fantasia: z
    .string()
    .trim()
    .max(120, "Nome fantasia muito longo.")
    .optional()
    .or(z.literal("")),
  cnpj: z
    .string()
    .transform(apenasDigitosCnpj)
    .refine((v) => v.length === 14, "CNPJ deve ter 14 dígitos.")
    .refine(cnpjValido, "CNPJ inválido."),
});

export type EmpresaContabilInput = z.infer<typeof empresaContabilSchema>;

/**
 * Endereço fiscal da empresa contábil. Usado como identificação do
 * titular do débito no header do arquivo CNAB. Todos os campos são
 * opcionais.
 */
export const enderecoEmpresaContabilSchema = z.object({
  endereco_logradouro: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  endereco_cidade: z
    .string()
    .trim()
    .max(100, "Máximo 100 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  endereco_cep: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ?? "").replace(/\D/g, ""))
    .transform((v) => (v.length > 0 ? v : null))
    .refine(
      (v) => v === null || v.length === 8,
      "CEP precisa ter 8 dígitos.",
    ),
  endereco_uf: z
    .string()
    .trim()
    .max(2, "UF tem 2 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null))
    .refine(
      (v) => v === null || v.length === 2,
      "UF precisa ter 2 letras.",
    ),
});

export type EnderecoEmpresaContabilInput = z.infer<
  typeof enderecoEmpresaContabilSchema
>;
