"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import type { VersaoOrcamentoItem, JobItemRealizado, PedidoCompra, Fornecedor, Empresa } from "@/lib/types";
import { upsertItemRealizado, type CampoRealizado } from "../actions-realizado";
import { PPActionsCell } from "./pp-actions-cell";
import { GerarPPDrawer } from "./gerar-pp-drawer";

interface Props {
  jobId: string;
  itens: VersaoOrcamentoItem[];
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
}

type CelulaAtiva = { itemId: string; campo: CampoRealizado } | null;
type Overrides = Record<string, Partial<Record<CampoRealizado, number>>>;

const ALTURA_LINHA = "h-[34px]";
const LARGURA_MINIMA = "min-w-[1280px]";

const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";
const GRADE_ORCADO = "border-r border-r-[#eceae5]";
const GRADE_PLANEJADO = "border-r border-r-[#e6eff9]";
const GRADE_REALIZADO = "border-r border-r-[#fde8b8]";

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

function ColunasFixas() {
  return (
    <colgroup>
      {/* Item absorve o resto; Tipo estreito; blocos proporcionais. */}
      <col />
      <col className="w-[4%]" />
      <col className="w-[11%]" />
      {/* Orcado */}
      <col className="w-[7.5%]" />
      <col className="w-[3%]" />
      <col className="w-[3%]" />
      <col className="w-[8.5%]" />
      {/* Planejado */}
      <col className="w-[7.5%]" />
      <col className="w-[3%]" />
      <col className="w-[3%]" />
      <col className="w-[8.5%]" />
      {/* Realizado */}
      <col className="w-[7.5%]" />
      <col className="w-[3%]" />
      <col className="w-[3%]" />
      <col className="w-[8.5%]" />
    </colgroup>
  );
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
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [ativa, setAtiva] = React.useState<CelulaAtiva>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [erro, setErro] = React.useState<string | null>(null);

  // Rail lateral PP
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const [railTop, setRailTop] = React.useState(0);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [itemIdAtual, setItemIdAtual] = React.useState<string | null>(null);
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
    const medir = () =>
      setRailTop(
        tbody.getBoundingClientRect().top - wrapper.getBoundingClientRect().top,
      );
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
    return r ? Number(r[campo] ?? 0) : 0;
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
      <div className="overflow-x-auto rounded-b-2xl">
        <table
          className={cn("w-full table-fixed text-sm border-collapse", LARGURA_MINIMA)}
        >
          <ColunasFixas />
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th colSpan={3} className="bg-muted/40 border-b border-border" />
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-foreground bg-[#f1f0ec] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#d7d7d7]"
              >
                ORÇADO
              </th>
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]"
              >
                PLANEJADO
              </th>
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-[#92400e] bg-[#fef3c7] border-b-[3px] border-b-[#d97706] border-l-2 border-l-[#f0c874]"
              >
                REALIZADO
              </th>
            </tr>
            <tr className="bg-muted/40">
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Item</th>
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Tipo</th>
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Categoria</th>
              {/* Orcado */}
              <th className="text-right font-semibold px-3 py-2 border-l-2 border-l-[#e4e2dd] border-r border-r-border">R$ Unit.</th>
              <th className="text-right font-semibold px-3 py-2 border-r border-r-border">QT</th>
              <th className="text-right font-semibold px-3 py-2 border-r border-r-border">D/M</th>
              <th className="text-right font-semibold px-3 py-2">Total</th>
              {/* Planejado */}
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-l-2 border-l-[#cfe0f7] border-r border-r-[#dfeafb]">R$ Unit.</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-r border-r-[#dfeafb]">QT</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-r border-r-[#dfeafb]">D/M</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8]">Total</th>
              {/* Realizado */}
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e] border-l-2 border-l-[#f0c874] border-r border-r-[#fde8b8]">R$ Unit.</th>
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e] border-r border-r-[#fde8b8]">QT</th>
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e] border-r border-r-[#fde8b8]">D/M</th>
              <th className="text-right font-semibold px-3 py-2 bg-[#fef3c7]/70 text-[#92400e]">Total</th>
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
                  <td className={cn("px-3 text-right text-xs font-mono align-middle bg-black/[0.015] border-l-2 border-l-[#e4e2dd]", GRADE_ORCADO)}>
                    {formatCurrency(Number(item.valor_unitario_orcado ?? 0), moeda)}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-black/[0.015]", GRADE_ORCADO)}>
                    {Number(item.quantidade_orcada ?? 0)}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-black/[0.015]", GRADE_ORCADO)}>
                    {Number(item.dias_meses_orcado ?? 0)}
                  </td>
                  <td className="px-3 text-right text-xs font-mono font-semibold align-middle bg-black/[0.015] whitespace-nowrap">
                    {formatCurrency(Number(item.total_orcado ?? 0), moeda)}
                  </td>
                  {/* Planejado (RO) */}
                  <td className={cn("px-3 text-right text-xs font-mono align-middle bg-blue-50/40 border-l-2 border-l-[#cfe0f7]", GRADE_PLANEJADO)}>
                    {Number(item.valor_unitario_planejado ?? 0) > 0
                      ? formatCurrency(Number(item.valor_unitario_planejado), moeda)
                      : "—"}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-blue-50/40", GRADE_PLANEJADO)}>
                    {Number(item.quantidade_planejada ?? 0) > 0
                      ? Number(item.quantidade_planejada)
                      : "—"}
                  </td>
                  <td className={cn("px-3 text-right text-xs align-middle bg-blue-50/40", GRADE_PLANEJADO)}>
                    {Number(item.dias_meses_planejado ?? 0) > 0
                      ? Number(item.dias_meses_planejado)
                      : "—"}
                  </td>
                  <td className="px-3 text-right text-xs font-mono font-semibold align-middle bg-blue-50/40 whitespace-nowrap">
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
                    tdClassName={cn("bg-[#fef3c7]/40 border-l-2 border-l-[#f0c874] font-mono", GRADE_REALIZADO)}
                  />
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "quantidade_realizada")}
                    editando={ativaAqui("quantidade_realizada")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "quantidade_realizada" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "quantidade_realizada", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={cn("bg-[#fef3c7]/40", GRADE_REALIZADO)}
                  />
                  <CelulaRealNum
                    valor={valorRealizado(item.id, "dias_meses_realizado")}
                    editando={ativaAqui("dias_meses_realizado")}
                    editavel={editable}
                    onAtivar={() => setAtiva({ itemId: item.id, campo: "dias_meses_realizado" })}
                    onConfirmar={(raw) => confirmarNumero(item.id, "dias_meses_realizado", raw)}
                    onCancelar={() => setAtiva(null)}
                    tdClassName={cn("bg-[#fef3c7]/40", GRADE_REALIZADO)}
                  />
                  <td className="px-3 text-right text-xs font-mono font-semibold align-middle bg-[#fef3c7]/40 whitespace-nowrap">
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
              <td colSpan={3} className="bg-[#f1f0ec] border-l-2 border-l-[#d7d7d7] border-t-2 border-t-[#282828]" />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-foreground bg-[#f1f0ec] border-t-2 border-t-[#282828]">
                {formatCurrency(subtotais.orcado, moeda)}
              </td>
              <td colSpan={3} className="bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t-2 border-t-[#2f6fdb]" />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-[#1e4fa3] bg-[#e8f0fd] border-t-2 border-t-[#2f6fdb]">
                {formatCurrency(subtotais.planejado, moeda)}
              </td>
              <td colSpan={3} className="bg-[#fef3c7] border-l-2 border-l-[#f0c874] border-t-2 border-t-[#d97706]" />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-[#92400e] bg-[#fef3c7] border-t-2 border-t-[#d97706]">
                {subtotais.realizado > 0 ? formatCurrency(subtotais.realizado, moeda) : "—"}
              </td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-t-border">
                Rentabilidade
              </td>
              <td colSpan={4} className="bg-[#f1f0ec] border-l-2 border-l-[#d7d7d7] border-t border-t-[#e4e2dd]" />
              <td colSpan={3} className="bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t border-t-[#cfe0f7]" />
              <td className="px-3 py-2 text-right whitespace-nowrap bg-[#e8f0fd] border-t border-t-[#cfe0f7]">
                <CelulaRentabilidade
                  orcado={subtotais.orcado}
                  custo={subtotais.planejado}
                  moeda={moeda}
                  corValor="text-[#1e4fa3]"
                  corPercentual="text-[#5a76a8]"
                />
              </td>
              <td colSpan={3} className="bg-[#fef3c7] border-l-2 border-l-[#f0c874] border-t border-t-[#f0c874]" />
              <td className="px-3 py-2 text-right whitespace-nowrap bg-[#fef3c7] border-t border-t-[#f0c874]">
                <CelulaRentabilidade
                  orcado={subtotais.orcado}
                  custo={subtotais.realizado}
                  moeda={moeda}
                  corValor="text-[#92400e]"
                  corPercentual="text-[#a3703a]"
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <div
          className="absolute left-full ml-2 flex flex-col"
          style={{ top: railTop }}
        >
          {itens.map((item) => {
            const realizado = realizadosMap.get(item.id);
            const total = realizado ? Number(realizado.total_realizado ?? 0) : 0;
            const realizadoId = realizado?.id ?? "";
            const pp = ppsPorItemId.get(realizadoId) ?? null;
            const otimista = ppsOtimistas.get(realizadoId) ?? null;
            return (
              <PPActionsCell
                key={item.id}
                itemRealizadoId={realizadoId}
                totalRealizado={total}
                pp={pp}
                ppOtimista={pp ? null : otimista}
                editable={editable}
                onGerar={abrirDrawer}
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
