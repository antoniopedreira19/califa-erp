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
      const buf = await arquivo.arrayBuffer();
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
      const buf = await arquivo.arrayBuffer();
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
            Selecione o PDF "Relação Geral dos Líquidos" entregue pela
            contabilidade para a competência {String(props.mes).padStart(2, "0")}/
            {props.ano}. O match é por CPF; linhas já aprovadas no financeiro
            não são sobrescritas.
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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
        <StatBox
          rotulo="Empregados"
          valor={p.totalizadores_pdf.empregados?.linhas ?? 0}
          sub={`R$ ${p.totalizadores_pdf.empregados?.total ?? "0,00"}`}
        />
        <StatBox
          rotulo="Estagiários"
          valor={p.totalizadores_pdf.estagiarios?.linhas ?? 0}
          sub={`R$ ${p.totalizadores_pdf.estagiarios?.total ?? "0,00"}`}
        />
        <StatBox
          rotulo="Contribuintes"
          valor={p.totalizadores_pdf.contribuintes?.linhas ?? 0}
          sub={`R$ ${p.totalizadores_pdf.contribuintes?.total ?? "0,00"}`}
        />
        <StatBox
          rotulo="Total do PDF"
          valor={p.linhas_total}
          sub={`R$ ${p.totalizadores_pdf.total_empresa ?? "0,00"}`}
          destaque
        />
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <SumAcao
          cor="emerald"
          rotulo="A criar"
          valor={p.linhas_criadas}
        />
        <SumAcao
          cor="amber"
          rotulo="A atualizar"
          valor={p.linhas_atualizadas}
        />
        <SumAcao
          cor="slate"
          rotulo="A ignorar"
          valor={p.linhas_ignoradas}
        />
      </div>

      {p.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold mb-1">
            {p.warnings.length} aviso{p.warnings.length === 1 ? "" : "s"}:
          </p>
          <ul className="space-y-0.5 list-disc list-inside">
            {p.warnings.map((w, i) => (
              <li key={i}>{w.mensagem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="text-left px-2 py-1.5 font-medium">Seção</th>
              <th className="text-left px-2 py-1.5 font-medium">Nome</th>
              <th className="text-left px-2 py-1.5 font-medium">CPF</th>
              <th className="text-right px-2 py-1.5 font-medium">Valor</th>
              <th className="text-left px-2 py-1.5 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {p.preview.map((l, i) => (
              <tr
                key={`${l.cpf}-${i}`}
                className={`border-t border-border ${l.acao === "ignorar" ? "opacity-60" : ""}`}
              >
                <td className="px-2 py-1">{SECAO_LABEL[l.secao]}</td>
                <td className="px-2 py-1 truncate max-w-[200px]">{l.nome}</td>
                <td className="px-2 py-1 font-mono text-[11px]">{l.cpf}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {brl.format(l.valor / 100)}
                </td>
                <td className="px-2 py-1">
                  <AcaoBadge acao={l.acao} />
                  {l.motivo_ignorar && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      — {l.motivo_ignorar}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox(props: {
  rotulo: string;
  valor: number | string;
  sub: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2 ${
        props.destaque
          ? "border-california-red/40 bg-california-red/5"
          : "border-border bg-background"
      }`}
    >
      <p className="text-[10px] font-medium uppercase text-muted-foreground">
        {props.rotulo}
      </p>
      <p className="mt-0.5 text-sm font-bold">{props.valor}</p>
      <p className="text-[11px] text-muted-foreground tabular-nums">{props.sub}</p>
    </div>
  );
}

function SumAcao(props: {
  cor: "emerald" | "amber" | "slate";
  rotulo: string;
  valor: number;
}) {
  const classes =
    props.cor === "emerald"
      ? "text-emerald-700"
      : props.cor === "amber"
        ? "text-amber-700"
        : "text-slate-600";
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase text-muted-foreground">
        {props.rotulo}
      </p>
      <p className={`text-lg font-bold ${classes}`}>{props.valor}</p>
    </div>
  );
}

function AcaoBadge(props: { acao: ResumoImportacaoLinha["acao"] }) {
  const map = {
    criar: "bg-emerald-100 text-emerald-800",
    atualizar: "bg-amber-100 text-amber-800",
    ignorar: "bg-slate-200 text-slate-700",
  } as const;
  const label = {
    criar: "criar",
    atualizar: "atualizar",
    ignorar: "ignorar",
  } as const;
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${map[props.acao]}`}
    >
      {label[props.acao]}
    </span>
  );
}
