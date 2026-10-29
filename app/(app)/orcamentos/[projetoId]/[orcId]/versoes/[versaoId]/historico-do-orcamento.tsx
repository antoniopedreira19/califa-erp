"use client";

/**
 * O Histórico da versão aprovada do orçamento (decisão 226, 28/10/2026).
 *
 * Com job aberto, a versão aprovada mostra a planilha do job — as erratas
 * são combinadas com o cliente. O botão "Histórico", à esquerda do "Exibir",
 * traz a versão que o cliente aprovou e cada errata depois dela, com as
 * mesmas peças do histórico da Planilha Interna (decisão 186): a lista, a
 * faixa da versão antiga e o destaque das linhas que mudaram.
 *
 * É um contexto, e não props: a planilha da versão (nacional, internacional
 * e a de cada mês do mensal) lê a versão escolhida e o botão daqui, sem a
 * página passar nada por quatro componentes. Sem o provedor, nada muda.
 */
import * as React from "react";
import { BotaoHistorico, FaixaDaVersao } from "@/app/(app)/jobs/[jobId]/realizado/historico-da-planilha";
import { carregarHistoricoDaPlanilha } from "@/app/(app)/jobs/[jobId]/realizado/actions-historico";
import {
  historicoDoOrcamento,
  type DadosDoHistorico,
  type VersaoDaPlanilha,
} from "@/lib/calculos/historico-da-planilha";
import { calcularTotaisVersao, type ParametrosInternacionais } from "@/lib/calculos/versao-totais";
import {
  CAMPOS_DE_MIDIA_VAZIOS,
  type ItemPlanilhaJob,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
} from "@/lib/types";

interface ContextoDoHistorico {
  /** A versão antiga escolhida, no formato da versão; `null` na atual. */
  versao: { grupos: VersaoOrcamentoGrupo[]; itens: VersaoOrcamentoItem[] } | null;
  /** O botão da barra, à esquerda do "Exibir". */
  botao: React.ReactNode;
  /** As linhas que o momento escolhido mudou, quando o destaque está ligado. */
  destaque: Set<string> | null;
}

const Contexto = React.createContext<ContextoDoHistorico | null>(null);

export function useHistoricoDoOrcamento(): ContextoDoHistorico | null {
  return React.useContext(Contexto);
}

/** Os meses do mensal depois do primeiro: sem um segundo botão. */
export function SemBotaoDoHistorico({ children }: { children: React.ReactNode }) {
  const c = React.useContext(Contexto);
  if (!c) return <>{children}</>;
  return <Contexto.Provider value={{ ...c, botao: null }}>{children}</Contexto.Provider>;
}

/** A linha do job no formato da versão: sem linha vermelha (não tem orçado)
 *  e sem a cancelada. */
function itensDoCliente(itens: ItemPlanilhaJob[], versaoId: string, tenantId: string): VersaoOrcamentoItem[] {
  return itens
    .filter((i) => !i.linha_vermelha && !i.cancelada_em)
    .map((i) => ({
      ...CAMPOS_DE_MIDIA_VAZIOS,
      id: i.id,
      tenant_id: tenantId,
      versao_orcamento_id: versaoId,
      grupo_id: i.grupo_id,
      ordem: i.ordem,
      planilha_origem: null,
      item: i.item,
      tipo_custo: i.tipo_custo,
      valor_unitario_orcado: Number(i.valor_unitario_orcado ?? 0),
      quantidade_orcada: Number(i.quantidade_orcada ?? 0),
      dias_meses_orcado: Number(i.dias_meses_orcado ?? 0),
      total_orcado: Number(i.total_orcado ?? 0),
      categoria_id: i.categoria_id,
      valor_unitario_planejado: Number(i.valor_unitario_planejado ?? 0),
      quantidade_planejada: Number(i.quantidade_planejada ?? 0),
      dias_meses_planejado: Number(i.dias_meses_planejado ?? 0),
      total_planejado: Number(i.total_planejado ?? 0),
      bv_liquido_planejado: i.bv_liquido_planejado,
      em_save: i.em_save,
      save_consumido: Number(i.save_consumido ?? 0),
      save_marcado_por: null,
      save_marcado_em: null,
      planejado_antes_save: null,
      fornecedor_id: null,
      observacoes: null,
      created_at: "",
      updated_at: "",
    }));
}

/** A versão do histórico como o cliente a vê: sem o agrupamento que só tem
 *  linha vermelha (29/10/2026). */
function versaoDoCliente(v: VersaoDaPlanilha, versaoId: string, tenantId: string) {
  const itens = itensDoCliente(v.itens, versaoId, tenantId);
  const comLinha = new Set(itens.map((i) => i.grupo_id));
  return { grupos: v.grupos.filter((g) => comLinha.has(g.id)), itens };
}

export function HistoricoDoOrcamento({
  jobId,
  aprovadaEm,
  versaoId,
  tenantId,
  moeda,
  percentualHonorarios,
  percentualImposto,
  internacional,
  children,
}: {
  jobId: string;
  /** Quando o cliente aprovou a versão (`versoes_orcamento.aprovado_em`). */
  aprovadaEm: string | null;
  versaoId: string;
  tenantId: string;
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
  internacional: ParametrosInternacionais | null;
  children: React.ReactNode;
}) {
  const [dados, setDados] = React.useState<DadosDoHistorico | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [selecionada, setSelecionada] = React.useState("atual");
  const [destacar, setDestacar] = React.useState(true);

  const versoes = React.useMemo(
    () => (dados ? historicoDoOrcamento(dados, aprovadaEm) : null),
    [dados, aprovadaEm],
  );

  async function abrir() {
    if (dados || carregando) return;
    setCarregando(true);
    setErro(null);
    const r = await carregarHistoricoDaPlanilha(jobId);
    setCarregando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    setDados(r.dados);
  }

  const valorDe = React.useCallback(
    (v: VersaoDaPlanilha) =>
      calcularTotaisVersao(
        itensDoCliente(v.itens, versaoId, tenantId),
        percentualHonorarios,
        percentualImposto,
        internacional,
      ).valorJob,
    [versaoId, tenantId, percentualHonorarios, percentualImposto, internacional],
  );

  const k = versoes ? versoes.findIndex((v) => v.chave === selecionada) : -1;
  const versao = versoes && k >= 0 ? versoes[k] : null;
  const antiga = versao && versao.chave !== "atual" ? versao : null;

  const valor = React.useMemo<ContextoDoHistorico>(
    () => ({
      versao: antiga ? versaoDoCliente(antiga, versaoId, tenantId) : null,
      destaque:
        antiga && destacar
          ? new Set(antiga.mudancas.map((m) => m.itemId).filter((id): id is string => !!id))
          : null,
      botao: (
        <BotaoHistorico
          versoes={versoes}
          carregando={carregando}
          erro={erro}
          selecionada={selecionada}
          valorDe={valorDe}
          moeda={moeda}
          onAbrir={() => void abrir()}
          onEscolher={setSelecionada}
          titulo="Histórico do orçamento"
          dica="A versão que o cliente aprovou e cada errata do job depois dela"
        />
      ),
    }),
    // `abrir` lê o estado do render; recriá-lo junto não muda nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [antiga, destacar, versoes, carregando, erro, selecionada, valorDe, moeda, versaoId, tenantId],
  );

  return (
    <Contexto.Provider value={valor}>
      {antiga && versoes && (
        <FaixaDaVersao
          versao={antiga}
          valorJob={{ antes: versoes[k + 1] ? valorDe(versoes[k + 1]) : null, depois: valorDe(antiga) }}
          moeda={moeda}
          temAnterior={k < versoes.length - 1}
          temProxima={k > 0}
          onAnterior={() => setSelecionada(versoes[k + 1].chave)}
          onProxima={() => setSelecionada(versoes[k - 1].chave)}
          onAtual={() => setSelecionada("atual")}
          destacar={destacar}
          onDestacar={setDestacar}
          nota="Só leitura: o que vale para o job é a versão atual."
        />
      )}
      {children}
    </Contexto.Provider>
  );
}
