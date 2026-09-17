"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Plus, AlertCircle, Pencil } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import type { ColaboradorSalario } from "@/lib/types";
import {
  registrarMudancaSalarial,
  corrigirSalarioAtual,
} from "./actions-salario";

export function CardSalarios({
  colaboradorId,
  salarios,
  isAdmin,
}: {
  colaboradorId: string;
  salarios: ColaboradorSalario[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [openMudanca, setOpenMudanca] = React.useState(false);
  const [openCorrigir, setOpenCorrigir] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [dataMudanca, setDataMudanca] = React.useState(
    new Date().toISOString().slice(0, 10),
  );

  const vigente = salarios.find((s) => s.data_fim === null) ?? null;
  const historico = salarios.filter((s) => s.data_fim !== null);

  function handleMudanca(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("data_inicio", dataMudanca);

    startTransition(async () => {
      const res = await registrarMudancaSalarial(colaboradorId, formData);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpenMudanca(false);
      router.refresh();
    });
  }

  function handleCorrigir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const valorRaw = (e.currentTarget.elements.namedItem("valor") as HTMLInputElement)
      ?.value ?? "";

    startTransition(async () => {
      const res = await corrigirSalarioAtual(colaboradorId, valorRaw);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpenCorrigir(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <DollarSign className="h-4 w-4 text-california-red" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Salário</h2>
            <p className="text-xs text-muted-foreground">
              Cada linha é uma mudança. Histórico completo preservado.
            </p>
          </div>
        </div>

        <Dialog open={openMudanca} onOpenChange={setOpenMudanca}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Registrar mudança
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar mudança salarial</DialogTitle>
              <DialogDescription>
                Fecha o salário vigente e abre uma nova linha com o valor novo.
                Não sobrescreve o histórico anterior.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleMudanca} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="valor">Novo valor mensal (R$)</Label>
                <Input
                  id="valor"
                  name="valor"
                  required
                  inputMode="decimal"
                  placeholder="3000,00"
                />
              </div>

              <div className="space-y-2">
                <Label>Data da mudança</Label>
                <DatePicker
                  name="data_inicio_visual"
                  defaultValue={dataMudanca}
                  onDateChange={(d) =>
                    setDataMudanca(d ? d.toISOString().slice(0, 10) : "")
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="motivo">
                  Motivo{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </Label>
                <Input
                  id="motivo"
                  name="motivo"
                  maxLength={500}
                  placeholder="Ex.: promoção, dissídio, reclassificação"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setOpenMudanca(false)}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
                >
                  {pending ? "Salvando..." : "Registrar"}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-5">
        {!vigente && historico.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum salário registrado ainda.
          </p>
        ) : (
          <ol className="relative space-y-2">
            {vigente && (
              <li className="rounded-xl border-2 border-california-red/40 bg-california-red/5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-california-red px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      Vigente
                    </span>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                      {formatarMoeda(vigente.valor)}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Desde {formatarData(vigente.data_inicio)}
                      {vigente.motivo ? ` · ${vigente.motivo}` : ""}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setOpenCorrigir(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/70 hover:text-foreground transition-colors"
                      title="Corrigir digitação (não gera histórico — apenas admin)"
                    >
                      <Pencil className="h-3 w-3" />
                      Corrigir
                    </button>
                  )}
                </div>
              </li>
            )}

            {historico.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-border bg-muted/20 px-4 py-2.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-semibold tabular-nums text-foreground">
                    {formatarMoeda(s.valor)}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatarData(s.data_inicio)} →{" "}
                    {s.data_fim ? formatarData(s.data_fim) : "vigente"}
                  </span>
                </div>
                {s.motivo && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.motivo}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Modal de correção (só admin) */}
      {isAdmin && (
        <Dialog open={openCorrigir} onOpenChange={setOpenCorrigir}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Corrigir salário vigente</DialogTitle>
              <DialogDescription>
                Sobrescreve o valor da linha vigente sem gerar nova entrada de
                histórico. Use para erro de digitação. A correção é auditada.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCorrigir} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="valor">Novo valor mensal (R$)</Label>
                <Input
                  id="valor"
                  name="valor"
                  required
                  inputMode="decimal"
                  defaultValue={vigente ? formatarInputMoeda(vigente.valor) : ""}
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setOpenCorrigir(false)}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
                >
                  {pending ? "Salvando..." : "Corrigir"}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor: string | number): string {
  const n = typeof valor === "string" ? Number(valor) : valor;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function formatarInputMoeda(valor: string): string {
  const n = Number(valor);
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
