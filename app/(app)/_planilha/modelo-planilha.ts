/** De qual modelo é a planilha desta versão, e o que ele precisa.
 *
 *  Fonte única da tradução "categoria → como esta planilha fecha"
 *  (decisão 072). A tela lê daqui em vez de espalhar `if` sobre o nome da
 *  categoria ou sobre campos soltos da versão.
 *
 *  **O modelo vem do campo `modelo_planilha` da categoria, nunca do nome
 *  dela.** `categorias_dominio` é lista que o usuário edita; casar a conta
 *  com a string "Internacional" quebraria em silêncio numa renomeação. A
 *  categoria com modelo próprio é travada no banco justamente porque este
 *  campo é contrato de código.
 *
 *  **Modelo novo entra aqui**: um `case` a mais em `configDaPlanilha`,
 *  devolvendo o que aquele fechamento precisa. É por isso que o que
 *  atravessa a árvore de props é o enum, e não um booleano
 *  `internacional` — booleano obrigaria a renomear tudo no modelo nº 3.
 */
import type { CategoriaModeloPlanilha, VersaoOrcamento } from "@/lib/types";
import type { ParametrosInternacionais } from "@/lib/calculos/versao-totais";
import type { MoedaEstrangeira } from "./moeda-estrangeira";

export interface ConfigDaPlanilha {
  /** Qual fechamento. Decide rótulos e qual variante o card de Totais usa. */
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Os parâmetros extras que `calcularTotaisVersao` recebe como 4º
   *  argumento. `null` ⇒ fechamento nacional, o de sempre. */
  internacional: ParametrosInternacionais | null;
  /** A coluna calculada da planilha e a coluna de moeda da cadeia.
   *  `null` quando não há moeda/ taxa gravadas — a tela mostra travessão
   *  em vez de um número dividido por zero. */
  moedaEstrangeira: MoedaEstrangeira | null;
}

/** Os campos da versão que o modelo consulta. Tipo estreito de propósito:
 *  quem chama pode passar a versão inteira. */
type CamposDaVersao = Pick<
  VersaoOrcamento,
  | "percentual_int_taxes"
  | "int_transaction_costs"
  | "moeda_estrangeira"
  | "cambio_compra"
>;

export function configDaPlanilha(
  modelo: CategoriaModeloPlanilha | null | undefined,
  versao: CamposDaVersao,
): ConfigDaPlanilha {
  // Orçamento sem categoria (dado anterior à obrigatoriedade dela) cai no
  // nacional, que é o fechamento que ele sempre teve.
  const modeloPlanilha: CategoriaModeloPlanilha = modelo ?? "nacional";

  if (modeloPlanilha !== "internacional") {
    return { modeloPlanilha, internacional: null, moedaEstrangeira: null };
  }

  const compra = Number(versao.cambio_compra ?? 0);
  const codigo = (versao.moeda_estrangeira ?? "").trim();

  return {
    modeloPlanilha,
    internacional: {
      percentualIntTaxes: Number(versao.percentual_int_taxes ?? 0),
      intTransactionCosts: Number(versao.int_transaction_costs ?? 0),
    },
    // Enquanto o câmbio não está preenchido, a cadeia em BRL já funciona —
    // é só a coluna convertida que não tem como existir.
    moedaEstrangeira:
      codigo !== "" && compra > 0 ? { codigo, compra } : null,
  };
}
