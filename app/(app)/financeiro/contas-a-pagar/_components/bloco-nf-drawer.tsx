"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
} from "lucide-react";
import { baixarNfColaborador } from "@/lib/nf/anexos-actions";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
import type { FolhaOrigem, TipoContratacao } from "@/lib/types";

export interface NfResumo {
  id: string;
  arquivo_nome: string;
  uploaded_at: string;
}

/** Mostrado só pra linhas que exigem NF (origem california + pj/mei/clt_recibo).
 *  Verde quando NF está anexada; vermelho quando falta — bloqueia o botão
 *  "Aprovar" do drawer. */
export function BlocoNfDrawer(props: {
  origem: FolhaOrigem;
  tipoContratacao: TipoContratacao;
  competenciaAno: number;
  competenciaMes: number;
  nf: NfResumo | null;
}) {
  const [baixando, setBaixando] = React.useState(false);

  const exigeNf =
    props.origem === "california" &&
    ["pj", "mei", "clt_recibo"].includes(props.tipoContratacao);
  if (!exigeNf) return null;

  async function baixar() {
    if (!props.nf) return;
    setBaixando(true);
    const r = await baixarNfColaborador(props.nf.id);
    setBaixando(false);
    if (!r.ok) {
      alert(r.message);
      return;
    }
    window.open(r.url, "_blank");
  }

  if (!props.nf) {
    return (
      <div className="rounded-lg border border-california-red/20 bg-california-red/5 px-4 py-3">
        <div className="flex items-start gap-2 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">NF não anexada</p>
            <p className="text-xs opacity-80">
              Peça pro colaborador anexar em /perfil, ou use o cadastro em
              /rh/colaboradores. A aprovação fica bloqueada até isso ser feito.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const janela = janelaDaNf({
    uploadedAt: props.nf.uploaded_at,
    competenciaAno: props.competenciaAno,
    competenciaMes: props.competenciaMes,
  });

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-emerald-900 min-w-0">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span className="truncate">{props.nf.arquivo_nome}</span>
            </p>
            <p className="text-xs opacity-80">
              Enviada em{" "}
              {new Date(props.nf.uploaded_at).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              ·{" "}
              {janela.janela === "salarios"
                ? `Janela de salários (${janela.data_prevista})`
                : `Janela de fornecedores (${janela.data_prevista}) — fora do prazo`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={baixar}
          disabled={baixando}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {baixando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Baixar
        </button>
      </div>
    </div>
  );
}
