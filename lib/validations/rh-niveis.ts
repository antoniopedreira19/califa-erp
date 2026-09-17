import { z } from "zod";

/**
 * Schema de nível de cargo do módulo RH.
 *
 * Nível é hierarquia de cargo (N3 < N4 < N5) — **não** faixa salarial.
 * Ver docs/modulos/rh/00-descoberta.md §6.6.
 */
export const nivelSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, "Informe o código do nível.")
    .max(20, "Máximo 20 caracteres."),
  descricao: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  ordem: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v || v.length === 0) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 32767) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ordem precisa ser um inteiro positivo.",
        });
        return z.NEVER;
      }
      return n;
    }),
});

export type NivelInput = z.infer<typeof nivelSchema>;
