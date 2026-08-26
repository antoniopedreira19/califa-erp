"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import type {
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompra,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import { CalhaLinha } from "./calha-linha";
import { GerarPPDrawer } from "./gerar-pp-drawer";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import { PainelPPsItem } from "./painel-pps-item";
import { saldoDoItem, somaDasPPs } from "@/lib/calculos/pps-item";
import { BvDialog } from "@/app/(app)/_bv/bv-dialog";
import { acaoBv } from "@/app/(app)/_bv/bv-action-button";
import { LARGURA_CALHA } from "@/app/(app)/_planilha/calha-acoes";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
  FAIXA_GRUPO,
  RENTAB_VALOR,
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
import { aceitaBV, tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import {
  BLOCO_ZERO,
  blocosDoItem,
  realizadoVemDasPPs,
  rotuloColunaTotal,
  rotuloSubtotal,
  somarBlocosDosItens,
  valorNaVisao,
  type ValoresDoBloco,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";

interface Props {
  /** Liga a coluna SAVE. Mesma coluna da planilha do orçamento — no job
   *  ela é só leitura até a Errata, que é quem pode mexer no orçado
   *  depois da abertura (decisão 023, nota de 26/08/2026). */
  saveVisivel?: boolean;
  savePorItem?: Record<string, EstadoSaveDaLinha>;
  onAbrirSave?: (item: ItemPlanilhaJob) => void;
  jobId: string;
  itens: ItemPlanilhaJob[];
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
  /** Grupo recolhido esconde as LINHAS e a calha de ações. O subtotal e a
   *  rentabilidade continuam visíveis — são o dado que justifica recolher,
   *  mesma regra da planilha do orçamento. */
  aberto?: boolean;
  /** Trilha lateral de BV e Pedido de Produção — só com o job aberto.
   *  Antes da abertura a planilha é visível e o realizado é editável,
   *  mas nada que vire documento pode ser criado. */
  podeAcoes: boolean;
  /** Job ainda não aberto pelo financeiro (`aguardando_abertura` ou
   *  `rejeitado_financeiro`). Distingue-se do job ENCERRADO, que também
   *  tem `podeAcoes` falso mas conserva os BVs lançados para consulta. */
  preAbertura: boolean;
  // PP rail — várias PPs por item desde 17/08/2026 (PPs parciais).
  ppsPorItemId: Map<string, PedidoCompra[]>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  jobEmpresaId: string;
  jobResponsavelId: string;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  grupoNome: string;
  /** Cartões de crédito ativos do tenant — buscados pelo server component pai. */
  cartoes: CartaoOption[];
  /** Identidade do grupo — mora na PRIMEIRA linha do thead, na mesma
   *  faixa de ORÇADO / PLANEJADO / REALIZADO. O card não tem mais barra
   *  de título só para isso. */
  cabecalhoGrupo?: React.ReactNode;
  /** Contador de itens do grupo, na calha à direita da faixa. */
  acoesGrupo?: React.ReactNode;
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


/** Célula "R$ x,xx / y,y%" usada nas linhas de Rentabilidade do rodapé. */
function CelulaRentabilidade({
  orcado,
  custo,
  moeda,
  corValor,
  corPercentual,
}: {
  orcado: number;
  custo: number;
  moeda: string;
  corValor: string;
  corPercentual: string;
}) {
  const { rentabilidade, percentual } = calcularRentabilidade(orcado, custo);

  if (custo <= 0) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn("font-mono text-[12.5px] font-bold", corValor)}>
        {formatCurrency(rentabilidade, moeda)}
      </span>
      {percentual !== null && (
        <span className={cn("font-mono text-[10.5px]", corPercentual)}>
          {formatarPercentual(percentual)}
        </span>
      )}
    </div>
  );
}

export function JobItemRealizadoTable({
  saveVisivel = false,
  savePorItem,
  onAbrirSave,
  jobId,
  itens,
  realizadosMap,
  categoriasMap,
  moeda,
  percentualImposto,
  visao,
  aberto = true,
  podeAcoes,
  preAbertura,
  ppsPorItemId,
  fornecedores,
  empresas,
  jobEmpresaId,
  jobResponsavelId: _jobResponsavelId,
  bvsPorItem,
  versaoLabel,
  grupoNome,
  cartoes,
  cabecalhoGrupo,
  acoesGrupo,
}: Props) {
  // Rail lateral PP
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const faixaRef = React.useRef<HTMLTableRowElement>(null);
  const [railTop, setRailTop] = React.useState(0);
  const [faixaAltura, setFaixaAltura] = React.useState(0);
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

  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const tbody = tbodyRef.current;
    if (!wrapper || !tbody) return;
    const medir = () => {
      const topoWrapper = wrapper.getBoundingClientRect().top;
      setRailTop(tbody.getBoundingClientRect().top - topoWrapper);
      // A calha do grupo se alinha pela faixa medida, não por altura
      // chutada — o thead muda de altura conforme a fonte carrega.
      const faixa = faixaRef.current;
      if (faixa) setFaixaAltura(faixa.getBoundingClientRect().height);
    };
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [itens.length, visao, aberto, podeAcoes, preAbertura]);

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
    for (const it of itens) {
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
  }, [itens, bvsPorItem, realizadosMap, percentualImposto, preAbertura]);

  const BLOCO_VAZIO = {
    orcado: 0,
    planejado: BLOCO_ZERO,
    realizado: BLOCO_ZERO,
  };

  const subtotais = React.useMemo(
    () =>
      somarBlocosDosItens(
        itens.map((it) => blocosPorItem.get(it.id) ?? BLOCO_VAZIO),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itens, blocosPorItem],
  );

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
      {/* Com o nome do grupo na faixa, a tabela abre e fecha o card. */}
      <div
        className={cn(
          "overflow-x-auto rounded-b-2xl",
          cabecalhoGrupo && "rounded-t-2xl",
        )}
      >
        <table
          className={cn(
            "w-full table-fixed text-sm border-collapse",
            saveVisivel ? LARGURA_MINIMA_JOB_SAVE : LARGURA_MINIMA_JOB,
          )}
        >
          <ColunasJob save={saveVisivel} />
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {/* Linha 1 — o nome do agrupamento divide a faixa com os
                blocos, em vez de ocupar uma barra só dele acima. */}
            <tr ref={faixaRef}>
              {saveVisivel && <CabecalhoSaveFaixa />}
              <th colSpan={3} className={FAIXA_GRUPO}>
                {cabecalhoGrupo}
              </th>
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
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Item</th>
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

          <tbody ref={tbodyRef}>
            {aberto && itens.length === 0 && (
              <tr>
                <td colSpan={totalDeColunasJob(saveVisivel)} className="py-8 text-center text-sm text-muted-foreground">
                  Sem itens neste grupo.
                </td>
              </tr>
            )}
            {aberto && itens.map((item) => {
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
                  className={cn(
                    ALTURA_LINHA,
                    "border-b border-border",
                    saveVisivel &&
                      classesDaLinhaComSave(savePorItem?.[item.id] ?? SAVE_VAZIO),
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
                  <td className={cn("px-3 text-xs align-middle", GRADE_NEUTRA)}>
                    <TruncateTooltip text={item.item} />
                  </td>
                  <td className={cn("px-3 text-xs align-middle", GRADE_NEUTRA)}>
                    <Badge variant="outline">{item.tipo_custo}</Badge>
                  </td>
                  <td className={cn("px-3 text-xs align-middle", GRADE_NEUTRA)}>
                    {categoria ? (
                      <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground">
                        {categoria}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Orcado (RO) */}
                  <td className={cn("px-3 text-right text-xs font-mono align-middle", ORCADO.celulaAbre)}>
                    {formatCurrency(Number(item.valor_unitario_orcado ?? 0), moeda)}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle", ORCADO.celulaMeio)}>
                    {Number(item.quantidade_orcada ?? 0)}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle", ORCADO.celulaMeio)}>
                    {Number(item.dias_meses_orcado ?? 0)}
                  </td>
                  <td className={cn("px-3 text-right text-xs font-mono font-semibold align-middle whitespace-nowrap", ORCADO.celulaTotal)}>
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
          </tbody>

          <tfoot>
            <tr>
              <td colSpan={colunasDoRotuloJob(saveVisivel)} className="px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {rotuloSubtotal(visao)}
              </td>
              <td colSpan={3} className={ORCADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", ORCADO.subtotalValor)}>
                {formatCurrency(subtotais.orcado, moeda)}
              </td>
              {/* O subtotal repete a sub-linha das células, somando o BV
                  de todos os itens do grupo — foi o que substituiu as
                  pílulas de "BV do grupo" do design 3b. */}
              <td colSpan={3} className={PLANEJADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap", PLANEJADO.subtotalValor)}>
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {formatCurrency(valorNaVisao(subtotais.planejado, visao), moeda)}
                  </span>
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={subtotais.planejado.deducaoBv}
                      formatar={fmt}
                      cor={PLANEJADO.texto}
                      corRotulo={PLANEJADO.textoSuave}
                    />
                  )}
                </div>
              </td>
              <td colSpan={3} className={REALIZADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap", REALIZADO.subtotalValor)}>
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {subtotais.realizado.bruto > 0
                      ? formatCurrency(valorNaVisao(subtotais.realizado, visao), moeda)
                      : "—"}
                  </span>
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={subtotais.realizado.deducaoBv}
                      formatar={fmt}
                      cor={REALIZADO.texto}
                      corRotulo={REALIZADO.textoSuave}
                    />
                  )}
                </div>
              </td>
            </tr>
            <tr>
              <td colSpan={colunasDoRotuloJob(saveVisivel)} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-t-border">
                Rentabilidade
              </td>
              <td colSpan={4} className={cn("border-t border-t-[#dfeafb]", ORCADO.celulaVazia)} />
              <td colSpan={3} className={cn("border-t border-t-[#dcf5e8]", PLANEJADO.celulaVazia)} />
              <td className={cn("px-3 py-2 text-right whitespace-nowrap border-t border-t-[#dcf5e8]", PLANEJADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={subtotais.orcado}
                  custo={valorNaVisao(subtotais.planejado, visao)}
                  moeda={moeda}
                  corValor={RENTAB_VALOR}
                  corPercentual={RENTAB_VALOR}
                />
              </td>
              <td colSpan={3} className={cn("border-t border-t-[#fbd8b8]", REALIZADO.celulaVazia)} />
              <td className={cn("px-3 py-2 text-right whitespace-nowrap border-t border-t-[#fbd8b8]", REALIZADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={subtotais.orcado}
                  custo={valorNaVisao(subtotais.realizado, visao)}
                  moeda={moeda}
                  corValor={RENTAB_VALOR}
                  corPercentual={RENTAB_VALOR}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Contador do grupo — calha à direita, na altura exata da faixa.
          É para lá que ele foi quando a barra de título do card saiu. */}
      {acoesGrupo && (
        <div
          className="absolute left-full top-0 ml-2.5 flex items-center"
          style={{ height: faixaAltura || undefined }}
        >
          {acoesGrupo}
        </div>
      )}

      {/* Fora do frame do card, como no design. A calha que recebe estes
          botões é reservada por JobRealizadoSection — sem ela a trilha era
          cortada na borda direita da página. */}
      {/* Job encerrado não some com a trilha: os BVs já lançados seguem
          consultáveis, como na tela de Orçamentos. Só o que é ação
          (gerar PP, lançar BV novo) é que desaparece. */}
      {aberto &&
        (podeAcoes || (!preAbertura && itens.some((i) => bvsPorItem[i.id]))) && (
        <div
          className={cn(
            "absolute left-full ml-2.5 flex flex-col",
            LARGURA_CALHA,
          )}
          style={{ top: railTop }}
        >
          {itens.map((item) => {
            // ---- BV: tipos A, AR e D ----
            const bv = bvsPorItem[item.id] ?? null;
            // Sem BV num job congelado não há o que consultar — a vaga
            // fica vazia para não desalinhar as linhas de baixo.
            const mostraBv =
              aceitaBV(item.tipo_custo) &&
              (podeAcoes || (!preAbertura && bv !== null));
            const travado =
              !podeAcoes || (bv !== null && bv.situacao !== "a_negociar");

            // ---- PP: tipos de calha PP (AR, B, C, F, FI) ----
            // Job congelado não gera nem consulta PP na planilha: a aba de
            // Pedidos de Produção é quem guarda o histórico.
            const realizado = realizadosMap.get(item.id);
            const realizadoId = realizado?.id ?? "";
            const ppsDoItem = ppsPorItemId.get(realizadoId) ?? [];

            return (
              <CalhaLinha
                key={item.id}
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
                  podeAcoes && tipoGeraDesembolso(item.tipo_custo)
                    ? {
                        itemRealizadoId: realizadoId,
                        // Era o realizado. Com o realizado nascendo das
                        // PPs, esperar por ele deixava a metade PP
                        // invisível para sempre — nunca haveria a
                        // primeira PP. Quem libera agora é o orçado.
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
            );
          })}
        </div>
      )}
      </div>

      {aberto && podeAcoes && (
        <div className="flex items-center justify-between gap-4 rounded-b-2xl border-t border-border bg-muted/40 px-6 py-3">
          <span className="text-[11px] text-muted-foreground">
            O Realizado não é digitado: ele é a soma dos Pedidos de Produção
            emitidos no item. Em custo <strong>A</strong> e <strong>D</strong>,
            que não geram PP, ele espelha o Orçado.
          </span>
        </div>
      )}

      {(() => {
        const itemAtual = itens.find(
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
              grupoNome={grupoNome}
              moeda={moeda}
              totalOrcado={orcadoAtual}
              quantidadeOrcada={quantidadeOrcada}
              pps={ppsDoItem.map((pp) => ({
                id: pp.id,
                codigo: pp.codigo,
                status: pp.status,
                fornecedorNome: nomeDoFornecedor(fornecedores, pp.fornecedor_id),
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
              defaultEmpresaId={jobEmpresaId}
              itemDescricao={itemAtual?.item ?? ""}
              valorOrcado={orcadoAtual}
              quantidadeOrcada={quantidadeOrcada}
              saldoDisponivel={saldo}
              cartoes={cartoes}
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
              grupoNome={grupoNome}
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
