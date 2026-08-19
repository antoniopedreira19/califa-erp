"use client";

/**
 * Modal único de baixa da aba "Títulos a Pagar" (Tela 3.2) — serve as
 * três origens: parcela de PP, lançamento avulso e ocorrência de
 * recorrência.
 *
 * Duas decisões do Tiago moram aqui:
 *
 * 1. **Centro de custo é o plano de contas.** O protótipo pede "centro de
 *    custo do pagamento" obrigatório; no banco isso é o par Tipo +
 *    Subtipo que a baixa já exigia — a legenda do próprio protótipo diz
 *    "define onde o custo entra no DRE". Vem sugerido quando a origem já
 *    tem plano (avulsa/recorrência) e é editável.
 * 2. **Nenhuma conta bancária padrão.** A conta é escolhida na mão em
 *    toda baixa, de propósito.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowRightLeft, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

export interface BaixaTituloAlvo {
  titulo: string;
  origem: string;
  parcela: string;
  vencimento: string | null;
  valor: number;
  empresaId: string;
  planoContaTipoId: string | null;
  planoContaSubtipoId: string | null;
}

export function BaixaTituloDialog({
  open,
  onOpenChange,
  alvo,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: BaixaTituloAlvo | null;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  onConfirm: (payload: {
    pago_em: string;
    conta_bancaria_id: string;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
  }) => void;
}) {
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [contaId, setContaId] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");

  // Ao abrir: hoje como data, conta em branco (sem padrão, por decisão) e
  // centro de custo sugerido pela origem quando existe.
  React.useEffect(() => {
    if (!open || !alvo) return;
    setErroLocal(null);
    setPagoEm(format(new Date(), "yyyy-MM-dd"));
    setContaId("");
    setTipoId(alvo.planoContaTipoId ?? "");
    setSubtipoId(alvo.planoContaSubtipoId ?? "");
  }, [open, alvo]);

  const contasDaEmpresa = contas.filter(
    (c) => c.empresa_id === alvo?.empresaId && c.ativo,
  );
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  function handleTipo(next: string) {
    setTipoId(next);
    // Trocar o tipo invalida o subtipo — o banco recusa o par incoerente.
    setSubtipoId((atual) =>
      subtipos.find((s) => s.id === atual)?.tipo_id === next ? atual : "",
    );
  }

  function handleSubmit() {
    setErroLocal(null);
    if (!pagoEm || !contaId) {
      setErroLocal(
        "Informe a data e a conta que realizará o pagamento.",
      );
      return;
    }
    if (!tipoId || !subtipoId) {
      setErroLocal("Selecione o centro de custo do pagamento.");
      return;
    }
    onConfirm({
      pago_em: pagoEm,
      conta_bancaria_id: contaId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
    });
  }

  if (!alvo) return null;
  const mensagemErro = erro ?? erroLocal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Dar baixa no pagamento
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <span className="text-muted-foreground">Título</span>
          <span className="font-semibold">{alvo.titulo}</span>
          <span className="text-muted-foreground">Origem</span>
          <span>{alvo.origem}</span>
          <span className="text-muted-foreground">Parcela</span>
          <span className="font-mono text-xs">{alvo.parcela}</span>
          <span className="text-muted-foreground">Vencimento</span>
          <span className="font-mono text-xs">
            {alvo.vencimento ? formatarData(alvo.vencimento) : "—"}
          </span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-bold">
            {formatCurrency(alvo.valor, "BRL")}
          </span>
        </div>

        {mensagemErro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Data do pagamento <span className="text-california-red">*</span>
            </label>
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => {
                setPagoEm(d ? format(d, "yyyy-MM-dd") : "");
                setErroLocal(null);
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Conta que realizará o pagamento{" "}
              <span className="text-california-red">*</span>
            </label>
            <Select
              value={contaId}
              onValueChange={(v) => {
                setContaId(v);
                setErroLocal(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contasDaEmpresa.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta ativa dessa empresa. Cadastre em
                    /cadastros/contas-bancarias.
                  </div>
                ) : (
                  contasDaEmpresa.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} · {c.banco}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Centro de custo do pagamento{" "}
              <span className="text-california-red">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Select value={tipoId} onValueChange={handleTipo}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {tiposAtivos.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum tipo cadastrado.
                    </div>
                  ) : (
                    tiposAtivos.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.codigo} · {t.nome}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Select
                value={subtipoId}
                onValueChange={(v) => {
                  setSubtipoId(v);
                  setErroLocal(null);
                }}
                disabled={!tipoId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={tipoId ? "Subtipo..." : "Escolha o tipo primeiro"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {subtiposDoTipo.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum subtipo cadastrado.
                    </div>
                  ) : (
                    subtiposDoTipo.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Define onde o custo entra no DRE.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>
              Ao confirmar, o pagamento é registrado e enviado para a{" "}
              <strong className="font-semibold text-foreground">Conciliação</strong>{" "}
              com a conta e o centro de custo escolhidos.
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {pending ? "Confirmando..." : "Confirmar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
