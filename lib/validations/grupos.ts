import { z } from "zod";

/** Schema do grupo de itens de uma versão. `ordem` é atribuída pelo
 *  Server Action (max+1 dos grupos da versão) na criação. */
export const grupoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome do grupo.")
    .max(120, "Máximo 120 caracteres."),
});

export type GrupoInput = z.infer<typeof grupoSchema>;
