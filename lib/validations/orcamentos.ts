import { z } from "zod";

export const orcamentoSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .max(50, "Máximo 50 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome do orçamento (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    // `status` saiu em 28/09/2026 (decisão 117): o status do orçamento é
    // do sistema — nasce rascunho pelo default do banco e só muda pela
    // aprovação, pelo envio para abertura e pelo cancelamento deles.
    // Obrigatória desde 17/08/2026, no mesmo padrão dos campos abaixo.
    categoria_id: z.string().uuid("Selecione a categoria."),
    // Serviço desceu do projeto em 02/09/2026 (decisão 037). Lê
    // `categorias_dominio` com escopo `projeto` — lista diferente da
    // Categoria acima, que usa escopo `orcamento`.
    servico_id: z.string().uuid("Selecione o serviço."),
    // Obrigatórios desde 06/08/2026. Nullable no banco por causa dos
    // orçamentos gravados antes desta mudança — a exigência vive aqui.
    // `regional_id` precisa ser uma das regionais do projeto; isso a
    // server action confere, porque o Zod não conhece o projeto.
    regional_id: z.string().uuid("Selecione a regional."),
    cidade_id: z.string().uuid("Selecione a cidade."),
    gp_responsavel_id: z.string().uuid("Selecione o GP responsável."),
    produtor_id: z.string().uuid("Selecione o produtor responsável."),
    // Adianta o Descritivo do envio para abertura (`jobs.observacoes`),
    // onde segue editável. Mesmo teto de lá — texto maior aqui não
    // caberia no destino.
    descritivo: z
      .string()
      .trim()
      .max(500, "Máximo 500 caracteres.")
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
  })
  .superRefine((data, ctx) => {
    if (data.data_inicio_prevista && data.data_fim_prevista) {
      if (data.data_fim_prevista < data.data_inicio_prevista) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data_fim_prevista"],
          message: "Data fim deve ser igual ou posterior à data início.",
        });
      }
    }
  });

export type OrcamentoInput = z.infer<typeof orcamentoSchema>;
