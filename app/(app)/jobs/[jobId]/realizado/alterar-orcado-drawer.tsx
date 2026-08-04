"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle, ArrowRight } from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import {
  tipoCustoLabel,
  type TipoCusto,
  type ItemPlanilhaJob,
  type VersaoOrcamentoGrupo,
} from "@/lib/types";
import { registrarErrata } from "./actions-errata";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  itens: ItemPlanilhaJob[];
  grupos: VersaoOrcamentoGrupo[];
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
  onSuccess?: () => void;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

type Rascunho = { unitario: string; tipo: TipoCusto };

function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function paraEdicao(v: number): string {
  return String(v).replace(".", ",");
}

export function AlterarOrcadoDrawer({
  open,
  onOpenChange,
  jobId,
  itens,
  grupos,
  percentualHonorarios,
  percentualImposto,
  moeda,
  onSuccess,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [rascunhos, setRascunhos] = React.useState<Record<string, Rascunho>>({});
  const [confirmando, setConfirmando] = React.useState(false);
  const [titulo, setTitulo] = React.useState("");
  const [justificativa, setJustificativa] = React.useState("");
  const submittingRef = React.useRef(false);

  const nomeDoGrupo = React.useMemo(
    () => new Map(grupos.map((g) => [g.id, g.nome])),
    [grupos],
  );

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setTitulo("");
    setJustificativa("");
    setConfirmando(false);
    setRascunhos(
      Object.fromEntries(
        itens.map((i) => [
          i.orcado_id,
          {
            unitario: paraEdicao(i.valor_unitario_orcado),
            tipo: i.tipo_custo,
          },
        ]),
      ),
    );
  }, [open, itens]);

  /** Itens que de fato mudaram, já com o total recalculado. */
  const mudancas = React.useMemo(() => {
    const lista: Array<{
      item: ItemPlanilhaJob;
      unitarioNovo: number;
      tipoNovo: TipoCusto;
      totalNovo: number;
    }> = [];

    for (const item of itens) {
      const r = rascunhos[item.orcado_id];
      if (!r) continue;
      const unitarioNovo = parseNumero(r.unitario);
      if (unitarioNovo === null || unitarioNovo < 0) continue;
      const mudouValor = unitarioNovo !== item.valor_unitario_orcado;
      const mudouTipo = r.tipo !== item.tipo_custo;
      if (!mudouValor && !mudouTipo) continue;
      lista.push({
        item,
        unitarioNovo,
        tipoNovo: r.tipo,
        totalNovo:
          unitarioNovo * item.quantidade_orcada * item.dias_meses_orcado,
      });
    }
    return lista;
  }, [itens, rascunhos]);

  const temInvalido = React.useMemo(
    () =>
      itens.some((i) => {
        const r = rascunhos[i.orcado_id];
        if (!r) return false;
        const n = parseNumero(r.unitario);
        return n === null || n < 0;
      }),
    [itens, rascunhos],
  );

  // Preview do impacto, com a mesma função que calcula o card de Totais.
  const impacto = React.useMemo(() => {
    const antes = calcularTotaisVersao(
      itens.map((i) => ({
        tipo_custo: i.tipo_custo,
        total_orcado: i.total_orcado,
      })),
      percentualHonorarios,
      percentualImposto,
    );
    const porId = new Map(mudancas.map((m) => [m.item.orcado_id, m]));
    const depois = calcularTotaisVersao(
      itens.map((i) => {
        const m = porId.get(i.orcado_id);
        return {
          tipo_custo: m ? m.tipoNovo : i.tipo_custo,
          total_orcado: m ? m.totalNovo : i.total_orcado,
        };
      }),
      percentualHonorarios,
      percentualImposto,
    );
    return {
      custoAntes: antes.subtotalGeral,
      custoDepois: depois.subtotalGeral,
      fatAntes: antes.faturamento,
      fatDepois: depois.faturamento,
      deltaFat: depois.faturamento - antes.faturamento,
    };
  }, [itens, mudancas, percentualHonorarios, percentualImposto]);

  function handleSalvar() {
    setErro(null);
    if (temInvalido) {
      setErro("Há valor unitário inválido. Corrija antes de salvar.");
      return;
    }
    if (mudancas.length === 0) {
      setErro("Nenhum valor ou tipo de custo foi alterado.");
      return;
    }
    setConfirmando(true);
  }

  function handleConfirmar() {
    if (submittingRef.current) return;
    if (titulo.trim().length < 5) {
      setErro("Descreva a errata em pelo menos 5 caracteres.");
      return;
    }
    submittingRef.current = true;

    startTransition(async () => {
      try {
        const res = await registrarErrata(jobId, {
          titulo: titulo.trim(),
          justificativa: justificativa.trim() || null,
          alteracoes: mudancas.map((m) => ({
            job_item_orcado_id: m.item.orcado_id,
            valor_unitario: m.unitarioNovo,
            tipo_custo: m.tipoNovo,
          })),
        });

        if (!res.ok) {
          setConfirmando(false);
          setErro(res.message);
          return;
        }

        setConfirmando(false);
        onOpenChange(false);
        onSuccess?.();
        router.refresh();
      } finally {
        submittingRef.current = false;
      }
    });
  }

  if (!open) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
            <DialogTitle>Alterar orçado</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Dá pra mudar o R$ unitário e o tipo de custo. Quantidade e D/M
              ficam como foram aprovados. Toda alteração vira uma errata no
              histórico do job.
            </p>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {grupos.map((g) => {
              const doGrupo = itens.filter((i) => i.grupo_id === g.id);
              if (doGrupo.length === 0) return null;
              return (
                <div key={g.id} className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.nome}
                  </p>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="w-[150px] px-3 py-2 text-left">
                            Tipo de custo
                          </th>
                          <th className="w-[130px] px-3 py-2 text-right">
                            R$ Unit.
                          </th>
                          <th className="w-[120px] px-3 py-2 text-right">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {doGrupo.map((item) => {
                          const r = rascunhos[item.orcado_id];
                          if (!r) return null;
                          const n = parseNumero(r.unitario);
                          const invalido = n === null || n < 0;
                          const totalNovo = invalido
                            ? item.total_orcado
                            : n * item.quantidade_orcada * item.dias_meses_orcado;
                          const mudou =
                            !invalido &&
                            (n !== item.valor_unitario_orcado ||
                              r.tipo !== item.tipo_custo);

                          return (
                            <tr
                              key={item.orcado_id}
                              className={cn(
                                "border-t border-border",
                                mudou && "bg-california-red/[0.04]",
                              )}
                            >
                              <td className="px-3 py-2">
                                <span className="text-[13px]">{item.item}</span>
                                <span className="ml-2 text-[11px] text-muted-foreground">
                                  {item.quantidade_orcada} × {item.dias_meses_orcado}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <Select
                                  value={r.tipo}
                                  onValueChange={(v) =>
                                    setRascunhos((prev) => ({
                                      ...prev,
                                      [item.orcado_id]: {
                                        ...prev[item.orcado_id],
                                        tipo: v as TipoCusto,
                                      },
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TIPOS.map((t) => (
                                      <SelectItem key={t} value={t}>
                                        {tipoCustoLabel(t)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  value={r.unitario}
                                  inputMode="decimal"
                                  onChange={(e) =>
                                    setRascunhos((prev) => ({
                                      ...prev,
                                      [item.orcado_id]: {
                                        ...prev[item.orcado_id],
                                        unitario: e.target.value,
                                      },
                                    }))
                                  }
                                  className={cn(
                                    "h-8 text-right font-mono text-xs",
                                    invalido && "border-california-red",
                                  )}
                                />
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                                {mudou ? (
                                  <span className="flex items-center justify-end gap-1.5">
                                    <span className="text-muted-foreground line-through">
                                      {formatCurrency(item.total_orcado, moeda)}
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                    <span className="font-semibold">
                                      {formatCurrency(totalNovo, moeda)}
                                    </span>
                                  </span>
                                ) : (
                                  formatCurrency(item.total_orcado, moeda)
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
            <div className="text-xs text-muted-foreground">
              {mudancas.length === 0 ? (
                "Nenhuma alteração ainda."
              ) : (
                <>
                  <strong className="text-foreground">
                    {mudancas.length}{" "}
                    {mudancas.length === 1 ? "item alterado" : "itens alterados"}
                  </strong>{" "}
                  · faturamento{" "}
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      impacto.deltaFat >= 0
                        ? "text-emerald-700"
                        : "text-california-red",
                    )}
                  >
                    {impacto.deltaFat >= 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(impacto.deltaFat), moeda)}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvar}
                disabled={pending || mudancas.length === 0}
                className="rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
              >
                Salvar alterações
              </button>
            </div>
          </div>
        </DrawerContent>
      </Dialog>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={(o) => {
          setConfirmando(o);
          if (!o) setErro(null);
        }}
        title="Tem certeza que deseja realizar essa alteração?"
        description={
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="text-[12.5px] leading-relaxed text-amber-900">
                <p>
                  Você está alterando o <strong>orçado</strong> de{" "}
                  {mudancas.length}{" "}
                  {mudancas.length === 1 ? "item" : "itens"} deste job. Isso:
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  <li>muda o faturamento previsto e a rentabilidade do job;</li>
                  <li>
                    fica registrado como errata, com seu nome e a data — o
                    histórico não pode ser apagado;
                  </li>
                  <li>
                    não altera a versão aprovada do orçamento, que continua
                    sendo o que o cliente aprovou.
                  </li>
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-[12.5px]">
              <div>
                <p className="text-muted-foreground">Custo orçado</p>
                <p className="mt-0.5 font-mono">
                  {formatCurrency(impacto.custoAntes, moeda)} →{" "}
                  <strong>{formatCurrency(impacto.custoDepois, moeda)}</strong>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Faturamento previsto</p>
                <p className="mt-0.5 font-mono">
                  {formatCurrency(impacto.fatAntes, moeda)} →{" "}
                  <strong
                    className={
                      impacto.deltaFat >= 0
                        ? "text-emerald-700"
                        : "text-california-red"
                    }
                  >
                    {formatCurrency(impacto.fatDepois, moeda)}
                  </strong>
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium">
                Título da errata * (mín. 5 caracteres)
              </label>
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={200}
                placeholder="Ex: Locação de estúdio reajustada"
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-medium">
                Justificativa (opcional)
              </label>
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="O que motivou a mudança? Aparece no histórico."
                className="mt-1 w-full rounded border border-border p-2 text-sm"
              />
            </div>

            {erro && (
              <p className="text-sm text-california-red">{erro}</p>
            )}
          </div>
        }
        confirmLabel="Confirmar alteração"
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={handleConfirmar}
      />
    </>
  );
}
