"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Palmtree } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
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
import type {
  ColaboradorFeriasPeriodo,
  TipoContratacao,
  FeriasLancamentoTipo,
} from "@/lib/types";
import { solicitarFerias } from "./actions";

const ANTECEDENCIA_MINIMA_DIAS = 5;

type TipoSolicitacao = "usufruto" | "abono_avulso";

type PeriodoComSaldo = ColaboradorFeriasPeriodo & { saldo: number };

type Props = {
  periodos: PeriodoComSaldo[];
  tipoContratacao: TipoContratacao;
};

export function SolicitarFeriasDrawer({
  periodos,
  tipoContratacao,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [erros, setErros] = React.useState<Record<string, string[]>>({});

  const permiteAbonoAvulso = tipoContratacao === "pj";

  const periodosDisponiveis = periodos.filter((p) => p.saldo > 0);

  const [tipo, setTipo] = React.useState<TipoSolicitacao>("usufruto");
  const [periodoId, setPeriodoId] = React.useState<string>(
    periodosDisponiveis[0]?.id ?? "",
  );
  const [dataInicio, setDataInicio] = React.useState<string>("");
  const [dataFim, setDataFim] = React.useState<string>("");

  const diasSelecionados = React.useMemo(() => {
    if (!dataInicio || !dataFim) return 0;
    const ini = new Date(dataInicio + "T00:00:00");
    const fim = new Date(dataFim + "T00:00:00");
    const diff = Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
    return diff > 0 ? diff : 0;
  }, [dataInicio, dataFim]);

  const periodoAtivo = periodosDisponiveis.find((p) => p.id === periodoId);
  const saldoDisponivel = periodoAtivo?.saldo ?? 0;

  function resetForm() {
    setTipo("usufruto");
    setPeriodoId(periodosDisponiveis[0]?.id ?? "");
    setDataInicio("");
    setDataFim("");
    setErro(null);
    setErros({});
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setErros({});

    startTransition(async () => {
      const payload = {
        tipo,
        periodo_id: tipo === "abono_avulso" ? null : periodoId || null,
        data_inicio: dataInicio,
        data_fim: dataFim,
        observacao: null,
      };

      const res = await solicitarFerias(payload);
      if (!res.ok) {
        setErro(res.message);
        setErros(res.fieldErrors ?? {});
        return;
      }

      setOpen(false);
      resetForm();
      router.refresh();
    });
  }

  // Data mínima permitida: hoje + 5 dias (F13).
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const minimo = new Date(hoje);
  minimo.setDate(hoje.getDate() + ANTECEDENCIA_MINIMA_DIAS);
  const dateDisabled = (d: Date) => d < minimo;

  // Botão desabilitado se não há período + saldo (e tipo não é abono avulso).
  const semSaldoNemAbono =
    periodosDisponiveis.length === 0 && !permiteAbonoAvulso;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={semSaldoNemAbono}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-california-red/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Palmtree className="h-4 w-4" />
          Solicitar férias
        </button>
      </DialogTrigger>

      <DrawerContent>
        <DialogHeader>
          <DialogTitle>Solicitar férias</DialogTitle>
          <DialogDescription>
            A solicitação precisa ser feita com pelo menos{" "}
            {ANTECEDENCIA_MINIMA_DIAS} dias de antecedência. Depois do envio,
            o RH recebe sua solicitação para aprovar.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-5 overflow-y-auto px-1 pb-4"
        >
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          {/* Tipo de solicitação */}
          <div className="space-y-1.5">
            <Label htmlFor="tipo">Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setTipo(v as TipoSolicitacao)}
            >
              <SelectTrigger id="tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usufruto">Férias (dias de folga)</SelectItem>
                {permiteAbonoAvulso && (
                  <SelectItem value="abono_avulso">
                    Abono avulso (venda de dias)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {erros.tipo && (
              <p className="text-xs text-red-600">{erros.tipo[0]}</p>
            )}
            {tipo === "abono_avulso" && (
              <p className="text-xs text-muted-foreground">
                Abono avulso é a venda de dias sem tirar folga. Pode ser até
                10 dias; venda maior precisa de acordo com a empresa.
              </p>
            )}
          </div>

          {/* Período aquisitivo — só para usufruto */}
          {tipo === "usufruto" && (
            <div className="space-y-1.5">
              <Label htmlFor="periodo">Período aquisitivo</Label>
              {periodosDisponiveis.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum período com saldo disponível no momento.
                </p>
              ) : (
                <Select value={periodoId} onValueChange={setPeriodoId}>
                  <SelectTrigger id="periodo">
                    <SelectValue placeholder="Escolha o período" />
                  </SelectTrigger>
                  <SelectContent>
                    {periodosDisponiveis.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {`#${p.numero} · ${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)} · ${p.saldo} dias disponíveis`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {periodoAtivo && (
                <p className="text-xs text-muted-foreground">
                  Precisa começar até:{" "}
                  {new Date(
                    periodoAtivo.data_limite_gozo + "T00:00:00",
                  ).toLocaleDateString("pt-BR")}
                </p>
              )}
              {erros.periodo_id && (
                <p className="text-xs text-red-600">{erros.periodo_id[0]}</p>
              )}
            </div>
          )}

          {/* Datas */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="data-inicio">Data de início</Label>
              <DatePicker
                name="_data_inicio_display"
                id="data-inicio"
                defaultValue={dataInicio}
                dateDisabled={dateDisabled}
                onDateChange={(d) => {
                  setDataInicio(
                    d ? d.toISOString().slice(0, 10) : "",
                  );
                }}
              />
              {erros.data_inicio && (
                <p className="text-xs text-red-600">{erros.data_inicio[0]}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="data-fim">Data de fim</Label>
              <DatePicker
                name="_data_fim_display"
                id="data-fim"
                defaultValue={dataFim}
                dateDisabled={(d) => {
                  if (dateDisabled(d)) return true;
                  if (dataInicio) {
                    const ini = new Date(dataInicio + "T00:00:00");
                    if (d < ini) return true;
                  }
                  return false;
                }}
                onDateChange={(d) => {
                  setDataFim(d ? d.toISOString().slice(0, 10) : "");
                }}
              />
              {erros.data_fim && (
                <p className="text-xs text-red-600">{erros.data_fim[0]}</p>
              )}
            </div>
          </div>

          {/* Resumo */}
          {diasSelecionados > 0 && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                {diasSelecionados} {diasSelecionados === 1 ? "dia" : "dias"}
              </p>
              {tipo === "usufruto" && saldoDisponivel > 0 && (
                <p className="text-xs text-muted-foreground">
                  Saldo após solicitação:{" "}
                  <span
                    className={
                      saldoDisponivel - diasSelecionados < 0
                        ? "font-medium text-red-700"
                        : "font-medium"
                    }
                  >
                    {saldoDisponivel - diasSelecionados} dias
                  </span>
                </p>
              )}
              {tipo === "abono_avulso" && diasSelecionados > 10 && (
                <p className="mt-1 text-xs text-amber-700">
                  Acima de 10 dias requer acordo com a empresa — RH vai
                  avaliar.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
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
                (tipo === "usufruto" && !periodoId)
              }
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Enviando..." : "Enviar solicitação"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
