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
  /** O par serviço × categoria do ORÇAMENTO, quando não combina: a frase de
   *  `erroDoParServicoCategoria` (lib/categorias-do-servico.ts). `null` com
   *  o par válido. Obrigatório: são os orçamentos de antes da decisão 078
   *  (serviço Always On com categoria Conteúdo ou Extra), que o editor
   *  deixou como estavam e que não aprovam assim (Tiago, 07/10/2026). */
  parServicoCategoria: string | null;
  percentualImposto: number;
  /** Câmbio da versão quando o orçamento é internacional; `null` no
   *  nacional. Obrigatório: quem chama tem que dizer qual é o caso, e um
   *  default não pode liberar a aprovação em silêncio. */
  cambioInternacional: CambioParaAprovar | null;
  qtdItens: number;
  /** Itens com total_orcado > 0 — linha começada e não preenchida dá 0.
   *  Item com orçado zerado aprova desde 01/10/2026 (revisão da decisão
   *  011): é o item da casa, mostrado ao cliente e não cobrado. Só a
   *  versão inteira zerada continua barrada. */
  qtdItensComValor: number;
  /** Modelo mensal (decisão 078): os meses sem item, pelo nome
   *  ("dezembro"). Obrigatório e anulável como o câmbio: `null` fora do
   *  mensal, e quem chama tem que dizer qual é o caso. */
  mesesSemItens: string[] | null;
  /** Mídia Off (decisão 147, resposta b do Tiago em 04/10/2026): quantas
   *  linhas estão sem veículo — a linha pode ficar sem ele no rascunho, mas
   *  a versão só aprova com todas preenchidas. `null` fora da Mídia Off, e
   *  é ele que troca "item" por "linha" nas frases. */
  linhasSemVeiculo: number | null;
}): string | null {
  const midia = input.linhasSemVeiculo !== null;
  // Serviço × categoria (revisão da decisão 149, 07/10/2026): o orçamento
  // antigo com o par fora da regra da 078 continua editável e consultável,
  // mas só aprova depois de trocar a categoria ou o serviço.
  if (input.parServicoCategoria) {
    const motivo = input.parServicoCategoria;
    return `Serviço e categoria do orçamento não combinam: ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)} Troque a categoria ou o serviço no "Editar" do orçamento antes de aprovar.`;
  }
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
    return midia
      ? "Adicione ao menos 1 linha antes de aprovar a versão."
      : "Adicione ao menos 1 item antes de aprovar a versão.";
  }
  if (input.qtdItensComValor === 0) {
    return midia
      ? "Nenhuma linha da planilha tem valor. Preencha ao menos uma linha antes de aprovar a versão."
      : "Nenhum item da planilha tem valor. Preencha ao menos um item antes de aprovar a versão.";
  }
  // Modelo mensal (decisão 078, Tiago em 14/09/2026): mês vazio viraria um
  // mês de faturamento zero no job. Quem não vai usar o mês o apaga.
  if (input.mesesSemItens && input.mesesSemItens.length > 0) {
    const nomes = listaPtBr(input.mesesSemItens);
    const texto = nomes.charAt(0).toUpperCase() + nomes.slice(1);
    const unidade = midia ? "linhas" : "itens";
    return input.mesesSemItens.length === 1
      ? `${texto} não tem ${unidade}. Preencha o mês ou apague-o em "Editar meses" antes de aprovar a versão.`
      : `${texto} não têm ${unidade}. Preencha os meses ou apague-os em "Editar meses" antes de aprovar a versão.`;
  }
  if (input.linhasSemVeiculo !== null && input.linhasSemVeiculo > 0) {
    const n = input.linhasSemVeiculo;
    return `${n === 1 ? "1 linha está" : `${n} linhas estão`} sem veículo. Escolha o veículo de todas as linhas antes de aprovar a versão.`;
  }
  return null;
}
