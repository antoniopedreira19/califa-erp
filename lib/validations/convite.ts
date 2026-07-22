import { z } from "zod";

const ROLES = ["administrador", "gestao_projetos", "financeiro"] as const;

export const conviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail.")
    .max(200, "Máximo 200 caracteres.")
    .toLowerCase()
    .refine(
      (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "E-mail inválido.",
    ),
  nome: z
    .string()
    .trim()
    .max(120, "Máximo 120 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  role: z.enum(ROLES, {
    errorMap: () => ({ message: "Selecione um papel válido." }),
  }),
});

export type ConviteInput = z.infer<typeof conviteSchema>;
