import { z } from "zod";

/**
 * Schema de validação da solicitação de férias.
 *
 * Modular (sem dependência de Next/server) pra poder ser testado isolado
 * via `node --test` + `tsx`. Consumido por:
 *   - `app/(app)/perfil/actions.ts` → `solicitarFerias` (colaborador)
 *   - `app/(app)/perfil/actions.test.ts` → testes do schema
 *
 * Tipos:
 *   - `usufruto` → tira dias de folga; precisa de periodo_id; dias_abono = 0
 *   - `abono_avulso` → PJ: vende dias sem tirar folga; periodo_id = null; dias_abono = 0
 *   - `abono_combinado` → tira X dias + vende Y; precisa de periodo_id + dias_abono > 0
 */
export const ANTECEDENCIA_MINIMA_DIAS = 5;

export const solicitarFeriasSchema = z
  .object({
    tipo: z.enum(["usufruto", "abono_avulso", "abono_combinado"]),
    periodo_id: z.string().uuid().nullable(),
    data_inicio: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida."),
    data_fim: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fim inválida."),
    dias_abono: z.number().int().min(0).max(30).default(0),
    observacao: z.string().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const ini = new Date(data.data_inicio + "T00:00:00");
    const fim = new Date(data.data_fim + "T00:00:00");
    if (fim < ini) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data_fim"],
        message:
          "A data de fim precisa ser igual ou posterior à data de início.",
      });
    }
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const minimo = new Date(hoje);
    minimo.setDate(hoje.getDate() + ANTECEDENCIA_MINIMA_DIAS);
    if (ini < minimo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data_inicio"],
        message: `A solicitação precisa ser feita com pelo menos ${ANTECEDENCIA_MINIMA_DIAS} dias de antecedência.`,
      });
    }
    if (data.tipo === "abono_avulso" && data.periodo_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodo_id"],
        message:
          "Abono avulso não é vinculado a um período aquisitivo específico.",
      });
    }
    if (
      (data.tipo === "usufruto" || data.tipo === "abono_combinado") &&
      !data.periodo_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodo_id"],
        message: "Escolha o período aquisitivo das férias.",
      });
    }
    if (data.tipo === "abono_combinado" && data.dias_abono <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dias_abono"],
        message: "Informe quantos dias quer vender.",
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

export type SolicitarFeriasInput = z.input<typeof solicitarFeriasSchema>;
export type SolicitarFeriasData = z.infer<typeof solicitarFeriasSchema>;
