/**
 * O resumo de uma aba, como o modal de importação mostra (decisão 110).
 * Usado pela importação da versão e pela do editor do orçamento: as duas
 * leem o arquivo aba por aba e montam o mesmo resumo.
 */

import type { CategoriaModeloPlanilha } from "@/lib/types";
import { rotuloMesCurto } from "@/lib/calculos/meses-trimestre";
import { recusaPorModelo, type ParseResultado } from "./parser-oficial";
import { motivoDaAbaSemItens } from "./abas-do-arquivo";
import { casarBlocosComMeses } from "./meses-da-planilha";
import { casarComAnterior } from "./planejado-anterior";
import type { GrupoAtual, ItemAtual } from "./diff-projeto";
import type { PreviewDaAba } from "./tipos-da-importacao";

/**
 * O resumo de UMA aba lida, como a tela mostra. `null` quando a aba não
 * entra: a mensagem vai para a coluna do motivo na tabela de abas.
 */
export function montarPreviewDaAba(
  lida: ParseResultado,
  contexto: {
    modelo: CategoriaModeloPlanilha;
    /** A versão de onde o planejado pode vir; `null` sem versão. */
    anterior: { numero_versao: number; grupos: GrupoAtual[]; itens: ItemAtual[] } | null;
    /** Meses de destino no mensal; `null` nos outros modelos. */
    mesesDestino: string[] | null;
    /** O que a versão vai receber; o editor do orçamento manda `null`. */
    honorarios: { percentual: number; clienteNome: string } | null;
  },
): { ok: true; preview: PreviewDaAba; parsed: ParseResultado } | { ok: false; motivo: string } {
  // Modelo errado é recusado antes de qualquer contagem (decisão 072).
  const recusa = recusaPorModelo(lida.modelo, contexto.modelo);
  if (recusa) return { ok: false, motivo: recusa };
  if (lida.grupos.length === 0) return { ok: false, motivo: motivoDaAbaSemItens(lida) };

  let parsed = lida;
  // Mensal: cada bloco da planilha num mês da versão; meses a mais ou a
  // menos recusam (decisão 078, 15/09/2026).
  if (contexto.mesesDestino) {
    const casados = casarBlocosComMeses(parsed.grupos, parsed.meses, contexto.mesesDestino);
    if (!casados.ok) return { ok: false, motivo: casados.message };
    parsed = {
      ...parsed,
      grupos: casados.grupos,
      warnings: [...parsed.warnings, ...casados.avisos],
      // A contagem segue os meses aceitos: item de bloco fora do trimestre
      // não entra, e a confirmação não pode prometer mais itens do que grava.
      linhas_importadas: casados.grupos.reduce((s, g) => s + g.itens.length, 0),
      linhas_ignoradas:
        parsed.linhas_ignoradas +
        parsed.linhas_importadas -
        casados.grupos.reduce((s, g) => s + g.itens.length, 0),
    };
    if (parsed.grupos.length === 0) {
      return { ok: false, motivo: "Nenhum item nos meses do orçamento." };
    }
  }

  const anterior = contexto.anterior;
  const casamento = anterior
    ? casarComAnterior(parsed.grupos, anterior.grupos, anterior.itens)
    : null;
  const ajustes = parsed.warnings.filter((w) => w.severidade === "ajuste");
  const ignoradas = parsed.warnings.filter((w) => w.severidade === "ignorada");

  return {
    ok: true,
    parsed,
    preview: {
      aba: parsed.aba,
      grupos: parsed.grupos.map((g, gi) => ({
        // No mensal o nome diz de que mês é o grupo.
        nome: g.mes ? `${g.nome} · ${rotuloMesCurto(g.mes)}` : g.nome,
        ordem: g.ordem,
        itens_count: g.itens.length,
        total_bruto: g.itens.reduce(
          (s, it) =>
            s + it.valor_unitario_orcado * it.quantidade_orcada * it.dias_meses_orcado,
          0,
        ),
        total_planejado: g.itens.reduce(
          (s, it) =>
            s +
            it.valor_unitario_planejado *
              it.quantidade_planejada *
              it.dias_meses_planejado,
          0,
        ),
        total_planejado_herdado: casamento?.planejadoHerdadoPorGrupo[gi] ?? 0,
      })),
      planejado: {
        // Versão de origem sem item não tem planejado a manter: a pergunta
        // "manter o planejado da vN" sairia com "0 de N linhas casadas".
        versao_anterior: anterior && anterior.itens.length > 0 ? anterior.numero_versao : null,
        casadas: casamento?.casadas ?? 0,
        por_descricao: casamento?.porDescricao ?? 0,
        total_itens: casamento?.totalItens ?? 0,
        planilha_tem_planejado: parsed.tem_planejado,
      },
      // A tela lista 40; o total vai à parte para o cabeçalho dos avisos.
      warnings: [...ajustes, ...ignoradas].slice(0, 40),
      avisos_total: { ajustes: ajustes.length, ignoradas: ignoradas.length },
      percentual_honorarios: parsed.percentual_honorarios,
      percentual_honorarios_cliente: contexto.honorarios?.percentual ?? 0,
      cliente_nome: contexto.honorarios?.clienteNome ?? "",
      linhas_lidas: parsed.linhas_lidas,
      linhas_importadas: parsed.linhas_importadas,
      linhas_ignoradas: parsed.linhas_ignoradas,
    },
  };
}

