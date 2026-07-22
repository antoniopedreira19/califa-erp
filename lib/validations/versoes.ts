import { z } from "zod";
import { VERSAO_STATUS_EDITAVEIS } from "@/lib/types";

/**
 * Schema do header da versão. `numero_versao` NÃO entra aqui — é
 * atribuído pelo Server Action (max+1 do orçamento) na criação e
 * imutável na edição.
 */
export const versaoSchema = z.object({
  nome: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  moeda: z
    .string()
    .trim()
    .length(3, "Use código ISO de 3 letras (ex.: BRL).")
    .toUpperCase()
    .default("BRL"),
  taxa_cambio: z.coerce
    .number({ invalid_type_error: "Taxa inválida." })
    .positive("Taxa deve ser maior que zero.")
    .default(1),
  percentual_honorarios: z.coerce
    .number({ invalid_type_error: "Percentual inválido." })
    .min(0, "Não pode ser negativo.")
    .max(100, "Máximo 100%.")
    .default(0),
  percentual_imposto: z.coerce
    .number({ invalid_type_error: "Percentual inválido." })
    .min(0, "Não pode ser negativo.")
    .max(100, "Máximo 100%.")
    .default(0),
  status: z
    .enum([
      "rascunho",
      "em_revisao",
      "enviada_cliente",
      "reprovada",
      "substituida",
      "cancelada",
    ])
    .default("rascunho")
    .refine((v) => VERSAO_STATUS_EDITAVEIS.includes(v), {
      message: "Status inválido para edição manual.",
    }),
});

export type VersaoInput = z.infer<typeof versaoSchema>;
