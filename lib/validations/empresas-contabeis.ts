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
