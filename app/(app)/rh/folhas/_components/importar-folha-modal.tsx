"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  importarFolhaContabilidade,
  type ResumoImportacao,
  type ResumoImportacaoLinha,
} from "../importar-actions";

const SECAO_LABEL: Record<ResumoImportacaoLinha["secao"], string> = {
  empregados: "Empregados",
  estagiarios: "Estagiários",
  contribuintes: "Contribuintes",
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export interface ImportarFolhaModalProps {
  ano: number;
  mes: number;
  triggerLabel: React.ReactNode;
}

export function ImportarFolhaModal(props: ImportarFolhaModalProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ResumoImportacao | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, startCarregando] = React.useTransition();

  function reset() {
    setArquivo(null);
    setPreview(null);
    setErro(null);
  }

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    reset();
    const f = e.target.files?.[0] ?? null;
    setArquivo(f);
  }

  function previsualizar() {
    if (!arquivo) return;
    setErro(null);
    startCarregando(async () => {
      // Uint8Array em vez de ArrayBuffer puro: Server Actions do Next.js 14+
      // rejeitam ArrayBuffer no encodeReply dos args ("null prototypes not supported").
      // Uint8Array é TypedArray built-in aceito.
      const buf = new Uint8Array(await arquivo.arrayBuffer());
      const r = await importarFolhaContabilidade({
        ano: props.ano,
        mes: props.mes,
        arquivoBuffer: buf,
        arquivoNome: arquivo.name,
        dryRun: true,
      });
      if (!r.ok) {
        setErro(r.message);
        setPreview(null);
        return;
      }
      setPreview(r);
    });
  }

  function confirmar() {
    if (!arquivo || !preview) return;
    setErro(null);
    startCarregando(async () => {
      // Uint8Array em vez de ArrayBuffer puro: Server Actions do Next.js 14+
      // rejeitam ArrayBuffer no encodeReply dos args ("null prototypes not supported").
      // Uint8Array é TypedArray built-in aceito.
      const buf = new Uint8Array(await arquivo.arrayBuffer());
      const r = await importarFolhaContabilidade({
        ano: props.ano,
        mes: props.mes,
        arquivoBuffer: buf,
        arquivoNome: arquivo.name,
        dryRun: false,
      });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
        >
          {props.triggerLabel}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar folha CLT</DialogTitle>
          <DialogDescription>
            Selecione o PDF &ldquo;Relação Geral dos Líquidos&rdquo; entregue
            pela contabilidade para a competência{" "}
            {String(props.mes).padStart(2, "0")}/{props.ano}. O match é por CPF;
            linhas já aprovadas no financeiro não são sobrescritas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="flex-1 cursor-pointer rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 hover:bg-muted transition-colors">
              <input
                type="file"
                accept="application/pdf"
                onChange={handleArquivo}
                className="hidden"
                disabled={carregando}
              />
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">
                  {arquivo ? arquivo.name : "Clique para selecionar o PDF"}
                </span>
              </div>
            </label>
            <button
              type="button"
              onClick={previsualizar}
              disabled={!arquivo || carregando}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
            >
              {carregando && !preview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Pré-visualizar
            </button>
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {preview && <PreviewTabela preview={preview} />}

          {preview && (
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                disabled={carregando}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={carregando}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
              >
                {carregando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {carregando ? "Importando..." : "Confirmar importação"}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewTabela(props: { preview: ResumoImportacao }) {
  const p = props.preview;
  const brlFmt = (centavos: number) => brl.format(centavos / 100);
  const totalGeral = p.preview.reduce((acc, l) => acc + l.valor, 0);
  const totalEncontrados = p.preview
    .filter((l) => l.acao !== "ignorar")
    .reduce((acc, l) => acc + l.valor, 0);
  const linhasEncontradas = p.linhas_criadas + p.linhas_atualizadas;
  const linhasIgnoradas = p.linhas_ignoradas;

  return (
    <div className="space-y-3">
      {/* Resumo em 1 linha, direto e visual */}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <ResumoBox
          cor="slate"
          rotulo="Total no PDF"
          valor={`${p.linhas_total} linha${p.linhas_total === 1 ? "" : "s"}`}
          sub={brlFmt(totalGeral)}
        />
        <ResumoBox
          cor="emerald"
          rotulo="A importar"
          valor={`${linhasEncontradas} encontrad${linhasEncontradas === 1 ? "o" : "os"}`}
          sub={brlFmt(totalEncontrados)}
        />
        <ResumoBox
          cor={linhasIgnoradas > 0 ? "amber" : "slate"}
          rotulo="A ignorar"
          valor={`${linhasIgnoradas} sem match`}
          sub={linhasIgnoradas > 0 ? "não cadastrados" : "—"}
        />
      </div>

      {/* Tabela: Nome | CPF | Valor | Status */}
      <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Nome (PDF)</th>
              <th className="text-left px-3 py-2 font-medium">CPF</th>
              <th className="text-right px-3 py-2 font-medium">Valor líquido</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {p.preview.map((l, i) => (
              <tr
                key={`${l.cpf}-${i}`}
                className="border-t border-border"
              >
                <td className="px-3 py-2 truncate max-w-[260px]">{l.nome}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {formatarCpf(l.cpf)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {brlFmt(l.valor)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge acao={l.acao} motivo={l.motivo_ignorar} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatarCpf(cpf: string): string {
  // "01505451264" → "015.054.512-64"
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function ResumoBox(props: {
  cor: "slate" | "emerald" | "amber";
  rotulo: string;
  valor: string;
  sub: string;
}) {
  const classes =
    props.cor === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : props.cor === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-border bg-muted/30 text-foreground";
  return (
    <div className={`rounded-lg border p-3 ${classes}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {props.rotulo}
      </p>
      <p className="mt-1 text-sm font-semibold">{props.valor}</p>
      <p className="text-xs opacity-80 tabular-nums">{props.sub}</p>
    </div>
  );
}

function StatusBadge(props: {
  acao: ResumoImportacaoLinha["acao"];
  motivo?: string;
}) {
  if (props.acao === "ignorar") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
        <AlertTriangle className="h-3 w-3" />
        Não encontrado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
      <CheckCircle2 className="h-3 w-3" />
      Encontrado
    </span>
  );
}
