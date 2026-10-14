"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Loader2,
  PlayCircle,
  Receipt,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  aplicarBeneficios,
  previsualizarAplicacao,
} from "@/lib/actions/beneficios/fechamento";
import type { PreviewAplicacao } from "@/lib/types";

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function formatarData(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function BotaoAplicarBeneficios(props: { ano: number; mes: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [carregandoPreview, setCarregandoPreview] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewAplicacao | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  async function abrirModal() {
    setErro(null);
    setPreview(null);
    setOpen(true);
    setCarregandoPreview(true);
    const r = await previsualizarAplicacao({ ano: props.ano, mes: props.mes });
    setCarregandoPreview(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    if (r.preview.qtdVinculos === 0) {
      setErro("Nenhum vínculo ativo nesta competência.");
      return;
    }
    setPreview(r.preview);
  }

  function confirmar() {
    setErro(null);
    startTransition(async () => {
      const r = await aplicarBeneficios({ ano: props.ano, mes: props.mes });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const competenciaLabel = `${NOMES_MES[props.mes - 1]}/${props.ano}`;

  return (
    <>
      <button
        type="button"
        onClick={abrirModal}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        <PlayCircle className="h-3.5 w-3.5" />
        Aplicar descontos
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!pending) setOpen(v);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-california-red" />
              Aplicar descontos de benefícios · {competenciaLabel}
            </DialogTitle>
            <DialogDescription>
              Revise os valores antes de confirmar. Enquanto a folha não for
              enviada ao financeiro, dá pra desaplicar e refazer sem efeito em
              Contas a Pagar.
            </DialogDescription>
          </DialogHeader>

          {carregandoPreview && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando descontos da competência...
            </div>
          )}

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {preview && !carregandoPreview && (
            <div className="space-y-5">
              {/* 1. O que acontece AGORA (desconto na folha) */}
              <section className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      1 · Agora (RH)
                    </p>
                    <h3 className="font-semibold flex items-center gap-2 mt-1">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      Desconto nas linhas PJ da folha
                    </h3>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Vínculos descontados
                    </p>
                    <p className="text-xl font-semibold tabular-nums">
                      {preview.qtdVinculos}
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        colaboradores
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Valor total descontado
                    </p>
                    <p className="text-xl font-semibold tabular-nums text-california-red">
                      −{brl(preview.totalColaborador)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  O desconto é aplicado só nas linhas PJ (origem California).
                  Linhas CLT não são tocadas (já vêm líquidas da contabilidade).
                </p>
              </section>

              {/* Seta visual entre os passos */}
              <div className="flex items-center justify-center">
                <div className="rounded-full bg-muted p-2">
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              {/* 2. O que acontece DEPOIS (quando enviar ao financeiro) */}
              <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                    2 · Depois (ao enviar ao financeiro)
                  </p>
                  <h3 className="font-semibold flex items-center gap-2 mt-1">
                    <Receipt className="h-4 w-4 text-sky-700" />
                    Avulsas em Contas a Pagar
                  </h3>
                </div>

                <div className="space-y-2">
                  {preview.porOperadora.map((op) => (
                    <div
                      key={op.operadora}
                      className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-white px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Building2 className="h-4 w-4 text-sky-700 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {op.operadora}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {op.qtdVinculos} vínculo
                            {op.qtdVinculos === 1 ? "" : "s"} · vence{" "}
                            {formatarData(op.dataVencimento)}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold tabular-nums shrink-0">
                        {brl(op.valorIntegral)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-sky-200 pt-2 text-sm">
                  <span className="font-medium text-sky-900">
                    Total das avulsas
                  </span>
                  <span className="font-semibold tabular-nums text-sky-900">
                    {brl(preview.totalIntegral)}
                  </span>
                </div>

                <p className="text-xs text-sky-800/80">
                  Essas avulsas ainda <strong>não existem</strong> no financeiro.
                  Elas só são criadas no momento em que você clicar em
                  &ldquo;Enviar ao financeiro&rdquo; na página da folha.
                </p>
              </section>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={pending || !preview || carregandoPreview}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              {pending ? "Aplicando..." : "Aplicar descontos"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
