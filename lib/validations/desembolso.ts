import { z } from "zod";
import { DOCUMENTO_TIPOS, PP_ANEXO_MIMETYPES_ACEITOS } from "@/lib/types";

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
  .min(1, "Escolha a regional do pedido.")
  .refine((a) => Math.abs(a.reduce((s, r) => s + r.percentual, 0) - 100) < 0.01, {
    message: "O rateio por regional precisa somar 100%.",
  })
  .refine((a) => new Set(a.map((r) => r.regional_id)).size === a.length, {
    message: "Cada regional só pode aparecer uma vez.",
  });

/**
 * Um anexo do pedido (decisão 264), no formato do anexo da PP: o tipo
 * obrigatório e, na NF, número, emissão, valor, CNPJ tomador e a parte da
 * nota neste pedido. No reembolso, data e valor de cada comprovante
 * (decisão 187). `id` = o anexo já gravado (corrigir e reenviar).
 */
const anexoDoPedidoSchema = z.object({
  id: z.string().uuid().nullable(),
  path: z.string().min(1),
  nome: z.string().min(1).max(255),
  tamanho: z.number().int().nonnegative(),
  mimetype: z.enum(PP_ANEXO_MIMETYPES_ACEITOS, { errorMap: () => ({ message: "Tipo de arquivo não aceito." }) }),
  // Como o anexo da PP: o cupom fiscal vale nos comprovantes do reembolso (decisão 187).
  documento_tipo: z.enum([...DOCUMENTO_TIPOS, "cupom_fiscal"]).nullable(),
  documento_numero: z.string().trim().max(60).nullable(),
  nf_data_emissao: z.string().regex(dateRegex).nullable(),
  nf_valor: z.number().positive().nullable(),
  nf_tomador_estabelecimento_id: z.string().uuid().nullable(),
  nf_valor_no_pedido: z.number().positive().nullable(),
});
export type AnexoDoPedidoInput = z.infer<typeof anexoDoPedidoSchema>;

/** O pedido novo, ou o rejeitado que quem pediu corrige e reenvia (`id`). */
export const salvarPedidoDeDesembolsoSchema = z
  .object({
    id: z.string().uuid().nullable(),
    empresa_id: z.string().uuid("Escolha a empresa."),
    descricao: z.string().trim().min(3, "Escreva a descrição do pedido.").max(500),
    favorecido_tipo: z.enum(["fornecedor", "reembolso"]),
    fornecedor_id: z.string().uuid().nullable(),
    valor: z.number({ invalid_type_error: "Informe o valor." }).positive("Informe o valor."),
    urgente: z.boolean(),
    urgente_justificativa: z.string().trim().max(500).nullable(),
    rateio: rateioSchema,
    parcelas: z
      .array(
        z.object({
          numero: z.number().int().min(1),
          data_vencimento: z.string().regex(dateRegex, "Escolha a data de pagamento."),
          valor: z.number().positive("Valor de parcela precisa ser positivo."),
        }),
      )
      .min(1, "Escolha a data de pagamento.")
      .max(36),
    anexos: z.array(anexoDoPedidoSchema).min(1, "Anexe o comprovante: sem ele o financeiro não aprova.").max(20),
  })
  .superRefine((d, ctx) => {
    const erro = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (d.favorecido_tipo === "fornecedor" && !d.fornecedor_id) erro("Escolha o fornecedor que recebe, ou marque reembolso.");
    if (d.urgente && (d.urgente_justificativa ?? "").trim().length < 10) {
      erro("Escreva a justificativa do pagamento urgente (mín. 10 caracteres).");
    }
    const soma = Math.round(d.parcelas.reduce((s, p) => s + p.valor, 0) * 100) / 100;
    if (Math.abs(soma - d.valor) > 0.005) erro("A soma das parcelas precisa bater com o valor do pedido.");
    if (new Set(d.parcelas.map((p) => p.numero)).size !== d.parcelas.length) erro("Número de parcela repetido.");
    if (d.anexos.some((a) => !a.documento_tipo)) erro("Escolha o tipo de cada arquivo.");
  });
export type SalvarPedidoDeDesembolsoInput = z.infer<typeof salvarPedidoDeDesembolsoSchema>;

export const aprovarDesembolsoSchema = z
  .object({
    desembolso_id: z.string().uuid(),
    data_pagamento: z.string().regex(dateRegex, "Escolha a data de pagamento."),
    // A INTENÇÃO de pagamento (decisão 093, §12): como a PP, o financeiro
    // pode dizer na aprovação por onde o desembolso vai sair. Cartão aqui
    // não amarra a fatura — isso acontece na baixa; serve para pré-preencher
    // a baixa e para a previsão de caixa cair no vencimento da fatura.
    forma_pagamento: z.enum(["pix", "transferencia", "boleto", "cartao_credito"]).nullable().optional(),
    cartao_credito_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.forma_pagamento === "cartao_credito" && !v.cartao_credito_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cartao_credito_id"],
        message: "Escolha o cartão de crédito.",
      });
    }
  });

export const rejeitarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter pelo menos 10 caracteres.").max(500),
});

export const cancelarDesembolsoSchema = z.object({
  desembolso_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter pelo menos 10 caracteres.").max(500),
});
