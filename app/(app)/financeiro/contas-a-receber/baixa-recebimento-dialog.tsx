"use client";

/**
 * Baixa do recebimento (Tela 3.3) — o espelho da baixa de Contas a Pagar.
 *
 * Três obrigatórios, todos do protótipo:
 *
 * 1. **Data do recebimento** — a invariante da tela: título recebido
 *    SEMPRE tem data. Validada aqui, no schema da action e de novo dentro
 *    da RPC, que recusa `null`.
 * 2. **Conta bancária que recebeu** — sem padrão, escolhida a cada baixa
 *    (mesma decisão da 016 §7 do lado do pagamento).
 * 3. **Centro de custo do recebimento** — que é o par Tipo + Subtipo do
 *    plano de contas (decisão 016 §6). Desde a Tela 3.3 é AQUI que a
 *    receita é classificada: o formulário de emissão da NF não pergunta
 *    mais tipo e subtipo.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowRightLeft, Banknote } from "lucide-react";
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
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

export interface BaixaRecebimentoAlvo {
  numeroNf: string;
  cliente: string;
  jobs: string[];
  parcela: string;
  vencimento: string;
  previsao: string;
  valor: number;
  empresaId: string;
}

export function BaixaRecebimentoDialog({
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
  alvo: BaixaRecebimentoAlvo | null;
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

  React.useEffect(() => {
    if (!open || !alvo) return;
    setErroLocal(null);
    setPagoEm(format(new Date(), "yyyy-MM-dd"));
    setContaId("");
    setTipoId("");
    setSubtipoId("");
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
    if (!pagoEm || !contaId || !tipoId || !subtipoId) {
      setErroLocal(
        "Informe a data do recebimento, a conta bancária que recebeu e o centro de custo.",
      );
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
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-emerald-700" />
            Dar baixa no recebimento
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
          <span className="text-muted-foreground">Nota fiscal</span>
          <span className="font-mono font-bold">NF {alvo.numeroNf}</span>
          <span className="text-muted-foreground">Cliente</span>
          <span className="font-semibold">{alvo.cliente}</span>
          <span className="text-muted-foreground">Jobs cobertos</span>
          <span className="font-mono text-xs">{alvo.jobs.join("  ·  ")}</span>
          <span className="text-muted-foreground">Parcela</span>
          <span className="font-mono">{alvo.parcela}</span>
          <span className="text-muted-foreground">Vencimento</span>
          <span className="font-mono">{formatarData(alvo.vencimento)}</span>
          <span className="text-muted-foreground">Previsão de recebimento</span>
          <span className="font-mono">{formatarData(alvo.previsao)}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-bold">
            {alvo.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
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
              Data do recebimento <span className="text-california-red">*</span>
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
              Conta bancária que recebeu{" "}
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
              Centro de custo do recebimento{" "}
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
            <p className="text-[11.5px] text-muted-foreground">
              Define onde a receita entra no DRE.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span>
              Ao confirmar, o recebimento é registrado e enviado para a{" "}
              <strong className="font-semibold text-foreground">Conciliação</strong> com
              a conta e o centro de custo escolhidos.
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <Banknote className="h-4 w-4" />
            {pending ? "Confirmando..." : "Confirmar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatarData(iso: string): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
