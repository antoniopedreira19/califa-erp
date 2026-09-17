"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus, Trash2, AlertCircle } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ColaboradorAlocacao, Empresa } from "@/lib/types";
import { substituirAlocacoes } from "./actions-alocacao";

type AlocacaoRow = ColaboradorAlocacao & {
  empresa: Pick<Empresa, "id" | "nome_fantasia">;
  regional: { id: string; nome: string };
};

type LinhaEdit = {
  key: string;
  empresa_id: string;
  regional_id: string;
  percentual: string;
};

export function CardAlocacoes({
  colaboradorId,
  alocacoes,
  empresas,
  regionais,
}: {
  colaboradorId: string;
  alocacoes: AlocacaoRow[];
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [dataMudanca, setDataMudanca] = React.useState<string>(
    new Date().toISOString().slice(0, 10),
  );

  const vigentes = alocacoes.filter((a) => a.data_fim === null);
  const historico = alocacoes.filter((a) => a.data_fim !== null);

  const [linhas, setLinhas] = React.useState<LinhaEdit[]>([]);

  // Ao abrir o modal, pré-preenche com as vigentes atuais
  React.useEffect(() => {
    if (!open) return;
    if (vigentes.length > 0) {
      setLinhas(
        vigentes.map((v, i) => ({
          key: `${v.id}-${i}`,
          empresa_id: v.empresa_id,
          regional_id: v.regional_id,
          percentual: v.percentual,
        })),
      );
    } else {
      setLinhas([
        {
          key: "new-1",
          empresa_id: "",
          regional_id: "",
          percentual: "100.00",
        },
      ]);
    }
    setError(null);
    setDataMudanca(new Date().toISOString().slice(0, 10));
    // vigentes é lido só na abertura pra montar o estado inicial —
    // reabrir com vigentes atualizadas cai aqui de novo. eslint-disable-next-line
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const somaAtual = linhas.reduce(
    (acc, l) => acc + (Number(l.percentual.replace(",", ".")) || 0),
    0,
  );
  const somaOk = Math.abs(somaAtual - 100) < 0.01;

  function atualizarLinha(index: number, patch: Partial<LinhaEdit>) {
    setLinhas((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  function adicionarLinha() {
    setLinhas((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        empresa_id: "",
        regional_id: "",
        percentual: "",
      },
    ]);
  }

  function removerLinha(index: number) {
    setLinhas((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!somaOk) {
      setError(
        `A soma dos percentuais precisa dar 100 (atual: ${somaAtual.toFixed(2)}).`,
      );
      return;
    }
    if (linhas.some((l) => !l.empresa_id || !l.regional_id)) {
      setError("Toda linha precisa ter empresa e regional selecionadas.");
      return;
    }

    startTransition(async () => {
      const res = await substituirAlocacoes(
        colaboradorId,
        linhas.map((l) => ({
          empresa_id: l.empresa_id,
          regional_id: l.regional_id,
          percentual: (
            Math.round(Number(l.percentual.replace(",", ".")) * 100) / 100
          ).toFixed(2),
        })),
        dataMudanca,
      );
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Briefcase className="h-4 w-4 text-california-red" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Alocações</h2>
            <p className="text-xs text-muted-foreground">
              Vigente somando 100% em par (empresa, regional).
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Alterar alocação
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Alterar alocação</DialogTitle>
              <DialogDescription>
                Fecha as vigentes na data de mudança e abre estas novas. A soma
                precisa dar 100%.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Data da mudança</Label>
                <DatePicker
                  name="data_mudanca_visual"
                  defaultValue={dataMudanca}
                  onDateChange={(d) =>
                    setDataMudanca(
                      d ? d.toISOString().slice(0, 10) : "",
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Alocações vigentes a partir da data</Label>
                <div className="space-y-2">
                  {linhas.map((l, i) => {
                    const regionaisDaEmpresa = regionais
                      .filter((r) => r.empresa_id === l.empresa_id)
                      .sort((a, b) =>
                        a.nome.localeCompare(b.nome, "pt-BR"),
                      );
                    return (
                      <div
                        key={l.key}
                        className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_120px_auto]"
                      >
                        <Select
                          value={l.empresa_id}
                          onValueChange={(v) =>
                            atualizarLinha(i, {
                              empresa_id: v,
                              regional_id: "",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Empresa" />
                          </SelectTrigger>
                          <SelectContent>
                            {empresas.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.nome_fantasia}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={l.regional_id}
                          onValueChange={(v) =>
                            atualizarLinha(i, { regional_id: v })
                          }
                          disabled={!l.empresa_id}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Regional" />
                          </SelectTrigger>
                          <SelectContent>
                            {regionaisDaEmpresa.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="relative">
                          <Input
                            value={l.percentual}
                            onChange={(e) =>
                              atualizarLinha(i, { percentual: e.target.value })
                            }
                            placeholder="0,00"
                            className="pr-7"
                            inputMode="decimal"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            %
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removerLinha(i)}
                          disabled={linhas.length === 1}
                          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-california-red transition-colors disabled:opacity-30"
                          title="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={adicionarLinha}
                    className="text-xs font-medium text-california-red hover:underline"
                  >
                    + Adicionar alocação
                  </button>
                  <p
                    className={`text-xs font-medium ${
                      somaOk ? "text-emerald-600" : "text-california-red"
                    }`}
                  >
                    Soma: {somaAtual.toFixed(2)}%
                  </p>
                </div>
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
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending || !somaOk}
                  className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
                >
                  {pending ? "Salvando..." : "Confirmar mudança"}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Vigentes */}
      <div className="mt-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Vigentes
        </p>
        {vigentes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Sem alocação vigente.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {vigentes.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{a.empresa.nome_fantasia}</span>{" "}
                  <span className="text-muted-foreground">
                    · {a.regional.nome}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-california-red">
                  {Number(a.percentual).toFixed(2).replace(".", ",")}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Histórico */}
      {historico.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Histórico
          </p>
          <ul className="mt-2 space-y-1.5">
            {historico.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
              >
                <span>
                  {a.empresa.nome_fantasia} · {a.regional.nome} ·{" "}
                  <span className="tabular-nums">
                    {Number(a.percentual).toFixed(2).replace(".", ",")}%
                  </span>
                </span>
                <span className="tabular-nums">
                  {formatarData(a.data_inicio)} →{" "}
                  {a.data_fim ? formatarData(a.data_fim) : "vigente"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}
