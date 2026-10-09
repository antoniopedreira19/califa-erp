"use client";

import * as React from "react";
import { AlertCircle, Paperclip, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  anexarReciboContabilFolhaFerias,
  gerarUrlUploadReciboContabil,
} from "./actions-pagamentos";
import type { PagamentoFerias } from "./aba-pagamentos";

type Props = {
  folha: PagamentoFerias;
  onFechar: () => void;
  onSucesso: () => void;
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

/**
 * Modal pra RH anexar o recibo da contabilidade (CLT) + informar o
 * valor líquido que vai ser pago. Decisão PO 2026-10-03: só o
 * líquido é obrigatório.
 *
 * Fluxo:
 *   1. RH seleciona o PDF
 *   2. Cliente pede signed URL ao servidor
 *   3. Faz PUT direto no bucket `recibos-ferias`
 *   4. Chama server action com `anexo_url` + valor líquido
 */
export function ModalAnexarRecibo({ folha, onFechar, onSucesso }: Props) {
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [valorLiquido, setValorLiquido] = React.useState<string>("");
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const liquido = parseFloat(valorLiquido.replace(",", "."));
    if (!isFinite(liquido) || liquido <= 0) {
      setErro("Informe um valor líquido válido.");
      return;
    }

    setPending(true);
    try {
      let anexoPath: string | null = folha.anexo_url;

      // Se o RH selecionou um novo PDF, sobe pro bucket.
      if (arquivo) {
        const urlRes = await gerarUrlUploadReciboContabil({
          folha_id: folha.id,
        });
        if (!urlRes.ok) {
          setErro(urlRes.message);
          setPending(false);
          return;
        }
        const uploadRes = await fetch(urlRes.signed_url, {
          method: "PUT",
          body: arquivo,
          headers: {
            "Content-Type": arquivo.type || "application/pdf",
          },
        });
        if (!uploadRes.ok) {
          setErro(
            "Falha ao fazer upload do PDF (" + uploadRes.status + ").",
          );
          setPending(false);
          return;
        }
        anexoPath = urlRes.path;
      }

      const res = await anexarReciboContabilFolhaFerias({
        folha_id: folha.id,
        valor_liquido: liquido,
        anexo_url: anexoPath,
      });
      if (!res.ok) {
        setErro(res.message);
        setPending(false);
        return;
      }
      onSucesso();
    } catch (e) {
      console.error(e);
      setErro("Erro inesperado ao anexar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-california-red" />
            Anexar recibo da contabilidade
          </DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {folha.colaborador_nome} ·{" "}
            {folha.lancamento_data_inicio
              ? `${fmtData(folha.lancamento_data_inicio)} a ${fmtData(folha.lancamento_data_fim)}`
              : "—"}{" "}
            · vencimento {fmtData(folha.data_pagamento_prevista)}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="arquivo">
              PDF do recibo (opcional pra atualizar valor)
            </Label>
            <div className="relative">
              <Input
                id="arquivo"
                type="file"
                accept="application/pdf"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="pl-9"
              />
              <Upload className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
            {folha.anexo_url && !arquivo && (
              <p className="text-xs text-muted-foreground">
                Já existe recibo anexado. Selecione um novo arquivo pra
                substituir.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="valor">Valor líquido do recibo (R$)</Label>
            <Input
              id="valor"
              type="text"
              inputMode="decimal"
              value={valorLiquido}
              onChange={(e) => setValorLiquido(e.target.value)}
              placeholder="3267.80"
              required
            />
            <p className="text-xs text-muted-foreground">
              Valor que o financeiro vai pagar efetivamente (já com
              descontos aplicados).
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onFechar}
              disabled={pending}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
            >
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
