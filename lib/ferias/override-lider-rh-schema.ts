import { z } from "zod";

/** Schema do input do override do RH (botão "Aprovar no lugar do líder").
 *
 *  O `motivo` é **opcional**. Casos equivalentes a "sem motivo":
 *    - campo omitido do payload
 *    - string vazia
 *    - só espaços
 *  Todos esses viram `null` no `data` parseado, e o UPDATE no banco grava
 *  `motivo_override_lider = NULL`.
 *
 *  Acima de 500 chars, falha.
 */
export const overrideLiderRhSchema = z
  .object({
    lancamentoId: z.string().uuid(),
    motivo: z.string().max(500).optional(),
  })
  .transform(({ lancamentoId, motivo }) => {
    const limpo = (motivo ?? "").trim();
    return { lancamentoId, motivo: limpo.length > 0 ? limpo : null };
  });

export type OverrideLiderRhInput = z.infer<typeof overrideLiderRhSchema>;
