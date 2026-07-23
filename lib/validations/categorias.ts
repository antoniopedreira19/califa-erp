import { z } from "zod";

/**
 * Schema de categoria de versão de orçamento. Mesmo padrão de grupos:
 * nome não vazio, trim, tamanho razoável.
 */
export const categoriaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(120, "Máximo 120 caracteres."),
});

export type CategoriaInput = z.infer<typeof categoriaSchema>;
