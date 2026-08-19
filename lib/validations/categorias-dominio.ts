import { z } from "zod";

export const categoriaDominioSchema = z.object({
  escopo: z.enum(["projeto", "orcamento"]),
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(120, "Máximo 120 caracteres."),
});

export type CategoriaDominioInput = z.infer<typeof categoriaDominioSchema>;
