import { z } from "zod";

export const editarPeriodoSchema = z.object({
  lancamento_id: z.string().uuid(),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodo_id: z.string().uuid().nullable(),
});

export type EditarPeriodoInput = z.infer<typeof editarPeriodoSchema>;
