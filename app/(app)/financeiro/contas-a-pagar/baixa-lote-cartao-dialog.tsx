"use client";

/**
 * Modal de baixa em lote de títulos de uma fatura de cartão de crédito.
 *
 * Exibe um resumo claro (N títulos, cartão, total, conta, data) antes de
 * confirmar. Chama `darBaixaLoteCartao` e trata erro inline (sem lib de
 * toast — padrão do projeto usa mensagem inline + notificação visual própria).
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, CreditCard } from "lucide-react";
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
import type {
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  OrigemTitulo,
} from "@/lib/types";
import { darBaixaLoteCartao } from "./actions-cartao";

// ---------------------------------------------------------------------------
// Tipos da interface pública
// ---------------------------------------------------------------------------

export interface TituloSelecionado {
  origem: OrigemTitulo;
  id: string;
  descricao: string;
  valor: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cartaoNome: string;
  cartaoId: string;
  titulosSelecionados: TituloSelecionado[];
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  onSucesso: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function BaixaLoteCartaoDialog({
  open,
  onOpenChange,
  cartaoNome,
  cartaoId,
  titulosSelecionados,
  contas,
  tipos,
  subtipos,
  onSucesso,
}: Props) {
  const [pagoEm, setPagoEm] = React.useState(hojeISO());
  const [contaId, setContaId] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Ao abrir: resetar campos.
  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setPagoEm(hojeISO());
    setContaId("");
    setTipoId("");
    setSubtipoId("");
  }, [open]);

  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  const totalValor = titulosSelecionados.reduce((s, t) => s + t.valor, 0);

  // A conta exibida no resumo — nome + banco.
  const contaSelecionada = contas.find((c) => c.id === contaId);
  const contaLabel = contaSelecionada
    ? `${contaSelecionada.nome} · ${contaSelecionada.banco}`
    : "—";

  function handleTipo(next: string) {
    setTipoId(next);
    // Trocar tipo invalida subtipo se não pertencer ao novo tipo.
    setSubtipoId((atual) =>
      subtipos.find((s) => s.id === atual)?.tipo_id === next ? atual : "",
    );
    setErro(null);
  }

  function handleSubmit() {
    setErro(null);
    if (!pagoEm || !contaId) {
      setErro("Informe a data e a conta que realizará o pagamento.");
      return;
    }
    if (!tipoId || !subtipoId) {
      setErro("Selecione o centro de custo do pagamento.");
      return;
    }

    startTransition(async () => {
      const res = await darBaixaLoteCartao({
        cartao_credito_id: cartaoId,
        titulos: titulosSelecionados.map((t) => ({
          origem: t.origem,
          id: t.id,
        })),
        pago_em: pagoEm,
        conta_bancaria_id: contaId,
        plano_conta_tipo_id: tipoId,
        plano_conta_subtipo_id: subtipoId,
      });

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      onOpenChange(false);
      onSucesso();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Baixa em lote — Fatura do cartão
          </DialogTitle>
        </DialogHeader>

        {/* Resumo dos títulos selecionados */}
        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <span className="text-muted-foreground">Cartão</span>
          <span className="font-semibold">{cartaoNome}</span>
          <span className="text-muted-foreground">Títulos</span>
          <span className="font-semibold">
            {titulosSelecionados.length} título
            {titulosSelecionados.length !== 1 ? "s" : ""}
          </span>
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-bold text-california-red">
            {formatCurrency(totalValor, "BRL")}
          </span>
        </div>

        {erro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="space-y-3">
          {/* Data do pagamento */}
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Data do pagamento <span className="text-california-red">*</span>
            </label>
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => {
                setPagoEm(d ? format(d, "yyyy-MM-dd") : "");
                setErro(null);
              }}
            />
          </div>

          {/* Conta bancária */}
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Conta que realizará o pagamento{" "}
              <span className="text-california-red">*</span>
            </label>
            <Select
              value={contaId || undefined}
              onValueChange={(v) => {
                setContaId(v);
                setErro(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contas.filter((c) => c.ativo).length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta bancária ativa cadastrada.
                  </div>
                ) : (
                  contas
                    .filter((c) => c.ativo)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome} · {c.banco}
                      </SelectItem>
                    ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Centro de custo (tipo + subtipo) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Centro de custo do pagamento{" "}
              <span className="text-california-red">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={tipoId || undefined}
                onValueChange={handleTipo}
              >
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
                value={subtipoId || undefined}
                onValueChange={(v) => {
                  setSubtipoId(v);
                  setErro(null);
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

          {/* Resumo em linguagem natural */}
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            Você vai baixar{" "}
            <strong className="text-foreground">
              {titulosSelecionados.length} título
              {titulosSelecionados.length !== 1 ? "s" : ""}
            </strong>{" "}
            do cartão{" "}
            <strong className="text-foreground">{cartaoNome}</strong>
            {", "}total{" "}
            <strong className="text-foreground">
              {formatCurrency(totalValor, "BRL")}
            </strong>
            {", "}na conta{" "}
            <strong className="text-foreground">{contaLabel}</strong>
            {", "}em{" "}
            <strong className="text-foreground">
              {pagoEm ? formatarData(pagoEm) : "—"}
            </strong>
            .
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
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
