"use client";
// O documento de cada título da recorrência (decisão 272): a célula com os
// anexos, a pendência (pago sem documento) e o "Anexar", e o pop-up de
// anexar. O arquivo vai do navegador para o bucket `contas-avulsas`, na
// pasta do tenant (como no lançamento avulso), e a Server Action grava o
// registro. A NF no cadastro único de notas fica com a frente das Notas
// Fiscais (decisão 271).
import * as React from "react";
import { AlertTriangle, FileCheck2, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DocumentoDoAnexoField } from "@/components/financeiro/documento-do-anexo-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { documentoTipoLabel, PP_ANEXO_TAMANHO_MAX_BYTES, type DocumentoDoAnexo, type DocumentoTipo } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { anexarDocumentoAoTitulo, removerDocumentoDoTitulo } from "../actions-recorrentes";
import { signedUrlAnexoAvulsa } from "../actions-avulsas";
import { brl, dia, type AnexoDoTitulo, type TituloDaRecorrencia } from "./dados";

export function rotuloDoDoc(a: Pick<AnexoDoTitulo, "tipo" | "numero">): string {
  const t = a.tipo ? documentoTipoLabel(a.tipo) : "Documento";
  return a.numero ? `${t} ${a.numero}` : t;
}

/** O arquivo já enviado ao bucket, pronto para a Server Action gravar. */
export interface ArquivoEnviado {
  path: string;
  nome: string;
  tamanho: number;
  mimetype: string;
}

/** Envia o arquivo para `contas-avulsas/<tenant>/…` (a RLS do bucket pede a pasta do tenant). */
export async function enviarArquivo(tenantId: string, arquivo: File): Promise<{ ok: true; arquivo: ArquivoEnviado } | { ok: false; message: string }> {
  if (arquivo.size > PP_ANEXO_TAMANHO_MAX_BYTES) return { ok: false, message: `"${arquivo.name}" passa de 8 MB.` };
  const uid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const path = `${tenantId}/${uid}-${arquivo.name}`;
  const { error } = await createClient().storage.from("contas-avulsas").upload(path, arquivo, { upsert: false });
  if (error) return { ok: false, message: `Falha ao enviar "${arquivo.name}": ${error.message}` };
  return { ok: true, arquivo: { path, nome: arquivo.name, tamanho: arquivo.size, mimetype: arquivo.type } };
}

/** Tira o arquivo do bucket quando a gravação falhou depois do envio. */
export async function desfazerEnvio(path: string) {
  await createClient().storage.from("contas-avulsas").remove([path]);
}

async function abrirDocumento(anexoId: string) {
  const r = await signedUrlAnexoAvulsa(anexoId);
  if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer");
}

/** A célula de documento de UM título: os anexos, a pendência e o Anexar. */
export function DocumentosDoTitulo({
  t,
  onAnexar,
  onMudou,
}: {
  t: TituloDaRecorrencia;
  onAnexar: () => void;
  onMudou: () => void;
}) {
  const [tirando, setTirando] = React.useState<string | null>(null);
  async function tirar(a: AnexoDoTitulo) {
    if (!window.confirm(`Tirar ${rotuloDoDoc(a)} do ${t.codigo}? O arquivo é apagado.`)) return;
    setTirando(a.id);
    const r = await removerDocumentoDoTitulo(a.id);
    setTirando(null);
    if (!r.ok) window.alert(r.message);
    else onMudou();
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {t.anexos.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 py-0.5 pl-1.5 pr-1 text-[11px] font-medium text-emerald-800"
        >
          <button type="button" onClick={() => abrirDocumento(a.id)} className="inline-flex items-center gap-1 hover:underline">
            <FileText className="h-3 w-3" />
            {rotuloDoDoc(a)}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={tirando === a.id}
                onClick={() => tirar(a)}
                className="rounded p-0.5 text-emerald-700/70 hover:bg-emerald-100 hover:text-california-red disabled:opacity-40"
                aria-label={`Tirar ${rotuloDoDoc(a)}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Tirar o documento</TooltipContent>
          </Tooltip>
        </span>
      ))}
      {t.semDocumento && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-md border border-california-red/30 bg-california-red/5 px-1.5 py-0.5 text-[11px] font-semibold text-california-red">
              <AlertTriangle className="h-3 w-3" /> Pendente
            </span>
          </TooltipTrigger>
          <TooltipContent>Pago em {dia(t.pagoEm)} sem o documento da cobrança.</TooltipContent>
        </Tooltip>
      )}
      {(!t.pago || t.semDocumento) && (
        <button
          type="button"
          onClick={onAnexar}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold transition-colors",
            t.semDocumento
              ? "border-california-red bg-california-red text-white hover:bg-california-red-hover"
              : "border-border bg-white text-muted-foreground hover:border-california-red/50 hover:text-california-red",
          )}
        >
          <Paperclip className="h-3 w-3" /> Anexar
        </button>
      )}
      {t.pago && !t.semDocumento && <FileCheck2 className="h-3.5 w-3.5 text-emerald-600" aria-label="Documento em dia" />}
    </div>
  );
}

/** O campo do arquivo, igual no Anexar e no Lançar a conta. */
export function CampoDoArquivo({ arquivo, onEscolher }: { arquivo: File | null; onEscolher: (f: File | null) => void }) {
  const entrada = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
      >
        <Upload className="h-5 w-5" />
        {arquivo ? <span className="font-medium text-foreground">{arquivo.name}</span> : <span>Clique para escolher o arquivo (PDF ou imagem)</span>}
      </button>
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          onEscolher(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** O pop-up de anexar, por cima dos detalhes. */
export function AnexarDocumento({
  titulo,
  descricao,
  tenantId,
  onFechar,
  onAnexado,
}: {
  titulo: TituloDaRecorrencia | null;
  descricao: string;
  tenantId: string;
  onFechar: () => void;
  onAnexado: (mensagem: string) => void;
}) {
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [doc, setDoc] = React.useState<DocumentoDoAnexo>({ tipo: null, numero: null });
  const [erro, setErro] = React.useState<string | null>(null);
  const [pendente, setPendente] = React.useState(false);
  React.useEffect(() => {
    setArquivo(null);
    setDoc({ tipo: null, numero: null });
    setErro(null);
  }, [titulo?.id]);

  async function salvar() {
    if (!titulo) return;
    if (!arquivo) return setErro("Escolha o arquivo.");
    if (!doc.tipo) return setErro("Escolha o tipo do documento.");
    setErro(null);
    setPendente(true);
    const envio = await enviarArquivo(tenantId, arquivo);
    if (!envio.ok) {
      setPendente(false);
      return setErro(envio.message);
    }
    const r = await anexarDocumentoAoTitulo(titulo.id, { ...envio.arquivo, tipo: doc.tipo as DocumentoTipo, numero: doc.numero?.trim() || null });
    setPendente(false);
    if (!r.ok) {
      await desfazerEnvio(envio.arquivo.path);
      return setErro(r.message);
    }
    onAnexado(`Documento anexado ao ${titulo.codigo}.`);
  }

  return (
    <Dialog open={Boolean(titulo)} onOpenChange={(o) => !o && !pendente && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Anexar documento</DialogTitle>
          <DialogDescription>
            {titulo && (
              <>
                <span className="font-mono">{titulo.codigo}</span> · {descricao} · vence {dia(titulo.vencimento)} · {brl(titulo.valor)}
                {titulo.pago && <> · pago em {dia(titulo.pagoEm)}</>}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Arquivo *</Label>
            <CampoDoArquivo arquivo={arquivo} onEscolher={setArquivo} />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo e número *</Label>
            <DocumentoDoAnexoField valor={doc} onChange={setDoc} descricaoArquivo={arquivo?.name ?? "documento"} />
          </div>
          {erro && <p className="text-sm text-california-red">{erro}</p>}
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onFechar}
            disabled={pendente}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pendente}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-60"
          >
            {pendente ? "Anexando…" : "Anexar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
