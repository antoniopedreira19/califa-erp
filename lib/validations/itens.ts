import { z } from "zod";

/**
 * Schema de item da versão. `grupo_id` vem do contexto (contexto do
 * botão "Novo item" dentro de um grupo específico), não do form.
 * `total_orcado` é GENERATED. `ordem` é atribuída pelo Server Action.
 * Fornecedor e observações deixaram de fazer parte do form —
 * as colunas permanecem no banco como legado nullable.
 */
export const itemSchema = z.object({
  item: z
    .string()
    .trim()
    .min(1, "Descreva o item.")
    .max(500, "Máximo 500 caracteres."),
  tipo_custo: z.enum(["A", "B", "C", "D"]).default("A"),
  valor_unitario_orcado: z.coerce
    .number({ invalid_type_error: "Valor inválido." })
    .nonnegative("Não pode ser negativo.")
    .default(0),
  quantidade_orcada: z.coerce
    .number({ invalid_type_error: "Quantidade inválida." })
    .positive("Quantidade deve ser maior que zero.")
    .default(1),
  dias_meses_orcado: z.coerce
    .number({ invalid_type_error: "Dias/meses inválido." })
    .positive("Dias/meses deve ser maior que zero.")
    .default(1),
});

export type ItemInput = z.infer<typeof itemSchema>;
