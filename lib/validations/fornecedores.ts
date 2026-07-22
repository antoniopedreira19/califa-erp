import { z } from "zod";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/utils";

/**
 * Schema de fornecedor (PF ou PJ). Documento (CPF ou CNPJ) opcional; se
 * informado, precisa ter tamanho e dígito verificador coerentes com o
 * tipo_pessoa. Isso é validado tanto aqui quanto no CHECK do banco.
 */
export const fornecedorSchema = z
  .object({
    tipo_pessoa: z.enum(["fisica", "juridica"]),
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    razao_social: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    cpf_cnpj: z
      .string()
      .optional()
      .transform((v) => (v ? onlyDigits(v) : ""))
      .transform((v) => (v === "" ? null : v)),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null))
      .refine(
        (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "E-mail inválido.",
      ),
    telefone: z
      .string()
      .optional()
      .transform((v) => (v ? onlyDigits(v) : ""))
      .refine(
        (v) => v === "" || v.length === 10 || v.length === 11,
        "Telefone deve ter 10 ou 11 dígitos.",
      )
      .transform((v) => (v === "" ? null : v)),
    observacoes: z
      .string()
      .trim()
      .max(2000, "Máximo 2000 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((data, ctx) => {
    if (!data.cpf_cnpj) return;

    if (data.tipo_pessoa === "fisica") {
      if (data.cpf_cnpj.length !== 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cpf_cnpj"],
          message: "CPF deve ter 11 dígitos.",
        });
        return;
      }
      if (!isValidCpf(data.cpf_cnpj)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cpf_cnpj"],
          message: "CPF inválido.",
        });
      }
    } else {
      if (data.cpf_cnpj.length !== 14) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cpf_cnpj"],
          message: "CNPJ deve ter 14 dígitos.",
        });
        return;
      }
      if (!isValidCnpj(data.cpf_cnpj)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cpf_cnpj"],
          message: "CNPJ inválido.",
        });
      }
    }
  });

export type FornecedorInput = z.infer<typeof fornecedorSchema>;
