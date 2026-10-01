"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Download } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  ColaboradorFeriasLancamento,
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
} from "@/lib/types";
import { cancelarMinhaSolicitacao } from "./actions";
import { obterUrlRecibo } from "../rh/ferias/actions";

type Props = {
  lancamento: ColaboradorFeriasLancamento;
};

export function LinhaHistoricoLancamento({ lancamento: l }: Props) {
  const router = useRouter();
  const [confirmando, setConfirmando] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = new Date(l.data_inicio + "T00:00:00");
  const podeCancelar =
    l.status === "pendente_aprovacao" ||
    (l.status === "aprovado" && dataInicio > hoje);
  const temRecibo =
    !!l.recibo_url &&
    (l.status === "aprovado" || l.status === "concluido");

  function baixarRecibo() {
    setErro(null);
    startTransition(async () => {
      const res = await obterUrlRecibo(l.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank");
    });
  }

  function handleCancelar() {
    setErro(null);
    startTransition(async () => {
      const res = await cancelarMinhaSolicitacao(l.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {dataInicio.toLocaleDateString("pt-BR")} a{" "}
          {new Date(l.data_fim + "T00:00:00").toLocaleDateString("pt-BR")} ·{" "}
          {l.dias} {l.dias === 1 ? "dia" : "dias"}
        </p>
        <p className="text-xs text-muted-foreground">{tipoLabel(l.tipo)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <BadgeStatusLancamento status={l.status} />
        {temRecibo && (
          <button
            type="button"
            onClick={baixarRecibo}
            title="Baixar recibo"
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Recibo
          </button>
        )}
        {podeCancelar && (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            title="Cancelar solicitação"
            className="rounded-md p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmando(false);
            setErro(null);
          }
        }}
        title="Cancelar solicitação de férias?"
        description={
          <div className="space-y-2">
            <p>
              Essa ação apaga a solicitação. Para solicitar novamente, você
              precisará preencher tudo de novo.
            </p>
            {erro && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                {erro}
              </p>
            )}
          </div>
        }
        variant="destructive"
        confirmLabel="Cancelar solicitação"
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={handleCancelar}
      />
    </li>
  );
}

function tipoLabel(t: FeriasLancamentoTipo): string {
  switch (t) {
    case "usufruto":
      return "Férias (dias de folga)";
    case "abono_combinado":
      return "Abono combinado";
    case "abono_avulso":
      return "Abono avulso";
    case "abono_excepcional":
      return "Abono excepcional";
  }
}

function BadgeStatusLancamento({ status }: { status: FeriasLancamentoStatus }) {
  const map: Record<FeriasLancamentoStatus, { label: string; cls: string }> = {
    pendente_aprovacao: {
      label: "Aguardando aprovação",
      cls: "bg-amber-100 text-amber-900",
    },
    em_analise: { label: "Em análise", cls: "bg-sky-100 text-sky-800" },
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-800" },
    reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-800" },
    cancelado: {
      label: "Cancelado",
      cls: "bg-muted text-muted-foreground",
    },
    concluido: {
      label: "Concluído",
      cls: "bg-slate-200 text-slate-700",
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}
    >
      {info.label}
    </span>
  );
}
