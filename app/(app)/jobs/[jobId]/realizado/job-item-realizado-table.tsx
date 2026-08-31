"use client";

import * as React from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import type {
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompra,
  PedidoCompraNaLista,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import { nomeContraparteBRPP } from "@/lib/types";
import { CalhaLinha } from "./calha-linha";
import { GerarPPDrawer } from "./gerar-pp-drawer";
import { PainelPPsItem } from "./painel-pps-item";
import { saldoDoItem, somaDasPPs } from "@/lib/calculos/pps-item";
import { BvDialog } from "@/app/(app)/_bv/bv-dialog";
import { acaoBv } from "@/app/(app)/_bv/bv-action-button";
import { LARGURA_CALHA } from "@/app/(app)/_planilha/calha-acoes";
import { ERRATA } from "@/app/(app)/_planilha/blocos";
import { TIPOS_CUSTO } from "@/lib/calculos/versao-totais";
import type { CampoErrata, RascunhoErrata } from "./errata-rascunho";
import {
  Calha,
  LinhaDaCalha,
  usePosicoesDaCalha,
} from "@/app/(app)/_planilha/calha";
import { RentabilidadeNoVao } from "@/app/(app)/_planilha/rentabilidade-inline";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
  FAIXA_GRUPO,
  LINHA_GRUPO_NOME,
  LINHA_TOTAL_ROTULO,
} from "@/app/(app)/_planilha/blocos";
import {
  ColunasJob,
  LARGURA_MINIMA_JOB,
  LARGURA_MINIMA_JOB_SAVE,
  colunasDoRotuloJob,
  totalDeColunasJob,
} from "@/app/(app)/_planilha/grade-job";
import {
  CabecalhoSaveColuna,
  CabecalhoSaveFaixa,
  CelulaSave,
  SAVE_VAZIO,
  classesDaLinhaComSave,
  type EstadoSaveDaLinha,
} from "@/app/(app)/_planilha/save-coluna";
import { AlcaDaColunaSave } from "@/app/(app)/_planilha/exibir-colunas";
import { aceitaBV, tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import {
  BLOCO_ZERO,
  blocosDoItem,
  realizadoVemDasPPs,
  rotuloColunaTotal,
  somarBlocosDosItens,
  valorNaVisao,
  type ValoresDoBloco,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";

/** Um agrupamento da planilha do job, com os itens já separados. */
export interface GrupoDoJob {
  id: string;
  nome: string;
  itens: ItemPlanilhaJob[];
}

interface Props {
  jobId: string;
  /** TODOS os agrupamentos da planilha, na ordem.
   *
   *  Até 24/08/2026 esta tabela desenhava UM grupo e a tela empilhava um
   *  card por grupo. O handoff "Planilha Interna - Grupos Unificados"
   *  juntou tudo numa tabela só — um cabeçalho de colunas, uma calha de
   *  números — e o grupo virou uma linha que carrega o próprio subtotal e
   *  a própria rentabilidade. */
  grupos: GrupoDoJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  /** id da categoria -> nome. Itens sem categoria caem no travessão. */
  categoriasMap: Map<string, string>;
  moeda: string;
  /** Alíquota do job — vira o BV líquido, que é o que a vista Líquido
   *  desconta. */
  percentualImposto: number;
  /** Bruto (padrão) ou Líquido (− BV). Decidida uma vez por página, em
   *  `JobRealizadoSection`: dois grupos em modos diferentes deixariam o
   *  card de Totais sem bater com nenhum deles. */
  visao: VisaoBv;
  /** Grupo recolhido esconde as LINHAS e a calha de ações. A linha do
   *  grupo — subtotal e rentabilidade — continua visível: é o dado que
   *  justifica recolher, mesma regra da planilha do orçamento. */
  estaAberto: (grupoId: string) => boolean;
  onAlternarGrupo: (grupoId: string) => void;
  /** Trilha lateral de BV e Pedido de Produção — só com o job aberto.
   *  Antes da abertura a planilha é visível e o realizado é editável,
   *  mas nada que vire documento pode ser criado. */
  podeAcoes: boolean;
  /** Job ainda não aberto pelo financeiro (`aguardando_abertura` ou
   *  `rejeitado_financeiro`). Distingue-se do job ENCERRADO, que também
   *  tem `podeAcoes` falso mas conserva os BVs lançados para consulta. */
  preAbertura: boolean;
  // PP rail — várias PPs por item desde 17/08/2026 (PPs parciais).
  ppsPorItemId: Map<string, PedidoCompraNaLista[]>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  /** Membros ativos do tenant — usados no combo de Responsável da Verba de Produção. */
  responsaveis: Array<{ id: string; nome: string }>;
  jobEmpresaId: string;
  jobResponsavelId: string;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  /** BASE do rótulo do pé da tabela. A vista Líquido acrescenta o sufixo
   *  sozinha. Default: "Total da planilha". */
  rotuloTotal?: string;
  /** Liga a coluna SAVE. Mesma coluna da planilha do orçamento — no job
   *  ela é só leitura até a Errata, que é quem pode mexer no orçado
   *  depois da abertura (decisão 028, nota de 26/08/2026). */
  saveVisivel?: boolean;
  /** Liga e desliga a coluna Save pela alça na borda esquerda da
   *  planilha. Ausente ⇒ a alça não aparece. */
  onAlternarSave?: () => void;
  savePorItem?: Record<string, EstadoSaveDaLinha>;
  onAbrirSave?: (item: ItemPlanilhaJob) => void;
  /** O rascunho do modo errata. Ausente = planilha só de leitura, que é
   *  como as outras telas que reusam esta tabela a consomem. */
  errata?: RascunhoErrata;
  /** Criar item normal e apagar linha ficam atrás de acesso; criar LINHA
   *  VERMELHA, não. Hoje todo mundo passa — a separação existe para o dia
   *  em que os papéis entrarem, e para o gate nascer num lugar só. */
  podeEditarLinhas?: boolean;
}

/** Quem decide o conteúdo da calha é a coluna Tipo:
 *
 *   - `A` e `D` — o cliente paga o fornecedor direto. Só BV.
 *   - `B`, `C`, `F`, `FI` — o custo sai do caixa da California. Só PP.
 *   - `AR` (A · Repasse) — as duas coisas na mesma linha: o principal
 *     passa pela California e vira PP, e ainda há comissão a negociar com
 *     o fornecedor, que é o BV. Desde 13/08/2026 é o único tipo assim, e
 *     é ele que a pílula dividida atende.
 *
 *  A pílula dividida cabe na MESMA calha de sempre (116px), então a
 *  reserva da página não muda e a tabela não perde um pixel. */

/** ⚠️ Nenhuma célula desta planilha é editável desde 21/08/2026.
 *
 *  O Orçado e o Planejado sempre vieram da versão aprovada e da errata. O
 *  REALIZADO era o único bloco digitável — e deixou de ser: ele nasce
 *  zerado e é montado pelas PPs emitidas no item (trigger
 *  `trg_pp_recalcula_realizado`). Em `A` e `D`, que não geram PP, o
 *  realizado é o próprio orçado.
 *
 *  Por isso saíram daqui a navegação por Tab, os overrides otimistas e a
 *  chamada a `upsertItemRealizado`: não há mais o que gravar a partir
 *  desta tabela. Mexer no realizado agora é emitir ou cancelar PP. */
const ALTURA_LINHA = "h-[34px]";

const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";

/** Razão social quando existe — é o nome que o PDF da PP usa. */
function nomeDoFornecedor(
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social">>,
  id: string,
): string {
  const f = fornecedores.find((x) => x.id === id);
  return f?.razao_social ?? f?.nome ?? "Fornecedor";
}

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/**
 * Uma célula do bloco ORÇADO — leitura fora do modo errata, input dentro.
 *
 * O input guarda TEXTO, não número: com número, digitar "1," volta a "1" e
 * o cursor pula. A conversão para número acontece uma vez só, em
 * `useRascunhoErrata`, e é de lá que sai o total da linha.
 */
function CelulaOrcadoErrata({
  item,
  campo,
  editando,
  errata,
  moeda,
  className,
}: {
  item: ItemPlanilhaJob;
  campo: CampoErrata;
  editando: boolean;
  errata?: RascunhoErrata;
  moeda: string;
  className: string;
}) {
  // A linha vermelha nasce sem orçado e nunca ganha um: mostrar travessão
  // é mais honesto do que mostrar zeros que ninguém pode mexer.
  if (item.linha_vermelha) {
    return (
      <td
        className={cn(
          "px-3 text-right text-xs align-middle font-mono",
          ERRATA.celulaVermelhaApagada,
        )}
      >
        —
      </td>
    );
  }

  const valorSalvo =
    campo === "unitario"
      ? Number(item.valor_unitario_orcado ?? 0)
      : campo === "quantidade"
        ? Number(item.quantidade_orcada ?? 0)
        : Number(item.dias_meses_orcado ?? 0);

  if (!editando || !errata) {
    return (
      <td
        className={cn(
          "px-3 text-right text-xs align-middle",
          campo === "unitario" && "font-mono",
          className,
        )}
      >
        {campo === "unitario" ? formatCurrency(valorSalvo, moeda) : valorSalvo}
      </td>
    );
  }

  const edicao = errata.edicaoDe(item.id);
  const rotulo =
    campo === "unitario" ? "R$ unitário" : campo === "quantidade" ? "QT" : "D/M";

  return (
    <td className={cn("px-1.5 align-middle", className, ERRATA.celulaEditavel)}>
      <input
        value={edicao ? edicao[campo] : String(valorSalvo)}
        onChange={(e) => errata.editarCampo(item.id, campo, e.target.value)}
        inputMode="decimal"
        aria-label={`${rotulo} orçado de ${item.item || "item novo"}`}
        className={ERRATA.input}
      />
    </td>
  );
}



export function JobItemRealizadoTable({
  jobId,
  grupos,
  realizadosMap,
  categoriasMap,
  moeda,
  percentualImposto,
  visao,
  estaAberto,
  onAlternarGrupo,
  podeAcoes,
  preAbertura,
  ppsPorItemId,
  fornecedores,
  empresas,
  responsaveis,
  jobEmpresaId,
  jobResponsavelId: _jobResponsavelId,
  bvsPorItem,
  versaoLabel,
  rotuloTotal,
  saveVisivel = false,
  onAlternarSave,
  savePorItem,
  onAbrirSave,
  errata,
  podeEditarLinhas = true,
}: Props) {
  const editando = errata?.ativo === true;
  // Rail lateral PP
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [painelOpen, setPainelOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [itemIdAtual, setItemIdAtual] = React.useState<string | null>(null);
  const [bvAberto, setBvAberto] = React.useState<ItemPlanilhaJob | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  // Estado otimista: quando finalizar PP OK, adiciona {itemRealizadoId: codigo}
  // pra trilha lateral mostrar os ícones Ver/Cancelar IMEDIATAMENTE, sem
  // esperar o router.refresh() completar. Quando a PP real chega via prop
  // (ppsPorItemId do server), este state fica redundante mas não conflita.
  const [ppsOtimistas, setPpsOtimistas] = React.useState<
    Map<string, { codigo: string }>
  >(new Map());

  // Auto-dismiss do toast após 4s
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Todos os itens da planilha, achatados — as contas e as buscas por
   *  id atravessam os grupos e não podem depender de qual card era. */
  const todosOsItens = React.useMemo(
    () => grupos.flatMap((g) => g.itens),
    [grupos],
  );

  // A calha vive fora do frame da tabela e agora acompanha linhas de
  // alturas diferentes (grupo e item). Medir é a única forma de acertar —
  // ver o cabeçalho de `_planilha/calha`.
  const posicoesCalha = usePosicoesDaCalha(wrapperRef, [
    grupos,
    visao,
    podeAcoes,
    preAbertura,
    grupos.map((g) => (estaAberto(g.id) ? "1" : "0")).join(""),
  ]);

  /** O chip da calha abre o painel; o formulário só se chega por ele. */
  function abrirPainel(itemRealizadoId: string) {
    setItemIdAtual(itemRealizadoId);
    setPainelOpen(true);
  }

  /**
   * Os três blocos de UMA linha, já com a dedução de BV separada.
   *
   * - **Orçado** nunca recebe BV: é idêntico nas duas vistas.
   * - **Planejado** deduz o BV CONGELADO no envio para abertura
   *   (`bv_liquido_planejado`). Editar o BV depois, aqui na planilha, não
   *   mexe nele — o compromisso do planejado já foi fechado. O valor novo
   *   só reaparece no realizado, e só na confirmação.
   * - **Realizado** deduz o BV vigente, e só a partir de `confirmado`.
   *   Enquanto ele está `a_negociar` a linha diz "BV não emitido" em vez
   *   de deduzir zero — que pareceria "não tem BV".
   */
  const blocosPorItem = React.useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof blocosDoItem>>();
    for (const it of todosOsItens) {
      mapa.set(
        it.id,
        blocosDoItem(
          it,
          bvsPorItem[it.id] ?? null,
          Number(realizadosMap.get(it.id)?.total_realizado ?? 0),
          percentualImposto,
          !preAbertura,
        ),
      );
    }
    return mapa;
  }, [todosOsItens, bvsPorItem, realizadosMap, percentualImposto, preAbertura]);

  const BLOCO_VAZIO = {
    orcado: 0,
    planejado: BLOCO_ZERO,
    realizado: BLOCO_ZERO,
  };

  /** Subtotais de cada grupo e o fechamento da planilha inteira — a
   *  mesma conta, aplicada a recortes diferentes da mesma lista. */
  const subtotaisPorGrupo = React.useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof somarBlocosDosItens>>();
    for (const g of grupos) {
      mapa.set(
        g.id,
        somarBlocosDosItens(
          g.itens.map((it) => blocosPorItem.get(it.id) ?? BLOCO_VAZIO),
        ),
      );
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, blocosPorItem]);

  const totais = React.useMemo(
    () =>
      somarBlocosDosItens(
        todosOsItens.map((it) => blocosPorItem.get(it.id) ?? BLOCO_VAZIO),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todosOsItens, blocosPorItem],
  );

  /** O grupo a que um item pertence — o formulário de BV e o painel de
   *  PPs mostram o nome dele no subtítulo. */
  const grupoDoItem = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const g of grupos) for (const it of g.itens) mapa.set(it.id, g.nome);
    return mapa;
  }, [grupos]);

  const rotuloDoTotal = `${rotuloTotal ?? "Total da planilha"}${
    visao === "liquido" ? " · líquido (− BV)" : ""
  }`;

  /** Quanto do item ainda pode virar PP.
   *
   *  Sai do ORÇADO desde 21/08/2026, não mais do realizado: com o
   *  realizado virando a própria soma das PPs, ele se limitaria sozinho.
   *  Mesma conta do trigger `pp_valida_saldo_do_item`. */
  function saldoParaPPs(itemId: string, itemRealizadoId: string): number {
    const orcado = blocosPorItem.get(itemId)?.orcado ?? 0;
    return saldoDoItem(orcado, ppsPorItemId.get(itemRealizadoId) ?? []);
  }

  const fmt = (v: number) => formatCurrency(v, moeda);

  return (
    <>
      {/* A faixa de erro que ficava aqui era do lançamento inline do
          realizado, que deixou de existir em 21/08/2026. Erro de PP e de
          BV vive no drawer que o produziu, junto do campo que o causou. */}
      <div ref={wrapperRef} className="relative">
      {/* A alça da coluna Save — mesma da planilha do orçamento, no
          lado oposto ao da calha de BV e PP. */}
      {onAlternarSave && (
        <div className="absolute right-full top-0 flex h-full items-start">
          <AlcaDaColunaSave visivel={saveVisivel} onAlternar={onAlternarSave} />
        </div>
      )}
      {/* Com o nome do grupo na faixa, a tabela abre e fecha o card. */}
      {/* A tabela abre e fecha o card: a planilha inteira é uma só. */}
      <div className="overflow-x-auto rounded-b-2xl rounded-t-2xl">
        <table
          className={cn(
            "w-full table-fixed text-sm border-collapse",
            saveVisivel ? LARGURA_MINIMA_JOB_SAVE : LARGURA_MINIMA_JOB,
          )}
        >
          <ColunasJob save={saveVisivel} />
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {/* Linha 1 — a faixa dos blocos. Ela é UMA para a planilha
                inteira: era esta repetição, um cabeçalho por grupo, que o
                handoff "Grupos Unificados" veio eliminar. */}
            <tr>
              {saveVisivel && <CabecalhoSaveFaixa />}
              <th colSpan={3} className={FAIXA_GRUPO} />
              <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                ORÇADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                PLANEJADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, REALIZADO.faixa)}>
                REALIZADO
              </th>
            </tr>
            <tr className="bg-muted/40">
              {saveVisivel && <CabecalhoSaveColuna />}
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Grupo · Item</th>
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Tipo</th>
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Categoria</th>
              {/* Orcado */}
              <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoAbre)}>R$ Unit.</th>
              <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoMeio)}>QT</th>
              <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoMeio)}>D/M</th>
              <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoFim)}>Total</th>
              {/* Planejado */}
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoAbre)}>R$ Unit.</th>
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoMeio)}>QT</th>
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoMeio)}>D/M</th>
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoFim)}>{rotuloColunaTotal(visao)}</th>
              {/* Realizado */}
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoAbre)}>R$ Unit.</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoMeio)}>QT</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoMeio)}>D/M</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoFim)}>{rotuloColunaTotal(visao)}</th>
            </tr>
          </thead>

          <tbody>
            {grupos.map((grupo) => {
              const abertoAqui = estaAberto(grupo.id);
              const sub =
                subtotaisPorGrupo.get(grupo.id) ??
                somarBlocosDosItens([]);
              const subPlanejado = valorNaVisao(sub.planejado, visao);
              const subRealizado = valorNaVisao(sub.realizado, visao);

              return (
                <React.Fragment key={grupo.id}>
                  {/* A LINHA DO GRUPO: nome à esquerda, subtotal já
                      alinhado à coluna Total de cada bloco, e a
                      rentabilidade ocupando o vão vazio de PLANEJADO e
                      REALIZADO. Era um `tfoot` de duas linhas por card;
                      agora é uma linha só. */}
                  <tr data-calha={`g:${grupo.id}`} className="h-10">
                    <td
                      colSpan={colunasDoRotuloJob(saveVisivel)}
                      className={LINHA_GRUPO_NOME}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => onAlternarGrupo(grupo.id)}
                          title={
                            abertoAqui
                              ? "Ocultar itens do grupo"
                              : "Mostrar itens do grupo"
                          }
                          aria-expanded={abertoAqui}
                          className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white hover:text-california-red"
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform duration-150",
                              !abertoAqui && "-rotate-90",
                            )}
                          />
                        </button>
                        <TruncateTooltip
                          text={grupo.nome}
                          className="text-[13.5px] font-bold tracking-[-0.01em] text-foreground"
                        />
                        <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">
                          {grupo.itens.length}{" "}
                          {grupo.itens.length === 1 ? "item" : "itens"}
                          {!abertoAqui && grupo.itens.length > 0 && " ocultos"}
                        </span>
                      </div>
                    </td>

                    <td colSpan={3} className={ORCADO.grupoVazio} />
                    <td
                      className={cn(
                        "px-3 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                        ORCADO.grupoValor,
                      )}
                    >
                      {formatCurrency(sub.orcado, moeda)}
                    </td>

                    <td
                      colSpan={3}
                      className={cn("overflow-hidden px-3 text-right", PLANEJADO.grupoVazio)}
                    >
                      <RentabilidadeNoVao
                        orcado={sub.orcadoRentabilidade}
                        custo={subPlanejado}
                        moeda={moeda}
                        corRotulo={PLANEJADO.textoSuave}
                      />
                    </td>
                    <td
                      className={cn(
                        "px-3 text-right whitespace-nowrap",
                        PLANEJADO.grupoValor,
                      )}
                    >
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-[13px] font-bold leading-[1.2]">
                          {formatCurrency(subPlanejado, moeda)}
                        </span>
                        {visao === "liquido" && (
                          <SubLinhaBv
                            deducao={sub.planejado.deducaoBv}
                            formatar={fmt}
                            cor={PLANEJADO.texto}
                            corRotulo={PLANEJADO.textoSuave}
                          />
                        )}
                      </div>
                    </td>

                    <td
                      colSpan={3}
                      className={cn("overflow-hidden px-3 text-right", REALIZADO.grupoVazio)}
                    >
                      <RentabilidadeNoVao
                        orcado={sub.orcadoRentabilidade}
                        custo={subRealizado}
                        moeda={moeda}
                        corRotulo={REALIZADO.textoSuave}
                      />
                    </td>
                    <td
                      className={cn(
                        "px-3 text-right whitespace-nowrap",
                        REALIZADO.grupoValor,
                      )}
                    >
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-[13px] font-bold leading-[1.2]">
                          {sub.realizado.bruto > 0
                            ? formatCurrency(subRealizado, moeda)
                            : "—"}
                        </span>
                        {visao === "liquido" && (
                          <SubLinhaBv
                            deducao={sub.realizado.deducaoBv}
                            formatar={fmt}
                            cor={REALIZADO.texto}
                            corRotulo={REALIZADO.textoSuave}
                          />
                        )}
                      </div>
                    </td>
                  </tr>

                  {abertoAqui && grupo.itens.length === 0 && (
                    <tr className="border-b border-border">
                      <td
                        colSpan={totalDeColunasJob(saveVisivel)}
                        className="py-5 pl-[30px] pr-3 text-xs text-muted-foreground"
                      >
                        Sem itens neste grupo.
                      </td>
                    </tr>
                  )}

                  {abertoAqui && grupo.itens.map((item) => {
              const blocos = blocosPorItem.get(item.id) ?? BLOCO_VAZIO;
              const realizadoDoItem = realizadosMap.get(item.id);
              // A quebra do realizado espelha o orçado só em `A`/`D` COM o
              // job aberto. Na pré-abertura ela vem da linha de realizado,
              // que está zerada — e zero vira travessão, igual ao Total.
              const quebraDasPPs =
                realizadoVemDasPPs(item.tipo_custo) || preAbertura;
              const categoria = item.categoria_id
                ? categoriasMap.get(item.categoria_id)
                : null;

              return (
                <tr
                      key={item.id}
                      data-calha={`i:${item.id}`}
                      className={cn(
                        ALTURA_LINHA,
                        "border-b border-border",
                        item.linha_vermelha && ERRATA.linhaVermelha,
                        saveVisivel &&
                          classesDaLinhaComSave(
                            savePorItem?.[item.id] ?? SAVE_VAZIO,
                          ),
                      )}
                    >
                  {saveVisivel && (
                    <CelulaSave
                      estado={savePorItem?.[item.id] ?? SAVE_VAZIO}
                      moeda={moeda}
                      totalOrcado={Number(item.total_orcado ?? 0)}
                      onAbrir={onAbrirSave ? () => onAbrirSave(item) : undefined}
                    />
                  )}
                  <td
                    className={cn(
                      "px-3 pl-[30px] text-xs align-middle",
                      item.linha_vermelha
                        ? ERRATA.celulaVermelha
                        : GRADE_NEUTRA,
                    )}
                  >
                    {editando && errata?.ehNova(item.id) ? (
                      <input
                        value={item.item}
                        onChange={(e) =>
                          errata.editarNome(item.id, e.target.value)
                        }
                        placeholder="Descrição do item"
                        aria-label="Descrição do item novo"
                        className={ERRATA.inputNome}
                      />
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <TruncateTooltip text={item.item} />
                        {item.linha_vermelha && (
                          <span className={cn(ERRATA.tagVermelha, "flex-none")}>
                            só realizado
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-3 text-xs align-middle",
                      item.linha_vermelha
                        ? ERRATA.celulaVermelha
                        : GRADE_NEUTRA,
                    )}
                  >
                    {editando ? (
                      <select
                        value={item.tipo_custo}
                        onChange={(e) =>
                          errata?.editarTipo(
                            item.id,
                            e.target.value as ItemPlanilhaJob["tipo_custo"],
                          )
                        }
                        aria-label={`Tipo de custo de ${item.item || "item novo"}`}
                        className="rounded-md border border-border bg-white px-1.5 py-1 text-[11px] font-semibold text-foreground outline-none focus:border-california-red"
                      >
                        {TIPOS_CUSTO.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge variant="outline">{item.tipo_custo}</Badge>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-3 text-xs align-middle",
                      item.linha_vermelha
                        ? ERRATA.celulaVermelha
                        : GRADE_NEUTRA,
                    )}
                  >
                    {categoria ? (
                      <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground">
                        {categoria}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* ORÇADO — o único bloco que o modo errata abre. A
                      linha vermelha fica de fora: ela não tem orçado, e é
                      o banco que garante isso. */}
                  <CelulaOrcadoErrata
                    item={item}
                    campo="unitario"
                    editando={editando}
                    errata={errata}
                    moeda={moeda}
                    className={ORCADO.celulaAbre}
                  />
                  <CelulaOrcadoErrata
                    item={item}
                    campo="quantidade"
                    editando={editando}
                    errata={errata}
                    moeda={moeda}
                    className={ORCADO.celulaMeio}
                  />
                  <CelulaOrcadoErrata
                    item={item}
                    campo="diasMeses"
                    editando={editando}
                    errata={errata}
                    moeda={moeda}
                    className={ORCADO.celulaMeio}
                  />
                  <td
                    className={cn(
                      "px-3 text-right text-xs font-mono font-semibold align-middle whitespace-nowrap",
                      item.linha_vermelha
                        ? ERRATA.celulaVermelhaApagada
                        : ORCADO.celulaTotal,
                    )}
                  >
                    {formatCurrency(Number(item.total_orcado ?? 0), moeda)}
                  </td>
                  {/* Planejado (RO) */}
                  <td className={cn("px-3 text-right text-xs font-mono align-middle", PLANEJADO.celulaAbre)}>
                    {Number(item.valor_unitario_planejado ?? 0) > 0
                      ? formatCurrency(Number(item.valor_unitario_planejado), moeda)
                      : "—"}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle", PLANEJADO.celulaMeio)}>
                    {Number(item.quantidade_planejada ?? 0) > 0
                      ? Number(item.quantidade_planejada)
                      : "—"}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle", PLANEJADO.celulaMeio)}>
                    {Number(item.dias_meses_planejado ?? 0) > 0
                      ? Number(item.dias_meses_planejado)
                      : "—"}
                  </td>
                  <CelulaTotalComBv
                    bloco={blocos.planejado}
                    visao={visao}
                    moeda={moeda}
                    className={PLANEJADO.celulaTotal}
                    cor={PLANEJADO.texto}
                    corRotulo={PLANEJADO.textoSuave}
                  />
                  {/* Realizado — leitura. Em item que gera PP, a quebra
                      descreve as PPs emitidas (quantidade somada e o
                      unitário que ela implica); em A e D, que não geram
                      PP, ela espelha o orçado. */}
                  <CelulaLeitura
                    valor={
                      quebraDasPPs
                        ? Number(realizadoDoItem?.valor_unitario_realizado ?? 0)
                        : Number(item.valor_unitario_orcado ?? 0)
                    }
                    formato="moeda"
                    moeda={moeda}
                    className={cn("font-mono", REALIZADO.celulaAbre)}
                  />
                  <CelulaLeitura
                    valor={
                      quebraDasPPs
                        ? Number(realizadoDoItem?.quantidade_realizada ?? 0)
                        : Number(item.quantidade_orcada ?? 0)
                    }
                    className={REALIZADO.celulaMeio}
                  />
                  <CelulaLeitura
                    valor={
                      quebraDasPPs
                        ? Number(realizadoDoItem?.dias_meses_realizado ?? 0)
                        : Number(item.dias_meses_orcado ?? 0)
                    }
                    className={REALIZADO.celulaMeio}
                  />
                  <CelulaTotalComBv
                    bloco={blocos.realizado}
                    visao={visao}
                    moeda={moeda}
                    className={REALIZADO.celulaTotal}
                    cor={REALIZADO.texto}
                    corRotulo={REALIZADO.textoSuave}
                  />
                </tr>
                    );
                  })}

                  {/* Os dois jeitos de criar linha, no pé do grupo.
                      "Novo item" é a linha de sempre: tem orçado, entra na
                      conta e depois recebe planejado. "Linha vermelha" é a
                      outra coisa — ela nasce sem orçado e sem planejado e
                      só recebe realizado, por PP. É o custo que o
                      orçamento não previu e que alguém precisa pedir
                      mesmo assim.

                      Criar item normal fica atrás de acesso; criar linha
                      vermelha, não. */}
                  {abertoAqui && editando && errata && (
                    <tr className="border-b border-border">
                      <td
                        colSpan={totalDeColunasJob(saveVisivel)}
                        className={ERRATA.linhaAcao}
                      >
                        <div className="flex flex-wrap items-center gap-2 pl-[18px]">
                          {podeEditarLinhas && (
                            <button
                              type="button"
                              onClick={() => errata.adicionar(grupo.id, false)}
                              className={ERRATA.botaoNovoItem}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Novo item em {grupo.nome}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => errata.adicionar(grupo.id, true)}
                            className={ERRATA.botaoLinhaVermelha}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Linha vermelha
                          </button>
                          <span className="text-[11px] text-muted-foreground">
                            orçado e planejado zerados · só recebe realizado por
                            PP
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>

          <tfoot>
            {/* O pé da tabela repete a forma da linha de grupo: subtotal
                alinhado à coluna Total e a rentabilidade no vão. Antes
                eram DUAS linhas por card — uma de subtotal e outra só de
                "Rentabilidade" —, e elas viravam quatro na tela com dois
                agrupamentos. */}
            <tr>
              <td
                colSpan={colunasDoRotuloJob(saveVisivel)}
                className={LINHA_TOTAL_ROTULO}
              >
                {rotuloDoTotal}
              </td>

              <td colSpan={3} className={ORCADO.subtotalVazio} />
              <td
                className={cn(
                  "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                  ORCADO.subtotalValor,
                )}
              >
                {formatCurrency(totais.orcado, moeda)}
              </td>

              <td
                colSpan={3}
                className={cn("overflow-hidden px-3 py-2 text-right", PLANEJADO.subtotalVazio)}
              >
                <RentabilidadeNoVao
                  orcado={totais.orcadoRentabilidade}
                  custo={valorNaVisao(totais.planejado, visao)}
                  moeda={moeda}
                  corRotulo={PLANEJADO.textoSuave}
                />
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right whitespace-nowrap",
                  PLANEJADO.subtotalValor,
                )}
              >
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {formatCurrency(valorNaVisao(totais.planejado, visao), moeda)}
                  </span>
                  {/* A soma dos BVs de todos os itens da planilha — foi o
                      que substituiu as pílulas de "BV do grupo" do design
                      3b. */}
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={totais.planejado.deducaoBv}
                      formatar={fmt}
                      cor={PLANEJADO.texto}
                      corRotulo={PLANEJADO.textoSuave}
                    />
                  )}
                </div>
              </td>

              <td
                colSpan={3}
                className={cn("overflow-hidden px-3 py-2 text-right", REALIZADO.subtotalVazio)}
              >
                <RentabilidadeNoVao
                  orcado={totais.orcadoRentabilidade}
                  custo={valorNaVisao(totais.realizado, visao)}
                  moeda={moeda}
                  corRotulo={REALIZADO.textoSuave}
                />
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right whitespace-nowrap",
                  REALIZADO.subtotalValor,
                )}
              >
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {totais.realizado.bruto > 0
                      ? formatCurrency(valorNaVisao(totais.realizado, visao), moeda)
                      : "—"}
                  </span>
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={totais.realizado.deducaoBv}
                      formatar={fmt}
                      cor={REALIZADO.texto}
                      corRotulo={REALIZADO.textoSuave}
                    />
                  )}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* A calha — fora do frame da tabela, ao lado das linhas. Cada
          pílula é presa à posição MEDIDA da linha que ela acompanha:
          numa tabela só, as linhas têm alturas diferentes e altura
          chutada acumularia erro a cada grupo.

          Job encerrado não some com a calha: os BVs já lançados seguem
          consultáveis, como na tela de Orçamentos. Só o que é ação
          (gerar PP, lançar BV novo) é que desaparece. */}
      {(editando ||
        podeAcoes ||
        (!preAbertura && todosOsItens.some((i) => bvsPorItem[i.id]))) && (
        <Calha className={cn("pointer-events-none absolute left-full top-0 ml-2.5", LARGURA_CALHA)}>
          {grupos.map((grupo) =>
            estaAberto(grupo.id)
              ? grupo.itens.map((item) => {
                  // No modo errata a calha troca de assunto: BV e PP são
                  // ações sobre a linha como ela está, e ela está sendo
                  // reescrita. O que cabe ali é remover.
                  if (editando) {
                    if (!errata || !podeEditarLinhas) return null;
                    // Linha com save não se remove — `barrarRemocao`, em
                    // `actions-errata.ts`, recusa no servidor porque o
                    // `on delete cascade` de `saves_consumos` devolveria
                    // crédito ao job de origem em silêncio. Oferecer o
                    // botão fazia o usuário montar a errata inteira,
                    // escrever a descrição e só então tomar o erro — com
                    // a linha já sumida da tabela e sem desfazer
                    // (31/08/2026). O gate é o mesmo dos dois lados.
                    const travadaPorSave =
                      item.em_save === true ||
                      Number(item.save_consumido ?? 0) > 0;
                    const motivoDaTrava = item.em_save
                      ? "Linha marcada como save: tire a marca antes de remover."
                      : "Linha paga com saldo de save de outro job: desfaça o consumo antes de remover.";
                    return (
                      <LinhaDaCalha
                        key={item.id}
                        posicao={posicoesCalha[`i:${item.id}`]}
                      >
                        <div
                          className={cn(
                            "pointer-events-auto flex items-center",
                            ALTURA_LINHA,
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => errata.remover(item.id)}
                            disabled={travadaPorSave}
                            title={travadaPorSave ? motivoDaTrava : undefined}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3 w-3" />
                            Remover
                          </button>
                        </div>
                      </LinhaDaCalha>
                    );
                  }

                  // ---- BV: tipos A, AR e D ----
                  const bv = bvsPorItem[item.id] ?? null;
                  // Sem BV num job congelado não há o que consultar — a
                  // vaga fica vazia para não desalinhar as de baixo.
                  // Linha em save não tem fornecedor neste job: sem BV a
                  // negociar e sem PP a emitir (decisão 028 §9). Os dois
                  // lados já são recusados no banco — aqui a calha nem
                  // oferece.
                  const emSave = item.em_save === true;
                  const mostraBv =
                    !emSave &&
                    aceitaBV(item.tipo_custo) &&
                    (podeAcoes || (!preAbertura && bv !== null));
                  const travado =
                    !podeAcoes || (bv !== null && bv.situacao !== "a_negociar");

                  // ---- PP: tipos de calha PP (AR, B, C, F, FI) ----
                  // Job congelado não gera nem consulta PP na planilha: a
                  // aba de Pedidos de Produção é quem guarda o histórico.
                  const realizado = realizadosMap.get(item.id);
                  const realizadoId = realizado?.id ?? "";
                  const ppsDoItem = ppsPorItemId.get(realizadoId) ?? [];

                  return (
                    <LinhaDaCalha
                      key={item.id}
                      posicao={posicoesCalha[`i:${item.id}`]}
                    >
                      <CalhaLinha
                        altura={ALTURA_LINHA}
                        bv={
                          mostraBv
                            ? acaoBv({
                                temBv: bv !== null,
                                itemNome: item.item,
                                somenteLeitura: travado,
                                onClick: () => setBvAberto(item),
                              })
                            : null
                        }
                        pp={
                          podeAcoes && !emSave && tipoGeraDesembolso(item.tipo_custo)
                            ? {
                                itemRealizadoId: realizadoId,
                                // Era o realizado. Com o realizado nascendo
                                // das PPs, esperar por ele deixava a metade
                                // PP invisível para sempre — nunca haveria
                                // a primeira PP. Quem libera agora é o
                                // orçado.
                                baseDisponivel: Number(item.total_orcado ?? 0),
                                pedidos: ppsDoItem,
                                otimista:
                                  ppsDoItem.length > 0
                                    ? null
                                    : ppsOtimistas.get(realizadoId) ?? null,
                                onAbrirPainel: abrirPainel,
                              }
                            : null
                        }
                      />
                    </LinhaDaCalha>
                  );
                })
              : null,
          )}
        </Calha>
      )}
      </div>

      {podeAcoes && grupos.some((g) => estaAberto(g.id)) && (
        <div className="flex items-center justify-between gap-4 rounded-b-2xl border-t border-border bg-muted/40 px-6 py-3">
          <span className="text-[11px] text-muted-foreground">
            O Realizado não é digitado: ele é a soma dos Pedidos de Produção
            emitidos no item. Em custo <strong>A</strong> e <strong>D</strong>,
            que não geram PP, ele espelha o Orçado.
          </span>
        </div>
      )}

      {(() => {
        const itemAtual = todosOsItens.find(
          (i) => (realizadosMap.get(i.id)?.id ?? "") === itemIdAtual,
        );
        // A base do painel e do formulário é o ORÇADO do item: é dele que
        // sai o saldo, e é sobre a quantidade orçada que a fatia da PP é
        // medida. O realizado não serve mais de base — ele É a soma das
        // PPs, e se limitaria sozinho.
        const orcadoAtual = itemAtual ? Number(itemAtual.total_orcado ?? 0) : 0;
        const quantidadeOrcada = itemAtual
          ? Number(itemAtual.quantidade_orcada ?? 0)
          : 0;
        const ppsDoItem = itemIdAtual
          ? (ppsPorItemId.get(itemIdAtual) ?? [])
          : [];
        const emPPs = somaDasPPs(ppsDoItem);
        const saldo = itemAtual
          ? saldoParaPPs(itemAtual.id, itemIdAtual ?? "")
          : 0;

        return (
          <>
            <PainelPPsItem
              open={painelOpen}
              onOpenChange={setPainelOpen}
              itemNome={itemAtual?.item ?? ""}
              grupoNome={
                itemAtual ? grupoDoItem.get(itemAtual.id) ?? "" : ""
              }
              moeda={moeda}
              totalOrcado={orcadoAtual}
              quantidadeOrcada={quantidadeOrcada}
              pps={ppsDoItem.map((pp) => ({
                id: pp.id,
                codigo: pp.codigo,
                status: pp.status,
                fornecedorNome: nomeContraparteBRPP({
                  verba_producao: pp.verba_producao,
                  fornecedor: pp.fornecedor_id ? { nome: nomeDoFornecedor(fornecedores, pp.fornecedor_id) } : null,
                  responsavel: pp.responsavel,
                }) || nomeDoFornecedor(fornecedores, pp.fornecedor_id ?? ""),
                quantidade: Number(pp.quantidade ?? 0),
                valor: Number(pp.valor ?? 0),
              }))}
              emPPs={emPPs}
              saldo={saldo}
              onNovaPP={
                podeAcoes
                  ? () => {
                      // O painel some enquanto o formulário está aberto:
                      // dois drawers empilhados na direita brigariam pelo
                      // mesmo espaço.
                      setPainelOpen(false);
                      setDrawerOpen(true);
                    }
                  : null
              }
            />

            <GerarPPDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              itemRealizadoId={itemIdAtual}
              jobId={jobId}
              fornecedores={fornecedores}
              empresas={empresas}
              responsaveis={responsaveis}
              defaultEmpresaId={jobEmpresaId}
              itemDescricao={itemAtual?.item ?? ""}
              valorOrcado={orcadoAtual}
              quantidadeOrcada={quantidadeOrcada}
              saldoDisponivel={saldo}
              onSuccess={(codigo) => {
                setToast(`Pedido de Produção ${codigo} gerado com sucesso!`);
                // Estado otimista: o chip da calha já conta a PP nova antes
                // do router.refresh() completar. Some sozinho quando a PP
                // real chega via prop (ppsPorItemId do server).
                if (itemIdAtual) {
                  setPpsOtimistas((prev) => {
                    const next = new Map(prev);
                    next.set(itemIdAtual, { codigo });
                    return next;
                  });
                }
              }}
            />
          </>
        );
      })()}

      {/* Mesmo formulário da tela de Orçamentos, na variante do job: o
          terceiro bloco é o Realizado e o rodapé ganha o Confirmar. */}
      {bvAberto &&
        (() => {
          const realizado = realizadosMap.get(bvAberto.id);
          const daPP = realizadoVemDasPPs(bvAberto.tipo_custo) || preAbertura;
          return (
            <BvDialog
              open
              onOpenChange={(o) => !o && setBvAberto(null)}
              item={bvAberto}
              grupoNome={grupoDoItem.get(bvAberto.id) ?? ""}
              versaoLabel={versaoLabel}
              categoriaNome={
                bvAberto.categoria_id
                  ? categoriasMap.get(bvAberto.categoria_id) ?? null
                  : null
              }
              moeda={moeda}
              bv={bvsPorItem[bvAberto.id] ?? null}
              fornecedores={fornecedores.map((f) => ({
                id: f.id,
                nome: f.razao_social ?? f.nome,
              }))}
              percentualImposto={percentualImposto}
              origem="job"
              realizado={{
                valorUnitario: daPP
                  ? Number(realizado?.valor_unitario_realizado ?? 0)
                  : Number(bvAberto.valor_unitario_orcado ?? 0),
                quantidade: daPP
                  ? Number(realizado?.quantidade_realizada ?? 0)
                  : Number(bvAberto.quantidade_orcada ?? 0),
                diasMeses: daPP
                  ? Number(realizado?.dias_meses_realizado ?? 0)
                  : Number(bvAberto.dias_meses_orcado ?? 0),
                total: blocosPorItem.get(bvAberto.id)?.realizado.bruto ?? 0,
              }}
              readOnly={!podeAcoes}
            />
          );
        })()}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated animate-in fade-in slide-in-from-bottom-2"
        >
          <span className="text-sm font-medium text-emerald-800">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}

/** Célula de leitura do bloco Realizado.
 *
 *  Substituiu a `CelulaRealNum`, que era um input disfarçado de célula.
 *  Zero vira travessão: "R$ 0,00" numa linha sem PP diria "custou zero",
 *  quando o que houve foi "ainda não se pediu nada". */
function CelulaLeitura({
  valor,
  formato,
  moeda,
  className,
}: {
  valor: number;
  formato?: "moeda";
  moeda?: string;
  className?: string;
}) {
  const vazio = valor <= 0;
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 text-right align-middle text-xs",
        className,
        vazio && "text-muted-foreground",
      )}
    >
      {vazio ? "—" : formato === "moeda" ? formatCurrency(valor, moeda) : valor}
    </td>
  );
}

/** Célula de Total dos blocos que recebem BV.
 *
 *  Na vista Bruto é o Total de sempre. Na Líquido mostra o valor já
 *  descontado E a sub-linha que diz de quanto foi o desconto — é ela que
 *  torna a dedução auditável sem abrir o formulário do BV. */
function CelulaTotalComBv({
  bloco,
  visao,
  moeda,
  className,
  cor,
  corRotulo,
}: {
  bloco: ValoresDoBloco;
  visao: VisaoBv;
  moeda: string;
  className?: string;
  cor: string;
  corRotulo: string;
}) {
  const valor = valorNaVisao(bloco, visao);
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 text-right align-middle",
        className,
      )}
    >
      <div className="flex flex-col items-end">
        <span
          className={cn(
            "font-mono text-xs font-semibold leading-[1.2]",
            bloco.bruto <= 0 && "text-muted-foreground",
          )}
        >
          {bloco.bruto > 0 ? formatCurrency(valor, moeda) : "—"}
        </span>
        {visao === "liquido" && bloco.bruto > 0 && (
          <SubLinhaBv
            deducao={bloco.deducaoBv}
            pendente={bloco.bvPendente}
            formatar={(v) => formatCurrency(v, moeda)}
            cor={cor}
            corRotulo={corRotulo}
          />
        )}
      </div>
    </td>
  );
}
