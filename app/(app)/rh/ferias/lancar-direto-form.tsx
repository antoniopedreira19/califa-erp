"use client";

import * as React from "react";
import { AlertCircle, History, Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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

// Explicação por tipo, mostrada abaixo do select. Mantém o form compacto
// mas tira dúvida de qual tipo escolher sem precisar sair da tela.
const HELPER_TIPO: Record<FeriasLancamentoTipo, string> = {
  usufruto: "Dias de folga que o colaborador vai tirar. Desconta do saldo do período.",
  abono_combinado:
    "CLT: vende até 10 dias combinados com o bloco de férias. Desconta do saldo.",
  abono_avulso:
    "PJ: venda de dias sem tirar folga. Não desconta de nenhum período (lançamento separado).",
  abono_excepcional:
    "Acordo: venda de mais de 10 dias. Requer alçada administrativa.",
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
  const [modoRetroativo, setModoRetroativo] = React.useState(false);
  const [dataInicio, setDataInicio] = React.useState("");
  const [dataFim, setDataFim] = React.useState("");
  const [observacao, setObservacao] = React.useState("");

  // Períodos exibidos no select:
  // - Default: só os acionáveis HOJE (apto/em_alerta/vencido) com saldo > 0.
  // - Modo retroativo: inclui regularizados (lançamento histórico).
  const periodosExibidos = React.useMemo(() => {
    const ativos = periodosComSaldo.filter(
      (p) =>
        (p.status === "apto" ||
          p.status === "em_alerta" ||
          p.status === "vencido") &&
        p.saldo > 0,
    );
    if (!modoRetroativo) return ativos;
    const regularizados = periodosComSaldo.filter(
      (p) => p.status === "regularizado",
    );
    return [...ativos, ...regularizados];
  }, [periodosComSaldo, modoRetroativo]);

  const [periodoId, setPeriodoId] = React.useState<string>(
    periodosExibidos[0]?.id ?? "",
  );

  // Se mudou a lista de períodos exibidos e o selecionado sumiu, pega o primeiro.
  React.useEffect(() => {
    if (!periodoId || !periodosExibidos.some((p) => p.id === periodoId)) {
      setPeriodoId(periodosExibidos[0]?.id ?? "");
    }
  }, [periodosExibidos, periodoId]);

  const diasSelecionados = React.useMemo(() => {
    if (!dataInicio || !dataFim) return 0;
    const ini = new Date(dataInicio + "T00:00:00");
    const fim = new Date(dataFim + "T00:00:00");
    const diff = Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
    return diff > 0 ? diff : 0;
  }, [dataInicio, dataFim]);

  const periodoSelecionado = periodosExibidos.find((p) => p.id === periodoId);

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
  const exigePeriodo = tipo !== "abono_avulso";
  const semPeriodosDisponiveis = exigePeriodo && periodosExibidos.length === 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-california-red/30 bg-california-red/5 p-5 space-y-4"
    >
      <div>
        <h4 className="text-sm font-semibold">Lançar Férias</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Entra como <strong>aprovado</strong>, pulando o pedido do
          colaborador. Use para férias já combinadas fora do sistema ou
          registros retroativos.
        </p>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {/* Tipo */}
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
              Abono combinado (CLT)
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
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{HELPER_TIPO[tipo]}</span>
        </p>
      </div>

      {/* Período aquisitivo */}
      {exigePeriodo && (
        <div className="space-y-2">
          <Label htmlFor="periodo-direto">Período aquisitivo</Label>

          {semPeriodosDisponiveis ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Nenhum período com saldo disponível. Marque{" "}
              <strong>&ldquo;Lançar em período anterior&rdquo;</strong> abaixo
              para registrar retroativamente num período regularizado.
            </div>
          ) : (
            <Select value={periodoId} onValueChange={setPeriodoId}>
              <SelectTrigger id="periodo-direto">
                <SelectValue placeholder="Escolha o período" />
              </SelectTrigger>
              <SelectContent>
                {periodosExibidos.map((p) => {
                  const rotulo = `${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`;
                  const sufixoStatus =
                    p.status === "regularizado"
                      ? " · regularizado"
                      : p.status === "vencido"
                        ? " · vencido"
                        : p.status === "em_alerta"
                          ? " · em alerta"
                          : "";
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      {rotulo} · {p.saldo}/{p.dias_direito} dias disponíveis
                      {sufixoStatus}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}

          <label className="flex items-start gap-2 text-sm cursor-pointer select-none pt-1">
            <Checkbox
              id="modo-retroativo"
              checked={modoRetroativo}
              onCheckedChange={(c) => setModoRetroativo(c === true)}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                Lançar em período anterior
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Permite escolher períodos já regularizados — útil para
                regularizar histórico que faltou importar.
              </span>
            </span>
          </label>

          {modoRetroativo && periodoSelecionado?.status === "regularizado" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              Lançamento retroativo em período já regularizado. Confirme com o
              RH responsável antes de salvar.
            </div>
          )}
        </div>
      )}

      {/* Datas */}
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

      {/* Observação */}
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

      {/* Preview do lançamento */}
      {diasSelecionados > 0 && (
        <div className="rounded-lg bg-white border border-border p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Resumo
          </p>
          <p>
            <strong>{diasSelecionados}</strong>{" "}
            {diasSelecionados === 1 ? "dia" : "dias"}
            {exigePeriodo && periodoSelecionado && (
              <>
                {" "}
                no período{" "}
                <strong>
                  {periodoSelecionado.aquisitivo_inicio.slice(0, 4)}/
                  {periodoSelecionado.aquisitivo_fim.slice(0, 4)}
                </strong>
                {" · "}
                saldo após: {Math.max(periodoSelecionado.saldo - diasSelecionados, 0)}
                /{periodoSelecionado.dias_direito}
              </>
            )}
            {!exigePeriodo && " (sem período — abono avulso)"}
          </p>
        </div>
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
            (exigePeriodo && !periodoId)
          }
          className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Lançando..." : "Lançar"}
        </button>
      </div>
    </form>
  );
}
