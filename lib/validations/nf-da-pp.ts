/**
 * As NFs do fornecedor como o pop-up de aprovação da PP as manda para o
 * servidor (módulo fiscal, entrega 1 — 02/10/2026; decisão 152 —
 * 07/10/2026): uma por anexo do tipo NF, com o que a coluna "Dados da PP"
 * conferiu (número, emissão, valor TOTAL, CNPJ tomador e a parte da nota
 * nesta PP) e a troca manual do crédito de PIS/COFINS, mais as retenções da
 * PP — vazio com a retenção desligada. É o que `aprovarPPComNotaFiscal`
 * passa a `registrar_notas_fiscais_da_pp`, que confere tudo de novo no
 * banco (inclusive que a soma das partes de cada nota, em todas as PPs, não
 * passa do valor dela).
 *
 * Testes: node --import tsx --test lib/validations/nf-da-pp.test.ts
 */
import { z } from "zod";
import { MOTIVOS_SEM_CREDITO } from "@/lib/fiscal/calculos";

const msgNumero = "Informe o número da NF.";
const msgEmissao = "Informe a data de emissão da NF.";
const msgValor = "Informe o valor da NF.";
const msgParte = "Informe o valor da NF nesta PP.";
const msgTomador = "Escolha o CNPJ tomador da NF.";
const msgAliquota = "Alíquota de retenção inválida.";
const msgSemNf = "Preencha as notas fiscais do fornecedor em “Dados da PP” antes de aprovar.";

export const notaDaPPSchema = z
  .object({
    anexo_id: z.string({ required_error: msgSemNf, invalid_type_error: msgSemNf }).uuid(msgSemNf),
    numero: z
      .string({ required_error: msgNumero, invalid_type_error: msgNumero })
      .trim()
      .min(1, msgNumero)
      .max(60, "O número da NF está longo demais."),
    data_emissao: z
      .string({ required_error: msgEmissao, invalid_type_error: msgEmissao })
      .regex(/^\d{4}-\d{2}-\d{2}$/, msgEmissao),
    valor: z
      .number({ required_error: msgValor, invalid_type_error: msgValor })
      .finite(msgValor)
      .positive(msgValor),
    tomador_estabelecimento_id: z
      .string({ required_error: msgTomador, invalid_type_error: msgTomador })
      .uuid(msgTomador),
    valor_na_pp: z
      .number({ required_error: msgParte, invalid_type_error: msgParte })
      .finite(msgParte)
      .positive(msgParte),
    credito_retirado: z
      .boolean({ invalid_type_error: "Escolha se a nota gera crédito de PIS/COFINS." })
      .default(false),
    credito_motivo: z.string().trim().nullable().default(null),
  })
  .superRefine((d, ctx) => {
    if (d.valor_na_pp > d.valor + 0.004) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `O valor da NF ${d.numero} nesta PP não pode passar do valor da nota.`,
        path: ["valor_na_pp"],
      });
    }
    // Tirar o crédito pede um dos motivos da lista.
    if (
      d.credito_retirado &&
      !(MOTIVOS_SEM_CREDITO as readonly string[]).includes(d.credito_motivo ?? "")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Escolha o motivo de a nota não gerar crédito de PIS/COFINS.",
        path: ["credito_motivo"],
      });
    }
  });

export const notasDaPPSchema = z
  .object(
    {
      notas: z
        .array(notaDaPPSchema, { required_error: msgSemNf, invalid_type_error: msgSemNf })
        .min(1, msgSemNf)
        .max(30, "Notas demais para uma PP."),
      retencoes: z
        .array(
          z.object({
            imposto: z.enum(["ISS", "PIS", "COFINS", "CSLL", "IRRF"], {
              errorMap: () => ({ message: "Imposto retido inválido." }),
            }),
            aliquota: z
              .number({ required_error: msgAliquota, invalid_type_error: msgAliquota })
              .gt(0, msgAliquota)
              .lt(100, msgAliquota),
          }),
          { invalid_type_error: "Retenções inválidas." },
        )
        .max(5, "Retenções demais para uma PP.")
        .default([]),
    },
    { required_error: msgSemNf, invalid_type_error: msgSemNf },
  )
  .superRefine((d, ctx) => {
    if (new Set(d.retencoes.map((r) => r.imposto)).size !== d.retencoes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cada imposto retido entra uma vez só.",
        path: ["retencoes"],
      });
    }
    if (new Set(d.notas.map((n) => n.anexo_id)).size !== d.notas.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "As notas não batem com os anexos da PP. Recarregue a tela.",
        path: ["notas"],
      });
    }
  });

export type NotasDaPPInput = z.infer<typeof notasDaPPSchema>;
