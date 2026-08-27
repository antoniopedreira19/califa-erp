/** Como uma parcela do envio vira ITENS de nota fiscal quando há save.
 *
 *  A parcela do envio vale o `faturamento_previsto` inteiro do job, save
 *  incluído. Na nota isso precisa sair em DOIS itens — `origem_tipo`
 *  `job` e `save` —, porque cada um tem um destino diferente no fluxo de
 *  caixa: o do job é dele, o do save entra sem dono até alguém consumir
 *  (docs/decisions/028-save-entre-jobs.md).
 *
 *  A regra de repartição é a mesma do resto do sistema, definida pelo
 *  Tiago em 26/08/2026: **job primeiro, depois o save**.
 */

/** Uma parcela repartida entre o que é do job e o que é saldo em save. */
export interface ParteDaParcela {
  job: number;
  save: number;
}

/**
 * Reparte o valor a faturar de UMA parcela entre job e save.
 *
 * `saldoProprio` é quanto ainda cabe faturar da parte do job naquela
 * parcela — vem de `vw_faturamento_pendente.saldo_proprio`. O que passar
 * disso é save.
 *
 * Numa parcela sem save `saldoProprio` é o saldo inteiro e a função
 * devolve `save: 0` — o comportamento de sempre.
 */
export function repartirEmJobESave(
  valor: number,
  saldoProprio: number,
): ParteDaParcela {
  const job = Math.max(0, Math.min(valor, saldoProprio));
  // Centavos: sem o arredondamento, 0.1 + 0.2 vira item de nota fiscal.
  return {
    job: Math.round(job * 100) / 100,
    save: Math.round(Math.max(valor - job, 0) * 100) / 100,
  };
}

/** Rótulo curto da quebra, para a linha da fila e o resumo do drawer. */
export function rotuloDaQuebra(parte: ParteDaParcela): string | null {
  if (parte.save <= 0.004) return null;
  if (parte.job <= 0.004) return "tudo em saldo de save";
  return "job + saldo em save";
}
