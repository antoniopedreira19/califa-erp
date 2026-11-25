import { z } from "zod";

/**
 * Schema de validação do lançamento DIRETO pelo RH (sem passar pelo
 * fluxo de solicitação do colaborador). Diferenças do schema do
 * colaborador:
 *   - Inclui `colaborador_id` (RH escolhe pra quem)
 *   - Permite `abono_excepcional` (acordo >10 dias)
 *   - Sem antecedência mínima (lançamento retroativo permitido)
 *
 * Todo lançamento (inclusive abono_avulso) exige `periodo_id` — a venda
 * sai de um aquisitivo. Até 2026-11-25, abono_avulso aceitava periodo_id
 * null e ficava "no ar" sem derrubar saldo. Ver migration 20261125800001.
 *
 * Modular (sem dependência de Next/server) pra poder ser testado isolado
 * via `node --test` + `tsx`.
 */
export const lancarDiretoSchema = z
  .object({
    colaborador_id: z.string().uuid(),
    periodo_id: z.string().uuid({ message: "Escolha o período aquisitivo." }),
    tipo: z.enum([
      "usufruto",
      "abono_combinado",
      "abono_avulso",
      "abono_excepcional",
    ]),
    data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dias_abono: z.number().int().min(0).max(30).default(0),
    observacao: z.string().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.tipo === "abono_combinado" && data.dias_abono <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dias_abono"],
        message: "Informe quantos dias serão vendidos.",
      });
    }
    if (data.tipo !== "abono_combinado" && data.dias_abono !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dias_abono"],
        message: "Dias de abono só se aplicam quando tipo = abono_combinado.",
      });
    }
  });

export type LancarDiretoInput = z.input<typeof lancarDiretoSchema>;
export type LancarDiretoData = z.infer<typeof lancarDiretoSchema>;
