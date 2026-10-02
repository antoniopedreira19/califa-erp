/**
 * A NF do fornecedor como o pop-up de aprovação da PP a manda para o
 * servidor (módulo fiscal, entrega 1 — 02/10/2026): o que a coluna "Dados
 * da PP" conferiu (número, emissão, valor e CNPJ tomador), as retenções
 * decididas — vazio com a retenção desligada — e a troca manual do crédito
 * de PIS/COFINS. É o que `aprovarPPComNotaFiscal` passa a
 * `registrar_nf_da_pp`, que confere tudo de novo no banco.
 *
 * Testes: node --import tsx --test lib/validations/nf-da-pp.test.ts
 */
import { z } from "zod";
import { MOTIVOS_SEM_CREDITO } from "@/lib/fiscal/calculos";

const msgNumero = "Informe o número da NF.";
const msgEmissao = "Informe a data de emissão da NF.";
const msgValor = "Informe o valor da NF.";
const msgTomador = "Escolha o CNPJ tomador da NF.";
const msgAliquota = "Alíquota de retenção inválida.";
const msgSemNf = "Preencha a nota fiscal do fornecedor em “Dados da PP” antes de aprovar.";

export const nfDaPPSchema = z
  .object(
    {
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
        .max(5, "Retenções demais para uma NF.")
        .default([]),
      credito_retirado: z
        .boolean({ invalid_type_error: "Escolha se a nota gera crédito de PIS/COFINS." })
        .default(false),
      credito_motivo: z.string().trim().nullable().default(null),
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

export type NfDaPPInput = z.infer<typeof nfDaPPSchema>;
