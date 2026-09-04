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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  confirmarImportacaoProjeto,
  previewImportacaoProjeto,
  type ConfirmProjetoResult,
  type PreviewProjetoResult,
  type ResumoOrcamentoImportado,
} from "./importar-actions";

type Preview = Extract<PreviewProjetoResult, { ok: true }>["preview"];
type Criadas = Extract<ConfirmProjetoResult, { ok: true }>["versoes"];
type Stage = "select" | "loading" | "preview" | "saving" | "done";

interface Props {
  projetoId: string;
}

/**
 * "Importar" da página do projeto e da visão agregada.
 *
 * Recebe de volta a planilha que o "Exportar" gerou — editada pelo
 * cliente ou por quem for — e cria uma versão nova só nos orçamentos que
 * mudaram, com o orçado da planilha e o planejado da versão anterior
 * (decisão 041). O preview diz, orçamento a orçamento, o que vai
 * acontecer antes de qualquer gravação.
 */
export function ImportarOrcamentosDrawer({ projetoId }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>("select");
  const [erro, setErro] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [criadas, setCriadas] = React.useState<Criadas>([]);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setStage("select");
    setErro(null);
    setPreview(null);
    setCriadas([]);
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
    const res = await previewImportacaoProjeto(projetoId, fd);
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
    const res = await confirmarImportacaoProjeto(projetoId, fd);
    if (!res.ok) {
      setErro(res.message);
      setStage("preview");
      router.refresh();
      return;
    }
    setCriadas(res.versoes);
    setStage("done");
    router.refresh();
  }

  const novas = preview?.novasVersoes ?? 0;
  const desfazem = preview?.orcamentos.filter((o) => o.desfazAprovacao) ?? [];

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
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
        >
          <Upload className="h-3.5 w-3.5" />
          Importar
        </button>
      </DialogTrigger>

      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Importar planilha do projeto</DialogTitle>
          <DialogDescription>
            Envie de volta o .xlsx que o &ldquo;Exportar&rdquo; gerou, depois
            de editado. Cada orçamento alterado ganha uma versão nova com o
            orçado da planilha; o planejado fica como estava.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {stage === "select" && (
              <div className="space-y-4">
                <label
                  htmlFor="arquivo-projeto"
                  className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-muted/20 px-6 py-12 text-center transition-colors hover:border-california-red/40 hover:bg-california-red/5"
                >
                  <FileSpreadsheet className="h-10 w-10 text-california-red/70" />
                  <div>
                    <p className="font-semibold text-foreground">
                      Escolher arquivo .xlsx
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Até 5 MB · a planilha exportada deste projeto
                    </p>
                  </div>
                </label>
                <input
                  ref={inputRef}
                  id="arquivo-projeto"
                  type="file"
                  accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleFileChange}
                />

                <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Como funciona:</p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>
                      Cada linha da planilha é casada com a linha da versão
                      pela identificação oculta que a exportação gravou.
                    </li>
                    <li>
                      Linha alterada entra com o orçado novo e{" "}
                      <b>mantém o planejado</b>. Linha nova nasce com
                      planejado zerado. Linha apagada some, com o planejado.
                    </li>
                    <li>
                      <b>Só os orçamentos alterados</b> ganham versão nova,
                      em rascunho.
                    </li>
                    <li>
                      Orçamento <b>aprovado</b> com alteração tem a aprovação
                      desfeita. Job aberto não recebe versão.
                    </li>
                    <li>
                      Honorários e imposto vêm da versão, não da planilha.
                    </li>
                  </ul>
                </div>

                {erro && <Erro texto={erro} />}
              </div>
            )}

            {stage === "loading" && (
              <Carregando texto="Lendo a planilha e comparando com as versões..." />
            )}

            {stage === "preview" && preview && (
              <>
                <div className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-3">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span className="truncate text-[13px] font-medium">
                    {preview.arquivo_nome}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                    {preview.orcamentos.length}{" "}
                    {preview.orcamentos.length === 1 ? "orçamento" : "orçamentos"}{" "}
                    · {preview.linhas_importadas}{" "}
                    {preview.linhas_importadas === 1 ? "item" : "itens"}
                    {preview.warnings.length > 0
                      ? ` · ${preview.warnings.length} ${
                          preview.warnings.length === 1 ? "aviso" : "avisos"
                        }`
                      : ""}
                  </span>
                </div>

                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Orçamento</th>
                        <th className="px-3 py-2 font-semibold">O que muda</th>
                        <th className="px-3 py-2 text-right font-semibold">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.orcamentos.map((o, i) => (
                        <LinhaPreview key={`${o.orcamentoId ?? "sem-id"}-${i}`} o={o} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {desfazem.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-[12.5px] text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {desfazem.map((o) => o.nome).join(", ")}{" "}
                      {desfazem.length === 1 ? "está aprovado" : "estão aprovados"}
                      . Ao importar, a aprovação é desfeita e a versão nova
                      passa a valer — a aprovação precisa ser refeita depois.
                    </span>
                  </div>
                )}

                {preview.orcamentos.some((o) => o.versaoDesatualizada) && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-[12.5px] text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      A planilha foi exportada de uma versão que já não é a
                      vigente em{" "}
                      {preview.orcamentos
                        .filter((o) => o.versaoDesatualizada)
                        .map((o) => o.nome)
                        .join(", ")}
                      . A comparação é com a versão vigente de hoje.
                    </span>
                  </div>
                )}

                {preview.warnings.length > 0 && (
                  <details className="rounded-xl border border-border">
                    <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-foreground">
                      {preview.warnings.length}{" "}
                      {preview.warnings.length === 1 ? "aviso" : "avisos"} da
                      leitura
                    </summary>
                    <ul className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                      {preview.warnings.map((w, i) => (
                        <li key={i}>
                          <span className="font-mono">linha {w.linha}</span>
                          {w.coluna ? (
                            <span className="font-mono"> · col. {w.coluna}</span>
                          ) : null}{" "}
                          — {w.motivo}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {novas === 0 && (
                  <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12.5px] text-muted-foreground">
                    Nenhum orçamento alterado — não há versão a criar.
                  </div>
                )}

                {erro && <Erro texto={erro} />}
              </>
            )}

            {stage === "saving" && (
              <Carregando texto="Criando as versões e gravando os itens..." />
            )}

            {stage === "done" && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {criadas.length === 1
                      ? "1 versão criada."
                      : `${criadas.length} versões criadas.`}
                  </span>
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-[12.5px]">
                  {criadas.map((c) => (
                    <li
                      key={c.versaoId}
                      className="flex items-center gap-3 px-3.5 py-2.5"
                    >
                      <span className="font-mono text-xs text-california-red">
                        {c.codigo}
                      </span>
                      <span className="font-semibold">{c.nome}</span>
                      <span className="ml-auto font-mono text-xs">
                        v{c.numeroVersao} · rascunho
                      </span>
                      {c.aprovacaoDesfeita && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-[10px] font-bold uppercase tracking-wider text-amber-800">
                          Aprovação desfeita
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              {stage === "done" ? "Fechar" : "Cancelar"}
            </button>
            {stage === "preview" && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={novas === 0}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all",
                  novas === 0
                    ? "cursor-not-allowed bg-muted-foreground/40"
                    : "bg-california-red shadow-sm hover:bg-california-red-hover hover:shadow-brand",
                )}
              >
                <CheckCircle2 className="h-4 w-4" />
                {novas === 1 ? "Criar 1 versão" : `Criar ${novas} versões`}
              </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Dialog>
  );
}

function LinhaPreview({ o }: { o: ResumoOrcamentoImportado }) {
  const r = o.resumo;
  const partes: string[] = [];
  if (r) {
    if (r.alterados > 0) partes.push(`${r.alterados} ${r.alterados === 1 ? "alterada" : "alteradas"}`);
    if (r.novos > 0) partes.push(`${r.novos} ${r.novos === 1 ? "nova" : "novas"}`);
    if (r.apagados > 0) partes.push(`${r.apagados} ${r.apagados === 1 ? "apagada" : "apagadas"}`);
    if (r.gruposNovos > 0) partes.push(`${r.gruposNovos} ${r.gruposNovos === 1 ? "grupo novo" : "grupos novos"}`);
    if (r.gruposApagados > 0) partes.push(`${r.gruposApagados} ${r.gruposApagados === 1 ? "grupo apagado" : "grupos apagados"}`);
    if (r.gruposRenomeados > 0) partes.push(`${r.gruposRenomeados} ${r.gruposRenomeados === 1 ? "grupo renomeado" : "grupos renomeados"}`);
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2.5 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">{o.nome}</span>
          {o.codigo && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {o.codigo}
              {o.versaoAtual !== null ? ` · v${o.versaoAtual} vigente` : ""}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 align-top text-muted-foreground">
        {o.acao === "recusado" ? (
          <span className="text-california-red">{o.motivo}</span>
        ) : partes.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <span>{partes.join(" · ")}</span>
            {r && (
              <span className="font-mono text-[11px]">
                {formatBRL(r.orcadoAntes)} → {formatBRL(r.orcadoDepois)}
              </span>
            )}
            {r && r.casadasPorDescricao > 0 && (
              <span className="text-[11px] text-amber-800">
                {r.casadasPorDescricao}{" "}
                {r.casadasPorDescricao === 1
                  ? "linha casada pela descrição, sem identificação"
                  : "linhas casadas pela descrição, sem identificação"}
              </span>
            )}
          </div>
        ) : (
          <span>Nada mudou</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right align-top">
        {o.acao === "nova_versao" && (
          <span className="inline-flex flex-col items-end gap-1">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-px font-mono text-[11px] font-bold text-emerald-700">
              → v{o.proximaVersao}
            </span>
            {o.desfazAprovacao && (
              <span className="text-[10.5px] font-semibold text-amber-800">
                aprovação desfeita
              </span>
            )}
          </span>
        )}
        {o.acao === "sem_alteracao" && (
          <span className="rounded-full border border-border bg-muted px-2 py-px text-[11px] font-semibold text-muted-foreground">
            sem versão nova
          </span>
        )}
        {o.acao === "recusado" && (
          <span className="rounded-full border border-california-red/20 bg-california-red/10 px-2 py-px text-[11px] font-semibold text-california-red">
            não entra
          </span>
        )}
      </td>
    </tr>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{texto}</span>
    </div>
  );
}

function Carregando({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-california-red/30 border-t-california-red" />
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}
