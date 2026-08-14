import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Envio do job para faturamento — o que a produção libera ao financeiro.
 *
 * `valor_faturado` NÃO está aqui: vem travado do `faturamento_previsto`
 * do job e é relido no servidor. Valor de nota não vem do formulário.
 *
 * `portal_id` é opcional porque nem todo cliente tem portal, e `numero_po`
 * porque nem todo cliente emite PO. O CNAE é obrigatório e, nesta fase, é
 * texto livre — não existe cadastro de CNAE no projeto
 * (decisão do time, 13/08/2026).
 */
export const envioFaturamentoSchema = z.object({
  numero_po: z
    .string()
    .trim()
    .max(60, "Máximo 60 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  data_faturamento: z
    .string()
    .regex(dateRegex, "Informe a data de faturamento."),
  cnae: z
    .string()
    .trim()
    .min(1, "Informe o CNAE a ser utilizado.")
    .max(120, "Máximo 120 caracteres."),
  portal_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type EnvioFaturamentoInput = z.infer<typeof envioFaturamentoSchema>;

/** Portal de fornecedor no cadastro do cliente. */
export const clientePortalSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome do portal.")
    .max(80, "Máximo 80 caracteres."),
  url: z
    .string()
    .trim()
    .min(1, "Informe o link do portal.")
    .max(500, "Máximo 500 caracteres.")
    .refine(
      (v) => /^https?:\/\//i.test(v),
      "O link precisa começar com http:// ou https://.",
    ),
});

export type ClientePortalInput = z.infer<typeof clientePortalSchema>;
