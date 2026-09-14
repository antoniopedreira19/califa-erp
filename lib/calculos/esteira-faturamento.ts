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
  /** Job cujo faturamento previsto é ZERO porque tudo nele é pago por
   *  saldo de save de outro job. Ele **pula a etapa de faturamento** e se
   *  comporta como já faturado: não há nota a emitir, ela já saiu no job
   *  que gerou o crédito (decisão do Tiago em 27/08/2026, decisão 028
   *  §11). Sem isto ele ficaria eternamente em "aguardando envio",
   *  travado dos dois lados. */
  nadaAFaturar = false,
): SituacaoFaturamento {
  if (nadaAFaturar && !temNota) return "faturado";
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

/**
 * Uma nota EMITIDA vista a partir de um job: a nota inteira e a parte que
 * cabe a ele.
 *
 * A nota de um job se reconhece pelos ITENS (`faturamento_itens`), nunca
 * por `faturamentos.origem_id`, que fica nulo sempre que a nota tem mais de
 * um item — NF agrupada, e também a nota de um job só com item de save ou
 * com duas parcelas dele (decisão 017 §2, decisão 075).
 */
export interface NotaDoJob {
  id: string;
  numero: string | null;
  data_emissao: string | null;
  /** Total da nota — todos os jobs que ela cobre. */
  valor_total: number;
  /** Soma dos itens DESTE job na nota: o próprio e o saldo em save. */
  parte_do_job: number;
  /** Títulos da nota inteira. Cancelado não chega aqui. */
  titulos: TituloDaNota[];
}

/** O que a esteira mostra de um job, depois de juntar as notas dele. */
export interface NotasConsolidadas {
  situacao: SituacaoFaturamento;
  /** Soma das partes do job nas notas; nulo quando não há nota. */
  valor_faturado: number | null;
  /** Números das notas, na ordem de emissão, separados por " · ". */
  numeros_nf: string | null;
  /** Quanto já entrou, rateado pela parte do job em cada nota. */
  valor_recebido: number;
  /** Vencimento em aberto mais antigo, de qualquer nota do job. */
  vencimento_em_aberto: string | null;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Junta as notas de um job numa linha da esteira (decisão 075, regras
 * escolhidas pelo Tiago em 14/09/2026):
 *
 * - **Valor**: a PARTE do job em cada nota, somada. Nunca o total da nota
 *   agrupada — 017 §2: "quanto o JOB-A faturou?" não se responde com a
 *   nota inteira.
 * - **Número**: todas as notas, "NF 101 · 102". Job em várias notas é o
 *   caso normal do envio em parcelas (017 §3).
 * - **Situação**: a nota inteira decide. O título é da nota, não do job, e
 *   não há como saber qual job ele paga — então um título vencido em
 *   qualquer nota do job deixa o job inadimplente, e ele só liquida quando
 *   todos os títulos de todas as suas notas estiverem pagos.
 * - **Recebido**: rateado pela participação do job em cada nota
 *   (`pago da nota × parte ÷ total`). Recebido da nota inteira em cada job
 *   somaria mais que o dinheiro que entrou.
 */
export function consolidarNotasDoJob(
  notas: NotaDoJob[],
  temEnvio: boolean,
  hoje: string,
  nadaAFaturar = false,
): NotasConsolidadas {
  const ordenadas = [...notas].sort(
    (a, b) =>
      (a.data_emissao ?? "").localeCompare(b.data_emissao ?? "") ||
      (a.numero ?? "").localeCompare(b.numero ?? "", "pt-BR", { numeric: true }),
  );

  const titulos = ordenadas.flatMap((n) => n.titulos);
  const emAberto = titulos.filter((t) => t.status !== "pago");

  const numeros = Array.from(
    new Set(ordenadas.map((n) => n.numero).filter((n): n is string => !!n)),
  );

  const recebido = ordenadas.reduce((soma, n) => {
    if (!(n.valor_total > 0)) return soma;
    const pagoDaNota = n.titulos
      .filter((t) => t.status === "pago")
      .reduce((s, t) => s + t.valor, 0);
    return soma + (pagoDaNota * n.parte_do_job) / n.valor_total;
  }, 0);

  return {
    situacao: classificarFaturamento(
      ordenadas.length > 0,
      temEnvio,
      titulos,
      hoje,
      nadaAFaturar,
    ),
    valor_faturado:
      ordenadas.length > 0
        ? centavos(ordenadas.reduce((s, n) => s + n.parte_do_job, 0))
        : null,
    numeros_nf: numeros.length > 0 ? numeros.join(" · ") : null,
    valor_recebido: centavos(recebido),
    vencimento_em_aberto: emAberto.map((t) => t.vencimento).sort()[0] ?? null,
  };
}
