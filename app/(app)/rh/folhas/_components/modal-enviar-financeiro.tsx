"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Send, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  enviarCompetencia,
  resumoEnvioCompetencia,
  type ResumoEnvioCompetencia,
} from "../importar-actions";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarVencimento(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export interface ModalEnviarFinanceiroProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ano: number;
  mes: number;
  onEnviado?: (linhasEnviadas: number) => void;
}

export function ModalEnviarFinanceiro(props: ModalEnviarFinanceiroProps) {
  const router = useRouter();
  const [resumo, setResumo] = React.useState<ResumoEnvioCompetencia | null>(
    null,
  );
  const [carregandoResumo, setCarregandoResumo] = React.useState(false);
  const [enviando, startEnviar] = React.useTransition();
  const [erroResumo, setErroResumo] = React.useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = React.useState<string | null>(null);

  // Busca o resumo quando o modal abre.
  React.useEffect(() => {
    if (!props.open) {
      setResumo(null);
      setErroResumo(null);
      setErroEnvio(null);
      return;
    }
    setCarregandoResumo(true);
    setErroResumo(null);
    (async () => {
      const r = await resumoEnvioCompetencia({ ano: props.ano, mes: props.mes });
      setCarregandoResumo(false);
      if (!r.ok) {
        setErroResumo(r.message);
        return;
      }
      setResumo(r);
    })();
  }, [props.open, props.ano, props.mes]);

  function handleConfirmar() {
    if (!resumo) return;
    setErroEnvio(null);
    startEnviar(async () => {
      const r = await enviarCompetencia({ ano: props.ano, mes: props.mes });
      if (!r.ok) {
        setErroEnvio(r.message);
        return;
      }
      props.onEnviado?.(r.linhas_enviadas);
      props.onOpenChange(false);
      router.refresh();
    });
  }

  const totalFolha =
    (resumo?.pj.total ?? 0) + (resumo?.clt.total ?? 0);
  const totalGeral = totalFolha + (resumo?.total_operadoras ?? 0);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar competência ao financeiro</DialogTitle>
          <DialogDescription>
            Revise o que será enviado. A aprovação continua em Contas a Pagar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {carregandoResumo && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-6 text-sm text-muted-foreground justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando resumo...
            </div>
          )}

          {erroResumo && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erroResumo}</span>
            </div>
          )}

          {resumo && (
            <>
              {/* Bloco folha */}
              <section className="rounded-xl border border-border bg-background">
                <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Folha salarial
                  </p>
                  <p className="text-xs text-muted-foreground">
                    1 título por colaborador
                  </p>
                </header>
                <div className="divide-y divide-border">
                  <LinhaResumo
                    rotulo="PJ"
                    detalhe={`${resumo.pj.linhas} linha${resumo.pj.linhas === 1 ? "" : "s"}`}
                    valor={brl.format(resumo.pj.total)}
                  />
                  <LinhaResumo
                    rotulo="CLT"
                    detalhe={`${resumo.clt.linhas} linha${resumo.clt.linhas === 1 ? "" : "s"}`}
                    valor={brl.format(resumo.clt.total)}
                  />
                </div>
                <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2.5">
                  <p className="text-sm font-medium text-foreground">
                    Subtotal folha
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {brl.format(totalFolha)}
                  </p>
                </div>
              </section>

              {/* Bloco operadoras */}
              <section className="rounded-xl border border-border bg-background">
                <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Avulsas de benefícios
                  </p>
                  <p className="text-xs text-muted-foreground">
                    1 avulsa por operadora
                  </p>
                </header>
                {resumo.operadoras.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground text-center">
                    Nenhuma avulsa será gerada nesta competência.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {resumo.operadoras.map((op) => (
                      <LinhaResumo
                        key={op.nome}
                        rotulo={op.nome}
                        detalhe={`venc. ${formatarVencimento(op.vencimento)}`}
                        valor={brl.format(op.valor_integral)}
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2.5">
                  <p className="text-sm font-medium text-foreground">
                    Subtotal operadoras
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {brl.format(resumo.total_operadoras)}
                  </p>
                </div>
              </section>

              {/* Total geral */}
              <div className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">
                    Total enviado ao financeiro
                  </p>
                  <p className="text-xl font-bold tabular-nums text-california-red">
                    {brl.format(totalGeral)}
                  </p>
                </div>
              </div>

              {/* Nota do repasse */}
              {resumo.total_descontado_colaborador > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Dos{" "}
                    <strong>{brl.format(resumo.total_operadoras)}</strong> das
                    operadoras,{" "}
                    <strong>
                      {brl.format(resumo.total_descontado_colaborador)}
                    </strong>{" "}
                    já foi descontado dos salários PJ (repasse). Parte real da
                    empresa:{" "}
                    <strong>{brl.format(resumo.total_parte_empresa)}</strong>.
                  </span>
                </div>
              )}

              {erroEnvio && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{erroEnvio}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => props.onOpenChange(false)}
            disabled={enviando}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={!resumo || enviando || resumo.rascunhos_a_enviar === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {enviando ? "Enviando..." : "Confirmar envio"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinhaResumo(props: {
  rotulo: string;
  detalhe: string;
  valor: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {props.rotulo}
        </p>
        <p className="text-xs text-muted-foreground">{props.detalhe}</p>
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
        {props.valor}
      </p>
    </div>
  );
}
