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
 *   - `usufruto` → tira dias de folga; dias_abono = 0
 *   - `abono_avulso` → PJ: vende dias sem tirar folga; dias_abono = 0
 *   - `abono_combinado` → tira X dias + vende Y; dias_abono > 0
 *
 * Todos exigem `periodo_id`: os dias vendidos/gozados sempre saem de um
 * aquisitivo. Antes de 2026-11-25 o abono_avulso ignorava essa regra e
 * não abatia saldo — ver migration 20261125800001.
 */
export const ANTECEDENCIA_MINIMA_DIAS = 5;

export const solicitarFeriasSchema = z
  .object({
    tipo: z.enum(["usufruto", "abono_avulso", "abono_combinado"]),
    periodo_id: z.string().uuid({ message: "Escolha o período aquisitivo." }),
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
    // Antecedência mínima só vale pra usufruto/combinado (o colaborador vai
    // ficar de folga — RH precisa de prazo). Em abono_avulso (Só venda) o
    // colaborador não tira folga, então a data_inicio vai como hoje só pra
    // marcar competência da folha — ver solicitar-ferias-form.tsx.
    if (data.tipo !== "abono_avulso") {
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
