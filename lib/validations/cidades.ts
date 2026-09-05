import { z } from "zod";

/** Schema base: só `nome` (usado pelo drawer de cadastro manual). */
export const cidadeSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(80, "Máximo 80 caracteres."),
});

export type CidadeInput = z.infer<typeof cidadeSchema>;

/** Schema estendido: aceita UF + IBGE (fluxo inline do combobox). Se
 *  `ibge_codigo` vier, `uf` também tem que vir — o banco também garante
 *  isso via constraint, mas validamos aqui pra dar erro amigável antes. */
export const cidadeCompletaSchema = cidadeSchema.extend({
  uf: z
    .string()
    .regex(/^[A-Z]{2}$/, "UF deve ter 2 letras maiúsculas.")
    .nullable()
    .optional(),
  ibge_codigo: z
    .string()
    .regex(/^[0-9]{7}$/, "Código IBGE deve ter 7 dígitos.")
    .nullable()
    .optional(),
}).refine(
  (v) => !v.ibge_codigo || !!v.uf,
  { message: "Cidade do IBGE precisa de UF.", path: ["uf"] },
);

export type CidadeCompletaInput = z.infer<typeof cidadeCompletaSchema>;
