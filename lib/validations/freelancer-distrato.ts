import { z } from "zod";

export const solicitarDistratoSchema = z.object({
  data_proposta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Data inválida" }),
  motivo: z
    .string()
    .trim()
    .min(3, { message: "Explique brevemente o motivo" })
    .max(1000),
});

export type SolicitarDistratoInput = z.infer<typeof solicitarDistratoSchema>;
