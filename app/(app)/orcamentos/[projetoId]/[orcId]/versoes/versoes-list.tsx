"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { versaoStatusLabel, type VersaoOrcamentoStatus } from "@/lib/types";
import { cancelarVersao, duplicarVersao } from "./actions";

export interface VersaoRow {
  id: string;
  numero_versao: number;
  nome: string | null;
  status: VersaoOrcamentoStatus;
  percentual_honorarios: number;
  percentual_imposto: number;
  moeda: string;
  itens_count: number;
  itens_total: number;
  created_at: string;
}

type PendingConfirm =
  | { type: "duplicar"; id: string; numero: number }
  | { type: "cancelar"; id: string; numero: number }
  | null;

function statusBadgeClasses(status: VersaoOrcamentoStatus): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviada_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovada":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "reprovada":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "substituida":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

export function VersoesList({
  projetoId,
  orcamentoId,
  versoes,
}: {
  projetoId: string;
  orcamentoId: string;
  versoes: VersaoRow[];
}) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState<PendingConfirm>(null);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    if (!confirm) return;
    const current = confirm;
    startTransition(async () => {
      const res =
        current.type === "duplicar"
          ? await duplicarVersao(current.id)
          : await cancelarVersao(current.id);
      if (!res.ok) {
        alert(res.message);
        setConfirm(null);
        return;
      }
      setConfirm(null);
      // duplicar redireciona no server; cancelar fica na mesma tela.
      if (current.type === "cancelar") router.refresh();
    });
  }

  const isDuplicar = confirm?.type === "duplicar";

  const versaoMaisRecente = React.useMemo(
    () => versoes.reduce((max, v) => Math.max(max, v.numero_versao), 0),
    [versoes],
  );

  return (
    <>
      <ul className="divide-y divide-border">
        {versoes.map((v) => {
          const podeCancelar =
            v.status !== "aprovada" && v.status !== "cancelada";
          const href = `/orcamentos/${projetoId}/${orcamentoId}/versoes/${v.id}`;
          const isMaisRecente = v.numero_versao === versaoMaisRecente;
          // Um passo maiores na linha destacada; o gap-1 do container
          // mantém a distância igual entre os três ícones.
          const iconBtn = cn(
            "rounded-lg text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50",
            isMaisRecente ? "p-2.5" : "p-2",
          );
          const iconSize = isMaisRecente ? "h-[18px] w-[18px]" : "h-4 w-4";
          return (
            <li key={v.id} className="group">
              <div
                role="link"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40 transition-colors"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg font-mono text-sm font-semibold shrink-0",
                    isMaisRecente
                      ? "bg-california-red text-white shadow-brand"
                      : "bg-california-red/10 text-california-red",
                  )}
                >
                  v{v.numero_versao}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={href}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "text-foreground hover:text-california-red transition-colors",
                        isMaisRecente ? "font-semibold" : "font-medium",
                      )}
                    >
                      {v.nome ?? `Versão ${v.numero_versao}`}
                    </Link>
                    {isMaisRecente && <Badge>Mais recente</Badge>}
                    <Badge className={cn("border", statusBadgeClasses(v.status))}>
                      {versaoStatusLabel(v.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {v.itens_count} {v.itens_count === 1 ? "item" : "itens"} ·{" "}
                    {formatCurrency(v.itens_total, v.moeda)} · honor.{" "}
                    {v.percentual_honorarios.toString().replace(".", ",")}% ·
                    imp. {v.percentual_imposto.toString().replace(".", ",")}%
                  </p>
                </div>

                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setConfirm({
                        type: "duplicar",
                        id: v.id,
                        numero: v.numero_versao,
                      })
                    }
                    disabled={pending}
                    title="Duplicar versão"
                    className={iconBtn}
                  >
                    <Copy className={iconSize} />
                  </button>
                  {podeCancelar && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({
                          type: "cancelar",
                          id: v.id,
                          numero: v.numero_versao,
                        })
                      }
                      disabled={pending}
                      title="Cancelar versão"
                      className={iconBtn}
                    >
                      <X className={iconSize} />
                    </button>
                  )}
                  <Link
                    href={href}
                    prefetch={false}
                    title="Abrir versão"
                    className={cn(iconBtn, isMaisRecente && "text-foreground")}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          isDuplicar
            ? `Duplicar v${confirm?.numero}?`
            : `Cancelar v${confirm?.numero}?`
        }
        description={
          isDuplicar ? (
            <>
              Uma nova versão será criada em{" "}
              <strong className="text-foreground">rascunho</strong> com
              todos os itens copiados. Você será redirecionado para editá-la.
            </>
          ) : (
            <>
              A versão fica marcada como{" "}
              <strong className="text-foreground">cancelada</strong> e não
              pode ser reativada. Ela continua visível no histórico.
            </>
          )
        }
        confirmLabel={isDuplicar ? "Duplicar" : "Cancelar versão"}
        cancelLabel="Voltar"
        variant={isDuplicar ? "default" : "destructive"}
        pending={pending}
        onConfirm={handleConfirm}
      />
    </>
  );
}
