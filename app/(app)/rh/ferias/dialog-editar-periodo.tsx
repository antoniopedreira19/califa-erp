"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FeriasLancamentoTipo } from "@/lib/types";
import { editarPeriodoLancamento } from "./actions";

const SENTINEL_NENHUM = "__nenhum__";

function tipoLabel(t: FeriasLancamentoTipo): string {
  switch (t) {
    case "usufruto":
      return "Férias (usufruto)";
    case "abono_combinado":
      return "Férias + abono";
    case "abono_avulso":
      return "Abono avulso";
    case "abono_excepcional":
      return "Abono excepcional";
  }
}

function calcularDias(ini: string, fim: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return null;
  }
  const ms = Date.parse(fim + "T00:00:00Z") - Date.parse(ini + "T00:00:00Z");
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
}

export function DialogEditarPeriodo({
  aberto,
  lancamentoId,
  dataInicioAtual,
  dataFimAtual,
  periodoIdAtual,
  tipoLancamento,
  aquisitivosDisponiveis,
  onFechar,
}: {
  aberto: boolean;
  lancamentoId: string;
  dataInicioAtual: string;
  dataFimAtual: string;
  periodoIdAtual: string | null;
  tipoLancamento: FeriasLancamentoTipo;
  aquisitivosDisponiveis: Array<{ id: string; rotulo: string; saldo: number }>;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [dataInicio, setDataInicio] = React.useState(dataInicioAtual);
  const [dataFim, setDataFim] = React.useState(dataFimAtual);
  const [periodoId, setPeriodoId] = React.useState<string>(
    periodoIdAtual ?? SENTINEL_NENHUM,
  );
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (aberto) {
      setDataInicio(dataInicioAtual);
      setDataFim(dataFimAtual);
      setPeriodoId(periodoIdAtual ?? SENTINEL_NENHUM);
      setErro(null);
    }
  }, [aberto, dataInicioAtual, dataFimAtual, periodoIdAtual]);

  const diasPreview = calcularDias(dataInicio, dataFim);

  function handleSalvar() {
    setErro(null);
    startTransition(async () => {
      const res = await editarPeriodoLancamento({
        lancamento_id: lancamentoId,
        data_inicio: dataInicio,
        data_fim: dataFim,
        periodo_id: periodoId === SENTINEL_NENHUM ? null : periodoId,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !pending && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar período</DialogTitle>
          <DialogDescription>
            Ajuste as datas e o aquisitivo se o colaborador tiver solicitado
            errado. Pra mudar o tipo, cancele e refaça.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Tipo</Label>
            <p className="text-sm">{tipoLabel(tipoLancamento)}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aquisitivo">Período aquisitivo</Label>
            <Select value={periodoId} onValueChange={setPeriodoId}>
              <SelectTrigger id="aquisitivo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SENTINEL_NENHUM}>
                  Sem aquisitivo (abono avulso)
                </SelectItem>
                {aquisitivosDisponiveis.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.rotulo} · saldo {a.saldo}d
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="data-inicio">Início</Label>
              <Input
                id="data-inicio"
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="data-fim">Fim</Label>
              <Input
                id="data-fim"
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Dias: {diasPreview != null ? diasPreview : "—"}
          </p>

          {erro && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {erro}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onFechar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {pending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
