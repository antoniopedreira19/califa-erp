import { z } from "zod";

export const cidadeSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(80, "Máximo 80 caracteres."),
});

export type CidadeInput = z.infer<typeof cidadeSchema>;
