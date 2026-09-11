"use client";

/**
 * O pop-up que aprova a PP (10/09/2026).
 *
 * Nasceu de um defeito: o "Aprovar" da conferência lado a lado não
 * aprovava. Ele chamava a mesma função do drawer e, sem a data de
 * pagamento, ela escrevia o aviso DENTRO do drawer — que naquele momento
 * estava atrás da tela cheia. O clique funcionava; a resposta é que ficava
 * escondida.
 *
 * Por isso o formulário saiu do drawer e virou este diálogo: a pergunta e
 * a resposta passam a acontecer na mesma camada de onde se clicou, venha o
 * clique do drawer ou da conferência.
 *
 * **Aqui só entra decisão.** Fornecedor, job, serviço e parcelas ficam na
 * tela de trás — repeti-los transformaria este diálogo num segundo drawer,
 * que é exatamente a redundância que ele veio desfazer (Tiago, 10/09/2026).
 * Do pedido ficam o código e o valor, para ninguém aprovar a PP errada.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { formatCurrency } from "@/lib/utils";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { aprovarPPComData } from "./actions-titulos";

interface PPParaAprovar {
  id: string;
  codigo: string;
  valor: number;
  /** Vencimento negociado pela produção — a referência da decisão. */
  vencimentoOriginal: string | null;
  parcelas: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function AprovarPPDialog({
  open,
  onOpenChange,
  pp,
  cartoes,
  tipos,
  subtipos,
  onAprovada,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  pp: PPParaAprovar | null;
  cartoes: CartaoOption[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** O pai fecha o que estiver aberto, avisa e recarrega. */
  onAprovada: (mensagem: string) => void;
}) {
  const [dataPagamento, setDataPagamento] = React.useState("");
  const [formaPagamento, setFormaPagamento] = React.useState("");
  const [cartaoId, setCartaoId] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const custoOperacionalId = React.useMemo(
    () => tipos.find((t) => t.codigo === "02")?.id ?? "",
    [tipos],
  );

  const noCartao = formaPagamento === "cartao_credito";
  const hoje = React.useMemo(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }, []);

  // Cada abertura começa limpa: o diálogo é a decisão de UMA aprovação, e
  // herdar a data escolhida na PP anterior é como se erra a data.
  React.useEffect(() => {
    if (!open) return;
    setDataPagamento("");
    setFormaPagamento("");
    setCartaoId("");
    setTipoId("");
    setSubtipoId("");
    setErro(null);
  }, [open, pp?.id]);

  if (!pp) return null;

  function handleAprovar() {
    if (!pp) return;
    if (!dataPagamento) {
      setErro("Escolha a data de pagamento antes de aprovar.");
      return;
    }
    startTransition(async () => {
      const res = await aprovarPPComData({
        pp_id: pp.id,
        data_pagamento: dataPagamento,
        forma_pagamento: formaPagamento || null,
        cartao_credito_id: noCartao ? cartaoId || null : null,
        plano_conta_tipo_id: noCartao ? tipoId || null : null,
        plano_conta_subtipo_id: noCartao ? subtipoId || null : null,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onAprovada(
        `${pp.codigo} aprovada · ${
          pp.parcelas > 1 ? `${pp.parcelas} títulos criados` : "título criado"
        } para ${formatDate(dataPagamento)}.`,
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `z-[60]` porque este diálogo é aberto TAMBÉM de dentro da
          conferência em tela cheia — ver a escala de camadas no
          `FullscreenContent`. Sem isso ele monta atrás do `<iframe>` do
          documento: visível, e sem receber clique. */}
      <DialogContent className="z-[60] max-w-md" overlayClassName="z-[60]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-2">
            <span>Aprovar</span>
            <span className="font-mono text-california-red">{pp.codigo}</span>
            <span className="ml-auto font-mono text-sm font-semibold text-muted-foreground">
              {formatCurrency(pp.valor, "BRL")}
            </span>
          </DialogTitle>
          <DialogDescription>
            Vencimento negociado pela produção:{" "}
            <strong className="font-semibold text-foreground">
              {formatDate(pp.vencimentoOriginal)}
            </strong>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-bold">
              Data de pagamento <span className="text-california-red">*</span>
            </p>
            <DatePicker
              id="aprovar-pp-data-pagamento"
              name="aprovar_pp_data_pagamento"
              onDateChange={(d) => {
                setDataPagamento(
                  d
                    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                    : "",
                );
                setErro(null);
              }}
            />
            <p className="text-[11px] text-muted-foreground text-pretty">
              Vira o vencimento do título em Títulos a Pagar; o original fica
              registrado. Hoje é{" "}
              <strong className="font-semibold text-california-red">{hoje}</strong>.
              {pp.parcelas > 1 && (
                <>
                  {" "}
                  Como esta PP tem {pp.parcelas} parcelas, as demais são deslocadas
                  pelo mesmo número de dias.
                </>
              )}
            </p>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-bold">Como vai ser pago</p>
            <select
              value={formaPagamento}
              disabled={pending}
              onChange={(e) => {
                const nova = e.target.value;
                setFormaPagamento(nova);
                setCartaoId("");
                // No cartão o tipo já entra em Custo Operacional; o subtipo
                // continua em branco, que é a escolha real.
                setTipoId(nova === "cartao_credito" ? custoOperacionalId : "");
                setSubtipoId("");
                setErro(null);
              }}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-california-red disabled:opacity-50"
            >
              <option value="">Decidir na baixa, parcela a parcela</option>
              <option value="pix">PIX</option>
              <option value="transferencia">Transferência</option>
              <option value="boleto">Boleto</option>
              <option value="cartao_credito">Cartão de Crédito</option>
            </select>

            {noCartao && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11.5px] leading-relaxed text-amber-900">
                  No cartão, cada parcela entra na fatura da <strong>data dela</strong>{" "}
                  e sai na baixa da fatura inteira — não existe baixa individual. Por
                  isso o centro de custo é escolhido agora.
                </p>

                <select
                  value={cartaoId}
                  disabled={pending}
                  onChange={(e) => setCartaoId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs outline-none focus:border-california-red"
                >
                  <option value="">Escolha o cartão…</option>
                  {cartoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · {c.bandeira.toUpperCase()} · ••••{c.ultimos_4_digitos}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={tipoId}
                    disabled={pending}
                    onChange={(e) => {
                      setTipoId(e.target.value);
                      setSubtipoId("");
                    }}
                    className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs outline-none focus:border-california-red"
                  >
                    <option value="">Tipo…</option>
                    {tipos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.codigo} · {t.nome}
                      </option>
                    ))}
                  </select>
                  <select
                    value={subtipoId}
                    disabled={pending || tipoId === ""}
                    onChange={(e) => setSubtipoId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-white px-2 text-xs outline-none focus:border-california-red disabled:bg-muted/40"
                  >
                    <option value="">Subtipo…</option>
                    {subtipos
                      .filter((sub) => sub.tipo_id === tipoId)
                      .map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.codigo} · {sub.nome}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            {!noCartao && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Centro de custo</span>
                  <span className="font-semibold">Custo Operacional</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground text-pretty">
                  Padrão de todo custo de job (decisão 068). O subtipo você escolhe na
                  baixa, em Títulos a Pagar.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-t border-border pt-4">
          <span className="text-[11px] text-muted-foreground">
            {pp.parcelas > 1
              ? `Cria ${pp.parcelas} títulos a pagar`
              : "Cria 1 título a pagar"}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="ml-auto rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAprovar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {pending ? "Aprovando..." : "Aprovar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
