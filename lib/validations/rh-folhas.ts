import { z } from "zod";

/**
 * Schemas do subsistema Folha Mensal.
 *
 * Ver docs/modulos/rh/20-folha-mensal.md.
 */

/** Ano da competência aceito (mesmo range do CHECK do banco). */
const anoSchema = z
  .number()
  .int()
  .min(2020)
  .max(2099);

/** Mês da competência (1..12). */
const mesSchema = z.number().int().min(1).max(12);

/** Payload de geração de folha. */
export const gerarFolhaSchema = z.object({
  ano: anoSchema,
  mes: mesSchema,
});

/**
 * Payload de edição de uma linha da folha pelo RH.
 * Alocações vêm como array — a UI já valida soma=100 no cliente, o
 * banco também tem constraint trigger deferred (2ª camada).
 */
/**
 * O valor chega em dois formatos, e os dois precisam dar o mesmo número:
 *
 * - o painel do RH manda o texto do campo de moeda, em pt-BR: "5.248,48";
 * - o painel de aprovação do financeiro manda o decimal: "5248.48" (é o
 *   que o banco devolve e o que o campo de moeda produz em centavos).
 *
 * Com vírgula, é pt-BR (ponto é milhar). Sem vírgula, o ponto é o decimal.
 * Até 30/09/2026 todo ponto era tratado como milhar: "5248.48" virava
 * 524848 — foi assim que nasceu o título de R$ 524.848,00 de 29/09
 * (decisão 132).
 */
export function valorDaFolhaParaNumero(v: string): number {
  const t = v.trim();
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(norm);
}

export const linhaFolhaSchema = z.object({
  salario_base: z
    .string()
    .trim()
    .min(1, "Informe o valor da folha.")
    .transform((v, ctx) => {
      const n = valorDaFolhaParaNumero(v);
      if (!Number.isFinite(n) || n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Valor precisa ser maior que zero.",
        });
        return z.NEVER;
      }
      return (Math.round(n * 100) / 100).toFixed(2);
    }),
  alocacoes: z
    .array(
      z.object({
        empresa_id: z.string().uuid("Empresa inválida."),
        regional_id: z.string().uuid("Regional inválida."),
        percentual: z
          .string()
          .transform((v, ctx) => {
            const norm = v.replace(",", ".");
            const n = Number(norm);
            if (!Number.isFinite(n) || n <= 0 || n > 100) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Percentual entre 0.01 e 100.",
              });
              return z.NEVER;
            }
            return (Math.round(n * 100) / 100).toFixed(2);
          }),
      }),
    )
    .min(1, "Pelo menos uma alocação."),
});

export type LinhaFolhaInput = z.infer<typeof linhaFolhaSchema>;
