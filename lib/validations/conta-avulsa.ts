import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const criarContaAvulsaSchema = z
  .object({
    empresa_id: z.string().uuid("Selecione a empresa."),
    descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
    valor: z
      .string()
      .refine(
        (v) => !Number.isNaN(Number(v)) && Number(v) > 0,
        "Valor deve ser positivo.",
      ),
    natureza: z.enum(["entrada", "saida"]),
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
    plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
    plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
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
  .refine((data) => !(data.fornecedor_id && data.cliente_id), {
    message: "Escolha fornecedor OU cliente, não ambos.",
    path: ["cliente_id"],
  });

/**
 * Editar não aceita empresa_id (imutável) nem anexos (fluxo separado — anexar
 * numa conta existente é outro caminho, TBD em fase futura; nesta task o
 * editar não altera anexos).
 */
export const editarContaAvulsaSchema = criarContaAvulsaSchema.innerType().omit({
  empresa_id: true,
  anexos: true,
});

export type CriarContaAvulsaInput = z.infer<typeof criarContaAvulsaSchema>;
export type EditarContaAvulsaInput = z.infer<typeof editarContaAvulsaSchema>;

export const baixaAvulsaSchema = z.object({
  conta_avulsa_id: z.string().uuid(),
  pago_em: z.string().regex(dateRegex, "Data em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

export const estornoAvulsaSchema = z.object({
  conta_avulsa_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
    .max(500, "Motivo passa de 500 caracteres."),
});
