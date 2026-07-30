import { z } from "zod";
import { isValidCnpj, onlyDigits } from "@/lib/utils";

/**
 * Schema de cliente (PJ). CNPJ opcional; quando informado, precisa ser
 * válido (dígito verificador OK). E-mail opcional; se informado, precisa
 * ser válido. Todos os campos que vêm como string vazia são normalizados
 * para null antes de gravar.
 */
export const clienteSchema = z.object({
  nome_fantasia: z
    .string()
    .trim()
    .min(2, "Informe o nome fantasia (mín. 2 caracteres).")
    .max(200, "Máximo 200 caracteres."),
  codigo_curto: z
    .string()
    .trim()
    .min(2, "Código deve ter no mínimo 2 letras.")
    .max(6, "Código deve ter no máximo 6 letras.")
    .regex(/^[A-Za-z]{2,6}$/, "Código deve conter apenas letras (A-Z), sem números ou símbolos.")
    .transform((v) => v.toUpperCase()),
  razao_social: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cnpj: z
    .string()
    .optional()
    .transform((v) => (v ? onlyDigits(v) : ""))
    .refine((v) => v === "" || v.length === 14, "CNPJ deve ter 14 dígitos.")
    .refine((v) => v === "" || isValidCnpj(v), "CNPJ inválido.")
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
});

export type ClienteInput = z.infer<typeof clienteSchema>;
