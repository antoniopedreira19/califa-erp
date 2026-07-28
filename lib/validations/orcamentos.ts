import { z } from "zod";
import { ORCAMENTO_STATUS_EDITAVEIS } from "@/lib/types";

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
    status: z
      .enum([
        "rascunho",
        "em_revisao",
        "enviado_cliente",
        "recusado",
        "cancelado",
      ])
      .default("rascunho")
      .refine((v) => ORCAMENTO_STATUS_EDITAVEIS.includes(v), {
        message: "Status inválido para edição manual.",
      }),
    tipo: z
      .string()
      .trim()
      .max(80)
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
