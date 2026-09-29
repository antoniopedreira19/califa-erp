/**
 * O valor a dar baixa e os impostos retidos que as actions de baixa
 * recebem (decisão 125). A regra de verdade mora no banco
 * (`_valor_da_baixa`, `_retencoes_total`): não passa do que falta, os
 * retidos ficam abaixo do valor, e cada imposto aparece uma vez. Aqui só
 * se barra a entrada malformada antes da ida ao servidor.
 */

import { z } from "zod";

export const retencaoDaBaixaSchema = z.object({
  imposto: z.enum(["ISS", "PIS", "COFINS", "CSLL", "IRRF"]),
  aliquota: z.number().positive().lt(100).nullable(),
  valor: z.number().positive("Informe o valor retido."),
});

export const valorDaBaixaSchema = {
  /** Líquido + retidos. Omitido, o banco baixa tudo o que falta. */
  valor_baixa: z.number().positive("Informe o valor a dar baixa.").optional(),
  retencoes: z
    .array(retencaoDaBaixaSchema)
    .max(5)
    .refine((lista) => new Set(lista.map((r) => r.imposto)).size === lista.length, {
      message: "Cada imposto aparece uma vez só.",
    })
    .default([]),
};
