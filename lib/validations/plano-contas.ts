import { z } from "zod";

export const tipoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[0-9]{2}$/, "Código: 2 dígitos (ex.: 01, 15, 99)."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(120),
  natureza_padrao: z.enum(["entrada", "saida", "ambos"]),
});

export const subtipoSchema = z.object({
  tipo_id: z.string().uuid("Selecione o tipo."),
  codigo: z
    .string()
    .trim()
    .regex(/^[0-9]{3}$/, "Código: 3 dígitos (ex.: 001, 015, 999)."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(160),
});

export type TipoInput = z.infer<typeof tipoSchema>;
export type SubtipoInput = z.infer<typeof subtipoSchema>;
