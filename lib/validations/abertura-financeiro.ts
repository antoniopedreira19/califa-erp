import { z } from "zod";

/**
 * Registro financeiro da abertura do job.
 *
 * Não confundir com `abertura-job.ts`: lá é o ENVIO do job pela produção
 * (nome, datas, observações). Aqui é o outro lado do balcão — o que o
 * financeiro preenche ao receber esse job e efetivamente abri-lo.
 */

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tolerância ao comparar a soma da curva com o custo previsto. Existe por
 * causa do centavo de arredondamento ao dividir um total por 3 — não é
 * folga de negócio.
 */
export const TOLERANCIA_CURVA = 0.02;

/**
 * Pode ser vazia: job sem custo de calha PP (100% pago direto pelo
 * cliente) abre sem desembolso previsto. Quando o custo previsto é maior
 * que zero, a action exige que a curva exista e some o total — essa
 * amarração cruzada é dela, não do schema.
 */
export const curvaDesembolsoSchema = z
  .array(
    z.object({
      data_prevista: z.string().regex(dateRegex, "Informe a data prevista."),
      valor: z
        .number({ invalid_type_error: "Informe o valor da data." })
        .positive("Cada data da curva precisa de um valor maior que zero."),
    }),
  )
  .max(60, "Máximo de 60 datas na curva.");

export const aberturaFinanceiraSchema = z.object({
  /**
   * Nome do job NO FINANCEIRO. Não sobrescreve o nome da produção — quem
   * abre pode renomear para o uso do financeiro sem que o GP perca o nome
   * pelo qual acha o job.
   */
  nome_financeiro: z
    .string()
    .trim()
    .min(2, "Informe o nome do job (mín. 2 caracteres).")
    .max(200, "Máximo 200 caracteres."),
  categoria_id: z.string().uuid("Selecione a categoria do job."),
  competencia_trimestre: z
    .number()
    .int()
    .min(1, "Trimestre inválido.")
    .max(4, "Trimestre inválido."),
  competencia_ano: z
    .number()
    .int()
    .min(2000, "Ano inválido.")
    .max(2100, "Ano inválido."),
  curva: curvaDesembolsoSchema,
});

export type CurvaDesembolsoLinhaInput = z.infer<
  typeof curvaDesembolsoSchema
>[number];
export type AberturaFinanceiraInput = z.infer<typeof aberturaFinanceiraSchema>;
