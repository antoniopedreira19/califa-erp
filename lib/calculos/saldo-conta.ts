import type { SupabaseClient } from "@supabase/supabase-js";

export type LancamentoLinha = {
  id: string;
  data_movimento: string;
  descricao: string;
  natureza: "entrada" | "saida";
  valor: number;
  fornecedor_nome: string | null;
  job_id: string | null;
  job_codigo: string | null;
  /** Do plano de contas. A tela mostra os dois separados desde 27/08/2026:
   *  até ali a coluna "Tipo" misturava o CÓDIGO do tipo com o NOME do
   *  subtipo ("05 · Salário"), e o nome do tipo — "Despesa com Pessoal" —
   *  não aparecia em lugar nenhum. */
  tipo_codigo: string;
  tipo_nome: string;
  subtipo_codigo: string;
  subtipo_nome: string;
  /** Empresa que possui a conta bancária do lançamento — o `nome_fantasia`
   *  quando existe, senão a `razao_social`. Sempre presente porque a conta
   *  bancária tem FK obrigatória para empresa. `null` só num caso limite
   *  de dado torto. */
  empresa_nome: string | null;
  /** Regional do lançamento, pela MESMA regra do `vw_fluxo_caixa`: a
   *  avulsa rateada manda; sem rateio, a regional do job; sem job, a da
   *  empresa. `null` quando nenhuma das três existe.
   *
   *  Quando a avulsa é rateada entre várias, isto vem `null` e quem conta
   *  a história é `rateio` — a coluna mostra "Rateada" e o detalhe da
   *  linha abre a divisão com os percentuais. */
  regional_nome: string | null;
  /** De ONDE o lançamento veio, pelo identificador interno da origem:
   *  `PP-00009`, `DES-00004`, `AV-00001`, ou o número da nota no
   *  recebimento — ali a origem É o documento, e não existe código
   *  interno (`faturamentos` não tem `codigo`). `null` em lançamento
   *  manual (28/08/2026). */
  origem_codigo: string | null;
  /** A avulsa nasceu de uma recorrência (assinatura, mensalidade). Vira um
   *  distintivo ao lado do código — chamar de "avulsa" o que se repete
   *  todo mês confunde quem lê o extrato. */
  origem_recorrente: boolean;
  /** "Nubank ·4471" quando o lançamento foi pago no cartão. É forma de
   *  PAGAMENTO, não origem: por isso acompanha o código em vez de
   *  substituí-lo. */
  cartao_label: string | null;
  /** O comprovante fiscal da origem: "NF 4471", "Recibo 88". Vem do
   *  primeiro anexo tipado como nota ou recibo; no recebimento vem da
   *  própria nota emitida. `null` quando ninguém identificou o anexo — ou
   *  quando não há anexo (28/08/2026). */
  documento_label: string | null;
  /** Caminho do arquivo no Storage, para o link. `null` quando o
   *  documento foi identificado mas o arquivo não está acessível. */
  documento_path: string | null;
  origem: string;
  credito: number;
  debito: number;
  saldo: number;
  rateio: Array<{ percentual: number; regional_nome: string }>;
  /** De onde vem o dinheiro desta transação, quando ela cobre mais de uma
   *  coisa: os jobs da nota e o saldo em save. Vazio na maioria dos
   *  lançamentos (docs/decisions/028-save-entre-jobs.md). */
  origens: OrigemDaTransacao[];
};

/** Uma origem do dinheiro de um lançamento. */
export type OrigemDaTransacao = {
  tipo: "job" | "save";
  /** Código do job coberto, ou do job que gerou o saldo em save. */
  codigo: string | null;
  nome: string | null;
  valor: number;
};

/**
 * Retorna o saldo da conta ANTES de `dataDe` (inclusive saldo_inicial da conta).
 * Se dataDe <= saldo_inicial_data, retorna saldo_inicial.
 */
export async function calcularSaldoAnterior(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    contaId: string;
    dataDe: string; // YYYY-MM-DD
  },
): Promise<{ saldoAnterior: number; saldoInicialData: string }> {
  const { data: conta } = await supabase
    .from("contas_bancarias")
    .select("saldo_inicial, saldo_inicial_data")
    .eq("id", args.contaId)
    .eq("tenant_id", args.tenantId)
    .single();

  if (!conta) return { saldoAnterior: 0, saldoInicialData: args.dataDe };

  const saldoInicial = Number(conta.saldo_inicial);
  const saldoInicialData: string = conta.saldo_inicial_data;

  if (args.dataDe <= saldoInicialData) {
    return { saldoAnterior: saldoInicial, saldoInicialData };
  }

  const { data: lancsAnteriores } = await supabase
    .from("lancamentos_financeiros")
    .select("valor, natureza")
    .eq("tenant_id", args.tenantId)
    .eq("conta_bancaria_id", args.contaId)
    .gte("data_movimento", saldoInicialData)
    .lt("data_movimento", args.dataDe);

  const delta = (lancsAnteriores ?? []).reduce((acc, l) => {
    const v = Number(l.valor);
    return acc + (l.natureza === "entrada" ? v : -v);
  }, 0);

  return { saldoAnterior: saldoInicial + delta, saldoInicialData };
}

/**
 * Enriquece as linhas do período com credito/debito/saldo derivado.
 * Recebe raw rows já ordenadas por data_movimento ASC, created_at ASC.
 */
export function derivarSaldo(
  rows: (Omit<LancamentoLinha, "credito" | "debito" | "saldo" | "origens"> & {
    rateio?: Array<{ percentual: number; regional_nome: string }>;
    origens?: OrigemDaTransacao[];
  })[],
  saldoAnterior: number,
): LancamentoLinha[] {
  let saldo = saldoAnterior;
  return rows.map((r) => {
    const credito = r.natureza === "entrada" ? r.valor : 0;
    const debito = r.natureza === "saida" ? r.valor : 0;
    saldo = saldo + credito - debito;
    return {
      ...r,
      credito,
      debito,
      saldo,
      rateio: r.rateio ?? [],
      origens: r.origens ?? [],
    };
  });
}
