"use client";

/**
 * Os anexos de Impostos a Pagar (módulo fiscal, entrega 2): a guia (DARF ou
 * guia municipal), o comprovante de pagamento e a guia nova da correção.
 *
 * O arquivo sobe do navegador direto para o bucket privado `impostos`, em
 * `<tenant_id>/<pasta>/<uuid>-<nome>` — o padrão dos anexos de contas
 * avulsas (`conta-avulsa-drawer.tsx`); o bucket só aceita admin e
 * financeiro do tenant (RLS) e PDF, PNG ou JPEG até 10 MB. A Server Action
 * que grava confere de novo que o caminho é do tenant. Para abrir, uma URL
 * assinada pela action `urlDoAnexoImposto`.
 *
 * Arquivo trocado ou removido antes de salvar sai do bucket; o que já está
 * gravado num imposto (a guia da aprovação) nunca é apagado daqui.
 */

import * as React from "react";
import { FileText, Loader2, Paperclip, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { urlDoAnexoImposto } from "@/app/(app)/financeiro/fiscal/impostos/actions";

export const BUCKET_IMPOSTOS = "impostos";

const TAMANHO_MAXIMO = 10 * 1024 * 1024;
const TIPOS_ACEITOS = ["application/pdf", "image/png", "image/jpeg"];

export type PastaDoAnexo = "guias" | "comprovantes" | "correcoes";

/** Sem acento e sem espaço: a chave do Storage recusa alguns caracteres. */
function nomeSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-120);
}

/** O nome do arquivo, para a tela: o fim do caminho, sem o uuid da frente. */
export function nomeDoAnexo(path: string): string {
  const fim = path.split("/").pop() ?? path;
  return fim.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

/** Sobe o arquivo e devolve o caminho no bucket. */
export async function enviarAnexoImposto(
  file: File,
  tenantId: string,
  pasta: PastaDoAnexo,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (file.size > TAMANHO_MAXIMO) return { ok: false, message: `“${file.name}” passa de 10 MB.` };
  if (!TIPOS_ACEITOS.includes(file.type)) {
    return { ok: false, message: `“${file.name}”: anexe um PDF, PNG ou JPEG.` };
  }
  const uid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const path = `${tenantId}/${pasta}/${uid}-${nomeSeguro(file.name)}`;
  const { error } = await createClient()
    .storage.from(BUCKET_IMPOSTOS)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, message: `Falha ao enviar “${file.name}”: ${error.message}` };
  return { ok: true, path };
}

/** Tira do bucket um arquivo que subiu e não foi gravado. Silencioso. */
export function descartarAnexoImposto(path: string) {
  void createClient()
    .storage.from(BUCKET_IMPOSTOS)
    .remove([path])
    .catch(() => undefined);
}

/** Abre o anexo numa aba nova (URL assinada de 10 minutos). */
export function useAbrirAnexo() {
  const [abrindo, setAbrindo] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  async function abrir(path: string) {
    setErro(null);
    setAbrindo(true);
    // A aba abre no clique (o navegador barra janela aberta depois de await).
    const aba = window.open("about:blank", "_blank");
    const res = await urlDoAnexoImposto(path).catch(() => null);
    setAbrindo(false);
    if (!res || !res.ok) {
      aba?.close();
      setErro(res && !res.ok ? res.message : "Não foi possível abrir o anexo.");
      return;
    }
    if (aba) aba.location.href = res.url;
    else window.open(res.url, "_blank", "noopener");
  }
  return { abrir, abrindo, erro };
}

/** O link de um anexo gravado: o nome, que abre o arquivo. */
export function LinkAnexo({ path, className }: { path: string | null; className?: string }) {
  const { abrir, abrindo, erro } = useAbrirAnexo();
  if (!path) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex min-w-0 flex-col", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void abrir(path);
        }}
        title={nomeDoAnexo(path)}
        className="inline-flex min-w-0 items-center gap-1 text-left text-california-red"
      >
        {abrindo ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Paperclip className="h-3 w-3 shrink-0" />}
        <span className="truncate underline-offset-2 hover:underline">{nomeDoAnexo(path)}</span>
      </button>
      {erro && <span className="text-[10.5px] text-california-red">{erro}</span>}
    </span>
  );
}

/**
 * O estado de um campo de anexo: o caminho escolhido e se ele subiu nesta
 * tela (só esse sai do bucket ao trocar, remover ou desistir).
 */
export function useCampoDeAnexo(inicial: string | null) {
  const [path, setPath] = React.useState<string | null>(inicial);
  const atual = React.useRef<string | null>(inicial);
  const enviados = React.useRef<Set<string>>(new Set());
  const trocar = React.useCallback((novo: string | null, enviadoAgora: boolean) => {
    const antigo = atual.current;
    if (antigo && antigo !== novo && enviados.current.has(antigo)) {
      enviados.current.delete(antigo);
      descartarAnexoImposto(antigo);
    }
    if (novo && enviadoAgora) enviados.current.add(novo);
    atual.current = novo;
    setPath(novo);
  }, []);
  /** Desistiu sem salvar: o que subiu nesta tela sai do bucket. */
  const descartarEnviados = React.useCallback(() => {
    for (const p of enviados.current) descartarAnexoImposto(p);
    enviados.current.clear();
  }, []);
  /** Salvou: o que subiu passa a ser do imposto e fica. */
  const confirmar = React.useCallback(() => enviados.current.clear(), []);
  return { path, trocar, descartarEnviados, confirmar };
}

/** O campo de anexo dos diálogos: escolher sobe o arquivo na hora. */
export function CampoAnexo({
  rotulo,
  dica,
  path,
  onChange,
  tenantId,
  pasta,
  obrigatorio,
  aceita = "PDF ou imagem, até 10 MB",
  destacar,
}: {
  rotulo: string;
  dica?: string;
  path: string | null;
  /** `enviadoAgora`: o arquivo subiu nesta tela (e sai se for trocado). */
  onChange: (path: string | null, enviadoAgora: boolean) => void;
  tenantId: string;
  pasta: PastaDoAnexo;
  obrigatorio?: boolean;
  aceita?: string;
  /** Faltou o anexo obrigatório na confirmação. */
  destacar?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const { abrir } = useAbrirAnexo();

  async function escolher(file: File) {
    setErro(null);
    setEnviando(file.name);
    const res = await enviarAnexoImposto(file, tenantId, pasta);
    setEnviando(null);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onChange(res.path, true);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">
        {rotulo}
        {obrigatorio && <span className="text-california-red"> *</span>}
      </p>
      {enviando ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="truncate">Enviando {enviando}…</span>
        </div>
      ) : path ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-sm">
          <button
            type="button"
            onClick={() => void abrir(path)}
            className="flex min-w-0 items-center gap-2 text-left hover:text-california-red"
            title="Abrir o arquivo"
          >
            <FileText className="h-4 w-4 shrink-0 text-california-red" />
            <span className="truncate">{nomeDoAnexo(path)}</span>
          </button>
          <button
            type="button"
            onClick={() => onChange(null, false)}
            className="rounded p-1 text-muted-foreground hover:text-california-red"
            aria-label="Remover arquivo"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-white px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red",
            destacar && "border-california-red",
          )}
        >
          <Upload className="h-4 w-4" />
          Selecionar arquivo
          <span className="text-[11px] text-muted-foreground/80">· {aceita}</span>
        </button>
      )}
      {erro && <p className="text-[11.5px] text-california-red">{erro}</p>}
      {dica && !erro && <p className="text-[11.5px] text-muted-foreground">{dica}</p>}
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept="application/pdf,image/png,image/jpeg"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (f) void escolher(f);
        }}
      />
    </div>
  );
}

/** Um anexo em versão de linha de tabela (a baixa em lote). */
export function AnexoCompacto({
  rotulo,
  path,
  onChange,
  tenantId,
  pasta,
  destacar,
}: {
  rotulo: string;
  path: string | null;
  onChange: (path: string | null, enviadoAgora: boolean) => void;
  tenantId: string;
  pasta: PastaDoAnexo;
  destacar?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function escolher(file: File) {
    setErro(null);
    setEnviando(true);
    const res = await enviarAnexoImposto(file, tenantId, pasta);
    setEnviando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onChange(res.path, true);
  }

  return (
    <>
      {enviando ? (
        <span className="flex items-center gap-1 rounded-md border border-border bg-white px-1.5 py-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 flex-none animate-spin" />
          Enviando…
        </span>
      ) : path ? (
        <span className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-white px-1.5 py-1 text-[11px]">
          <FileText className="h-3 w-3 flex-none text-california-red" />
          <span className="truncate" title={nomeDoAnexo(path)}>
            {nomeDoAnexo(path)}
          </span>
          <button
            type="button"
            onClick={() => onChange(null, false)}
            aria-label="Remover arquivo"
            className="ml-auto flex-none rounded p-0.5 text-muted-foreground hover:text-california-red"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border bg-white px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red",
            destacar && "border-california-red",
          )}
        >
          <Upload className="h-3 w-3" />
          {rotulo}
        </button>
      )}
      {erro && <span className="block text-[10.5px] text-california-red">{erro}</span>}
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept="application/pdf,image/png,image/jpeg"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (f) void escolher(f);
        }}
      />
    </>
  );
}
