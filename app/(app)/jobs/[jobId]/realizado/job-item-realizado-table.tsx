"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import { upsertItemRealizado, type CampoRealizado } from "../actions-realizado";
import { CalhaLinha } from "./calha-linha";
import { GerarPPDrawer } from "./gerar-pp-drawer";
import { BvDialog } from "@/app/(app)/_bv/bv-dialog";
import { acaoBv } from "@/app/(app)/_bv/bv-action-button";
import { LARGURA_CALHA } from "@/app/(app)/_planilha/calha-acoes";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
  FAIXA_GRUPO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";
import { ColunasJob, LARGURA_MINIMA_JOB } from "@/app/(app)/_planilha/grade-job";
import { aceitaBV, tipoGeraDesembolso } from "@/lib/calculos/versao-totais";

interface Props {
  jobId: string;
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  /** id da categoria -> nome. Itens sem categoria caem no travessão. */
  categoriasMap: Map<string, string>;
  moeda: string;
  editable: boolean;
  // PP rail
  ppsPorItemId: Map<string, PedidoCompra>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  jobEmpresaId: string;
  jobResponsavelId: string;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  grupoNome: string;
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

type CelulaAtiva = { itemId: string; campo: CampoRealizado } | null;
type Overrides = Record<string, Partial<Record<CampoRealizado, number>>>;

const ALTURA_LINHA = "h-[34px]";

const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";

const CAMPO_CLASSES =
  "h-7 w-full rounded-lg border border-california-red bg-white px-2 text-xs text-foreground outline-none ring-2 ring-california-red/15";

function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function paraEdicao(valor: number): string {
  return String(valor).replace(".", ",");
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
  jobId,
  itens,
  realizadosMap,
  categoriasMap,
  moeda,
  editable,
  ppsPorItemId,
  fornecedores,
  empresas,
  jobEmpresaId,
  jobResponsavelId: _jobResponsavelId,
  bvsPorItem,
  versaoLabel,
  grupoNome,
  cabecalhoGrupo,
  acoesGrupo,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [ativa, setAtiva] = React.useState<CelulaAtiva>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [erro, setErro] = React.useState<string | null>(null);

  // Rail lateral PP
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const faixaRef = React.useRef<HTMLTableRowElement>(null);
  const [railTop, setRailTop] = React.useState(0);
  const [faixaAltura, setFaixaAltura] = React.useState(0);
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
  }, [itens.length, editable]);

  function abrirDrawer(itemRealizadoId: string) {
    setItemIdAtual(itemRealizadoId);
    setDrawerOpen(true);
  }

  // Descarta overrides quando o servidor devolve o mesmo valor.
  React.useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Overrides = {};
      for (const item of itens) {
        const campos = prev[item.id];
        if (!campos) continue;
        const realizado = realizadosMap.get(item.id);
        const restante: Partial<Record<CampoRealizado, number>> = {};
        for (const [campo, valor] of Object.entries(campos)) {
          const doServidor = realizado
            ? Number(realizado[campo as CampoRealizado] ?? 0)
            : 0;
          if (doServidor !== valor) {
            restante[campo as CampoRealizado] = valor as number;
          }
        }
        if (Object.keys(restante).length > 0) next[item.id] = restante;
      }
      return next;
    });
  }, [itens, realizadosMap]);

  function valorRealizado(itemId: string, campo: CampoRealizado): number {
    const override = overrides[itemId]?.[campo];
    if (override !== undefined) return override;
    const r = realizadosMap.get(itemId);
    if (r) return Number(r[campo] ?? 0);
    // Sem lançamento ainda: espelha o default do banco (QT e D/M nascem 1),
    // pra célula já mostrar o valor que vai valer quando o unitário for
    // preenchido, em vez de um travessão que sugere "vazio".
    return campo === "valor_unitario_realizado" ? 0 : 1;
  }

  function totalRealizadoDe(itemId: string): number {
    const override = overrides[itemId];
    if (override) {
      const v = valorRealizado(itemId, "valor_unitario_realizado");
      const q = valorRealizado(itemId, "quantidade_realizada");
      const d = valorRealizado(itemId, "dias_meses_realizado");
      return v * q * d;
    }
    const r = realizadosMap.get(itemId);
    return r ? Number(r.total_realizado ?? 0) : 0;
  }

  function confirmarNumero(itemId: string, campo: CampoRealizado, raw: string) {
    const n = parseNumero(raw);
    if (n === null) {
      setAtiva(null);
      setErro("Valor inválido — a célula foi mantida como estava.");
      return;
    }
    if (n < 0) {
      setAtiva(null);
      setErro("Valor não pode ser negativo.");
      return;
    }
    if (n === valorRealizado(itemId, campo)) {
      setAtiva(null);
      return;
    }
    gravar(itemId, campo, n);
  }

  function gravar(itemId: string, campo: CampoRealizado, valor: number) {
    const anterior = overrides[itemId];
    setErro(null);
    setAtiva(null);
    setOverrides((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [campo]: valor },
    }));

    const reverter = () =>
      setOverrides((prev) => {
        const next = { ...prev };
        if (anterior) next[itemId] = anterior;
        else delete next[itemId];
        return next;
      });

    startTransition(async () => {
      try {
        const res = await upsertItemRealizado(jobId, itemId, campo, String(valor));
        if (!res.ok) {
          reverter();
          setErro(res.message);
          return;
        }
        router.refresh();
      } catch (e) {
        reverter();
        throw e;
      }
    });
  }

  const subtotais = React.useMemo(() => {
    let orcado = 0;
    let planejado = 0;
    let realizado = 0;
    for (const it of itens) {
      orcado += Number(it.total_orcado ?? 0);
      planejado += Number(it.total_planejado ?? 0);
      realizado += totalRealizadoDe(it.id);
    }
    return { orcado, planejado, realizado };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, overrides, realizadosMap]);

  void pending;

  return (
    <>
      {erro && (
        <div className="flex items-center justify-between gap-3 border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
          <span>{erro}</span>
          <button
            type="button"
            onClick={() => setErro(null)}
            className="rounded-md p-1 hover:bg-california-red/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div ref={wrapperRef} className="relative">
      {/* Com o nome do grupo na faixa, a tabela abre e fecha o card. */}
      <div
        className={cn(
          "overflow-x-auto rounded-b-2xl",
          cabecalhoGrupo && !erro && "rounded-t-2xl",
        )}
      >
        <table
          className={cn(
            "w-full table-fixed text-sm border-collapse",
            LARGURA_MINIMA_JOB,
          )}
        >
          <ColunasJob />
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {/* Linha 1 — o nome do agrupamento divide a faixa com os
                blocos, em vez de ocupar uma barra só dele acima. */}
            <tr ref={faixaRef}>
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
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoFim)}>Total</th>
              {/* Realizado */}
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoAbre)}>R$ Unit.</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoMeio)}>QT</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoMeio)}>D/M</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoFim)}>Total</th>
            </tr>
          </thead>

          <tbody ref={tbodyRef}>
            {itens.length === 0 && (
              <tr>
                <td colSpan={15} className="py-8 text-center text-sm text-muted-foreground">
                  Sem itens neste grupo.
                </td>
              </tr>
            )}
            {itens.map((item) => {
              const totalReal = totalRealizadoDe(item.id);
              const categoria = item.categoria_id
                ? categoriasMap.get(item.categoria_id)
                : null;
              const ativaAqui = (campo: CampoRealizado) =>
                ativa?.itemId === item.id && ativa.campo === campo;

              return (
                <tr key={item.id} className={cn(ALTURA_LINHA, "border-b border-border")}>
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
                  <td className={cn("px-3 text-right text-xs font-mono font-semibold align-middle whitespace-nowrap", PLANEJADO.celulaTotal)}>
                    {Number(item.total_planejado ?? 0) > 0
                      ? formatCurrency(Number(item.total_planejado), moeda)
                      : "—"}
                  </td>
                  {/* Realizado (editavel) */}
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "valor_unitario_realizado")}
                    formato="moeda"
                    moeda={moeda}
                    editando={ativaAqui("valor_unitario_realizado")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "valor_unitario_realizado" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "valor_unitario_realizado", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={cn("font-mono", REALIZADO.celulaAbre)}
                  />
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "quantidade_realizada")}
                    editando={ativaAqui("quantidade_realizada")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "quantidade_realizada" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "quantidade_realizada", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={REALIZADO.celulaMeio}
                  />
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "dias_meses_realizado")}
                    editando={ativaAqui("dias_meses_realizado")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "dias_meses_realizado" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "dias_meses_realizado", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={REALIZADO.celulaMeio}
                  />
                  <td className={cn("px-3 text-right text-xs font-mono font-semibold align-middle whitespace-nowrap", REALIZADO.celulaTotal)}>
                    {totalReal > 0 ? formatCurrency(totalReal, moeda) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr>
              <td colSpan={3} className="px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Subtotal do grupo
              </td>
              <td colSpan={3} className={ORCADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", ORCADO.subtotalValor)}>
                {formatCurrency(subtotais.orcado, moeda)}
              </td>
              <td colSpan={3} className={PLANEJADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", PLANEJADO.subtotalValor)}>
                {formatCurrency(subtotais.planejado, moeda)}
              </td>
              <td colSpan={3} className={REALIZADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", REALIZADO.subtotalValor)}>
                {subtotais.realizado > 0 ? formatCurrency(subtotais.realizado, moeda) : "—"}
              </td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-t-border">
                Rentabilidade
              </td>
              <td colSpan={4} className={cn("border-t border-t-[#dfeafb]", ORCADO.celulaVazia)} />
              <td colSpan={3} className={cn("border-t border-t-[#dcf5e8]", PLANEJADO.celulaVazia)} />
              <td className={cn("px-3 py-2 text-right whitespace-nowrap border-t border-t-[#dcf5e8]", PLANEJADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={subtotais.orcado}
                  custo={subtotais.planejado}
                  moeda={moeda}
                  corValor={RENTAB_VALOR}
                  corPercentual={RENTAB_VALOR}
                />
              </td>
              <td colSpan={3} className={cn("border-t border-t-[#fbd8b8]", REALIZADO.celulaVazia)} />
              <td className={cn("px-3 py-2 text-right whitespace-nowrap border-t border-t-[#fbd8b8]", REALIZADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={subtotais.orcado}
                  custo={subtotais.realizado}
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
      {(editable || itens.some((i) => bvsPorItem[i.id])) && (
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
              aceitaBV(item.tipo_custo) && (editable || bv !== null);
            const travado =
              !editable || (bv !== null && bv.situacao !== "a_negociar");

            // ---- PP: tipos de calha PP (AR, B, C, F, FI) ----
            // Job congelado não gera nem consulta PP na planilha: a aba de
            // Pedidos de Produção é quem guarda o histórico.
            const realizado = realizadosMap.get(item.id);
            const realizadoId = realizado?.id ?? "";
            const pp = ppsPorItemId.get(realizadoId) ?? null;

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
                  editable && tipoGeraDesembolso(item.tipo_custo)
                    ? {
                        itemRealizadoId: realizadoId,
                        totalRealizado: realizado
                          ? Number(realizado.total_realizado ?? 0)
                          : 0,
                        pedido: pp,
                        otimista: pp
                          ? null
                          : ppsOtimistas.get(realizadoId) ?? null,
                        onGerar: abrirDrawer,
                      }
                    : null
                }
              />
            );
          })}
        </div>
      )}
      </div>

      {editable && (
        <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-6 py-3 rounded-b-2xl">
          <span className="text-[11px] text-muted-foreground">
            Clique em qualquer célula do bloco Realizado para editar ·{" "}
            <kbd className="font-mono">Enter</kbd> confirma ·{" "}
            <kbd className="font-mono">Esc</kbd> desfaz
          </span>
        </div>
      )}

      {(() => {
        const itemAtual = itens.find(
          (i) => (realizadosMap.get(i.id)?.id ?? "") === itemIdAtual,
        );
        const realizadoAtual = itemAtual ? realizadosMap.get(itemAtual.id) : null;
        return (
          <GerarPPDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            itemRealizadoId={itemIdAtual}
            jobId={jobId}
            fornecedores={fornecedores}
            empresas={empresas}
            defaultEmpresaId={jobEmpresaId}
            itemDescricao={itemAtual?.item ?? ""}
            valorRealizado={realizadoAtual ? Number(realizadoAtual.total_realizado ?? 0) : 0}
            quantidadeRealizada={realizadoAtual ? Number(realizadoAtual.quantidade_realizada ?? 0) : 0}
            onSuccess={(codigo) => {
              setToast(`Pedido de Produção ${codigo} gerado com sucesso!`);
              // Estado otimista: já mostra os ícones Ver/Cancelar antes do
              // router.refresh() completar. Sem flicker quando a PP real
              // chega via prop (ppsPorItemId do server).
              if (itemIdAtual) {
                setPpsOtimistas((prev) => {
                  const next = new Map(prev);
                  next.set(itemIdAtual, { codigo });
                  return next;
                });
              }
            }}
          />
        );
      })()}

      {/* Mesmo formulário da tela de Orçamentos, na variante do job: o
          terceiro bloco é o Realizado e o rodapé ganha o Confirmar. */}
      {bvAberto &&
        (() => {
          const realizado = realizadosMap.get(bvAberto.id);
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
              origem="job"
              realizado={{
                valorUnitario: Number(realizado?.valor_unitario_realizado ?? 0),
                quantidade: Number(realizado?.quantidade_realizada ?? 0),
                diasMeses: Number(realizado?.dias_meses_realizado ?? 0),
                total: Number(realizado?.total_realizado ?? 0),
              }}
              readOnly={!editable}
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

function CelulaRealNum({
  valor,
  formato,
  moeda,
  editando,
  editavel,
  onAtivar,
  onConfirmar,
  onCancelar,
  tdClassName,
}: {
  valor: number;
  formato?: "moeda";
  moeda?: string;
  editando: boolean;
  editavel: boolean;
  onAtivar: () => void;
  onConfirmar: (raw: string) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  React.useEffect(() => {
    if (editando) finalizado.current = false;
  }, [editando]);

  if (editando) {
    return (
      <td className={cn("text-xs align-middle px-1.5", tdClassName)}>
        <input
          autoFocus
          inputMode="decimal"
          defaultValue={paraEdicao(valor)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finalizado.current = true;
              onConfirmar(e.currentTarget.value);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              finalizado.current = true;
              onCancelar();
            }
          }}
          onBlur={(e) => {
            if (!finalizado.current) onConfirmar(e.currentTarget.value);
          }}
          className={cn(CAMPO_CLASSES, "text-right font-mono")}
        />
      </td>
    );
  }

  const mostrarTraco = valor <= 0;

  return (
    <td
      className={cn(
        "text-xs align-middle px-3 text-right whitespace-nowrap",
        tdClassName,
        editavel && "cursor-pointer",
        mostrarTraco && "text-muted-foreground",
      )}
      onClick={editavel ? onAtivar : undefined}
    >
      {mostrarTraco
        ? "—"
        : formato === "moeda"
          ? formatCurrency(valor, moeda)
          : valor}
    </td>
  );
}
