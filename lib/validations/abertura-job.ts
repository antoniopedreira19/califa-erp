import { z } from "zod";

/**
 * Modal "Enviar job para abertura" (handoff "Abertura de Job.dc.html").
 *
 * Difere do `jobSchema` em três pontos deliberados:
 * - `produto_id` é FK para `cliente_produtos`, não texto livre;
 * - `cidade_id` é FK para o cadastro `cidades`, não texto livre;
 * - não tem `posicao_hierarquia`: a posição é decidida no servidor
 *   (primeiro job do projeto vira principal, os seguintes viram sub-job).
 *
 * `valor_total` também não está aqui: é recalculado no servidor a partir
 * dos itens da versão aprovada. Valor de faturamento não vem do cliente.
 *
 * Nome e datas são gravados TAMBÉM no orçamento — ver `enviarJobParaAbertura`.
 */
export const aberturaJobSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome do job (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    produto_id: z.string().uuid("Selecione um produto do cadastro do cliente."),
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
  })
  .refine((d) => d.data_fim_prevista >= d.data_inicio_prevista, {
    message: "A data de fim não pode ser anterior à data de início.",
    path: ["data_fim_prevista"],
  });

export type AberturaJobInput = z.infer<typeof aberturaJobSchema>;
