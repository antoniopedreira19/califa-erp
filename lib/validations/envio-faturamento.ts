import { z } from "zod";
import { isValidCnpj, onlyDigits } from "@/lib/utils";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Um vencimento de uma nota do envio (decisão 123, 29/09/2026).
 *
 * Até a 123 cada parcela virava uma nota própria. Agora a parcela é um
 * vencimento DA MESMA nota: "uma nota, vários vencimentos".
 */
export const parcelaFaturamentoSchema = z.object({
  valor: z.number().positive("Parcela precisa ter valor maior que zero."),
  data_vencimento: z
    .string()
    .regex(dateRegex, "Informe o vencimento de cada parcela."),
});

export type ParcelaFaturamentoInput = z.infer<typeof parcelaFaturamentoSchema>;

/**
 * Uma nota fiscal do envio (decisão 123). O valor da nota é a soma das
 * parcelas dela — não há campo de valor à parte para divergir.
 *
 * O CNPJ é do cliente tomador e é campo livre: nasce com o do cadastro e
 * pode ser outro (o Tiago preferiu não cadastrar vários CNPJs por cliente,
 * 29/09/2026). CNAE sugerido e descritivo são opcionais (D2).
 */
export const notaFaturamentoSchema = z.object({
  cnpj: z
    .string()
    .transform((v) => onlyDigits(v))
    .refine((v) => v.length === 14, "O CNPJ tem 14 números.")
    .refine(isValidCnpj, "CNPJ inválido."),
  cnae_sugerido: z
    .string()
    .trim()
    .max(60, "Máximo 60 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  descritivo: z
    .string()
    .trim()
    .max(2000, "Máximo 2.000 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  parcelas: z
    .array(parcelaFaturamentoSchema)
    .min(1, "Cada nota fiscal precisa de ao menos um vencimento."),
});

export type NotaFaturamentoInput = z.infer<typeof notaFaturamentoSchema>;

/** Anexo da PO: o arquivo já subiu ao Storage pelo navegador. */
export const ANEXO_PO_MIMES = ["application/pdf", "image/png", "image/jpeg"] as const;
export const ANEXO_PO_TAMANHO_MAX = 10 * 1024 * 1024;

export const anexoPoSchema = z.object({
  path: z.string().min(1).max(500),
  nome_arquivo: z.string().trim().min(1).max(255),
  mime_type: z.enum(ANEXO_PO_MIMES, {
    errorMap: () => ({ message: "Anexe um PDF ou uma imagem (PNG ou JPG)." }),
  }),
  tamanho_bytes: z
    .number()
    .int()
    .positive()
    .max(ANEXO_PO_TAMANHO_MAX, "Cada anexo da PO pode ter até 10 MB."),
});

export type AnexoPoInput = z.infer<typeof anexoPoSchema>;

/** Contato de cobrança revisto no envio (D1): o mesmo formato da abertura. */
export const contatoCobrancaEnvioSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do contato."),
  numero: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  email: z.string().trim().email("E-mail do contato inválido.").max(200),
});

export type ContatoCobrancaEnvioInput = z.infer<typeof contatoCobrancaEnvioSchema>;

/**
 * Envio do job para faturamento — o que a produção libera ao financeiro.
 *
 * `valor_faturado` NÃO está aqui: vem travado do `faturamento_previsto`
 * do job e é relido no servidor. Valor de nota não vem do formulário.
 * A soma das notas é conferida contra esse número relido.
 *
 * Desde a decisão 123 (29/09/2026) o envio se divide em `notas`, cada uma
 * com CNPJ, CNAE sugerido, descritivo e vencimentos; leva os anexos da PO;
 * e traz a lista revista dos contatos de cobrança, que passa a ser a do job.
 *
 * `portal_id` é opcional porque nem todo cliente tem portal, e `numero_po`
 * porque nem todo cliente emite PO. Envios diferentes podem citar a mesma
 * PO (D5): o número não é único.
 */
export const envioFaturamentoSchema = z.object({
  // `nullable` além de `optional`: o formulário manda `null` quando o
  // campo fica vazio, não `undefined`. Sem isto o Zod recusava o envio
  // sem PO — que é justamente o caso que o campo opcional existe para
  // permitir — com a mensagem crua "Expected string, received null".
  numero_po: z
    .string()
    .trim()
    .max(60, "Máximo 60 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  // Mensagem em português mesmo num caminho improvável: o que vaza do
  // Zod sem mensagem custom vaza em inglês, na cara do usuário.
  portal_id: z
    .string()
    .uuid("Selecione um portal da lista.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  notas: z
    .array(notaFaturamentoSchema)
    .min(1, "Informe ao menos uma nota fiscal.")
    .max(30, "No máximo 30 notas fiscais por envio."),
  anexos_po: z.array(anexoPoSchema).max(10, "No máximo 10 anexos da PO."),
  contatos: z
    .array(contatoCobrancaEnvioSchema)
    .min(1, "Informe ao menos um contato de cobrança."),
  // Mês de referência do envio nos jobs do modelo mensal — Fee e Always On
  // (decisão 078): o primeiro dia do mês. Ausente no envio único dos
  // outros jobs; a action confere qual dos dois o job pede.
  mes: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/, "Mês de referência inválido.")
    .nullable()
    .optional(),
});

export type EnvioFaturamentoInput = z.input<typeof envioFaturamentoSchema>;

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
