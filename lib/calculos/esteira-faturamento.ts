/**
 * A esteira do faturamento de um job.
 *
 * Fica em `lib/calculos/` — e não junto da tela — por dois motivos: é
 * regra de negócio, e precisa ser conferível sem emitir nota de verdade.
 * `faturamentos` e `titulos_receber` são tabelas da frente de contas a
 * receber; testar pela interface exigiria escrever no módulo do outro.
 */

/**
 * Onde o job está na esteira. Os cinco estados são exclusivos entre si —
 * cada job está em exatamente um.
 *
 * - `aguardando_envio`: a produção ainda não liberou o job.
 * - `enviado`: liberado, esperando o financeiro emitir a nota.
 * - `faturado`: nota emitida, dinheiro ainda dentro do prazo.
 * - `inadimplente`: nota emitida e parcela vencida sem recebimento.
 * - `liquidado`: tudo recebido.
 */
export type SituacaoFaturamento =
  | "aguardando_envio"
  | "enviado"
  | "faturado"
  | "inadimplente"
  | "liquidado";

/** Título a receber, na forma mínima de que a classificação precisa. */
export interface TituloDaNota {
  valor: number;
  vencimento: string;
  /** `em_aberto` ou `pago` — cancelado nem chega aqui. */
  status: string;
}

/**
 * Classifica o job a partir do que existe gravado.
 *
 * `hoje` entra por parâmetro para a inadimplência ser conferível sem
 * depender do relógio da máquina. Datas são ISO (`YYYY-MM-DD`), que
 * ordena igual como texto e como data — por isso a comparação direta.
 *
 * Vencer HOJE não é inadimplência: o cliente tem o dia inteiro para
 * pagar.
 */
export function classificarFaturamento(
  temNota: boolean,
  temEnvio: boolean,
  titulos: TituloDaNota[],
  hoje: string,
): SituacaoFaturamento {
  if (!temNota) return temEnvio ? "enviado" : "aguardando_envio";

  const emAberto = titulos.filter((t) => t.status !== "pago");

  // Uma parcela vencida basta: o job inteiro está em atraso, mesmo que as
  // outras já tenham sido recebidas. Por isso `inadimplente` é testado
  // antes de `liquidado`.
  if (emAberto.some((t) => t.vencimento < hoje)) return "inadimplente";
  if (titulos.length > 0 && emAberto.length === 0) return "liquidado";

  // Nota emitida e nada vencido. Inclui a nota cujas parcelas ainda não
  // foram geradas: já faturada, ainda sem cobrança montada.
  return "faturado";
}
