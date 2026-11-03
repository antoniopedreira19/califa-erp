/**
 * Os parâmetros do job que alguém pediu para mudar (decisões 224 e 233).
 *
 * O financeiro muda pelo "Editar planilha" dele
 * (`registrar_alteracao_do_financeiro`); a produção, pela errata
 * (`registrar_errata_do_job`). As duas actions conferem o pedido da MESMA
 * forma, aqui: só o que o modelo do job tem muda, o câmbio exige moeda e
 * cotação (compra e venda saem dela), e fora do internacional a alíquota
 * sai da lista do orçamento.
 */

import { z } from "zod";
import { isAliquotaConhecida } from "@/lib/impostos";
import { compraDaCotacao, cotacaoValida, vendaDaCotacao } from "@/lib/calculos/excecao-fechamento";
import { formatCurrency } from "@/lib/utils";
import { formatarTaxa } from "@/app/(app)/_planilha/moeda-estrangeira";
import type { CategoriaModeloPlanilha, ParametrosDoJobGravados } from "@/lib/types";

/** Os parâmetros do job depois da mudança, como a tela os manda. */
export const parametrosPedidosSchema = z.object({
  percentual_honorarios: z.number().min(0, "Honorários não podem ser negativos.").max(100, "Honorários vão até 100%."),
  percentual_imposto: z.number().min(0, "Impostos não podem ser negativos.").lt(100, "Impostos precisam ficar abaixo de 100%."),
  percentual_int_taxes: z.number().min(0, "Int. taxes não podem ser negativas.").lt(100, "Int. taxes precisam ficar abaixo de 100%."),
  int_transaction_costs: z.number().min(0, "O custo de transação não pode ser negativo."),
  moeda_estrangeira: z.string().trim().max(3).nullable(),
  cambio_cotacao: z.number().nullable(),
  cambio_data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data da cotação inválida.")
    .nullable(),
  percentual_veiculo: z.number().min(0).max(100, "A parte do veículo vai até 100%."),
  base_honorarios: z.enum(["negociado", "liquido"]),
});

export type ParametrosPedidos = z.infer<typeof parametrosPedidosSchema>;

/** As colunas de `vw_parametros_do_job` que `parametrosAtuaisDe` lê. */
export const SELECT_VW_PARAMETROS_DO_JOB =
  "percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data, percentual_veiculo, base_honorarios";

/** A trava dos parâmetros pela errata (decisão 233): a da errata, no envio
 *  para faturamento — no mensal, de qualquer mês, porque os parâmetros
 *  mexem em todos. */
export const MENSAGEM_PARAMETROS_DEPOIS_DO_ENVIO =
  "O job já foi enviado para faturamento: honorários, impostos e taxas agora só mudam pelo financeiro.";

/** Os campos do câmbio: o financeiro os muda até o encerramento. */
export const CAMPOS_DO_CAMBIO = ["moeda_estrangeira", "cambio_cotacao", "cambio_data", "cambio_compra", "cambio_venda"];

const num = (v: unknown): number => Number(v ?? 0);
const numOuNulo = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Os parâmetros de hoje, a partir de uma linha de `vw_parametros_do_job`. */
export function parametrosAtuaisDe(a: Record<string, unknown>): ParametrosDoJobGravados {
  return {
    percentual_honorarios: num(a.percentual_honorarios),
    percentual_imposto: num(a.percentual_imposto),
    percentual_int_taxes: num(a.percentual_int_taxes),
    int_transaction_costs: num(a.int_transaction_costs),
    moeda_estrangeira: (a.moeda_estrangeira as string | null) ?? null,
    cambio_cotacao: numOuNulo(a.cambio_cotacao),
    cambio_compra: numOuNulo(a.cambio_compra),
    cambio_venda: numOuNulo(a.cambio_venda),
    cambio_data: (a.cambio_data as string | null) ?? null,
    percentual_veiculo: num(a.percentual_veiculo ?? 80),
    base_honorarios: (a.base_honorarios as string) ?? "negociado",
  };
}

/**
 * O retrato novo dos parâmetros a partir do pedido. `parametros: null`
 * quando nada mudou de fato.
 */
export function parametrosDoPedido(
  atual: ParametrosDoJobGravados,
  p: ParametrosPedidos,
  modelo: CategoriaModeloPlanilha,
):
  | {
      ok: true;
      parametros: { de: ParametrosDoJobGravados; para: ParametrosDoJobGravados; campos: string[] } | null;
    }
  | { ok: false; message: string } {
  const internacional = modelo === "internacional";
  const para: ParametrosDoJobGravados = {
    ...atual,
    percentual_honorarios: p.percentual_honorarios,
    percentual_imposto: p.percentual_imposto,
  };
  if (internacional) {
    para.percentual_int_taxes = p.percentual_int_taxes;
    para.int_transaction_costs = p.int_transaction_costs;
    const moeda = p.moeda_estrangeira ? p.moeda_estrangeira.toUpperCase() : null;
    const cambioMudou =
      moeda !== atual.moeda_estrangeira ||
      p.cambio_cotacao !== atual.cambio_cotacao ||
      p.cambio_data !== atual.cambio_data;
    if (cambioMudou) {
      if (!moeda) return { ok: false, message: "Escolha a moeda do job." };
      if (p.cambio_cotacao === null || !cotacaoValida(p.cambio_cotacao)) {
        return {
          ok: false,
          message: "Informe a cotação do dia, maior que 0,20: compra e venda saem dela (−0,20 e +0,20).",
        };
      }
      // Compra e venda saem da cotação, aqui, como no orçamento.
      para.moeda_estrangeira = moeda;
      para.cambio_cotacao = p.cambio_cotacao;
      para.cambio_compra = compraDaCotacao(p.cambio_cotacao);
      para.cambio_venda = vendaDaCotacao(p.cambio_cotacao);
      para.cambio_data = p.cambio_data;
    }
  }
  // A base e a parte do veículo da Mídia Off não passam por aqui: ela não
  // tem "Editar planilha" nem errata, e muda por `alterarParametrosDoJob`.
  // Fora do internacional a alíquota sai da mesma lista do orçamento.
  if (!internacional && para.percentual_imposto !== atual.percentual_imposto) {
    if (!isAliquotaConhecida(para.percentual_imposto)) {
      return { ok: false, message: "Escolha a alíquota de impostos na lista." };
    }
  }
  const campos = (Object.keys(para) as Array<keyof ParametrosDoJobGravados>).filter(
    (k) => para[k] !== atual[k],
  );
  return { ok: true, parametros: campos.length > 0 ? { de: atual, para, campos } : null };
}

/** Percentual em pt-BR, sem zeros à direita: 13 / 19,53 / 24,269914. */
const pct = (n: number) => `${String(Number(n)).replace(".", ",")}%`;

function formatarData(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const BASES_DOS_HONORARIOS: Array<{ value: string; rotulo: string }> = [
  { value: "negociado", rotulo: "do negociado" },
  { value: "liquido", rotulo: "do líquido do veículo" },
];

/** O de → para de cada campo que mudou, nos rótulos do modelo do job. */
export function camposDaAlteracao(
  de: ParametrosDoJobGravados,
  para: ParametrosDoJobGravados,
  modelo: CategoriaModeloPlanilha,
  moeda = "BRL",
): Array<{ rotulo: string; de: string; para: string }> {
  const intl = modelo === "internacional";
  const c: Array<{ rotulo: string; de: string; para: string }> = [];
  const se = (cond: boolean, rotulo: string, a: string, b: string) => {
    if (cond) c.push({ rotulo, de: a, para: b });
  };
  se(
    de.percentual_honorarios !== para.percentual_honorarios,
    intl ? "Fee" : "Honorários",
    pct(de.percentual_honorarios),
    pct(para.percentual_honorarios),
  );
  se(de.base_honorarios !== para.base_honorarios, "Base dos honorários",
    BASES_DOS_HONORARIOS.find((b) => b.value === de.base_honorarios)?.rotulo ?? de.base_honorarios,
    BASES_DOS_HONORARIOS.find((b) => b.value === para.base_honorarios)?.rotulo ?? para.base_honorarios);
  se(de.percentual_veiculo !== para.percentual_veiculo, "Veículo", pct(de.percentual_veiculo), pct(para.percentual_veiculo));
  se(de.percentual_int_taxes !== para.percentual_int_taxes, "Int. taxes", pct(de.percentual_int_taxes), pct(para.percentual_int_taxes));
  se(
    de.percentual_imposto !== para.percentual_imposto,
    intl ? "Impostos BR" : "Impostos",
    pct(de.percentual_imposto),
    pct(para.percentual_imposto),
  );
  se(
    de.int_transaction_costs !== para.int_transaction_costs,
    "Int. transaction costs",
    formatCurrency(de.int_transaction_costs, moeda),
    formatCurrency(para.int_transaction_costs, moeda),
  );
  se(de.moeda_estrangeira !== para.moeda_estrangeira, "Moeda", de.moeda_estrangeira || "—", para.moeda_estrangeira || "—");
  se(
    de.cambio_cotacao !== para.cambio_cotacao,
    "Cotação",
    de.cambio_cotacao ? formatarTaxa(de.cambio_cotacao) : "—",
    para.cambio_cotacao ? formatarTaxa(para.cambio_cotacao) : "—",
  );
  se(
    de.cambio_compra !== para.cambio_compra,
    "Compra",
    de.cambio_compra ? formatarTaxa(de.cambio_compra) : "—",
    para.cambio_compra ? formatarTaxa(para.cambio_compra) : "—",
  );
  se(
    de.cambio_data !== para.cambio_data,
    "Data da cotação",
    de.cambio_data ? formatarData(de.cambio_data) : "—",
    para.cambio_data ? formatarData(para.cambio_data) : "—",
  );
  return c;
}
