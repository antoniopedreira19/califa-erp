import { z } from "zod";

export const contaBancariaSchema = z.object({
  empresa_id: z.string().uuid("Selecione a empresa."),
  nome: z.string().trim().min(2, "Nome muito curto.").max(120),
  banco: z.string().trim().min(2, "Banco muito curto.").max(80),
  agencia: z.string().trim().max(20).optional().or(z.literal("")),
  numero_conta: z.string().trim().max(30).optional().or(z.literal("")),
  tipo: z.enum(["corrente", "poupanca", "investimento", "caixa"]),
  saldo_inicial: z
    .string()
    .refine((v) => !Number.isNaN(Number(v)), "Saldo inicial inválido."),
  saldo_inicial_data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data em YYYY-MM-DD."),
  ordem: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? Number(v) : 0)),
});

export type ContaBancariaInput = z.infer<typeof contaBancariaSchema>;
