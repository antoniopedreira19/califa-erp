"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Ban } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BaixaAvulsaDialog } from "@/components/financeiro/baixa-avulsa-dialog";
import type { ContaBancaria, TituloReceberStatus } from "@/lib/types";
import { tituloReceberStatusLabel } from "@/lib/types";
import {
  darBaixaTitulo,
  estornarBaixaTitulo,
  cancelarFaturamento,
} from "./actions";
import { CancelarFaturamentoModal } from "./cancelar-faturamento-modal";

export interface TituloRow {
  id: string;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  status: TituloReceberStatus;
  pago_em: string | null;
  empresa_id: string;
  faturamento_id: string;
  fat_numero_nf: string;
  fat_serie: string;
  fat_descricao: string;
  fat_status: "emitido" | "cancelado";
  contraparte_nome: string;
}

interface Props {
  rows: TituloRow[];
  contas: ContaBancaria[];
}

type Filtro = "em_aberto" | "pago" | "inadimplente" | "todos";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function TitulosList({ rows, contas }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [filtro, setFiltro] = React.useState<Filtro>("em_aberto");
  const [erro, setErro] = React.useState<string | null>(null);
  const [baixando, setBaixando] = React.useState<TituloRow | null>(null);
  const [estornando, setEstornando] = React.useState<TituloRow | null>(null);
  const [motivoEstorno, setMotivoEstorno] = React.useState("");
  const [cancelandoFat, setCancelandoFat] = React.useState<TituloRow | null>(null);

  const hoje = new Date().toISOString().slice(0, 10);

  function isInadimplente(r: TituloRow): boolean {
    return r.status === "em_aberto" && r.data_vencimento < hoje;
  }

  const contagens = React.useMemo(() => {
    let em_aberto = 0, pago = 0, inadimplente = 0;
    for (const r of rows) {
      if (r.status === "pago") pago++;
      else if (r.status === "em_aberto") {
        em_aberto++;
        if (isInadimplente(r)) inadimplente++;
      }
    }
    return { em_aberto, pago, inadimplente, todos: rows.length };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, hoje]);

  const filtrados = React.useMemo(() => {
    if (filtro === "todos") return rows;
    if (filtro === "inadimplente") return rows.filter(isInadimplente);
    return rows.filter((r) => r.status === filtro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filtro, hoje]);

  function badgeStatus(r: TituloRow) {
    if (r.status === "cancelado")
      return { label: "Cancelado", cls: "bg-slate-100 text-slate-500 border-slate-200" };
    if (r.status === "pago")
      return { label: "Pago", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    if (isInadimplente(r))
      return { label: "Inadimplente", cls: "bg-red-50 text-red-700 border-red-200" };
    return { label: "Em aberto", cls: "bg-yellow-50 text-yellow-800 border-yellow-200" };
  }

  // tituloReceberStatusLabel is available but badgeStatus provides richer labels
  void tituloReceberStatusLabel;

  return (
    <div className="space-y-4">
      {erro && (
        <div className="rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          {erro}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {(["em_aberto", "pago", "inadimplente", "todos"] as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtro === f
                ? "border-california-red bg-california-red/10 text-california-red"
                : "border-border bg-white text-muted-foreground hover:bg-muted/50",
            )}
          >
            {f === "em_aberto"
              ? "Em aberto"
              : f === "pago"
              ? "Pagos"
              : f === "inadimplente"
              ? "Inadimplentes"
              : "Todos"}
            <span className="tabular-nums opacity-70">{contagens[f]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Contraparte</th>
              <th className="p-3 text-left">NF</th>
              <th className="p-3 text-left">Parcela</th>
              <th className="p-3 text-left">Vencimento</th>
              <th className="p-3 text-right">Valor</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Nenhum título nesta situação.
                </td>
              </tr>
            )}
            {filtrados.map((r) => {
              const b = badgeStatus(r);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                  <td className="p-3">{r.contraparte_nome}</td>
                  <td className="p-3 font-mono text-xs">
                    {r.fat_numero_nf}/{r.fat_serie}
                  </td>
                  <td className="p-3">{r.numero_parcela}</td>
                  <td className={cn("p-3", isInadimplente(r) && "text-california-red font-medium")}>
                    {formatDate(r.data_vencimento)}
                  </td>
                  <td className="p-3 text-right font-mono">{formatCurrency(r.valor, "BRL")}</td>
                  <td className="p-3">
                    <Badge className={cn("border", b.cls)}>{b.label}</Badge>
                  </td>
                  <td className="p-3 text-right">
                    {r.status === "em_aberto" && r.fat_status === "emitido" && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setBaixando(r)}
                          disabled={pending}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Baixar
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelandoFat(r)}
                          disabled={pending}
                          title="Cancelar NF"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-california-red hover:text-california-red disabled:opacity-50"
                        >
                          <Ban className="h-3 w-3" />
                          Cancelar NF
                        </button>
                      </div>
                    )}
                    {r.status === "pago" && (
                      <button
                        type="button"
                        onClick={() => {
                          setEstornando(r);
                          setMotivoEstorno("");
                        }}
                        disabled={pending}
                        className="inline-flex items-center gap-1 rounded-md border border-california-red/30 px-2 py-1 text-[11px] text-california-red hover:bg-california-red hover:text-white disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Estornar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {baixando && (
        <BaixaAvulsaDialog
          open
          onOpenChange={(o) => {
            if (!o) setBaixando(null);
          }}
          descricao={`NF ${baixando.fat_numero_nf}/${baixando.fat_serie} — parcela ${baixando.numero_parcela}`}
          valor={baixando.valor}
          empresaId={baixando.empresa_id}
          dataPrevista={baixando.data_vencimento}
          contas={contas}
          tipoLabel="Título"
          pending={pending}
          onConfirm={(payload) => {
            const alvo = baixando;
            if (!alvo) return;
            startTransition(async () => {
              const res = await darBaixaTitulo({
                titulo_id: alvo.id,
                pago_em: payload.pago_em,
                conta_bancaria_id: payload.conta_bancaria_id,
              });
              if (!res.ok) {
                setErro(res.message);
              } else {
                setBaixando(null);
                router.refresh();
              }
            });
          }}
        />
      )}

      <ConfirmDialog
        open={estornando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEstornando(null);
            setMotivoEstorno("");
          }
        }}
        title={estornando ? `Estornar baixa da parcela ${estornando.numero_parcela}?` : ""}
        description={
          <div className="space-y-2">
            <p>Vai criar um lançamento reverso e o título volta para em aberto.</p>
            <div>
              <label className="text-xs font-medium">Motivo * (mín. 10 caracteres)</label>
              <textarea
                value={motivoEstorno}
                onChange={(e) => setMotivoEstorno(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {motivoEstorno.trim().length}/500 caracteres
              </p>
            </div>
          </div>
        }
        confirmLabel="Confirmar estorno"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={() => {
          const alvo = estornando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await estornarBaixaTitulo({ titulo_id: alvo.id, motivo: motivoEstorno });
            if (!res.ok) {
              setErro(res.message);
            } else {
              setEstornando(null);
              setMotivoEstorno("");
              router.refresh();
            }
          });
        }}
      />

      {cancelandoFat && (
        <CancelarFaturamentoModal
          faturamentoId={cancelandoFat.faturamento_id}
          numeroNf={cancelandoFat.fat_numero_nf}
          onClose={() => setCancelandoFat(null)}
          onDone={() => {
            setCancelandoFat(null);
            router.refresh();
          }}
          onErr={(msg) => setErro(msg)}
        />
      )}
    </div>
  );
}
