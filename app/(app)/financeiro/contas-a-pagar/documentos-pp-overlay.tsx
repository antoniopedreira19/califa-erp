"use client";

/**
 * "Visualizar documentos" (Tela 3.2) — o PDF da PP e o anexo enviado pela
 * produção LADO A LADO, para conferência antes de aprovar ou reprovar.
 *
 * Substitui o antigo "Ver PP", que abria só o PDF numa aba nova e obrigava
 * o financeiro a alternar entre janelas para comparar o pedido com a nota.
 */

import * as React from "react";
import { AlertCircle, FileText, Paperclip, X } from "lucide-react";
import {
  signedUrlPdf,
  signedUrlAnexo,
} from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

interface Anexo {
  id: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
}

export function DocumentosPPOverlay({
  open,
  onClose,
  ppId,
  ppCodigo,
  anexos,
  rodape,
}: {
  open: boolean;
  onClose: () => void;
  ppId: string;
  ppCodigo: string;
  anexos: Anexo[];
  /** Ações de aprovação, quando a PP ainda está em avaliação. */
  rodape?: React.ReactNode;
}) {
  const [urlPdf, setUrlPdf] = React.useState<string | null>(null);
  const [urlAnexo, setUrlAnexo] = React.useState<string | null>(null);
  const [anexoAtivo, setAnexoAtivo] = React.useState(0);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);

  const anexo = anexos[anexoAtivo] ?? null;

  React.useEffect(() => {
    if (!open) return;
    setAnexoAtivo(0);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    (async () => {
      const [pdf, anx] = await Promise.all([
        signedUrlPdf(ppId),
        anexo ? signedUrlAnexo(anexo.id) : Promise.resolve(null),
      ]);
      if (cancelado) return;
      if (pdf.ok) setUrlPdf(pdf.url);
      else setErro(pdf.message);
      if (anx && anx.ok) setUrlAnexo(anx.url);
      else if (anx && !anx.ok) setErro(anx.message);
      else setUrlAnexo(null);
      setCarregando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [open, ppId, anexo]);

  // Esc fecha, como em qualquer overlay do sistema.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const anexoEhImagem =
    anexo != null && /\.(png|jpe?g|webp|gif)$/i.test(anexo.arquivo_nome_original);

  return (
    <div className="fixed inset-0 z-[75] flex flex-col bg-[#181818]/[0.72] p-6">
      <div className="flex flex-wrap items-center gap-3 pb-3.5">
        <span className="font-mono text-[15px] font-bold text-white">{ppCodigo}</span>
        <span className="text-xs text-white/70">
          Conferência lado a lado · PP e documento anexo
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          <X className="h-3 w-3" />
          Fechar
        </button>
      </div>

      {erro && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-california-red/50 bg-california-red/15 p-3 text-sm text-white">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <Painel
          icone={<FileText className="h-4 w-4 text-california-red" />}
          titulo="Pedido de Produção · PDF"
          legenda={`${ppCodigo}.pdf`}
        >
          {urlPdf ? (
            <iframe
              src={urlPdf}
              title={`PDF da PP ${ppCodigo}`}
              className="h-full w-full border-0"
            />
          ) : (
            <Vazio texto={carregando ? "Carregando o PDF..." : "PDF indisponível."} />
          )}
        </Painel>

        <Painel
          icone={<Paperclip className="h-4 w-4 text-violet-700" />}
          titulo="Documento anexo"
          legenda={anexo?.arquivo_nome_original ?? "Nenhum anexo enviado"}
          extra={
            anexos.length > 1 ? (
              <div className="flex items-center gap-1">
                {anexos.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAnexoAtivo(i)}
                    className={
                      i === anexoAtivo
                        ? "rounded-md bg-california-red px-2 py-0.5 text-[11px] font-semibold text-white"
                        : "rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    }
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            ) : null
          }
        >
          {!anexo ? (
            <Vazio texto="A produção não enviou anexo nesta PP." />
          ) : urlAnexo ? (
            anexoEhImagem ? (
              <div className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-3">
                {/* Imagem de storage com URL assinada — `next/image` exigiria
                    domínio configurado e não agrega nada aqui. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={urlAnexo}
                  alt={anexo.arquivo_nome_original}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <iframe
                src={urlAnexo}
                title={anexo.arquivo_nome_original}
                className="h-full w-full border-0"
              />
            )
          ) : (
            <Vazio texto={carregando ? "Carregando o anexo..." : "Anexo indisponível."} />
          )}
        </Painel>
      </div>

      {rodape && <div className="flex-none pt-3.5">{rodape}</div>}
    </div>
  );
}

function Painel({
  icone,
  titulo,
  legenda,
  extra,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  legenda: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white">
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-2.5">
        {icone}
        <span className="text-xs font-bold">{titulo}</span>
        {extra}
        <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground">
          {legenda}
        </span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/40 p-6 text-center">
      <p className="text-xs text-muted-foreground">{texto}</p>
    </div>
  );
}
