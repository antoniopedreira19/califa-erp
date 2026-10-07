"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gerarFolha } from "../actions";

interface Resultado {
  criadas: number;
  ja_existiam: number;
  pulados_sem_salario: string[];
  pulados_sem_alocacao: string[];
  pulados_sem_rateio: string[];
}

export function BotaoGerarFolhaPj(props: { ano: number; mes: number }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<Resultado | null>(null);

  function handleGerar() {
    setErro(null);
    setResultado(null);
    startTransition(async () => {
      const res = await gerarFolha({ ano: props.ano, mes: props.mes });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setResultado({
        criadas: res.criadas,
        ja_existiam: res.ja_existiam,
        pulados_sem_salario: res.pulados_sem_salario,
        pulados_sem_alocacao: res.pulados_sem_alocacao,
        pulados_sem_rateio: res.pulados_sem_rateio,
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
      <button
        type="button"
        onClick={handleGerar}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {pending ? "Gerando..." : "Gerar PJ"}
      </button>

      <Dialog
        open={!!resultado || !!erro}
        onOpenChange={(v) => {
          if (!v) fechar();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {erro ? "Falha ao gerar folha PJ" : "Folha PJ gerada"}
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
                  {resultado.criadas > 0 && (
                    <>
                      {resultado.criadas} linha
                      {resultado.criadas === 1 ? "" : "s"} criada
                      {resultado.criadas === 1 ? "" : "s"}.
                    </>
                  )}
                  {resultado.ja_existiam > 0 && (
                    <>
                      {" "}
                      {resultado.ja_existiam} já existia
                      {resultado.ja_existiam === 1 ? "" : "m"}.
                    </>
                  )}
                  {resultado.criadas === 0 && resultado.ja_existiam === 0 && (
                    <>Nenhum colaborador PJ/MEI/híbrido elegível na competência.</>
                  )}
                </span>
              </div>

              {(resultado.pulados_sem_salario.length > 0 ||
                resultado.pulados_sem_alocacao.length > 0 ||
                resultado.pulados_sem_rateio.length > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-semibold mb-1">
                    Alguns colaboradores ficaram de fora:
                  </p>
                  {resultado.pulados_sem_salario.length > 0 && (
                    <p>
                      <strong>Sem salário vigente:</strong>{" "}
                      {resultado.pulados_sem_salario.join(", ")}
                    </p>
                  )}
                  {resultado.pulados_sem_alocacao.length > 0 && (
                    <p>
                      <strong>Sem alocação vigente:</strong>{" "}
                      {resultado.pulados_sem_alocacao.join(", ")}
                    </p>
                  )}
                  {resultado.pulados_sem_rateio.length > 0 && (
                    <p>
                      <strong>
                        Alocação em &quot;Todas as regionais&quot; mas empresa
                        sem rateio configurado para {props.ano}:
                      </strong>{" "}
                      {resultado.pulados_sem_rateio.join(", ")}
                    </p>
                  )}
                  <p className="mt-1 opacity-70">
                    Complete os dados no cadastro do colaborador (ou configure
                    o rateio anual da empresa) e gere a folha de novo — quem
                    já entrou não é duplicado.
                  </p>
                </div>
              )}
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
