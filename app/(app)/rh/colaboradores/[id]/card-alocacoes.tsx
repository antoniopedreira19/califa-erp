"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, PenLine, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "@/components/ui/dialog";
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
import { alterarAlocacao } from "./actions-alocacao";

export type AlocacaoRow = ColaboradorAlocacao & {
  empresa: Pick<Empresa, "id" | "nome_fantasia">;
  regional: { id: string; nome: string } | null;
};

/**
 * Rateio da empresa+ano vigente, apenas as regionais com % > 0.
 * A page passa isso já filtrado pelo ano corrente pra economizar payload.
 */
export type RateioEmpresa = {
  empresa_id: string;
  regionais: Array<{ regional_id: string; regional_nome: string; percentual: number }>;
};

export function CardAlocacoes({
  colaboradorId,
  alocacoes,
  empresas,
  regionais,
  rateiosDoAno,
  anoRateio,
}: {
  colaboradorId: string;
  alocacoes: AlocacaoRow[];
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  rateiosDoAno: RateioEmpresa[];
  anoRateio: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [dataMudanca, setDataMudanca] = React.useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [empresaId, setEmpresaId] = React.useState<string>("");
  const [usaRateio, setUsaRateio] = React.useState<boolean>(false);
  const [regionalId, setRegionalId] = React.useState<string>("");

  const vigente = alocacoes.find((a) => a.data_fim === null) ?? null;
  const historico = alocacoes.filter((a) => a.data_fim !== null);

  const rateioPorEmpresa = React.useMemo(() => {
    const m = new Map<string, RateioEmpresa["regionais"]>();
    for (const r of rateiosDoAno) m.set(r.empresa_id, r.regionais);
    return m;
  }, [rateiosDoAno]);

  const empresaTemRateio = empresaId ? rateioPorEmpresa.has(empresaId) : false;

  // Ao abrir, pré-preenche com a vigente atual (ou vazio se não tiver).
  React.useEffect(() => {
    if (!open) return;
    if (vigente) {
      setEmpresaId(vigente.empresa_id);
      setUsaRateio(vigente.usa_rateio_empresa);
      setRegionalId(vigente.regional_id ?? "");
    } else {
      setEmpresaId("");
      setUsaRateio(false);
      setRegionalId("");
    }
    setError(null);
    setDataMudanca(new Date().toISOString().slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Se empresa perde rateio quando muda a seleção, força toggle off.
  React.useEffect(() => {
    if (!empresaTemRateio && usaRateio) setUsaRateio(false);
    if (usaRateio) setRegionalId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, empresaTemRateio]);

  const regionaisDaEmpresa = regionais
    .filter((r) => r.empresa_id === empresaId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!empresaId) {
      setError("Selecione uma empresa.");
      return;
    }
    if (!usaRateio && !regionalId) {
      setError("Selecione uma regional.");
      return;
    }
    if (!dataMudanca) {
      setError("Informe a data de mudança.");
      return;
    }

    startTransition(async () => {
      const res = await alterarAlocacao(colaboradorId, {
        empresa_id: empresaId,
        usa_rateio_empresa: usaRateio,
        regional_id: usaRateio ? null : regionalId,
        data_mudanca: dataMudanca,
      });
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
            <h2 className="text-lg font-semibold">Alocação</h2>
            <p className="text-xs text-muted-foreground">
              Vigente por vez. Regional específica ou todas as regionais da
              empresa via rateio anual.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red/90 transition-colors"
            >
              <PenLine className="h-3.5 w-3.5" />
              Alterar
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Alterar alocação</DialogTitle>
              <DialogDescription>
                Fecha a vigente no dia anterior à data de mudança e abre esta
                nova.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Data da mudança</Label>
                <DatePicker
                  name="data_mudanca_visual"
                  defaultValue={dataMudanca}
                  onDateChange={(d) =>
                    setDataMudanca(d ? d.toISOString().slice(0, 10) : "")
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Empresa</Label>
                <Select value={empresaId} onValueChange={setEmpresaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome_fantasia}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {empresaTemRateio && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Todas as regionais</p>
                    <p className="text-xs text-muted-foreground">
                      Usa o rateio anual configurado para {anoRateio}.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={usaRateio}
                    onClick={() => setUsaRateio((v) => !v)}
                    className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                      usaRateio ? "bg-california-red" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform ${
                        usaRateio ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              )}

              {!usaRateio && empresaId && (
                <div className="space-y-2">
                  <Label>Regional</Label>
                  <Select value={regionalId} onValueChange={setRegionalId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a regional" />
                    </SelectTrigger>
                    <SelectContent>
                      {regionaisDaEmpresa.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {usaRateio && empresaTemRateio && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Preview do rateio {anoRateio}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-emerald-900">
                    {rateioPorEmpresa.get(empresaId)!.map((r) => (
                      <li
                        key={r.regional_id}
                        className="flex items-center justify-between"
                      >
                        <span>{r.regional_nome}</span>
                        <span className="tabular-nums font-semibold">
                          {r.percentual.toFixed(2).replace(".", ",")}%
                        </span>
                      </li>
                    ))}
                  </ul>
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
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
                >
                  {pending ? "Salvando..." : "Confirmar mudança"}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Vigente em destaque + histórico simples */}
      <div className="mt-5">
        {alocacoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma alocação registrada ainda.
          </p>
        ) : (
          <ol className="space-y-2">
            {vigente && (
              <li className="rounded-xl border-2 border-california-red/40 bg-california-red/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-california-red px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    Vigente
                  </span>
                  <span className="text-xs text-muted-foreground">
                    desde {formatarData(vigente.data_inicio)}
                  </span>
                </div>
                <div className="mt-2 rounded-lg bg-white/60 px-3 py-2 text-sm">
                  <span className="font-medium">
                    {vigente.empresa.nome_fantasia}
                  </span>
                  {vigente.usa_rateio_empresa ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Todas as regionais (rateio {anoRateio})
                    </span>
                  ) : (
                    <span className="ml-2 text-muted-foreground">
                      · {vigente.regional?.nome ?? "—"}
                    </span>
                  )}
                </div>
              </li>
            )}

            {historico
              .sort((a, b) => {
                const p = (b.data_inicio ?? "").localeCompare(a.data_inicio ?? "");
                if (p !== 0) return p;
                return (b.created_at ?? "").localeCompare(a.created_at ?? "");
              })
              .map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-border bg-muted/20 px-4 py-2.5"
                >
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatarData(a.data_inicio)} →{" "}
                    {a.data_fim ? formatarData(a.data_fim) : "vigente"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.empresa.nome_fantasia}
                    {a.usa_rateio_empresa
                      ? " · Todas as regionais (rateio)"
                      : a.regional
                        ? ` · ${a.regional.nome}`
                        : ""}
                  </p>
                </li>
              ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}
