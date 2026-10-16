"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Download,
  Upload,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  contratoId: string;
  temMinuta: boolean;
  temAssinado: boolean;
  podeGerenciar: boolean;
  podeGerarMinuta: boolean;
  motivoBloqueioMinuta?: string;
}

export function BlocoArquivos({
  contratoId,
  temMinuta,
  temAssinado,
  podeGerenciar,
  podeGerarMinuta,
  motivoBloqueioMinuta,
}: Props) {
  const router = useRouter();
  const [gerandoMinuta, setGerandoMinuta] = React.useState(false);
  const [enviandoAssinado, setEnviandoAssinado] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState<string | null>(null);
  const inputFileRef = React.useRef<HTMLInputElement>(null);

  async function gerarMinuta() {
    setErro(null);
    setSucesso(null);
    setGerandoMinuta(true);
    try {
      const r = await fetch(
        `/api/freelancers/contratos/${contratoId}/gerar-minuta`,
        { method: "POST" },
      );
      const data = await r.json();
      if (!r.ok) {
        setErro(data.error ?? "Falha ao gerar minuta");
        return;
      }
      setSucesso("Minuta gerada com sucesso");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setGerandoMinuta(false);
    }
  }

  async function enviarAssinado(arquivo: File) {
    setErro(null);
    setSucesso(null);
    setEnviandoAssinado(true);
    try {
      const fd = new FormData();
      fd.set("arquivo", arquivo);
      const r = await fetch(
        `/api/freelancers/contratos/${contratoId}/enviar-assinado`,
        { method: "POST", body: fd },
      );
      const data = await r.json();
      if (!r.ok) {
        setErro(data.error ?? "Falha ao enviar PDF assinado");
        return;
      }
      setSucesso("PDF assinado enviado com sucesso");
      if (inputFileRef.current) inputFileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setEnviandoAssinado(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-white shadow-soft">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
            Arquivos
          </h3>
        </div>
      </div>

      {erro && (
        <div className="mx-5 mt-4 rounded-lg border border-california-red/30 bg-california-red/5 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-california-red shrink-0 mt-0.5" />
          <p className="text-xs text-california-red font-medium">{erro}</p>
        </div>
      )}
      {sucesso && (
        <div className="mx-5 mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-800 font-medium">{sucesso}</p>
        </div>
      )}

      <div className="p-5 space-y-5">
        {/* Minuta DOCX */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Minuta (DOCX)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Documento gerado automaticamente a partir dos dados do contrato e
              do freelancer. Pronto pra enviar pra assinatura.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {temMinuta && (
              <a
                href={`/api/freelancers/contratos/${contratoId}/baixar/minuta`}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Baixar
              </a>
            )}
            {podeGerenciar && (
              <button
                type="button"
                onClick={gerarMinuta}
                disabled={gerandoMinuta || !podeGerarMinuta}
                title={!podeGerarMinuta ? motivoBloqueioMinuta : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                  temMinuta
                    ? "border border-border bg-white text-foreground hover:border-california-red/40"
                    : "bg-california-red text-white hover:bg-california-red-hover shadow-sm",
                  (gerandoMinuta || !podeGerarMinuta) && "opacity-50 cursor-not-allowed",
                )}
              >
                {gerandoMinuta ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : temMinuta ? (
                  <RefreshCw className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {temMinuta ? "Regerar" : "Gerar minuta"}
              </button>
            )}
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* PDF assinado */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Assinado (PDF)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Envie o PDF com assinaturas das partes. Até 10 MB.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {temAssinado && (
              <a
                href={`/api/freelancers/contratos/${contratoId}/baixar/assinado`}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Baixar
              </a>
            )}
            {podeGerenciar && (
              <>
                <input
                  ref={inputFileRef}
                  type="file"
                  accept="application/pdf"
                  disabled={enviandoAssinado}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) enviarAssinado(f);
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => inputFileRef.current?.click()}
                  disabled={enviandoAssinado}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                    temAssinado
                      ? "border border-border bg-white text-foreground hover:border-california-red/40"
                      : "bg-california-red text-white hover:bg-california-red-hover shadow-sm",
                    enviandoAssinado && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {enviandoAssinado ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {temAssinado ? "Substituir" : "Enviar PDF"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
