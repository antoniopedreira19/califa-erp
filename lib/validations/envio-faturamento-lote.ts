import { z } from "zod";
import { isValidCnpj, onlyDigits } from "@/lib/utils";
import { contatoCobrancaEnvioSchema } from "./envio-faturamento";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Uma nota do envio em lote (decisão 188): a nota que o cliente pediu —
 * tomador, CNPJ (ou exterior, decisão 184), valor e descritivo — e de que
 * jobs ela é ("Rateio"): proporcional, de um job só, ou dividida à mão.
 *
 * As partes de cada job NÃO vêm prontas do navegador: a action refaz o
 * rateio com o valor dos jobs relido do banco (`ratearNotas`). Só a divisão
 * à mão traz valores por job, e a soma dela é conferida.
 */
export const notaDoLoteSchema = z
  .object({
    tomador_nome: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .nullable()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    cnpj: z
      .string()
      .nullable()
      .default(null)
      .transform((v) => (v === null ? null : onlyDigits(v))),
    tomador_exterior: z.boolean().default(false),
    valor: z.number().positive("Cada nota precisa de valor maior que zero."),
    descritivo: z
      .string()
      .trim()
      .max(2000, "Máximo 2.000 caracteres.")
      .nullable()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    /** "proporcional", "manual" ou o id do job ("Só o job X"). */
    rateio: z.string().min(1),
    /** Só na divisão à mão: id do job → valor. */
    manual: z.record(z.string(), z.number().nonnegative()).optional(),
  })
  .superRefine((n, ctx) => {
    if (n.tomador_exterior) return;
    if (!n.cnpj || n.cnpj.length !== 14) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "O CNPJ tem 14 números." });
    } else if (!isValidCnpj(n.cnpj)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "CNPJ inválido." });
    }
  })
  .transform((n) => (n.tomador_exterior ? { ...n, cnpj: null } : n));

export type NotaDoLoteInput = z.input<typeof notaDoLoteSchema>;

/**
 * O envio em lote (decisão 188): jobs de um mesmo cliente e de uma mesma
 * empresa, as notas que o cliente pediu e o que vale para todas — o
 * vencimento e o número de parcelas, o CNAE sugerido, o portal, a
 * observação para o financeiro e os contatos de cobrança (que passam a ser
 * os de cada job, como no envio de um job só, D1).
 *
 * O valor de cada job não está aqui: é relido no servidor, como no envio
 * de um job só.
 */
export const envioEmLoteSchema = z.object({
  jobs: z
    .array(
      z.object({
        job_id: z.string().uuid(),
        numero_po: z
          .string()
          .trim()
          .max(60, "Máximo 60 caracteres.")
          .nullable()
          .optional()
          .transform((v) => (v && v.length > 0 ? v : null)),
      }),
    )
    .min(1, "Escolha os jobs do envio."),
  /** O mês dos jobs mensais (Fee e Always On); nulo sem mensal. */
  mes: z.string().regex(dateRegex).nullable().default(null),
  vencimento: z.string().regex(dateRegex, "Informe o vencimento."),
  parcelas: z.number().int().min(1).max(3),
  cnae_sugerido: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  portal_id: z.string().uuid().nullable().default(null),
  observacao: z
    .string()
    .trim()
    .max(1000, "Máximo 1.000 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  contatos: z.array(contatoCobrancaEnvioSchema).min(1, "Informe ao menos um contato de cobrança."),
  notas: z.array(notaDoLoteSchema).min(1, "Informe ao menos uma nota fiscal."),
});

export type EnvioEmLoteInput = z.input<typeof envioEmLoteSchema>;
