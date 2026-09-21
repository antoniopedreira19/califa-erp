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

/**
 * Configuração CNAB Santander da conta bancária. Necessária pra
 * geração de arquivo de remessa a partir dessa conta. Convênio,
 * agência+DV, conta+DV e sequencial andam juntos — parcial não faz
 * sentido operacional.
 *
 * `sequencial_arquivo` começa em 11 pra evitar a faixa 1-10 que o
 * Santander trata como teste (Nota G010 do manual). Cada conta tem
 * sua própria série independente.
 *
 * Módulo pgto-remessa (ADR 004).
 */
export const configCnabContaBancariaSchema = z
  .object({
    convenio_cnab_santander: z
      .string()
      .trim()
      .max(20, "Convênio tem no máximo 20 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    agencia: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 5),
        "Agência precisa ter até 5 dígitos.",
      ),
    agencia_dv: z
      .string()
      .trim()
      .max(1, "Máximo 1 caractere.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    numero_conta: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 12),
        "Conta precisa ter até 12 dígitos.",
      ),
    numero_conta_dv: z
      .string()
      .trim()
      .max(1, "Máximo 1 caractere.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    sequencial_arquivo: z
      .string()
      .trim()
      .optional()
      .transform((v) => {
        if (!v || v.length === 0) return null;
        const n = Number(v.replace(/\D/g, ""));
        return Number.isFinite(n) && n >= 0 ? n : null;
      })
      .refine(
        (v) => v === null || v >= 11,
        "Sequencial precisa ser >= 11 (evita faixa de teste 1-10).",
      ),
  })
  .superRefine((val, ctx) => {
    // Se preencheu convênio, agência+conta+sequencial são obrigatórios juntos.
    const temConvenio = val.convenio_cnab_santander !== null;
    if (!temConvenio) return;

    const obrigatorios: [keyof typeof val, string][] = [
      ["agencia", "Preencha a agência da conta."],
      ["numero_conta", "Preencha o número da conta."],
      ["sequencial_arquivo", "Preencha o sequencial (comece em 11)."],
    ];
    for (const [campo, msg] of obrigatorios) {
      if (val[campo] === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [campo],
          message: msg,
        });
      }
    }
  });

export type ConfigCnabContaBancariaInput = z.infer<
  typeof configCnabContaBancariaSchema
>;
