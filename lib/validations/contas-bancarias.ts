import { z } from "zod";

/**
 * A conta bancária não tem empresa (decisão de 29/08/2026, aplicada ao
 * cadastro em 09/09/2026): "as contas em si não são específicas de uma
 * empresa". A empresa é do DOCUMENTO — vem do título e é ela que vai
 * para o lançamento na baixa.
 *
 * `empresa_id` segue existindo na tabela como vestígio nullable, para o
 * caso de a agência voltar a dividir contas por empresa. O cadastro não
 * a envia mais, e nada deve filtrar conta por ela.
 */
export const contaBancariaSchema = z.object({
  empresa_contabil_id: z.string().uuid("Empresa contábil é obrigatória."),
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
