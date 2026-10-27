"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X, AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";
import {
  aprovarLancamento,
  previewValoresFerias,
  reprovarLancamento,
} from "./actions";

type ValoresBloco = {
  valor_base_remuneracao: number;
  valor_ferias: number;
  valor_um_terco: number;
  valor_abono: number;
  valor_total: number;
};

type PreviewValores = {
  tipo: FeriasLancamentoTipo;
  tipo_contratacao: TipoContratacao;
  dias: number;
  dias_abono: number;
  valores: ValoresBloco | null;
  valores_clt: ValoresBloco | null;
};

function formatarBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

type Props = {
  lancamentoId: string;
  status: FeriasLancamentoStatus;
  colaboradorNome: string;
};

export function AcoesLancamento({
  lancamentoId,
  status,
  colaboradorNome,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmandoAprovar, setConfirmandoAprovar] = React.useState(false);
  const [reprovandoAberto, setReprovandoAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewValores | null>(null);
  const [previewPending, setPreviewPending] = React.useState(false);
  const [previewErro, setPreviewErro] = React.useState<string | null>(null);

  function abrirConfirmacao() {
    setConfirmandoAprovar(true);
    setPreview(null);
    setPreviewErro(null);
    setPreviewPending(true);
    void previewValoresFerias(lancamentoId).then((res) => {
      setPreviewPending(false);
      if (!res.ok) {
        setPreviewErro(res.message);
        return;
      }
      setPreview({
        tipo: res.tipo,
        tipo_contratacao: res.tipo_contratacao,
        dias: res.dias,
        dias_abono: res.dias_abono,
        valores: res.valores,
        valores_clt: res.valores_clt,
      });
    });
  }

  const podeAprovar = status === "pendente_aprovacao";
  const podeReprovar = podeAprovar;

  if (!podeAprovar && !podeReprovar) {
    return null;
  }

  function handleAprovar() {
    setErro(null);
    startTransition(async () => {
      const res = await aprovarLancamento(lancamentoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmandoAprovar(false);
      router.refresh();
    });
  }

  function handleReprovar() {
    setErro(null);
    startTransition(async () => {
      const res = await reprovarLancamento({
        lancamento_id: lancamentoId,
        motivo: motivo.trim(),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setReprovandoAberto(false);
      setMotivo("");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 shrink-0 flex-wrap">
      {podeReprovar && (
        <button
          type="button"
          onClick={() => setReprovandoAberto(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors"
        >
          <X className="h-3 w-3" />
          Reprovar
        </button>
      )}
      {podeAprovar && (
        <button
          type="button"
          onClick={abrirConfirmacao}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Check className="h-3 w-3" />
          Aprovar
        </button>
      )}

      {/* Confirmação de aprovação com preview de valores */}
      <ConfirmDialog
        open={confirmandoAprovar}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmandoAprovar(false);
            setErro(null);
            setPreview(null);
            setPreviewErro(null);
          }
        }}
        title={`Aprovar férias de ${colaboradorNome}?`}
        description={
          <div className="space-y-3">
            <p>
              A solicitação muda para <strong>aprovado</strong>. O colaborador
              recebe notificação na página de perfil.
            </p>

            {previewPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Calculando valores...
              </div>
            )}

            {previewErro && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {previewErro}
              </p>
            )}

            {preview && preview.valores && (
              <ResumoValores dados={preview} />
            )}

            {preview && !preview.valores && (
              <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
                Sem salário vigente cadastrado — valores serão calculados pela
                contabilidade.
              </p>
            )}

            {erro && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {erro}
              </p>
            )}
          </div>
        }
        confirmLabel="Aprovar"
        pending={pending}
        onConfirm={handleAprovar}
      />

      {/* Dialog de reprovação */}
      <Dialog
        open={reprovandoAberto}
        onOpenChange={(o) => {
          setReprovandoAberto(o);
          if (!o) {
            setMotivo("");
            setErro(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reprovar solicitação</DialogTitle>
            <DialogDescription>
              Diga por que você está reprovando — essa mensagem chega pro{" "}
              {colaboradorNome} na notificação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="motivo-reprov">Motivo</Label>
              <Textarea
                id="motivo-reprov"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex: data conflita com entrega de projeto X; já tem 2 do time nesse período..."
                rows={4}
                maxLength={500}
              />
            </div>

            {erro && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {erro}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setReprovandoAberto(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleReprovar}
              disabled={pending || motivo.trim().length < 5}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Reprovando..." : "Reprovar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function ResumoValores({ dados }: { dados: PreviewValores }) {
  const v = dados.valores!;
  const hibrido = dados.tipo_contratacao === "clt_recibo";
  const totalCombinado = hibrido && dados.valores_clt
    ? v.valor_total + dados.valores_clt.valor_total
    : null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-3">
      <BlocoValores
        titulo={hibrido ? "Parte PJ (RPA)" : "Resumo dos valores"}
        valores={v}
        tipo={dados.tipo}
        dias={dados.dias}
        diasAbono={dados.dias_abono}
        destacarTotal={!hibrido}
      />

      {hibrido && dados.valores_clt && (
        <>
          <BlocoValores
            titulo="Parte CLT (bruto estimado)"
            valores={dados.valores_clt}
            tipo={dados.tipo}
            dias={dados.dias}
            diasAbono={dados.dias_abono}
            destacarTotal={false}
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            Parte CLT pendente do recibo da contabilidade. Valor final pode
            variar após descontos (INSS, IRRF).
          </p>
        </>
      )}

      {hibrido && !dados.valores_clt && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 leading-snug">
          Parte CLT não cadastrada no salário. O recibo da contabilidade entra
          separado após a aprovação.
        </p>
      )}

      {totalCombinado !== null && (
        <div className="flex justify-between pt-2 border-t border-border">
          <span className="font-semibold">Total estimado (PJ + CLT)</span>
          <span className="font-semibold text-california-red">
            {formatarBRL(totalCombinado)}
          </span>
        </div>
      )}
    </div>
  );
}

function BlocoValores({
  titulo,
  valores,
  tipo,
  dias,
  diasAbono,
  destacarTotal,
}: {
  titulo: string;
  valores: ValoresBloco;
  tipo: FeriasLancamentoTipo;
  dias: number;
  diasAbono: number;
  destacarTotal: boolean;
}) {
  const temAbono = tipo === "abono_combinado" && valores.valor_abono > 0;
  const soAbono =
    (tipo === "abono_avulso" || tipo === "abono_excepcional") &&
    valores.valor_abono > 0;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Base de cálculo (salário)</span>
        <span className="font-medium text-foreground">
          {formatarBRL(valores.valor_base_remuneracao)}
        </span>
      </div>

      {tipo === "usufruto" && (
        <>
          <LinhaValor label="Férias" valor={valores.valor_ferias} />
          <LinhaValor label="1/3 constitucional" valor={valores.valor_um_terco} />
        </>
      )}

      {temAbono && (
        <>
          <LinhaValor
            label={`Férias (${dias - diasAbono} dias)`}
            valor={valores.valor_ferias}
          />
          <LinhaValor label="1/3 constitucional" valor={valores.valor_um_terco} />
          <LinhaValor
            label={`Abono (${diasAbono} dias vendidos)`}
            valor={valores.valor_abono}
          />
        </>
      )}

      {soAbono && (
        <>
          <LinhaValor
            label={`Abono (${dias} dias vendidos)`}
            valor={valores.valor_abono}
          />
          <LinhaValor label="1/3 constitucional" valor={valores.valor_um_terco} />
        </>
      )}

      <div className="flex justify-between pt-1 mt-1 border-t border-border/60">
        <span className={destacarTotal ? "font-semibold" : "font-medium text-xs"}>
          {destacarTotal ? "Total" : "Subtotal"}
        </span>
        <span
          className={
            destacarTotal
              ? "font-semibold text-california-red"
              : "font-semibold"
          }
        >
          {formatarBRL(valores.valor_total)}
        </span>
      </div>
    </div>
  );
}

function LinhaValor({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span>{label}</span>
      <span className="font-medium">{formatarBRL(valor)}</span>
    </div>
  );
}
