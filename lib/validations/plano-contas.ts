import { z } from "zod";

export const tipoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[A-Z]{2,6}$/, "Código: 2 a 6 letras maiúsculas."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(120),
  natureza_padrao: z.enum(["entrada", "saida", "ambos"]),
  ordem: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? Number(v) : 0)),
});

export const subtipoSchema = z.object({
  tipo_id: z.string().uuid("Selecione o tipo."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(160),
  ordem: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? Number(v) : 0)),
});

export type TipoInput = z.infer<typeof tipoSchema>;
export type SubtipoInput = z.infer<typeof subtipoSchema>;
