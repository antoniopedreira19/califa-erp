import { z } from "zod";

/**
 * Schema de projeto. Código é gerado no server (não vem do form).
 * data_inicio_prevista é NOT NULL — determina o ano do código.
 */
export const projetoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Informe o nome do projeto (mín. 2 caracteres).")
    .max(200, "Máximo 200 caracteres."),
  campanha: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cliente_id: z.string().uuid("Selecione um cliente válido."),
  responsavel_id: z.string().uuid("Selecione um responsável válido."),
  data_inicio_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início é obrigatória."),
});

export type ProjetoInput = z.infer<typeof projetoSchema>;
