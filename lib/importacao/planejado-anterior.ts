import type { TipoCusto } from "@/lib/types";
import type { ParseGrupo } from "./parser-oficial";
import { planejarSecao, type GrupoAtual, type ItemAtual } from "./diff-projeto";

/**
 * De onde vem o planejado quando uma planilha entra pelo "Importar
 * planilha" da versão — decisão do Tiago, 14/09/2026.
 *
 * O caso que motivou: a planilha que foi para o cliente só tem o orçado.
 * Ele mexe, devolve, e a versão nova precisa do orçado dele COM o
 * planejado que a agência já tinha montado. A planilha interna, ao
 * contrário, traz o planejado — e aí vale o dela.
 *
 * Por isso a importação pergunta:
 *   - `anterior` — a linha casada com a versão anterior herda o planejado
 *     dela (e categoria e marca de save, como na importação do projeto);
 *     a linha sem par entra zerada;
 *   - `planilha` — vale o planejado da planilha (zerado se ela só tem o
 *     orçado), que é como a importação sempre funcionou.
 *
 * "Versão anterior" é a vigente do orçamento na versão nova, e a própria
 * versão no sobrescrever. O casamento é o da importação do projeto
 * (`planejarSecao`): pelo id oculto da exportação e, sem id, por grupo +
 * descrição. Uma regra só nas duas portas.
 *
 * No internacional, que não tem coluna de tipo, a linha casada mantém o
 * tipo gravado em qualquer das duas escolhas — a mesma regra da
 * importação do projeto.
 */

export type OrigemDoPlanejado = "anterior" | "planilha";

export interface CasamentoComAnterior {
  /** O par de cada item, na ordem de `grupos[g].itens[i]`. */
  origens: (ItemAtual | null)[][];
  casadas: number;
  /** Das casadas, quantas pela descrição (sem o id da exportação). */
  porDescricao: number;
  totalItens: number;
  /** Planejado de cada grupo se a versão herdar. */
  planejadoHerdadoPorGrupo: number[];
}

export interface LinhaParaGravar {
  item: string;
  tipo_custo: TipoCusto;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  categoria_id: string | null;
  /** `null` = a linha não herda, e a marca fica no default do banco. */
  em_save: boolean | null;
  linha_xlsx: number;
}

const totalPlanejado = (it: {
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
}) => it.valor_unitario_planejado * it.quantidade_planejada * it.dias_meses_planejado;

export function casarComAnterior(
  grupos: ParseGrupo[],
  gruposAnteriores: GrupoAtual[],
  itensAnteriores: ItemAtual[],
): CasamentoComAnterior {
  const plano = planejarSecao(
    {
      orcamentoId: null,
      versaoId: null,
      titulo: "",
      linha_xlsx: 0,
      grupos: grupos.map((g) => ({
        grupoId: g.grupo_id,
        nome: g.nome,
        linha_xlsx: 0,
        itens: g.itens.map((it) => ({
          itemId: it.item_id,
          item: it.item,
          tipo_custo: it.tipo_custo,
          valor_unitario_orcado: it.valor_unitario_orcado,
          quantidade_orcada: it.quantidade_orcada,
          dias_meses_orcado: it.dias_meses_orcado,
          linha_xlsx: it.linha_xlsx,
        })),
      })),
    },
    gruposAnteriores,
    itensAnteriores,
  );

  const origens = plano.grupos.map((g) => g.itens.map((i) => i.origem));
  const todas = plano.grupos.flatMap((g) => g.itens);
  return {
    origens,
    casadas: todas.filter((i) => i.origem !== null).length,
    porDescricao: todas.filter((i) => i.casadaPorDescricao).length,
    totalItens: todas.length,
    planejadoHerdadoPorGrupo: plano.grupos.map((g) =>
      g.itens.reduce((s, i) => s + (i.origem ? totalPlanejado(i.origem) : 0), 0),
    ),
  };
}

export function linhasParaGravar(
  grupos: ParseGrupo[],
  origens: (ItemAtual | null)[][] | null,
  origem: OrigemDoPlanejado,
  internacional: boolean,
): LinhaParaGravar[][] {
  return grupos.map((g, gi) =>
    g.itens.map((it, ii) => {
      const par = origens?.[gi]?.[ii] ?? null;
      const herda = origem === "anterior";
      return {
        item: it.item,
        tipo_custo: internacional && par ? par.tipo_custo : it.tipo_custo,
        valor_unitario_orcado: it.valor_unitario_orcado,
        quantidade_orcada: it.quantidade_orcada,
        dias_meses_orcado: it.dias_meses_orcado,
        valor_unitario_planejado: herda
          ? (par?.valor_unitario_planejado ?? 0)
          : it.valor_unitario_planejado,
        quantidade_planejada: herda
          ? (par?.quantidade_planejada ?? 0)
          : it.quantidade_planejada,
        dias_meses_planejado: herda
          ? (par?.dias_meses_planejado ?? 0)
          : it.dias_meses_planejado,
        categoria_id: herda && par ? par.categoria_id : null,
        em_save: herda && par ? par.em_save : null,
        linha_xlsx: it.linha_xlsx,
      };
    }),
  );
}
