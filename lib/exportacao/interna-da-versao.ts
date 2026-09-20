import type { ParametrosInternacionais } from "@/lib/calculos/versao-totais";
import { nomeDaMoeda, type CambioDaAba } from "./planilha-orcamento-internacional";
import { montarFechamentoInterno } from "./montar-interna";
import type { GrupoInterno, MesInterno, SecaoInterna } from "./planilha-interna";

/**
 * Uma versão do orçamento vira uma seção da planilha interna (decisão
 * 088): os mesmos grupos e itens da exportação para o cliente, mais o
 * PLANEJADO, que já mora nas colunas `*_planejado` do item.
 *
 * O fechamento sai de `montarFechamentoInterno`, que é a conta das telas.
 * No mensal cada mês fecha por conta própria e o resumo do trimestre fecha
 * sobre o conjunto — é o mesmo desenho da exportação para o cliente.
 */
export function secaoInternaDaVersao(args: {
  /** Só na exportação do projeto: a da versão única não tem linha de título. */
  titulo?: string;
  orcamentoId?: string;
  versaoId?: string;
  percentualHonorarios: number;
  percentualImposto: number;
  internacional?: ParametrosInternacionais | null;
  /** Nos modelos nacional e internacional. */
  grupos?: GrupoInterno[];
  /** No mensal, os grupos vêm dentro dos meses. */
  meses?: MesInterno[];
  /** O job traz realizado; a versão do orçamento, não. */
  comRealizado?: boolean;
}): SecaoInterna {
  const internacional = args.internacional ?? null;
  const comRealizado = args.comRealizado === true;
  const gruposDoMes = args.meses?.map((m) => m.grupos) ?? [];
  const todos = (args.grupos ?? gruposDoMes.flat()).flatMap((g) => g.itens);

  const fechar = (grupos: GrupoInterno[]) =>
    montarFechamentoInterno(
      grupos.flatMap((g) => g.itens),
      args.percentualHonorarios,
      args.percentualImposto,
      { internacional, comRealizado },
    );

  return {
    titulo: args.titulo,
    orcamentoId: args.orcamentoId,
    versaoId: args.versaoId,
    grupos: args.grupos,
    meses: args.meses,
    fechamento: montarFechamentoInterno(
      todos,
      args.percentualHonorarios,
      args.percentualImposto,
      { internacional, comRealizado },
    ),
    fechamentoDoMes: args.meses ? gruposDoMes.map(fechar) : undefined,
  };
}

/** O câmbio da exportação internacional no formato da aba interna — o
 *  mesmo rodapé (COMPRA, cotação do dia, VENDA) da planilha do cliente. */
export function cambioDaInterna(cambio: CambioDaAba): {
  moeda: string;
  cambioCompra: number | null;
  cambio: {
    cotacao: number | null;
    venda: number | null;
    data: string | null;
    nomeDaMoeda: string;
  };
} {
  return {
    moeda: cambio.moeda,
    cambioCompra: cambio.compra,
    cambio: {
      cotacao: cambio.cotacao,
      venda: cambio.venda,
      data: cambio.data,
      nomeDaMoeda: nomeDaMoeda(cambio.moeda),
    },
  };
}
