"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Info,
  Loader2,
  PlayCircle,
  RotateCcw,
  TrendingDown,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aplicarBeneficios } from "@/lib/actions/beneficios/fechamento";

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

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export interface BotaoAplicarBeneficiosPJProps {
  ano: number;
  mes: number;
  /** Soma de valor_colaborador do preview. Null quando preview falhou ou ausente. */
  previewDescontoBeneficios: number | null;
  /** Qtd de vínculos ativos no preview. Null idem; 0 significa "sem vínculos". */
  previewQtdVinculos: number | null;
  disabled?: boolean;
  /** Render-prop pra customizar o trigger. Se não passado, usa o pill default. */
  renderTrigger?: (bind: {
    onClick: () => void;
    pending: boolean;
    disabled: boolean;
  }) => React.ReactNode;
}

export function BotaoAplicarBeneficiosPJ(
  props: BotaoAplicarBeneficiosPJProps,
): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const competenciaLabel = `${NOMES_MES[props.mes - 1]}/${props.ano}`;

  const temVinculos =
    props.previewQtdVinculos !== null && props.previewQtdVinculos > 0;
  const temDesconto =
    props.previewDescontoBeneficios !== null &&
    props.previewDescontoBeneficios > 0;
  const temPreview = temVinculos && temDesconto;

  function abrir() {
    setErro(null);
    setOpen(true);
  }

  function handleConfirmar() {
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

  return (
    <>
      {props.renderTrigger ? (
        props.renderTrigger({
          onClick: abrir,
          pending,
          disabled: Boolean(props.disabled),
        })
      ) : (
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={abrir}
            disabled={props.disabled || pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            {pending ? "Aplicando..." : "Aplicar benefícios"}
          </button>
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!pending) setOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
                <PlayCircle className="h-4 w-4" />
              </span>
              Aplicar benefícios · {competenciaLabel}
            </DialogTitle>
            <DialogDescription>
              Confirme a aplicação dos descontos de benefícios desta competência.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {temPreview ? (
              <>
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-california-red/10 text-california-red shrink-0">
                      <TrendingDown className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Desconto na folha PJ
                      </p>
                      <p className="text-lg font-bold tabular-nums text-california-red">
                        −{brl.format(props.previewDescontoBeneficios!)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-700 shrink-0">
                      <Users className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Colaboradores impactados
                      </p>
                      <p className="text-lg font-bold tabular-nums text-foreground">
                        {props.previewQtdVinculos}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  <RotateCcw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    <strong>Reversível:</strong> dá pra Desaplicar enquanto a
                    folha ainda não foi enviada ao financeiro.
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-700" />
                <span>
                  Nenhum vínculo ativo nesta competência — o snapshot será
                  criado vazio e você poderá enviar a folha normalmente.
                </span>
              </div>
            )}

            {erro && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              {pending ? "Aplicando..." : "Aplicar benefícios"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
