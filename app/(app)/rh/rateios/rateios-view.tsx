"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus, AlertCircle, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { salvarRateioAno, copiarRateioParaAno } from "./actions";

export type EmpresaRateio = {
  empresa_id: string;
  nome_fantasia: string;
  regionais: { id: string; nome: string }[];
  anos: {
    ano: number;
    linhas: { regional_id: string; percentual: number }[];
  }[];
};

type EditKey = { empresa_id: string; ano: number } | null;

export function RateiosView({ empresas }: { empresas: EmpresaRateio[] }) {
  const router = useRouter();
  const [editando, setEditando] = React.useState<EditKey>(null);
  const [criando, setCriando] = React.useState<string | null>(null);

  return (
    <>
      <div className="space-y-6">
        {empresas.map((e) => (
          <div
            key={e.empresa_id}
            className="rounded-2xl border border-border bg-card p-6 shadow-soft"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{e.nome_fantasia}</h2>
                <p className="text-xs text-muted-foreground">
                  {e.regionais.length} regionais · {e.anos.length}{" "}
                  {e.anos.length === 1 ? "ano configurado" : "anos configurados"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCriando(e.empresa_id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:border-california-red/30 hover:text-california-red transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar ano
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {e.anos.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhum rateio configurado ainda para esta empresa. Colaboradores
                  aqui não podem usar &quot;Todas as regionais&quot;.
                </p>
              ) : (
                e.anos.map((ano) => (
                  <div
                    key={ano.ano}
                    className="rounded-xl border border-border bg-background p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{ano.ano}</h3>
                      <button
                        type="button"
                        onClick={() =>
                          setEditando({
                            empresa_id: e.empresa_id,
                            ano: ano.ano,
                          })
                        }
                        className="inline-flex items-center gap-1 text-xs font-semibold text-california-red hover:underline"
                      >
                        <PenLine className="h-3 w-3" />
                        Editar
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
                      {ano.linhas
                        .slice()
                        .sort((a, b) => {
                          const na =
                            e.regionais.find((r) => r.id === a.regional_id)
                              ?.nome ?? "";
                          const nb =
                            e.regionais.find((r) => r.id === b.regional_id)
                              ?.nome ?? "";
                          return na.localeCompare(nb, "pt-BR");
                        })
                        .map((l) => {
                          const nome =
                            e.regionais.find((r) => r.id === l.regional_id)
                              ?.nome ?? "?";
                          return (
                            <div
                              key={l.regional_id}
                              className="flex items-center justify-between text-xs"
                            >
                              <span>{nome}</span>
                              <span className="tabular-nums font-semibold">
                                {l.percentual.toFixed(2).replace(".", ",")}%
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <EditarRateioDialog
          empresa={empresas.find((e) => e.empresa_id === editando.empresa_id)!}
          ano={editando.ano}
          onDone={() => {
            setEditando(null);
            router.refresh();
          }}
          onCancel={() => setEditando(null)}
        />
      )}

      {criando && (
        <CriarAnoDialog
          empresa={empresas.find((e) => e.empresa_id === criando)!}
          onDone={() => {
            setCriando(null);
            router.refresh();
          }}
          onCancel={() => setCriando(null)}
        />
      )}
    </>
  );
}

function EditarRateioDialog({
  empresa,
  ano,
  onDone,
  onCancel,
}: {
  empresa: EmpresaRateio;
  ano: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const linhasIniciais = empresa.anos.find((a) => a.ano === ano)?.linhas ?? [];
  const [linhas, setLinhas] = React.useState<
    { regional_id: string; percentual: string }[]
  >(() =>
    linhasIniciais.map((l) => ({
      regional_id: l.regional_id,
      percentual: l.percentual.toFixed(2).replace(".", ","),
    })),
  );
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const soma = linhas.reduce(
    (acc, l) => acc + (Number(l.percentual.replace(",", ".")) || 0),
    0,
  );
  const somaOk = Math.abs(soma - 100) < 0.01;

  function adicionar() {
    setLinhas((prev) => [
      ...prev,
      { regional_id: "", percentual: "" },
    ]);
  }
  function remover(i: number) {
    setLinhas((prev) => prev.filter((_, idx) => idx !== i));
  }
  function atualizar(i: number, patch: Partial<{ regional_id: string; percentual: string }>) {
    setLinhas((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  const regionaisUsadas = new Set(linhas.map((l) => l.regional_id).filter(Boolean));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const linhasNum = linhas
      .filter((l) => l.regional_id)
      .map((l) => ({
        regional_id: l.regional_id,
        percentual: Number(l.percentual.replace(",", ".")),
      }));

    if (linhasNum.length === 0) {
      setError("Informe pelo menos uma regional.");
      return;
    }
    if (linhasNum.some((l) => !Number.isFinite(l.percentual) || l.percentual <= 0)) {
      setError("Todo percentual precisa ser um número maior que 0.");
      return;
    }
    if (!somaOk) {
      setError(`A soma dos percentuais precisa dar 100 (atual: ${soma.toFixed(2)}).`);
      return;
    }

    startTransition(async () => {
      const res = await salvarRateioAno({
        empresa_id: empresa.empresa_id,
        ano,
        linhas: linhasNum,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Rateio {empresa.nome_fantasia} · {ano}
          </DialogTitle>
          <DialogDescription>
            Ajuste os percentuais por regional. Soma precisa dar 100. Regionais
            fora da lista têm 0% no ano (não entram no rateio).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            {linhas.map((l, i) => {
              const opcoes = empresa.regionais.filter(
                (r) => r.id === l.regional_id || !regionaisUsadas.has(r.id),
              );
              return (
                <div
                  key={i}
                  className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_140px_auto]"
                >
                  <Select
                    value={l.regional_id}
                    onValueChange={(v) => atualizar(i, { regional_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Regional" />
                    </SelectTrigger>
                    <SelectContent>
                      {opcoes.map((r) => (
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
                        atualizar(i, { percentual: e.target.value })
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
                    onClick={() => remover(i)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-california-red transition-colors"
                    title="Remover"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={adicionar}
              className="text-xs font-medium text-california-red hover:underline"
            >
              + Adicionar regional
            </button>
            <p
              className={`text-xs font-medium ${
                somaOk ? "text-emerald-600" : "text-california-red"
              }`}
            >
              Soma: {soma.toFixed(2).replace(".", ",")}%
            </p>
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
              onClick={onCancel}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !somaOk}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : "Salvar rateio"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CriarAnoDialog({
  empresa,
  onDone,
  onCancel,
}: {
  empresa: EmpresaRateio;
  onDone: () => void;
  onCancel: () => void;
}) {
  const anoAtual = new Date().getFullYear();
  const anosDisponiveis = React.useMemo(() => {
    const anosExistentes = new Set(empresa.anos.map((a) => a.ano));
    const opts: number[] = [];
    for (let a = anoAtual; a <= anoAtual + 3; a += 1) {
      if (!anosExistentes.has(a)) opts.push(a);
    }
    return opts;
  }, [anoAtual, empresa.anos]);
  const anosOrigem = empresa.anos.map((a) => a.ano);

  const [anoDestino, setAnoDestino] = React.useState<string>(
    anosDisponiveis[0] ? String(anosDisponiveis[0]) : "",
  );
  const [anoOrigem, setAnoOrigem] = React.useState<string>(
    anosOrigem[0] ? String(anosOrigem[0]) : "",
  );
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!anoDestino || !anoOrigem) {
      setError("Escolha ano origem e destino.");
      return;
    }

    startTransition(async () => {
      const res = await copiarRateioParaAno({
        empresa_id: empresa.empresa_id,
        ano_origem: Number(anoOrigem),
        ano_destino: Number(anoDestino),
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar ano · {empresa.nome_fantasia}</DialogTitle>
          <DialogDescription>
            Copia o rateio de um ano existente pra abrir o novo. Você ajusta os
            percentuais na sequência.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {anosOrigem.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta empresa ainda não tem nenhum rateio configurado. Peça pro RH
              criar o primeiro via SQL ou aguarde a próxima entrega.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Copiar de</Label>
                <Select value={anoOrigem} onValueChange={setAnoOrigem}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {anosOrigem.map((a) => (
                      <SelectItem key={a} value={String(a)}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Novo ano</Label>
                <Select value={anoDestino} onValueChange={setAnoDestino}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {anosDisponiveis.map((a) => (
                      <SelectItem key={a} value={String(a)}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {anosDisponiveis.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Todos os anos até {anoAtual + 3} já estão configurados.
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                pending ||
                anosOrigem.length === 0 ||
                anosDisponiveis.length === 0 ||
                !anoDestino
              }
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Criando..." : "Criar rateio do ano"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
