import { z } from "zod";

export const regionalSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(80, "Máximo 80 caracteres."),
});

export type RegionalInput = z.infer<typeof regionalSchema>;
