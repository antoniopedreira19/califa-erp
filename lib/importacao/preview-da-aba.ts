/**
 * O resumo de uma aba, como o modal de importação mostra (decisão 110).
 * Usado pela importação da versão e pela do editor do orçamento: as duas
 * leem o arquivo aba por aba e montam o mesmo resumo.
 */

import type { CategoriaModeloPlanilha } from "@/lib/types";
import { rotuloMesCurto } from "@/lib/calculos/meses-trimestre";
import { recusaPorModelo, type ParseResultado } from "./parser-oficial";
import { motivoDaAbaSemItens } from "./abas-do-arquivo";
import {
  abaSemBlocoDeMes,
  comBlocosSinteticos,
  mesesDaAbaParaGravar,
  mesesDaOpcao,
} from "./meses-da-planilha";
import { casarComAnterior } from "./planejado-anterior";
import type { GrupoAtual, ItemAtual } from "./diff-projeto";
import type { OpcaoDosMeses, PreviewDaAba, SemBlocoDeMes } from "./tipos-da-importacao";

/**
 * O resumo de UMA aba lida, como a tela mostra. `null` quando a aba não
 * entra: a mensagem vai para a coluna do motivo na tabela de abas.
 *
 * `semBloco` vem preenchido na aba sem título de mês do Fee e do Always On
 * (decisão 158): as leituras de cada opção de meses, prontas. Com mais de
 * um mês, `preview` e `parsed` são a aba como está (um mês), que a tela
 * mostra até a escolha.
 */
export function montarPreviewDaAba(
  lida: ParseResultado,
  contexto: {
    modelo: CategoriaModeloPlanilha;
    /** A versão de onde o planejado pode vir; `null` sem versão. */
    anterior: { numero_versao: number; grupos: GrupoAtual[]; itens: ItemAtual[] } | null;
    /** Meses de destino no mensal; `null` nos outros modelos. */
    mesesDestino: string[] | null;
    /** Os honorários que a versão vai ter; o editor do orçamento manda
     *  `null`. `versao` ("v1") quando a importação sobrescreve a versão e
     *  mantém os dela; `null` quando ela nasce com os do cadastro. */
    honorarios: { percentual: number; clienteNome: string; versao: string | null } | null;
  },
):
  | { ok: true; preview: PreviewDaAba; parsed: ParseResultado; semBloco: SemBlocoDeMes | null }
  | { ok: false; motivo: string } {
  // Aba sem título de mês no mensal (decisão 158): antes da recusa pelo
  // modelo, que a trataria como planilha nacional.
  const mesesDoOrcamento = contexto.mesesDestino ? [...contexto.mesesDestino].sort() : [];
  if (contexto.modelo === "mensal" && mesesDoOrcamento.length > 0 && abaSemBlocoDeMes(lida)) {
    const ler = (opcao: OpcaoDosMeses) => {
      const meses = mesesDaOpcao(mesesDoOrcamento, opcao);
      return montarPreviewDaAba(comBlocosSinteticos(lida, meses), { ...contexto, mesesDestino: meses });
    };
    const todos = ler("todos");
    if (!todos.ok) return todos;
    if (mesesDoOrcamento.length === 1) {
      return { ...todos, semBloco: { meses: mesesDoOrcamento, todos: todos.preview, primeiro: null } };
    }
    const primeiro = ler("primeiro");
    if (!primeiro.ok) return primeiro;
    const comoEsta = montarPreviewDaAba(lida, { ...contexto, modelo: lida.modelo, mesesDestino: null });
    if (!comoEsta.ok) return comoEsta;
    return {
      ...comoEsta,
      semBloco: { meses: mesesDoOrcamento, todos: todos.preview, primeiro: primeiro.preview },
    };
  }

  // Modelo errado é recusado antes de qualquer contagem (decisão 072).
  const recusa = recusaPorModelo(lida.modelo, contexto.modelo);
  if (recusa) return { ok: false, motivo: recusa };
  if (lida.grupos.length === 0) return { ok: false, motivo: motivoDaAbaSemItens(lida) };

  let parsed = lida;
  // Mensal: cada bloco da planilha num mês da versão. Mês do orçamento sem
  // bloco recusa; mês que o orçamento não tem fica de fora, com aviso
  // (decisão 078, revista pela 158).
  if (contexto.mesesDestino) {
    const casados = mesesDaAbaParaGravar(parsed, contexto.mesesDestino, null);
    if (!casados.ok) return { ok: false, motivo: casados.message };
    parsed = casados.parsed;
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
    semBloco: null,
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
      honorarios_da_versao: contexto.honorarios?.versao ?? null,
      linhas_lidas: parsed.linhas_lidas,
      linhas_importadas: parsed.linhas_importadas,
      linhas_ignoradas: parsed.linhas_ignoradas,
    },
  };
}

