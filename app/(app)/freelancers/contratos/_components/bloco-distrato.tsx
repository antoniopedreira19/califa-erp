"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Download,
  Upload,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileWarning,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

interface Props {
  contratoId: string;
  dataTerminoAtual: string | null;
  distrato: {
    data_proposta: string | null;
    motivo: string | null;
    minuta_url: string | null;
    arquivo_url: string | null;
    solicitado_em: string | null;
  };
  podeGerenciar: boolean;
}

export function BlocoDistrato({
  contratoId,
  dataTerminoAtual,
  distrato,
  podeGerenciar,
}: Props) {
  const router = useRouter();
  const [acao, setAcao] = React.useState<null | string>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState<string | null>(null);
  const [modoSolicitar, setModoSolicitar] = React.useState(false);
  const [dataProposta, setDataProposta] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const inputFileRef = React.useRef<HTMLInputElement>(null);

  const estado: "nenhum" | "solicitado" | "minuta" | "aplicado" = React.useMemo(() => {
    if (distrato.arquivo_url) return "aplicado";
    if (distrato.minuta_url) return "minuta";
    if (distrato.data_proposta) return "solicitado";
    return "nenhum";
  }, [distrato]);

  async function post(url: string, body?: FormData) {
    setErro(null);
    setSucesso(null);
    setAcao(url);
    try {
      const r = await fetch(url, { method: "POST", body });
      const data = await r.json();
      if (!r.ok) {
        setErro(data.error ?? "Falha");
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado");
      return false;
    } finally {
      setAcao(null);
    }
  }

  async function solicitar(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("data_proposta", dataProposta);
    fd.set("motivo", motivo);
    const ok = await post(
      `/api/freelancers/contratos/${contratoId}/distrato/solicitar`,
      fd,
    );
    if (ok) {
      setModoSolicitar(false);
      setDataProposta("");
      setMotivo("");
      setSucesso("Distrato solicitado");
    }
  }

  async function cancelar() {
    const ok = await post(
      `/api/freelancers/contratos/${contratoId}/distrato/cancelar`,
    );
    if (ok) setSucesso("Distrato cancelado");
  }

  async function gerarMinuta() {
    const ok = await post(
      `/api/freelancers/contratos/${contratoId}/distrato/gerar-minuta`,
    );
    if (ok) setSucesso("Minuta gerada");
  }

  async function enviarAssinado(arquivo: File) {
    const fd = new FormData();
    fd.set("arquivo", arquivo);
    const ok = await post(
      `/api/freelancers/contratos/${contratoId}/distrato/enviar-assinado`,
      fd,
    );
    if (ok) {
      setSucesso("Distrato aplicado — contrato encerrado na data proposta");
      if (inputFileRef.current) inputFileRef.current.value = "";
    }
  }

  const pending = acao !== null;

  return (
    <div className="rounded-2xl border border-border bg-white shadow-soft">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <FileWarning className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          Distrato
        </h3>
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

      <div className="p-5 space-y-4">
        {estado === "nenhum" && !modoSolicitar && (
          <>
            <p className="text-xs text-muted-foreground">
              Antecipe o término do contrato quando o freelancer não vai mais
              trabalhar o período previsto.
            </p>
            <button
              type="button"
              onClick={() => setModoSolicitar(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
            >
              <Calendar className="h-3.5 w-3.5" />
              Solicitar distrato
            </button>
          </>
        )}

        {modoSolicitar && (
          <form onSubmit={solicitar} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Nova data de término *
                </label>
                <Input
                  type="date"
                  value={dataProposta}
                  onChange={(e) => setDataProposta(e.target.value)}
                  required
                  disabled={pending}
                />
                {dataTerminoAtual && (
                  <p className="text-[10px] text-muted-foreground">
                    Data atual: {formatarData(dataTerminoAtual)}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Motivo *
              </label>
              <Textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                maxLength={1000}
                required
                disabled={pending}
                placeholder="Explique brevemente por que o contrato está sendo encerrado antes"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Calendar className="h-3.5 w-3.5" />
                )}
                Enviar solicitação
              </button>
              <button
                type="button"
                onClick={() => {
                  setModoSolicitar(false);
                  setDataProposta("");
                  setMotivo("");
                  setErro(null);
                }}
                disabled={pending}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {(estado === "solicitado" || estado === "minuta") && (
          <>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              <p>
                <strong>Distrato solicitado</strong> — nova data de término:{" "}
                <strong>{formatarData(distrato.data_proposta)}</strong>
                {dataTerminoAtual && (
                  <> (anterior {formatarData(dataTerminoAtual)})</>
                )}
              </p>
              {distrato.motivo && (
                <p className="mt-1 text-amber-800 whitespace-pre-wrap">
                  {distrato.motivo}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {distrato.minuta_url && (
                <a
                  href={`/api/freelancers/contratos/${contratoId}/baixar/distrato-minuta`}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar minuta
                </a>
              )}
              {podeGerenciar && (
                <>
                  <button
                    type="button"
                    onClick={gerarMinuta}
                    disabled={pending}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                      distrato.minuta_url
                        ? "border border-border bg-white text-foreground hover:border-california-red/40"
                        : "bg-california-red text-white hover:bg-california-red-hover shadow-sm",
                      pending && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : distrato.minuta_url ? (
                      <RefreshCw className="h-3.5 w-3.5" />
                    ) : (
                      <FileWarning className="h-3.5 w-3.5" />
                    )}
                    {distrato.minuta_url ? "Regerar minuta" : "Gerar minuta"}
                  </button>
                  {distrato.minuta_url && (
                    <>
                      <input
                        ref={inputFileRef}
                        type="file"
                        accept="application/pdf"
                        disabled={pending}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) enviarAssinado(f);
                        }}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => inputFileRef.current?.click()}
                        disabled={pending}
                        className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Enviar PDF assinado
                      </button>
                    </>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={cancelar}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Cancelar distrato
              </button>
            </div>
          </>
        )}

        {estado === "aplicado" && (
          <>
            <div className="rounded-lg bg-zinc-100 border border-zinc-300 p-3 text-xs text-zinc-700">
              <p>
                <strong>Distrato aplicado.</strong> O contrato foi encerrado em{" "}
                <strong>{formatarData(distrato.data_proposta)}</strong>.
              </p>
              {distrato.motivo && (
                <p className="mt-1 text-zinc-600 whitespace-pre-wrap">
                  Motivo: {distrato.motivo}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {distrato.minuta_url && (
                <a
                  href={`/api/freelancers/contratos/${contratoId}/baixar/distrato-minuta`}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar minuta
                </a>
              )}
              <a
                href={`/api/freelancers/contratos/${contratoId}/baixar/distrato-assinado`}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Baixar assinado
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
