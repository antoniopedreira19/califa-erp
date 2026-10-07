"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  History,
  Loader2,
  Upload,
} from "lucide-react";
import { anexarNfColaborador } from "@/lib/nf/anexos-actions";
import { diasAtePrazoNf } from "@/lib/folha/countdown-nf";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
import type { JanelaPagamento, TipoContratacao } from "@/lib/types";
import { HistoricoNfModal } from "./historico-nf-modal";

const NOMES_MES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

export interface NfVigente {
  id: string;
  arquivo_nome: string;
  uploaded_at: string;
}

export interface BacklogPendente {
  ano: number;
  mes: number;
}

export function CardNfMes(props: {
  colaboradorId: string;
  tipoContratacao: TipoContratacao;
  /** NF do mês vigente, se já anexada. */
  nfVigente: NfVigente | null;
  /** Competências anteriores com folha PJ aberta sem NF. */
  backlog: BacklogPendente[];
  anoVigente: number;
  mesVigente: number;
}) {
  // Só renderiza para tipos que exigem NF.
  if (!["pj", "mei", "clt_recibo"].includes(props.tipoContratacao)) {
    return null;
  }

  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [histOpen, setHistOpen] = React.useState(false);

  const countdown = diasAtePrazoNf({
    hoje: new Date(),
    competenciaAno: props.anoVigente,
    competenciaMes: props.mesVigente,
  });

  const janela: JanelaPagamento | null = props.nfVigente
    ? janelaDaNf({
        uploadedAt: props.nfVigente.uploaded_at,
        competenciaAno: props.anoVigente,
        competenciaMes: props.mesVigente,
      }).janela
    : null;

  function handleSelecionarArquivo() {
    inputRef.current?.click();
  }

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErro(null);
    startTransition(async () => {
      const buf = await file.arrayBuffer();
      const r = await anexarNfColaborador({
        colaboradorId: props.colaboradorId,
        ano: props.anoVigente,
        mes: props.mesVigente,
        arquivoBuffer: buf,
        arquivoNome: file.name,
        arquivoTamanhoBytes: file.size,
      });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  const nomeCompetencia = `${NOMES_MES[props.mesVigente - 1]}/${props.anoVigente}`;
  const mmSeguinte = String(
    props.mesVigente === 12 ? 1 : props.mesVigente + 1,
  ).padStart(2, "0");

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft space-y-4">
      {props.backlog.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Você tem NF pendente de{" "}
            {props.backlog
              .map((b) => `${NOMES_MES[b.mes - 1].toLowerCase()}/${b.ano}`)
              .join(", ")}
            .{" "}
            <button
              type="button"
              onClick={() => setHistOpen(true)}
              className="underline font-medium"
            >
              Ver histórico
            </button>
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FileText className="h-4 w-4 text-california-red" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Nota Fiscal</h2>
            <p className="text-xs text-muted-foreground">
              Anexe a NF do mês para receber na janela de pagamento.
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold">{nomeCompetencia}</p>

        {props.nfVigente ? (
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              <span className="truncate">
                Enviada em{" "}
                {new Date(props.nfVigente.uploaded_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {props.nfVigente.arquivo_nome}
              </span>
            </div>
            <p
              className={
                janela === "salarios"
                  ? "text-xs text-muted-foreground"
                  : "text-xs text-amber-700"
              }
            >
              {janela === "salarios"
                ? `Pagamento previsto: 03/${mmSeguinte} (janela de salários).`
                : `⚠ Fora do prazo — pagamento vai pra janela de fornecedores (08/${mmSeguinte}).`}
            </p>
          </div>
        ) : (
          <p
            className={
              countdown.vencido
                ? "mt-2 text-sm text-amber-700"
                : "mt-2 text-sm text-muted-foreground"
            }
          >
            ⏱ {countdown.mensagem}
          </p>
        )}
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={handleArquivo}
          className="hidden"
        />
        <button
          type="button"
          onClick={handleSelecionarArquivo}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {props.nfVigente ? "Substituir" : "Anexar NF"}
        </button>
        <button
          type="button"
          onClick={() => setHistOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <History className="h-4 w-4" />
          Ver histórico
        </button>
      </div>

      {histOpen && (
        <HistoricoNfModal
          colaboradorId={props.colaboradorId}
          open={histOpen}
          onOpenChange={setHistOpen}
        />
      )}
    </div>
  );
}
