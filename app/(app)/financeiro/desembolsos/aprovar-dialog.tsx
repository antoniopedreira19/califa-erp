"use client";
// O pop-up que aprova o desembolso (decisão 264), no desenho do "Aprovar
// PP": cabeçalho com código e valor, a faixa de quem enviou e, numa caixa
// só, a data de pagamento e como vai ser pago. As retenções e o crédito de
// PIS/COFINS da nota entram com o controle de NFs; o centro de custo segue
// na baixa, como hoje.
import * as React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FaixaQuemEnviou } from "@/app/(app)/financeiro/contas-a-pagar/faixa-quem-enviou";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { PedidoDeDesembolso } from "./tipos";
import { aprovarDesembolsoComData } from "./actions";
import { Dica, brl, dataBr } from "./comum";

const DECIDIR = "decidir";
type Forma =
  | ""
  | "pix"
  | "transferencia"
  | "boleto"
  | "cartao_credito"
  | "debito_automatico";

export function AprovarDesembolsoDialog({
  open,
  onOpenChange,
  d,
  cartoes,
  onAprovado,
}: {
  open: boolean;
  onOpenChange: (x: boolean) => void;
  d: PedidoDeDesembolso;
  cartoes: CartaoOption[];
  onAprovado: (mensagem: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[60] flex max-w-lg flex-col gap-0 overflow-clip p-0"
        overlayClassName="z-[60]"
        onOpenAutoFocus={focarPrimeiroCampo}
      >
        {open && <Corpo d={d} cartoes={cartoes} fechar={() => onOpenChange(false)} onAprovado={onAprovado} />}
      </DialogContent>
    </Dialog>
  );
}

function Corpo({
  d,
  cartoes,
  fechar,
  onAprovado,
}: {
  d: PedidoDeDesembolso;
  cartoes: CartaoOption[];
  fechar: () => void;
  onAprovado: (m: string) => void;
}) {
  const [data, setData] = React.useState("");
  const [forma, setForma] = React.useState<Forma>("");
  const [cartaoId, setCartaoId] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const noCartao = forma === "cartao_credito";
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const temNf = !d.reembolso && d.anexos.some((a) => a.tipo === "nota_fiscal");

  function aprovar() {
    if (!data) return setErro("Escolha a data de pagamento antes de aprovar.");
    if (noCartao && !cartaoId) return setErro("Escolha o cartão de crédito.");
    startTransition(async () => {
      const r = await aprovarDesembolsoComData({
        desembolso_id: d.id,
        data_pagamento: data,
        forma_pagamento: forma || null,
        cartao_credito_id: noCartao ? cartaoId : null,
      });
      if (!r.ok) return setErro(r.message);
      onAprovado(
        `${d.codigo} aprovado: ${d.parcelas.length > 1 ? `${d.parcelas.length} títulos` : "1 título"} em Títulos a Pagar${temNf ? " e a NF no controle de notas" : ""}.`,
      );
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-5 pt-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-2 pr-8">
            <span>Aprovar</span>
            <span className="font-mono text-california-red">{d.codigo}</span>
            <span className="ml-auto font-mono text-sm font-semibold text-muted-foreground">{brl(d.valor)}</span>
          </DialogTitle>
          <FaixaQuemEnviou
            rotulo={d.reenviadoEm ? "Reenviado por" : "Enviado por"}
            nome={d.criador.nome}
            em={d.enviadoEm}
            referencia={d.reembolso ? `Reembolso a ${d.criador.nome}` : `Paga a ${d.fornecedor?.nome ?? "—"}`}
          />
          <DialogDescription>
            Data de pagamento pedida{d.urgente ? " (urgente)" : ""}:{" "}
            <strong className="font-semibold text-foreground">{dataBr(d.parcelas[0]?.vencimento)}</strong>.
          </DialogDescription>
        </DialogHeader>
        {erro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="space-y-4 px-4 py-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold">
                  Data de pagamento <span className="text-california-red">*</span>
                </p>
                <Dica
                  texto={`Vira o vencimento do título em Títulos a Pagar; a data pedida fica registrada.${
                    d.parcelas.length > 1 ? ` As outras ${d.parcelas.length - 1} parcelas andam o mesmo número de dias.` : ""
                  }`}
                />
                <span className="ml-auto text-[11px] text-muted-foreground">
                  Hoje é <strong className="font-semibold text-california-red">{hoje}</strong>
                </span>
              </div>
              <DatePicker
                id="aprovar-des-data"
                name="aprovar_des_data"
                onDateChange={(x) => {
                  setData(
                    x ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}` : "",
                  );
                  setErro(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-bold">Como vai ser pago</p>
              <Select
                value={forma === "" ? DECIDIR : forma}
                onValueChange={(x) => {
                  setForma(x === DECIDIR ? "" : (x as Forma));
                  setCartaoId("");
                  setErro(null);
                }}
              >
                <SelectTrigger aria-label="Como vai ser pago" className="h-10 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DECIDIR}>Decidir na baixa, parcela a parcela</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="cartao_credito">Cartão de Crédito</SelectItem>
                </SelectContent>
              </Select>
              {noCartao && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-900">
                    Cartão
                    <Dica
                      className="text-amber-700/70"
                      texto="O cartão aqui é a intenção: a parcela entra na fatura quando o pagamento for confirmado em Títulos a Pagar, pela data informada na baixa."
                    />
                  </div>
                  <Select value={cartaoId || undefined} onValueChange={setCartaoId}>
                    <SelectTrigger aria-label="Cartão" className="h-9 w-full text-xs">
                      <SelectValue placeholder="Escolha o cartão…" />
                    </SelectTrigger>
                    <SelectContent>
                      {cartoes.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.nome} · {String(c.bandeira).toUpperCase()} · ••••{c.ultimos_4_digitos}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          {temNf && (
            <div className="space-y-1 border-t border-border px-4 py-3">
              <p className="text-sm font-bold">Nota fiscal</p>
              <p className="text-[12px] text-muted-foreground">
                A nota já está no cadastro de notas desde o envio. Na aprovação, ela é registrada no controle de notas.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2.5 border-t border-border bg-card px-6 py-4">
        <span className="text-[11px] text-muted-foreground">
          {d.parcelas.length > 1 ? `Cria ${d.parcelas.length} títulos a pagar` : "Cria 1 título a pagar"}
        </span>
        <button
          type="button"
          onClick={fechar}
          className="ml-auto rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={aprovar}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {pending ? "Aprovando..." : "Aprovar"}
        </button>
      </div>
    </>
  );
}

/** O foco de abertura vai ao primeiro campo que não é dica (como no Aprovar PP). */
function focarPrimeiroCampo(e: Event) {
  e.preventDefault();
  const raiz = e.currentTarget as HTMLElement;
  const alvo = raiz.querySelector<HTMLElement>(
    'button:not([data-dica]):not([disabled]), input:not([type="hidden"]):not([disabled]), [role="combobox"]',
  );
  (alvo ?? raiz).focus();
}
