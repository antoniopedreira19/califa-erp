"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import {
  previewImportacao,
  confirmarImportacao,
  type PreviewResult,
} from "./importar-actions";

interface Props {
  orcamentoId: string;
  disabled?: boolean;
  disabledReason?: string;
}

type Preview = Extract<PreviewResult, { ok: true }>["preview"];

type Stage = "select" | "loading" | "preview" | "saving";

export function ImportarPlanilhaDrawer({
  orcamentoId,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>("select");
  const [erro, setErro] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setStage("select");
    setErro(null);
    setPreview(null);
    setArquivo(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivo(file);
    setErro(null);
    setStage("loading");

    const fd = new FormData();
    fd.set("arquivo", file);
    const res = await previewImportacao(orcamentoId, fd);

    if (!res.ok) {
      setErro(res.message);
      setStage("select");
      return;
    }

    setPreview(res.preview);
    setStage("preview");
  }

  async function handleConfirm() {
    if (!arquivo) return;
    setStage("saving");
    setErro(null);

    const fd = new FormData();
    fd.set("arquivo", arquivo);
    const res = await confirmarImportacao(orcamentoId, fd);

    if (!res.ok) {
      setErro(res.message);
      setStage("preview");
      return;
    }

    // Sucesso: fecha e navega para a nova versão.
    setOpen(false);
    reset();
    router.push(`/orcamentos/${res.orcamento_id}/versoes/${res.versao_id}`);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground shadow-sm hover:border-california-red/40 hover:text-california-red transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="h-3.5 w-3.5" />
          Importar planilha
        </button>
      </DialogTrigger>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Importar planilha de orçamento</DialogTitle>
          <DialogDescription>
            Envie o arquivo .xlsx no formato padrão da agência (aba
            &ldquo;Oficial&rdquo;). Uma nova versão é criada em rascunho com
            os grupos e itens da planilha.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {stage === "select" && (
              <div className="space-y-4">
                <label
                  htmlFor="arquivo"
                  className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-muted/20 px-6 py-12 text-center cursor-pointer hover:border-california-red/40 hover:bg-california-red/5 transition-colors"
                >
                  <FileSpreadsheet className="h-10 w-10 text-california-red/70" />
                  <div>
                    <p className="font-semibold text-foreground">
                      Escolher arquivo .xlsx
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Até 5 MB · aba &ldquo;Oficial&rdquo; da planilha padrão
                    </p>
                  </div>
                </label>
                <input
                  ref={inputRef}
                  id="arquivo"
                  type="file"
                  accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleFileChange}
                />

                <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5">
                  <p className="font-medium text-foreground">Como o parser lê:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>
                      <b>Grupo</b>: coluna A com o nome do grupo + coluna G com o subtotal.
                    </li>
                    <li>
                      <b>Item</b>: coluna C com o nome do item + coluna D com valor unitário.
                    </li>
                    <li>
                      Colunas D · R$, E · QT, F · D/M, H · tipo (A/B/C/D).
                    </li>
                    <li>
                      Tipos <b>F</b> ou &ldquo;A e D&rdquo; ficam de fora com aviso — só A/B/C/D suportados.
                    </li>
                    <li>
                      Blocos <b>PLANEJADO</b>/<b>REALIZADO</b> e linhas de subtotal/imposto/honorários/faturamento são ignorados.
                    </li>
                  </ul>
                </div>

                {erro && (
                  <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{erro}</span>
                  </div>
                )}
              </div>
            )}

            {stage === "loading" && (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <span className="h-8 w-8 rounded-full border-2 border-california-red/30 border-t-california-red animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Lendo a planilha...
                </p>
              </div>
            )}

            {stage === "preview" && preview && (
              <PreviewPanel preview={preview} arquivoNome={arquivo?.name ?? ""} />
            )}

            {stage === "saving" && (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <span className="h-8 w-8 rounded-full border-2 border-california-red/30 border-t-california-red animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Criando a versão e gravando os itens...
                </p>
              </div>
            )}

            {stage === "preview" && erro && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            {stage === "preview" && (
              <button
                type="button"
                onClick={handleConfirm}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
              >
                <CheckCircle2 className="h-4 w-4" />
                Criar versão importada
              </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Dialog>
  );
}

function PreviewPanel({
  preview,
  arquivoNome,
}: {
  preview: Preview;
  arquivoNome: string;
}) {
  const totalGeral = preview.grupos.reduce((s, g) => s + g.total_bruto, 0);
  const totalItens = preview.grupos.reduce((s, g) => s + g.itens_count, 0);
  const ajustes = preview.warnings.filter((w) => w.severidade === "ajuste");
  const ignoradas = preview.warnings.filter((w) => w.severidade === "ignorada");

  return (
    <div className="space-y-5">
      {/* Cabeçalho do arquivo */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <FileSpreadsheet className="h-5 w-5 text-california-red shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground truncate">{arquivoNome}</p>
          <p className="text-xs text-muted-foreground">
            Aba lida: <b className="text-foreground">{preview.aba}</b> ·{" "}
            {(preview.arquivo_tamanho / 1024).toFixed(0)} KB
          </p>
        </div>
      </div>

      {/* Contagens */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Grupos" value={preview.grupos.length} />
        <Stat label="Itens" value={totalItens} />
        <Stat label="Total bruto" value={formatCurrency(totalGeral, "BRL")} mono />
      </div>

      {preview.percentual_honorarios !== null && (
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          Detectamos <b className="text-foreground">
            {preview.percentual_honorarios.toString().replace(".", ",")}%
          </b>{" "}
          de honorários no resumo — vamos aplicar na versão criada.
        </div>
      )}

      {/* Grupos */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-muted/40 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          Grupos que serão criados
        </div>
        <ul className="divide-y divide-border">
          {preview.grupos.map((g) => (
            <li
              key={`${g.ordem}-${g.nome}`}
              className="flex items-center justify-between px-4 py-2.5 text-sm"
            >
              <span className="font-medium text-foreground">{g.nome}</span>
              <span className="text-xs text-muted-foreground">
                {g.itens_count} {g.itens_count === 1 ? "item" : "itens"} ·{" "}
                <span className="font-mono">
                  {formatCurrency(g.total_bruto, "BRL")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Warnings */}
      {(ajustes.length > 0 || ignoradas.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {ajustes.length} {ajustes.length === 1 ? "ajuste" : "ajustes"}
            {ignoradas.length > 0 && (
              <>
                {" · "}
                {ignoradas.length}{" "}
                {ignoradas.length === 1 ? "linha ignorada" : "linhas ignoradas"}
              </>
            )}
          </div>
          <ul className="divide-y divide-amber-200/70 max-h-52 overflow-y-auto">
            {[...ajustes, ...ignoradas].slice(0, 40).map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-2 px-4 py-2 text-xs text-amber-900"
              >
                <Badge
                  className={
                    w.severidade === "ignorada"
                      ? "bg-amber-200 text-amber-900 border-amber-300"
                      : "bg-amber-100 text-amber-800 border-amber-200"
                  }
                >
                  L{w.linha}
                  {w.coluna ? `·${w.coluna}` : ""}
                </Badge>
                <span className="flex-1">{w.motivo}</span>
              </li>
            ))}
            {ajustes.length + ignoradas.length > 40 && (
              <li className="px-4 py-2 text-xs text-amber-800/70">
                + {ajustes.length + ignoradas.length - 40} outros avisos
                omitidos.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold text-foreground ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
