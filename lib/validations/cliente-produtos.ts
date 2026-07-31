import { z } from "zod";

/**
 * Produto do cliente. O código (PRD-01, PRD-02…) não vem do formulário:
 * é gerado na action, sequencial dentro do cliente.
 */
export const clienteProdutoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome do produto.")
    .max(120, "Máximo 120 caracteres."),
});

export type ClienteProdutoInput = z.infer<typeof clienteProdutoSchema>;
