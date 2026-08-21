import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const rateioSchema = z
  .array(
    z.object({
      regional_id: z.string().uuid("Selecione a regional."),
      percentual: z
        .number({ invalid_type_error: "Informe o percentual." })
        .min(0.01, "Percentual mínimo 0,01.")
        .max(100, "Percentual máximo 100."),
    }),
  )
  .min(1, "Adicione pelo menos uma regional.")
  .refine(
    (a) => Math.abs(a.reduce((s, r) => s + r.percentual, 0) - 100) < 0.01,
    { message: "A soma dos percentuais deve ser 100,00.", path: ["_sum"] },
  )
  .refine(
    (a) => new Set(a.map((r) => r.regional_id)).size === a.length,
    { message: "Cada regional só pode aparecer uma vez.", path: ["_dup"] },
  );

const parcelaSchema = z.object({
  numero: z.number().int().min(1),
  data_vencimento: z.string().regex(dateRegex, "Data em YYYY-MM-DD."),
  valor: z
    .string()
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, "Valor deve ser positivo."),
});

const formaPagamentoEnum = z.enum([
  "pix",
  "transferencia",
  "boleto",
  "cartao_credito",
]);

export const criarDesembolsoSchema = z
  .object({
    empresa_id: z.string().uuid("Selecione a empresa."),
    descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
    valor: z
      .string()
      .refine((v) => !Number.isNaN(Number(v)) && Number(v) > 0, "Valor deve ser positivo."),
    forma_pagamento: formaPagamentoEnum,
    cartao_credito_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    data_prevista_pagamento: z
      .string()
      .regex(dateRegex, "Data em YYYY-MM-DD.")
      .nullable()
      .or(z.literal("").transform(() => null)),
    fornecedor_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    cliente_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    job_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    rateio: rateioSchema,
    parcelas: z.array(parcelaSchema).min(1, "Adicione pelo menos uma parcela.")
      .refine((ps) => new Set(ps.map((p) => p.numero)).size === ps.length,
        "Número de parcela repetido."),
    anexos: z
      .array(
        z.object({
          path: z.string().min(1),
          nome: z.string().min(1),
          tamanho: z.number().int().positive(),
          mimetype: z.string().min(1),
        }),
      )
      .default([]),
  })
  .superRefine((data, ctx) => {
    if (data.forma_pagamento === "cartao_credito") {
      if (!data.cartao_credito_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selecione o cartão de crédito.",
          path: ["cartao_credito_id"],
        });
      }
      const hoje = new Date().toISOString().slice(0, 10);
      for (const [i, p] of data.parcelas.entries()) {
        if (p.data_vencimento < hoje) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Cartão exige data futura para cada parcela.",
            path: ["parcelas", i, "data_vencimento"],
          });
        }
      }
    } else if (data.cartao_credito_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cartão só pode ser informado quando a forma é cartão de crédito.",
        path: ["cartao_credito_id"],
      });
    }

    // Soma das parcelas bate com valor total
    const totalParcelas = data.parcelas.reduce((s, p) => s + Number(p.valor), 0);
    const totalDesembolso = Number(data.valor);
    if (Math.abs(totalParcelas - totalDesembolso) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A soma das parcelas deve bater com o valor total.",
        path: ["parcelas"],
      });
    }
  });

export type CriarDesembolsoInput = z.infer<typeof criarDesembolsoSchema>;

export const aprovarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  data_pagamento: z.string().regex(dateRegex, "Data em YYYY-MM-DD."),
});

export const rejeitarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter pelo menos 10 caracteres.").max(500),
});

export const cancelarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter pelo menos 10 caracteres.").max(500),
});
