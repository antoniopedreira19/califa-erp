"use client";

/**
 * Aprovar um desembolso: a data de pagamento e, desde a decisão 093 §12
 * (20/09/2026), a INTENÇÃO de pagamento — como na PP. "Decidir na baixa"
 * é o padrão; escolhendo cartão, nada entra em fatura agora: a baixa vem
 * pré-preenchida e a previsão de caixa passa a cair no vencimento da
 * fatura daquele cartão. O centro de custo continua sendo escolhido na
 * baixa (desembolso não tem plano de contas próprio, decisão 069).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { aprovarDesembolsoComData } from "@/app/(app)/financeiro/desembolsos/actions";
import type { DesembolsoStatus } from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import { proximaFatura } from "@/lib/cartoes/proxima-fatura";

export interface DesembolsoParaAprovar {
  id: string;
  codigo: string;
  descricao: string;
  valor: number;
  status: DesembolsoStatus;
  fornecedor_nome: string;
}

interface AprovarDesembolsoDialogProps {
  desembolso: DesembolsoParaAprovar | null;
  cartoes: CartaoOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Radix não aceita `value=""` num item; este é o rótulo da ausência de
 *  escolha ("decidir na baixa"), traduzido para "" no estado. */
const DECIDIR = "decidir";

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AprovarDesembolsoDialog({
  desembolso,
  cartoes,
  open,
  onOpenChange,
}: AprovarDesembolsoDialogProps) {
  const router = useRouter();
  const [dataPagamento, setDataPagamento] = React.useState(hoje());
  const [formaPagamento, setFormaPagamento] = React.useState("");
  const [cartaoId, setCartaoId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  // Cada abertura começa limpa: a decisão é de UM desembolso.
  React.useEffect(() => {
    if (open) {
      setDataPagamento(hoje());
      setFormaPagamento("");
      setCartaoId("");
      setErro(null);
    }
  }, [open]);

  const noCartao = formaPagamento === "cartao_credito";
  const cartao = cartoes.find((c) => c.id === cartaoId) ?? null;

  // A fatura em que a previsão vai cair, pela data escolhida — só um
  // aviso: quem decide de verdade é a data informada na baixa.
  const previsaoFatura = React.useMemo(() => {
    if (!noCartao || !cartao || !dataPagamento) return null;
    const [y, m, d] = dataPagamento.split("-").map(Number);
    try {
      return proximaFatura(
        cartao.dia_vencimento_fatura,
        new Date(y, m - 1, d),
        cartao.dia_fechamento_fatura ?? null,
      );
    } catch {
      return null;
    }
  }, [noCartao, cartao, dataPagamento]);

  async function handleConfirmar() {
    if (!desembolso) return;
    if (noCartao && !cartaoId) {
      setErro("Escolha o cartão de crédito.");
      return;
    }
    setPending(true);
    setErro(null);
    const res = await aprovarDesembolsoComData({
      desembolso_id: desembolso.id,
      data_pagamento: dataPagamento,
      forma_pagamento: formaPagamento || null,
      cartao_credito_id: noCartao ? cartaoId || null : null,
    });
    setPending(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  if (!desembolso) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aprovar desembolso</DialogTitle>
          <DialogDescription>
            Informe a data de pagamento e, se já souber, por onde ele vai sair.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Resumo */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
            <p>
              <span className="font-mono font-bold text-california-red">{desembolso.codigo}</span>
              {" — "}
              <span className="font-semibold">{formatMoney(desembolso.valor)}</span>
            </p>
            <p className="text-muted-foreground">{desembolso.descricao}</p>
            {desembolso.fornecedor_nome && (
              <p className="text-muted-foreground">Fornecedor: {desembolso.fornecedor_nome}</p>
            )}
          </div>

          {/* Data de pagamento */}
          <div className="space-y-1.5">
            <Label htmlFor="data-pagamento-desembolso">Data de pagamento</Label>
            <Input
              id="data-pagamento-desembolso"
              type="date"
              value={dataPagamento}
              onChange={(e) => setDataPagamento(e.target.value)}
              min="2020-01-01"
              max="2099-12-31"
            />
          </div>

          {/* Como vai ser pago — a intenção (decisão 093, §12) */}
          <div className="space-y-1.5">
            <Label>Como vai ser pago</Label>
            <Select
              value={formaPagamento === "" ? DECIDIR : formaPagamento}
              onValueChange={(v) => {
                const nova = v === DECIDIR ? "" : v;
                setFormaPagamento(nova);
                if (nova !== "cartao_credito") setCartaoId("");
                setErro(null);
              }}
            >
              <SelectTrigger aria-label="Como vai ser pago" className="h-10 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DECIDIR}>Decidir na baixa</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="transferencia">Transferência</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="cartao_credito">Cartão de Crédito</SelectItem>
              </SelectContent>
            </Select>
            {noCartao && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11.5px] leading-relaxed text-amber-900">
                  O cartão aqui é a intenção: o desembolso entra na fatura quando
                  o pagamento for confirmado em Títulos a Pagar, pela{" "}
                  <strong>data informada na baixa</strong>. Até lá a previsão de
                  caixa usa o vencimento da fatura desse cartão. O centro de custo
                  é escolhido na baixa.
                </p>
                <Select value={cartaoId || undefined} onValueChange={setCartaoId}>
                  <SelectTrigger aria-label="Cartão" className="h-9 w-full text-xs">
                    <SelectValue placeholder="Escolha o cartão…" />
                  </SelectTrigger>
                  <SelectContent>
                    {cartoes.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.nome} · {c.bandeira.charAt(0).toUpperCase() + c.bandeira.slice(1)} ·
                        ••••{c.ultimos_4_digitos}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {previsaoFatura && (
                  <p className="text-[11px] text-amber-900">
                    Pela data de {dataPagamento.split("-").reverse().join("/")}, a
                    previsão cai na fatura que vence em{" "}
                    <strong>{formatDate(previsaoFatura)}</strong>.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Erro */}
          {erro && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={pending || !dataPagamento}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {pending ? "Aprovando…" : "Confirmar aprovação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
