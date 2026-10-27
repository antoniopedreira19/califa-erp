"use client";

import * as React from "react";
import { AlertCircle, DollarSign, Palmtree, Split } from "lucide-react";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ColaboradorFeriasPeriodo,
  TipoContratacao,
} from "@/lib/types";
import { reconciliarPeriodoSelecionado } from "@/lib/ferias/reconciliar-periodo-selecionado";

export type SolicitarFeriasPayload = {
  tipo: "usufruto" | "abono_avulso" | "abono_combinado";
  periodo_id: string | null;
  data_inicio: string;
  data_fim: string;
  dias_abono: number;
  observacao: string | null;
};

export type SolicitarFeriasResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

type PeriodoComSaldo = ColaboradorFeriasPeriodo & { saldo: number };

type Props = {
  periodos: PeriodoComSaldo[];
  tipoContratacao: TipoContratacao;
  modo: "colaborador" | "rh";
  onSubmit: (payload: SolicitarFeriasPayload) => Promise<SolicitarFeriasResult>;
  onSucesso: () => void;
  onCancelar: () => void;
};

const ANTECEDENCIA_MINIMA_DIAS = 5;

type CardTipo = "usufruto" | "abono_combinado" | "abono_avulso";

type CardConfig = {
  tipo: CardTipo;
  titulo: string;
  Icone: React.ComponentType<{ className?: string }>;
};

const CARDS: CardConfig[] = [
  { tipo: "usufruto", titulo: "Férias", Icone: Palmtree },
  { tipo: "abono_combinado", titulo: "Férias + venda", Icone: Split },
  { tipo: "abono_avulso", titulo: "Só venda", Icone: DollarSign },
];

/** Soma N-1 dias à data (data_fim = data_inicio + diasFolga - 1). */
function calcularDataFim(dataInicio: string, diasFolga: number): string {
  if (!dataInicio || diasFolga <= 0) return "";
  const ini = new Date(dataInicio + "T00:00:00");
  ini.setDate(ini.getDate() + diasFolga - 1);
  return ini.toISOString().slice(0, 10);
}

export function SolicitarFeriasForm({
  periodos,
  tipoContratacao,
  modo,
  onSubmit,
  onSucesso,
  onCancelar,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [erros, setErros] = React.useState<Record<string, string[]>>({});

  const periodosDisponiveis = periodos.filter((p) => p.saldo > 0);
  const permiteAbonoAvulso = tipoContratacao === "pj";
  const permiteCombinado = periodosDisponiveis.length > 0;

  const cardsVisiveis = CARDS.filter((c) => {
    if (c.tipo === "abono_avulso") return permiteAbonoAvulso;
    if (c.tipo === "abono_combinado") return permiteCombinado;
    return true;
  });

  const [tipo, setTipo] = React.useState<CardTipo>("usufruto");
  const [periodoId, setPeriodoId] = React.useState<string>(
    periodosDisponiveis[0]?.id ?? "",
  );

  // Reconcilia periodoId se a lista mudar (ex: RH alterna "modo retroativo").
  React.useEffect(() => {
    if (tipo === "abono_avulso") return;
    const reconciliado = reconciliarPeriodoSelecionado(
      periodosDisponiveis,
      periodoId,
    );
    if (reconciliado !== periodoId) {
      setPeriodoId(reconciliado);
    }
  }, [periodosDisponiveis, periodoId, tipo]);

  const [qtdDias, setQtdDias] = React.useState<number>(0);
  const [dataInicio, setDataInicio] = React.useState<string>("");
  const [diasAbono, setDiasAbono] = React.useState<number>(0);
  const [observacao, setObservacao] = React.useState<string>("");

  function trocarTipo(novo: CardTipo) {
    setTipo(novo);
    setPeriodoId(
      novo === "abono_avulso" ? "" : periodosDisponiveis[0]?.id ?? "",
    );
    setQtdDias(0);
    setDataInicio("");
    setDiasAbono(novo === "abono_combinado" ? 1 : 0);
    setErros({});
    setErro(null);
  }

  const periodoAtivo = periodosDisponiveis.find((p) => p.id === periodoId);
  const saldoDisponivel = periodoAtivo?.saldo ?? 0;

  const diasConsumidosDoSaldo =
    tipo === "abono_combinado" ? qtdDias + diasAbono : qtdDias;
  const excedeSaldo =
    tipo !== "abono_avulso" &&
    diasConsumidosDoSaldo > saldoDisponivel &&
    saldoDisponivel > 0;

  const dataFimCalculada = React.useMemo(
    () => calcularDataFim(dataInicio, qtdDias),
    [dataInicio, qtdDias],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setErros({});

    startTransition(async () => {
      const payload: SolicitarFeriasPayload = {
        tipo,
        periodo_id: tipo === "abono_avulso" ? null : periodoId || null,
        data_inicio: dataInicio,
        data_fim: dataFimCalculada,
        dias_abono: tipo === "abono_combinado" ? diasAbono : 0,
        observacao: observacao.trim() || null,
      };

      const res = await onSubmit(payload);
      if (!res.ok) {
        setErro(res.message);
        setErros(res.fieldErrors ?? {});
        return;
      }

      onSucesso();
    });
  }

  // Antecedência: colab = +5 dias; RH = sem antecedência (retroativo permitido)
  const dateDisabled = React.useMemo(() => {
    if (modo === "rh") return undefined;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const minimo = new Date(hoje);
    minimo.setDate(hoje.getDate() + ANTECEDENCIA_MINIMA_DIAS);
    return (d: Date) => d < minimo;
  }, [modo]);

  const submitDesabilitado =
    pending ||
    qtdDias <= 0 ||
    !dataInicio ||
    (tipo === "abono_combinado" && diasAbono < 1) ||
    (tipo !== "abono_avulso" && !periodoId) ||
    excedeSaldo;

  const labelSubmit =
    modo === "rh"
      ? pending
        ? "Lançando..."
        : "Lançar"
      : pending
        ? "Enviando..."
        : "Enviar solicitação";

  const labelQtdDias =
    tipo === "abono_avulso" ? "Quantos dias quer vender?" : "Quantos dias de férias?";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {/* Cards de tipo — compactos */}
      <div className="space-y-1.5">
        <Label>Como você quer solicitar?</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {cardsVisiveis.map((c) => {
            const ativo = tipo === c.tipo;
            return (
              <button
                key={c.tipo}
                type="button"
                onClick={() => trocarTipo(c.tipo)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  ativo
                    ? "border-california-red bg-california-red/5 ring-1 ring-california-red/20"
                    : "border-border bg-white hover:bg-muted/40"
                }`}
              >
                <div
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                    ativo
                      ? "bg-california-red text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <c.Icone className="h-3.5 w-3.5" />
                </div>
                <p className="text-sm font-medium">{c.titulo}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Período aquisitivo — vem antes do input de dias pra mostrar o saldo */}
      {tipo !== "abono_avulso" && (
        <div className="space-y-1.5">
          <Label htmlFor="sff-periodo">Período aquisitivo</Label>
          {periodosDisponiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum período com saldo disponível no momento.
            </p>
          ) : (
            <Select value={periodoId} onValueChange={setPeriodoId}>
              <SelectTrigger id="sff-periodo">
                <SelectValue placeholder="Escolha o período" />
              </SelectTrigger>
              <SelectContent>
                {periodosDisponiveis.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {`#${p.numero} · ${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {periodoAtivo && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium">
                Saldo disponível:{" "}
                <span className="text-california-red">
                  {saldoDisponivel} {saldoDisponivel === 1 ? "dia" : "dias"}
                </span>
              </span>
              {periodoAtivo.data_limite_gozo && (
                <span className="text-muted-foreground">
                  Precisa começar até{" "}
                  {new Date(
                    periodoAtivo.data_limite_gozo + "T00:00:00",
                  ).toLocaleDateString("pt-BR")}
                </span>
              )}
            </div>
          )}
          {erros.periodo_id && (
            <p className="text-xs text-red-600">{erros.periodo_id[0]}</p>
          )}
        </div>
      )}

      {/* Qtd dias + Data início + Data fim calculada */}
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="sff-qtd-dias">{labelQtdDias}</Label>
          <Input
            id="sff-qtd-dias"
            type="number"
            min={1}
            max={30}
            value={qtdDias || ""}
            onChange={(e) => setQtdDias(Number(e.target.value) || 0)}
          />
          {erros.data_fim && (
            <p className="text-xs text-red-600">{erros.data_fim[0]}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sff-data-inicio">Data de início</Label>
          <DatePicker
            id="sff-data-inicio"
            name="_sff_data_inicio"
            defaultValue={dataInicio}
            dateDisabled={dateDisabled}
            onDateChange={(d) => {
              setDataInicio(d ? d.toISOString().slice(0, 10) : "");
            }}
          />
          {erros.data_inicio && (
            <p className="text-xs text-red-600">{erros.data_inicio[0]}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sff-data-fim">Data de fim</Label>
          <div
            id="sff-data-fim"
            className="flex h-10 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground"
          >
            {dataFimCalculada
              ? new Date(dataFimCalculada + "T00:00:00").toLocaleDateString("pt-BR")
              : "—"}
          </div>
        </div>
      </div>

      {/* Dias de abono — só pra abono_combinado */}
      {tipo === "abono_combinado" && (
        <div className="space-y-1.5">
          <Label htmlFor="sff-dias-abono">Quantos dias quer vender?</Label>
          <Input
            id="sff-dias-abono"
            type="number"
            min={1}
            max={30}
            value={diasAbono || ""}
            onChange={(e) => setDiasAbono(Number(e.target.value) || 0)}
          />
          <p className="text-xs text-muted-foreground">
            Até 10 dias é padrão. Acima disso vira acordo com a empresa (RH
            avalia).
          </p>
          {erros.dias_abono && (
            <p className="text-xs text-red-600">{erros.dias_abono[0]}</p>
          )}
        </div>
      )}

      {/* Observação */}
      <div className="space-y-1.5">
        <Label htmlFor="sff-observacao">Observação (opcional)</Label>
        <Textarea
          id="sff-observacao"
          rows={2}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          maxLength={500}
          placeholder="Alguma informação adicional pro RH..."
        />
      </div>

      {/* Resumo */}
      {qtdDias > 0 && dataInicio && (
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          {tipo === "usufruto" && (
            <>
              <p className="font-medium">
                {qtdDias} {qtdDias === 1 ? "dia" : "dias"} de folga
              </p>
              {saldoDisponivel > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Saldo após solicitação:{" "}
                  <span
                    className={
                      excedeSaldo ? "font-medium text-red-700" : "font-medium"
                    }
                  >
                    {saldoDisponivel - diasConsumidosDoSaldo}{" "}
                    {saldoDisponivel - diasConsumidosDoSaldo === 1
                      ? "dia"
                      : "dias"}
                  </span>
                </p>
              )}
            </>
          )}
          {tipo === "abono_combinado" && diasAbono > 0 && (
            <>
              <p className="font-medium">
                {qtdDias} dias de folga + {diasAbono} vendidos ={" "}
                {diasConsumidosDoSaldo} dias
              </p>
              {saldoDisponivel > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Saldo após solicitação:{" "}
                  <span
                    className={
                      excedeSaldo ? "font-medium text-red-700" : "font-medium"
                    }
                  >
                    {saldoDisponivel - diasConsumidosDoSaldo} dias
                  </span>
                </p>
              )}
              {diasAbono > 10 && (
                <p className="mt-1 text-xs text-amber-700">
                  Acima de 10 dias requer acordo com a empresa — RH vai avaliar.
                </p>
              )}
            </>
          )}
          {tipo === "abono_avulso" && (
            <>
              <p className="font-medium">
                {qtdDias} {qtdDias === 1 ? "dia" : "dias"} vendidos
              </p>
              {qtdDias > 10 && (
                <p className="mt-1 text-xs text-amber-700">
                  Acima de 10 dias requer acordo com a empresa — RH vai avaliar.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onCancelar}
          disabled={pending}
          className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitDesabilitado}
          className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labelSubmit}
        </button>
      </div>
    </form>
  );
}
