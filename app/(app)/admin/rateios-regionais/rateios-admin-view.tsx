"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus, AlertCircle, Trash2, Copy } from "lucide-react";
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

export type EmpresaRateios = {
  empresa_id: string;
  nome_fantasia: string;
  regionais: { id: string; nome: string }[];
  /** ano → regional_id → percentual */
  rateioPorAno: Record<number, Record<string, number>>;
};

type EditKey = { empresa_id: string; ano: number } | null;

export function RateiosAdminView({
  empresas,
  anosDisponiveis,
  anoInicial,
}: {
  empresas: EmpresaRateios[];
  anosDisponiveis: number[];
  anoInicial: number;
}) {
  const router = useRouter();
  const [ano, setAno] = React.useState<number>(anoInicial);
  const [editando, setEditando] = React.useState<EditKey>(null);
  const [copiandoParaEmpresa, setCopiandoParaEmpresa] = React.useState<
    string | null
  >(null);

  const anoAtual = new Date().getFullYear();
  const soLeitura = ano < anoAtual;

  return (
    <>
      <div className="flex items-center gap-3">
        <Label htmlFor="ano-filtro" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ano
        </Label>
        <Select
          value={String(ano)}
          onValueChange={(v) => setAno(Number(v))}
        >
          <SelectTrigger id="ano-filtro" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anosDisponiveis.map((a) => (
              <SelectItem key={a} value={String(a)}>
                {a}
                {a === anoAtual ? " · atual" : a < anoAtual ? " · histórico" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {soLeitura && (
          <span className="text-xs text-muted-foreground">
            Anos anteriores ao atual são só leitura (protege folhas antigas).
          </span>
        )}
      </div>

      <div className="space-y-6">
        {empresas.map((e) => {
          const rateio = e.rateioPorAno[ano] ?? {};
          const temRateio = Object.keys(rateio).length > 0;
          const soma = Object.values(rateio).reduce((acc, v) => acc + v, 0);
          const somaOk = Math.abs(soma - 100) < 0.01;

          return (
            <div
              key={e.empresa_id}
              className="rounded-2xl border border-border bg-card p-6 shadow-soft"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{e.nome_fantasia}</h2>
                  <p className="text-xs text-muted-foreground">
                    {e.regionais.length}{" "}
                    {e.regionais.length === 1 ? "regional" : "regionais"} · rateio
                    de {ano}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!temRateio && !soLeitura && (
                    <button
                      type="button"
                      onClick={() => setCopiandoParaEmpresa(e.empresa_id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:border-california-red/30 hover:text-california-red transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copiar de outro ano
                    </button>
                  )}
                  {!soLeitura && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditando({ empresa_id: e.empresa_id, ano })
                      }
                      className="inline-flex items-center gap-1.5 rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red/90 transition-colors"
                    >
                      {temRateio ? (
                        <>
                          <PenLine className="h-3.5 w-3.5" />
                          Editar
                        </>
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" />
                          Configurar
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      {e.regionais.map((r) => (
                        <th
                          key={r.id}
                          className="px-4 py-2.5 text-center font-medium text-muted-foreground"
                        >
                          {r.nome}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {e.regionais.map((r) => {
                        const pct = rateio[r.id];
                        return (
                          <td
                            key={r.id}
                            className={`px-4 py-3 text-center tabular-nums ${
                              pct === undefined
                                ? "text-muted-foreground"
                                : "font-semibold text-foreground"
                            }`}
                          >
                            {pct === undefined
                              ? "—"
                              : `${pct.toFixed(2).replace(".", ",")}%`}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs">
                {temRateio ? (
                  <>
                    <span className="text-muted-foreground">
                      Regionais em &quot;—&quot; ficam com 0% no rateio deste
                      ano.
                    </span>
                    <span
                      className={`font-semibold ${
                        somaOk ? "text-emerald-600" : "text-california-red"
                      }`}
                    >
                      Soma: {soma.toFixed(2).replace(".", ",")}%
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Sem rateio em {ano} — colaboradores desta empresa não podem
                    usar &quot;Todas as regionais&quot;.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editando && (
        <EditarRateioDialog
          empresa={
            empresas.find((e) => e.empresa_id === editando.empresa_id)!
          }
          ano={editando.ano}
          onDone={() => {
            setEditando(null);
            router.refresh();
          }}
          onCancel={() => setEditando(null)}
        />
      )}

      {copiandoParaEmpresa && (
        <CopiarAnoDialog
          empresa={
            empresas.find((e) => e.empresa_id === copiandoParaEmpresa)!
          }
          anoDestino={ano}
          onDone={() => {
            setCopiandoParaEmpresa(null);
            router.refresh();
          }}
          onCancel={() => setCopiandoParaEmpresa(null)}
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
  empresa: EmpresaRateios;
  ano: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const inicial = empresa.rateioPorAno[ano] ?? {};
  const [linhas, setLinhas] = React.useState<
    { regional_id: string; percentual: string }[]
  >(() => {
    const entries = Object.entries(inicial);
    if (entries.length > 0) {
      return entries.map(([regional_id, pct]) => ({
        regional_id,
        percentual: pct.toFixed(2).replace(".", ","),
      }));
    }
    return [{ regional_id: "", percentual: "" }];
  });
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const soma = linhas.reduce(
    (acc, l) => acc + (Number(l.percentual.replace(",", ".")) || 0),
    0,
  );
  const somaOk = Math.abs(soma - 100) < 0.01;

  function adicionar() {
    setLinhas((prev) => [...prev, { regional_id: "", percentual: "" }]);
  }
  function remover(i: number) {
    setLinhas((prev) => prev.filter((_, idx) => idx !== i));
  }
  function atualizar(
    i: number,
    patch: Partial<{ regional_id: string; percentual: string }>,
  ) {
    setLinhas((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  const regionaisUsadas = new Set(
    linhas.map((l) => l.regional_id).filter(Boolean),
  );

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
    if (
      linhasNum.some(
        (l) => !Number.isFinite(l.percentual) || l.percentual <= 0,
      )
    ) {
      setError("Todo percentual precisa ser um número maior que 0.");
      return;
    }
    if (!somaOk) {
      setError(
        `A soma dos percentuais precisa dar 100 (atual: ${soma.toFixed(2)}).`,
      );
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
            fora da lista têm 0% no ano.
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

function CopiarAnoDialog({
  empresa,
  anoDestino,
  onDone,
  onCancel,
}: {
  empresa: EmpresaRateios;
  anoDestino: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const anosOrigem = Object.keys(empresa.rateioPorAno)
    .map(Number)
    .filter((a) => a !== anoDestino)
    .sort((a, b) => b - a);

  const [anoOrigem, setAnoOrigem] = React.useState<string>(
    anosOrigem[0] ? String(anosOrigem[0]) : "",
  );
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!anoOrigem) {
      setError("Escolha um ano de origem.");
      return;
    }

    startTransition(async () => {
      const res = await copiarRateioParaAno({
        empresa_id: empresa.empresa_id,
        ano_origem: Number(anoOrigem),
        ano_destino: anoDestino,
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
          <DialogTitle>
            Copiar rateio · {empresa.nome_fantasia}
          </DialogTitle>
          <DialogDescription>
            Cria o rateio de {anoDestino} copiando os percentuais de outro ano
            existente. Você pode editar depois.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {anosOrigem.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta empresa ainda não tem nenhum rateio configurado em anos
              anteriores. Use &quot;Configurar&quot; pra criar do zero.
            </p>
          ) : (
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
              disabled={pending || anosOrigem.length === 0}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Copiando..." : `Copiar para ${anoDestino}`}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
