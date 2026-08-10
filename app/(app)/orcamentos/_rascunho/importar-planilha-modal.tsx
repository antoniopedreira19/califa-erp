"use client";

import * as React from "react";
import { AlertCircle, Check, FileSpreadsheet, UploadCloud } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { parsePlanilhaRascunho, type ParseRascunhoResult } from "./actions";
import type { GrupoPayload } from "./tipos";

export interface PlanilhaLida {
  arquivo: File;
  grupos: GrupoPayload[];
  percentualHonorarios: number | null;
  avisos: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Código previsto do orçamento — deixa claro que a importação vale só
   *  para este job, e não para os outros do rascunho. */
  codigo: string;
  onImportado: (planilha: PlanilhaLida) => void;
}

/**
 * Importação de planilha dentro do editor do orçamento do projeto.
 *
 * Lê o arquivo no servidor e traz grupos e itens para o rascunho — sem
 * criar versão, sem gravar nada. O arquivo original fica guardado no
 * editor e sobe junto no "Salvar orçamentos", que é quando ele vira
 * registro em `orcamento_importacoes`.
 */
export function ImportarPlanilhaModal({
  open,
  onOpenChange,
  codigo,
  onImportado,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [lido, setLido] = React.useState<ParseRascunhoResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) return;
    setErro(null);
    setArquivo(null);
    setLido(null);
  }, [open]);

  function selecionar(file: File | undefined) {
    if (!file) return;
    setErro(null);
    setArquivo(file);
    setLido(null);

    const formData = new FormData();
    formData.set("arquivo", file);
    startTransition(async () => {
      const res = await parsePlanilhaRascunho(formData);
      if (!res.ok) {
        setErro(res.message);
        setArquivo(null);
        return;
      }
      setLido(res);
    });
  }

  function confirmar() {
    if (!arquivo || !lido?.ok) return;
    onImportado({
      arquivo,
      grupos: lido.grupos,
      percentualHonorarios: lido.percentual_honorarios,
      avisos: lido.warnings.length,
    });
    onOpenChange(false);
  }

  const totalItens = lido?.ok
    ? lido.grupos.reduce((s, g) => s + g.itens.length, 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <div className="px-7 pb-4 pt-6">
          <DialogTitle className="text-lg font-bold tracking-tight">
            Importar planilha
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-[13px]">
            A importação vale só para{" "}
            <span className="font-mono font-semibold text-foreground">
              {codigo}
            </span>{" "}
            — os demais orçamentos do rascunho não são afetados.
          </DialogDescription>
        </div>

        {erro && (
          <div className="flex items-start gap-2 border-y border-california-red/20 bg-california-red/5 px-7 py-3 text-xs text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="px-7 pb-6 pt-1">
          {/* Mesmo par label + input escondido do drawer de importação da
              versão: o rótulo é o alvo de clique e mantém o input acessível
              por teclado. */}
          <label
            htmlFor="arquivo-orcamento-projeto"
            className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 px-8 py-8 text-center transition-colors hover:border-california-red/40 hover:bg-accent"
          >
            <UploadCloud className="h-6 w-6 text-muted-foreground" />
            <span className="text-[13.5px] font-semibold text-foreground">
              {pending
                ? "Lendo a planilha..."
                : "Clique para selecionar o arquivo"}
            </span>
            <span className="text-xs text-muted-foreground">
              .xlsx no modelo padrão de orçamento
            </span>
          </label>
          <input
            ref={inputRef}
            id="arquivo-orcamento-projeto"
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              selecionar(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {lido?.ok && arquivo && (
            <div className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-3">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
              <span className="truncate text-[13px] font-medium">
                {arquivo.name}
              </span>
              <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                {lido.grupos.length}{" "}
                {lido.grupos.length === 1 ? "grupo" : "grupos"} · {totalItens}{" "}
                {totalItens === 1 ? "item" : "itens"}
                {lido.warnings.length > 0
                  ? ` · ${lido.warnings.length} ${
                      lido.warnings.length === 1 ? "aviso" : "avisos"
                    }`
                  : ""}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-7 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border border-border bg-white px-5 py-2.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending || !lido?.ok}
            className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Importar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
