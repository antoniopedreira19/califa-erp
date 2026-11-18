import { z } from "zod";
import { OBSERVACOES_MAX } from "@/lib/validations/abertura-job";

/**
 * Decisão 266 — o pop-up "Criar Job de Pagamentos" da aba Visualizar Jobs.
 *
 * O projeto unificado é um existente (`projeto_financeiro_id`) ou um nome
 * novo (`projeto_financeiro_novo`), nunca os dois. O resto da regra (a
 * empresa ter cliente, a regional ser dela, o projeto ser da empresa) é do
 * banco, na função `criar_job_de_pagamentos`.
 */
export const jobDePagamentosSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome do job.")
      .max(200, "Máximo 200 caracteres."),
    projeto_financeiro_id: z.string().uuid().nullable(),
    projeto_financeiro_novo: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .nullable(),
    empresa_id: z.string().uuid("Escolha a empresa."),
    regional_id: z.string().uuid("Escolha a regional."),
    competencia_trimestre: z.number().int().min(1).max(4),
    competencia_ano: z.number().int().min(2000).max(2100),
    descritivo: z
      .string()
      .trim()
      .min(10, "Escreva o descritivo com pelo menos 10 caracteres.")
      .max(OBSERVACOES_MAX, `Máximo ${OBSERVACOES_MAX} caracteres.`),
  })
  .refine(
    (v) => Boolean(v.projeto_financeiro_id) !== Boolean(v.projeto_financeiro_novo && v.projeto_financeiro_novo.length >= 2),
    { message: "Escolha ou crie o projeto unificado.", path: ["projeto_financeiro_id"] },
  );

export type JobDePagamentosInput = z.input<typeof jobDePagamentosSchema>;
