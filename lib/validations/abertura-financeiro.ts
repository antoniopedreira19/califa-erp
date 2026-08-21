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
 * Tolerância ao comparar a soma de uma previsão (curva de desembolso ou
 * parcelas de recebimento) com o total dela. Existe por causa do centavo
 * de arredondamento ao dividir um total por 3 — não é folga de negócio.
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

/**
 * Parcelas de recebimento: em que datas o faturamento previsto entra no
 * caixa. Pode ser vazia pelo mesmo motivo da curva — job cujo
 * faturamento previsto é zero (tudo pago direto pelo cliente ao
 * fornecedor) abre sem previsão de entrada. Quando o faturamento previsto
 * é maior que zero, a action exige que as parcelas existam e fechem com
 * ele.
 */
export const previsaoRecebimentoSchema = z
  .array(
    z.object({
      data_prevista: z.string().regex(dateRegex, "Informe a data prevista."),
      valor: z
        .number({ invalid_type_error: "Informe o valor da parcela." })
        .positive("Cada parcela de recebimento precisa de um valor maior que zero."),
    }),
  )
  .max(60, "Máximo de 60 parcelas de recebimento.");

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
  /**
   * Projeto do job NA VISÃO DO FINANCEIRO (`projetos_financeiro`). Não
   * mexe em `jobs.projeto_id`, que é o da produção e continua vindo do
   * orçamento — mesmo contrato de `nome_financeiro` vs `nome`.
   * Obrigatório: o protótipo marca o campo com asterisco.
   */
  projeto_financeiro_id: z.string().uuid("Selecione o projeto do job."),
  /**
   * Contas bancárias do job: uma para a entrada, uma para a saída.
   * Opcionais de propósito — o protótipo não marca nenhuma das duas com
   * asterisco, e job sem faturamento previsto (cliente paga direto ao
   * fornecedor) não tem por que ter conta de recebimento.
   */
  conta_recebimento_id: z.string().uuid().nullable(),
  conta_pagamento_id: z.string().uuid().nullable(),
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
  recebimento: previsaoRecebimentoSchema,
});

export type CurvaDesembolsoLinhaInput = z.infer<
  typeof curvaDesembolsoSchema
>[number];
export type PrevisaoRecebimentoLinhaInput = z.infer<
  typeof previsaoRecebimentoSchema
>[number];
export type AberturaFinanceiraInput = z.infer<typeof aberturaFinanceiraSchema>;

/**
 * Criação de projeto do financeiro direto do formulário de abertura
 * ("Criar projeto para este job", do protótipo).
 *
 * Só o nome vem da tela: o código é gerado pelo sistema
 * (`lib/codigos/projetos-financeiro.ts`) e o cliente vem do orçamento de
 * origem do job — nenhum dos dois é escolha de quem preenche.
 */
export const criarProjetoFinanceiroSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Informe o nome do projeto (mín. 2 caracteres).")
    .max(200, "Máximo 200 caracteres."),
});

export type CriarProjetoFinanceiroInput = z.infer<
  typeof criarProjetoFinanceiroSchema
>;

/**
 * Edição do registro da abertura de um job JÁ ABERTO ("Editar registro",
 * do protótipo). Mesmos campos da abertura: o formulário é o mesmo, só
 * muda o que a action aceita reescrever.
 *
 * O que NUNCA muda na edição, e por isso não está aqui:
 * `data_abertura_financeiro` e `aberto_por` — a abertura aconteceu uma
 * vez, e reescrever quem abriu apagaria a única prova de quem conferiu.
 */
export const edicaoRegistroAberturaSchema = aberturaFinanceiraSchema;

export type EdicaoRegistroAberturaInput = z.infer<
  typeof edicaoRegistroAberturaSchema
>;
