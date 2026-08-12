import { z } from "zod";

/** Limite do contador de caracteres das observações (UI e CHECK do banco). */
export const OBSERVACOES_MAX = 500;

/**
 * Modal "Enviar job para abertura" (handoff "Abertura de Job.dc.html").
 *
 * Só valida o que o modal deixa editar. Produto, GP responsável e produtor
 * responsável continuam herdados — produto vem do projeto, os dois
 * responsáveis vêm do orçamento — e aparecem travados na tela; o servidor
 * relê esses valores do banco em vez de aceitá-los do formulário, então
 * eles não têm campo aqui.
 *
 * Cidade e regional voltaram a ser editáveis em 12/08/2026: chegam
 * pré-preenchidas com o que está no orçamento e, se o usuário trocar, o
 * valor novo é gravado no job E no orçamento — como já acontece com nome
 * e datas. A regional escolhida ainda precisa estar cadastrada no projeto;
 * isso o servidor confere, porque a lista do formulário não é garantia.
 *
 * Não tem `posicao_hierarquia`: não há mais conceito de principal/sub-job.
 *
 * `valor_total` também não está aqui: é recalculado no servidor a partir
 * dos itens da versão aprovada. Valor de faturamento não vem do cliente.
 *
 * Nome, datas, cidade e regional são gravados TAMBÉM no orçamento — ver
 * `enviarJobParaAbertura`.
 */
export const aberturaJobSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome do job (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    cidade_id: z.string().uuid("Selecione a cidade."),
    regional_id: z.string().uuid("Selecione a regional."),
    data_inicio_prevista: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início é obrigatória."),
    data_fim_prevista: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fim é obrigatória."),
    data_prevista_faturamento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data prevista para faturamento é obrigatória."),
    observacoes: z
      .string()
      .trim()
      .max(OBSERVACOES_MAX, `Máximo ${OBSERVACOES_MAX} caracteres.`)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .refine((d) => d.data_fim_prevista >= d.data_inicio_prevista, {
    message: "A data de fim não pode ser anterior à data de início.",
    path: ["data_fim_prevista"],
  });

export type AberturaJobInput = z.infer<typeof aberturaJobSchema>;
