import { z } from "zod";
import { VERSAO_STATUS_EDITAVEIS } from "@/lib/types";
import { isAliquotaConhecida } from "@/lib/impostos";

/**
 * Schema do header da versão. `numero_versao` NÃO entra aqui — é
 * atribuído pelo Server Action (max+1 do orçamento) na criação e
 * imutável na edição.
 */
export const versaoSchema = z.object({
  // `nome` saiu em 13/08/2026: o nome da versão é o do job mais o número
  // da versão, calculado na leitura (`lib/nome-versao.ts`). A coluna
  // continua no banco com o conteúdo antigo, sem ninguém ler nem gravar.
  moeda: z
    .string()
    .trim()
    .length(3, "Use código ISO de 3 letras (ex.: BRL).")
    .toUpperCase()
    .default("BRL"),
  taxa_cambio: z.coerce
    .number({ invalid_type_error: "Taxa inválida." })
    .positive("Taxa deve ser maior que zero.")
    .default(1),
  percentual_honorarios: z.coerce
    .number({ invalid_type_error: "Percentual inválido." })
    .min(0, "Não pode ser negativo.")
    .max(100, "Máximo 100%.")
    .default(0),
  percentual_imposto: z.coerce
    .number({ invalid_type_error: "Percentual inválido." })
    .min(0, "Não pode ser negativo.")
    .max(100, "Máximo 100%.")
    .default(0),
  status: z
    .enum([
      "rascunho",
      "em_revisao",
      "enviada_cliente",
      "reprovada",
      "substituida",
      "cancelada",
    ])
    .default("rascunho")
    .refine((v) => VERSAO_STATUS_EDITAVEIS.includes(v), {
      message: "Status inválido para edição manual.",
    }),
});

export type VersaoInput = z.infer<typeof versaoSchema>;

/**
 * O que impede aprovar a versão, em texto para o usuário — ou `null` quando
 * está liberada.
 *
 * Mora aqui porque roda nos dois lados: a server action `aprovarVersao` é quem
 * de fato barra, e o botão "Aprovar versão" usa a mesma função para desabilitar
 * com o motivo no title. Mensagem única evita o botão dizer uma coisa e o
 * servidor recusar por outra.
 *
 * Aprovar trava os valores da versão e é o que alimenta o job, então os três
 * pontos abaixo não podem passar batido.
 */
/** O câmbio de uma versão internacional, como a aprovação o confere. */
export interface CambioParaAprovar {
  moeda: string | null;
  compra: number | string | null;
  cotacao: number | string | null;
  venda: number | string | null;
  /** `yyyy-mm-dd`. */
  data: string | null;
}

/** "a", "a e b", "a, b e c". */
function listaPtBr(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function bloqueioAprovacaoVersao(input: {
  percentualImposto: number;
  /** Câmbio da versão quando o orçamento é internacional; `null` no
   *  nacional. Obrigatório: quem chama tem que dizer qual é o caso, e um
   *  default não pode liberar a aprovação em silêncio. */
  cambioInternacional: CambioParaAprovar | null;
  qtdItens: number;
  /** Itens com total_orcado > 0 — linha começada e não preenchida dá 0. */
  qtdItensComValor: number;
  /** Itens com valor_unitario_orcado = 0 — aprovar exige orçado em todos;
   *  o planejado pode ficar zerado (docs/decisions/011). */
  qtdItensOrcadoZerado: number;
  /** Modelo mensal (decisão 078): os meses sem item, pelo nome
   *  ("dezembro"). Obrigatório e anulável como o câmbio: `null` fora do
   *  mensal, e quem chama tem que dizer qual é o caso. */
  mesesSemItens: string[] | null;
}): string | null {
  if (!isAliquotaConhecida(input.percentualImposto)) {
    return 'Escolha a alíquota de impostos da versão antes de aprovar. Use o botão "Editar" da versão.';
  }
  // Internacional (decisão 072, 14/09/2026, pedido do Tiago): o câmbio
  // inteiro — moeda, data da cotação, cotação, compra e venda — tem que
  // estar preenchido. Aprovar trava a versão e alimenta o job; sem compra
  // a coluna em moeda e a cadeia do cliente não têm como existir.
  if (input.cambioInternacional) {
    const c = input.cambioInternacional;
    const positivo = (v: number | string | null) =>
      v !== null && v !== "" && Number(v) > 0;
    const faltando = [
      (c.moeda ?? "").trim() === "" ? "moeda" : null,
      !c.data ? "data da cotação" : null,
      !positivo(c.cotacao) ? "cotação" : null,
      !positivo(c.compra) ? "compra" : null,
      !positivo(c.venda) ? "venda" : null,
    ].filter((f): f is string => f !== null);
    if (faltando.length > 0) {
      return `Preencha o câmbio da versão antes de aprovar — falta ${listaPtBr(faltando)}. Use o botão "Editar" da versão.`;
    }
  }
  if (input.qtdItens === 0) {
    return "Adicione ao menos 1 item antes de aprovar a versão.";
  }
  if (input.qtdItensComValor === 0) {
    return "Nenhum item da planilha tem valor. Preencha ao menos um item antes de aprovar a versão.";
  }
  // Modelo mensal (decisão 078, Tiago em 14/09/2026): mês vazio viraria um
  // mês de faturamento zero no job. Quem não vai usar o mês o apaga.
  if (input.mesesSemItens && input.mesesSemItens.length > 0) {
    const nomes = listaPtBr(input.mesesSemItens);
    const texto = nomes.charAt(0).toUpperCase() + nomes.slice(1);
    return input.mesesSemItens.length === 1
      ? `${texto} não tem itens. Preencha o mês ou apague-o em "Editar meses" antes de aprovar a versão.`
      : `${texto} não têm itens. Preencha os meses ou apague-os em "Editar meses" antes de aprovar a versão.`;
  }
  if (input.qtdItensOrcadoZerado > 0) {
    return `${input.qtdItensOrcadoZerado} ${input.qtdItensOrcadoZerado === 1 ? "item" : "itens"} com R$ unitário orçado zerado. Preencha o orçado de todos os itens antes de aprovar a versão.`;
  }
  return null;
}
