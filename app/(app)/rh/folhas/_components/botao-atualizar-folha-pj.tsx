"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ressincronizarSalariosPj } from "../actions";

interface Resultado {
  atualizadas: number;
  inalteradas: number;
  puladas_sem_vigente: string[];
  recalculadas_ferias: number;
}

export interface BotaoAtualizarFolhaPjProps {
  ano: number;
  mes: number;
  /** Render-prop pra customizar o trigger. Se não passado, usa o pill default. */
  renderTrigger?: (bind: {
    onClick: () => void;
    pending: boolean;
    disabled: boolean;
  }) => React.ReactNode;
}

export function BotaoAtualizarFolhaPj(props: BotaoAtualizarFolhaPjProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<Resultado | null>(null);

  function handleAtualizar() {
    setErro(null);
    setResultado(null);
    startTransition(async () => {
      const res = await ressincronizarSalariosPj({
        ano: props.ano,
        mes: props.mes,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setResultado({
        atualizadas: res.atualizadas,
        inalteradas: res.inalteradas,
        puladas_sem_vigente: res.puladas_sem_vigente,
        recalculadas_ferias: res.recalculadas_ferias,
      });
    });
  }

  function fechar() {
    setResultado(null);
    setErro(null);
    router.refresh();
  }

  return (
    <>
      {props.renderTrigger ? (
        props.renderTrigger({ onClick: handleAtualizar, pending, disabled: pending })
      ) : (
        <button
          type="button"
          onClick={handleAtualizar}
          disabled={pending}
          title="Puxa o salário vigente de cada colaborador e aplica pro-rata de férias se houver. Preserva o desconto de benefícios já aplicado."
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {pending ? "Atualizando..." : "Atualizar PJ"}
        </button>
      )}

      <Dialog
        open={!!resultado || !!erro}
        onOpenChange={(v) => {
          if (!v) fechar();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {erro ? "Falha ao atualizar folha PJ" : "Folha PJ atualizada"}
            </DialogTitle>
            <DialogDescription>
              Competência {String(props.mes).padStart(2, "0")}/{props.ano}.
            </DialogDescription>
          </DialogHeader>

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-sm text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {resultado && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {resultado.atualizadas > 0 ? (
                    <>
                      {resultado.atualizadas} linha
                      {resultado.atualizadas === 1 ? "" : "s"} atualizada
                      {resultado.atualizadas === 1 ? "" : "s"} (salário vigente
                      {resultado.recalculadas_ferias > 0 ? " + pro-rata de férias" : ""}
                      ).
                    </>
                  ) : (
                    <>Nenhuma linha precisou de ajuste — tudo já alinhado.</>
                  )}
                  {resultado.inalteradas > 0 && (
                    <>
                      {" "}
                      ({resultado.inalteradas} já estava
                      {resultado.inalteradas === 1 ? "" : "m"} ok)
                    </>
                  )}
                </span>
              </div>

              {resultado.recalculadas_ferias > 0 && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                  <p className="font-semibold mb-1">
                    Férias aplicadas em {resultado.recalculadas_ferias}{" "}
                    {resultado.recalculadas_ferias === 1
                      ? "linha"
                      : "linhas"}
                  </p>
                  <p className="opacity-80">
                    Pro-rata: salário × (30 − dias de férias) / 30. A folha de
                    férias cobre os dias fora.
                  </p>
                </div>
              )}

              {resultado.puladas_sem_vigente.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-semibold mb-1">
                    Sem salário vigente no cadastro:
                  </p>
                  <p>{resultado.puladas_sem_vigente.join(", ")}</p>
                  <p className="mt-1 opacity-70">
                    Registre o salário atual na ficha do colaborador e rode
                    de novo.
                  </p>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Só linhas em rascunho são tocadas. Enviadas, aprovadas ou pagas
                ficam imutáveis.
              </p>
            </div>
          )}

          <div className="flex justify-end border-t border-border pt-4">
            <button
              type="button"
              onClick={fechar}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors"
            >
              Fechar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
