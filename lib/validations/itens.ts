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
  categoria_id: z
    .string()
    .uuid("ID da categoria inválido.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  valor_unitario_planejado: z.coerce
    .number({ invalid_type_error: "Valor planejado inválido." })
    .nonnegative("Valor planejado não pode ser negativo.")
    .default(0),
  quantidade_planejada: z.coerce
    .number({ invalid_type_error: "Quantidade planejada inválida." })
    .nonnegative("Quantidade planejada não pode ser negativa.")
    .default(0),
  dias_meses_planejado: z.coerce
    .number({ invalid_type_error: "Dias/meses planejado inválido." })
    .nonnegative("Dias/meses planejado não pode ser negativo.")
    .default(0),
});

export type ItemInput = z.infer<typeof itemSchema>;

/**
 * Campos que a edição inline da planilha pode gravar, um por vez.
 * Serve como allowlist do `atualizarCampoItem` — o nome do campo chega
 * do cliente e nunca pode virar UPDATE de coluna arbitrária.
 * `total_orcado` e `total_planejado` são GENERATED: não entram aqui.
 */
export const camposItemEditaveis = {
  item: itemSchema.shape.item,
  tipo_custo: itemSchema.shape.tipo_custo,
  categoria_id: itemSchema.shape.categoria_id,
  valor_unitario_orcado: itemSchema.shape.valor_unitario_orcado,
  quantidade_orcada: itemSchema.shape.quantidade_orcada,
  dias_meses_orcado: itemSchema.shape.dias_meses_orcado,
  valor_unitario_planejado: itemSchema.shape.valor_unitario_planejado,
  quantidade_planejada: itemSchema.shape.quantidade_planejada,
  dias_meses_planejado: itemSchema.shape.dias_meses_planejado,
} as const;

export type CampoItemEditavel = keyof typeof camposItemEditaveis;

export function isCampoItemEditavel(campo: string): campo is CampoItemEditavel {
  return Object.prototype.hasOwnProperty.call(camposItemEditaveis, campo);
}
