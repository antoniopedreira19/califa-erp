import { z } from "zod";

export const aprovarComoLiderSchema = z.object({
  lancamentoId: z.string().uuid(),
});
export type AprovarComoLiderInput = z.infer<typeof aprovarComoLiderSchema>;

export const reprovarComoLiderSchema = z.object({
  lancamentoId: z.string().uuid(),
  motivo: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(3, "Explique em pelo menos 3 caracteres.")
        .max(500, "Máximo 500 caracteres."),
    ),
});
export type ReprovarComoLiderInput = z.infer<typeof reprovarComoLiderSchema>;
