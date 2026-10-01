"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ColaboradorFeriasPeriodo,
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";
import { lancarDiretoPeloRh } from "./actions";

type PeriodoComSaldo = ColaboradorFeriasPeriodo & { saldo: number };

type Props = {
  colaboradorId: string;
  tipoContratacao: TipoContratacao;
  periodosComSaldo: PeriodoComSaldo[];
  onFechar: () => void;
  onSucesso: () => void;
};

export function LancarDiretoForm({
  colaboradorId,
  tipoContratacao,
  periodosComSaldo,
  onFechar,
  onSucesso,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const [tipo, setTipo] = React.useState<FeriasLancamentoTipo>("usufruto");
  const [periodoId, setPeriodoId] = React.useState<string>(
    periodosComSaldo.find((p) => p.saldo > 0)?.id ?? "",
  );
  const [dataInicio, setDataInicio] = React.useState("");
  const [dataFim, setDataFim] = React.useState("");
  const [observacao, setObservacao] = React.useState("");

  const diasSelecionados = React.useMemo(() => {
    if (!dataInicio || !dataFim) return 0;
    const ini = new Date(dataInicio + "T00:00:00");
    const fim = new Date(dataFim + "T00:00:00");
    const diff = Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
    return diff > 0 ? diff : 0;
  }, [dataInicio, dataFim]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    startTransition(async () => {
      const res = await lancarDiretoPeloRh({
        colaborador_id: colaboradorId,
        periodo_id: tipo === "abono_avulso" ? null : periodoId || null,
        tipo,
        data_inicio: dataInicio,
        data_fim: dataFim,
        observacao: observacao.trim() || null,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onSucesso();
    });
  }

  const permiteAbonoAvulso = tipoContratacao === "pj";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-california-red/30 bg-california-red/5 p-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">Lançar direto</h4>
        <p className="text-xs text-muted-foreground">
          Entra como <strong>aprovado</strong>, sem passar pelo fluxo de
          solicitação do colaborador.
        </p>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="tipo-direto">Tipo</Label>
        <Select
          value={tipo}
          onValueChange={(v) => setTipo(v as FeriasLancamentoTipo)}
        >
          <SelectTrigger id="tipo-direto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="usufruto">Usufruto (dias de folga)</SelectItem>
            <SelectItem value="abono_combinado">
              Abono combinado (CLT clássico)
            </SelectItem>
            {permiteAbonoAvulso && (
              <SelectItem value="abono_avulso">
                Abono avulso (PJ, sem período)
              </SelectItem>
            )}
            <SelectItem value="abono_excepcional">
              Abono excepcional (acordo)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tipo !== "abono_avulso" && (
        <div className="space-y-1.5">
          <Label htmlFor="periodo-direto">Período aquisitivo</Label>
          <Select value={periodoId} onValueChange={setPeriodoId}>
            <SelectTrigger id="periodo-direto">
              <SelectValue placeholder="Escolha o período" />
            </SelectTrigger>
            <SelectContent>
              {periodosComSaldo.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  #{p.numero} · {p.aquisitivo_inicio.slice(0, 4)}/
                  {p.aquisitivo_fim.slice(0, 4)} · {p.saldo}/{p.dias_direito} dias
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="data-inicio-direto">Data de início</Label>
          <DatePicker
            name="_data_inicio_direto"
            id="data-inicio-direto"
            defaultValue={dataInicio}
            onDateChange={(d) =>
              setDataInicio(d ? d.toISOString().slice(0, 10) : "")
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="data-fim-direto">Data de fim</Label>
          <DatePicker
            name="_data_fim_direto"
            id="data-fim-direto"
            defaultValue={dataFim}
            onDateChange={(d) =>
              setDataFim(d ? d.toISOString().slice(0, 10) : "")
            }
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="obs-direto">Observação (opcional)</Label>
        <Textarea
          id="obs-direto"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex: lançamento retroativo pra regularizar histórico."
          rows={2}
          maxLength={500}
        />
      </div>

      {diasSelecionados > 0 && (
        <p className="text-sm text-muted-foreground">
          Total: <strong>{diasSelecionados}</strong>{" "}
          {diasSelecionados === 1 ? "dia" : "dias"}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={
            pending ||
            !dataInicio ||
            !dataFim ||
            diasSelecionados <= 0 ||
            (tipo !== "abono_avulso" && !periodoId)
          }
          className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Lançando..." : "Lançar"}
        </button>
      </div>
    </form>
  );
}
