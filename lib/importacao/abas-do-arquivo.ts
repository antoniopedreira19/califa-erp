/**
 * A escolha da aba na importação (decisão 110, 27/09/2026).
 *
 * A planilha que sai do Google Sheets carrega as versões antigas do
 * orçamento em abas ocultas: a da Budweiser tinha 15 abas, só uma visível,
 * e 10 delas legíveis, com orçados entre R$ 132 mil e R$ 468 mil. O
 * importador lia a primeira aba do arquivo — oculta, e a legenda — e
 * recusava a planilha inteira.
 *
 * Agora o arquivo é lido aba por aba, e a tela mostra todas: as visíveis
 * primeiro, depois as ocultas (marcadas), e por último as que o ERP não
 * lê, com o motivo. Vem marcada a "Padrão"/"Oficial", senão a primeira
 * visível, senão a primeira oculta que dê para ler.
 */

import {
  abaOculta,
  carregarPlanilha,
  ehAbaConhecida,
  parseOficial,
  type OpcoesDoParse,
  type ParseResultado,
} from "./parser-oficial";

export interface AbaLida {
  nome: string;
  visivel: boolean;
  parsed: ParseResultado;
}

/** Abre o arquivo uma vez e lê todas as abas, na ordem do arquivo. */
export async function lerTodasAsAbas(
  buffer: ArrayBuffer | Buffer,
  opcoes: Omit<OpcoesDoParse, "aba">,
): Promise<AbaLida[]> {
  const wb = await carregarPlanilha(buffer);
  const lidas: AbaLida[] = [];
  for (const ws of wb.worksheets) {
    lidas.push({
      nome: ws.name,
      visivel: !abaOculta(ws),
      parsed: await parseOficial(wb, { ...opcoes, aba: ws.name }),
    });
  }
  return lidas;
}

/** Uma linha da tabela de abas. */
export interface AbaResumo {
  nome: string;
  visivel: boolean;
  legivel: boolean;
  /** Por que o ERP não lê a aba. `null` nas legíveis. */
  motivo: string | null;
  grupos: number;
  itens: number;
  orcado: number;
  planejado: number;
}

export function totaisDaAba(parsed: ParseResultado): Pick<AbaResumo, "grupos" | "itens" | "orcado" | "planejado"> {
  let itens = 0;
  let orcado = 0;
  let planejado = 0;
  for (const g of parsed.grupos) {
    for (const it of g.itens) {
      itens += 1;
      orcado += it.valor_unitario_orcado * it.quantidade_orcada * it.dias_meses_orcado;
      planejado +=
        it.valor_unitario_planejado * it.quantidade_planejada * it.dias_meses_planejado;
    }
  }
  return { grupos: parsed.grupos.length, itens, orcado, planejado };
}

/** O motivo curto para a linha da aba que não entra. */
export function motivoDaAbaSemItens(parsed: ParseResultado): string {
  const primeiro = parsed.warnings[0]?.motivo ?? "";
  if (primeiro.startsWith("Não encontramos a linha de header")) {
    return "Sem o cabeçalho do orçamento (CATEGORIA, ITEM, R$).";
  }
  return primeiro || "Nenhum item no formato do orçamento.";
}

/** Ordem da tabela: visíveis legíveis, ocultas legíveis, as que não
 *  entram — cada grupo na ordem do arquivo. */
export function ordenarAbas<T extends { visivel: boolean; legivel: boolean }>(abas: T[]): T[] {
  const peso = (a: T) => (!a.legivel ? 2 : a.visivel ? 0 : 1);
  return abas
    .map((a, i) => ({ a, i }))
    .sort((x, y) => peso(x.a) - peso(y.a) || x.i - y.i)
    .map((x) => x.a);
}

/** A aba que vem marcada, ou `null` se nenhuma é legível. */
export function abaSugerida(
  abas: { nome: string; visivel: boolean; legivel: boolean }[],
): string | null {
  const legiveis = abas.filter((a) => a.legivel);
  return (
    legiveis.find((a) => ehAbaConhecida(a.nome))?.nome ??
    legiveis.find((a) => a.visivel)?.nome ??
    legiveis[0]?.nome ??
    null
  );
}
