import { z } from "zod";

export const jobSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    produto: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    regional_id: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
    cidade: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    data_inicio_prevista: z
      .string()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    data_fim_prevista: z
      .string()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    responsavel_id: z.string().uuid("Selecione um responsável válido."),
    // `valor_total` saiu daqui em 11/08/2026: ele e o `faturamento_previsto`
    // são derivados dos itens orçados, e um campo editável no formulário
    // permitia gravar um valor que não fecha com a planilha do job.
  })
  .superRefine((data, ctx) => {
    if (
      data.data_inicio_prevista &&
      data.data_fim_prevista &&
      data.data_fim_prevista < data.data_inicio_prevista
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data_fim_prevista"],
        message: "Data fim deve ser igual ou posterior à data início.",
      });
    }
  });

export type JobInput = z.infer<typeof jobSchema>;

// ---------- Rejeição de abertura (financeiro) ----------

export const rejeicaoAberturaSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(10, "Motivo precisa ter ao menos 10 caracteres.")
    .max(500, "Máximo 500 caracteres."),
});

export type RejeicaoAberturaInput = z.infer<typeof rejeicaoAberturaSchema>;
