"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { anexarNfPorEscopoForm } from "@/lib/nf/anexos-actions";
import type { NfPendenteQuadro } from "@/lib/types";
import type { NfAnexoEscopo } from "@/lib/nf/anexos-escopo";

// ---------------------------------------------------------------------------
// Helpers de exibição
// ---------------------------------------------------------------------------

function labelEscopo(linha: NfPendenteQuadro): string {
  return linha.label;
}

type BadgeVariant = "azul" | "verde" | "amarelo" | "roxo";

function badgeVariantParaEscopo(escopo: NfAnexoEscopo): BadgeVariant {
  switch (escopo) {
    case "folha_mensal":
      return "azul";
    case "ferias_usufruto":
      return "verde";
    case "ferias_abono":
      return "amarelo";
    case "decimo_terceiro_p1":
    case "decimo_terceiro_p2":
    case "decimo_terceiro_adiantamento":
      return "roxo";
  }
}

function labelEscopoTipo(escopo: NfAnexoEscopo): string {
  switch (escopo) {
    case "folha_mensal":
      return "Salário";
    case "ferias_usufruto":
      return "Férias";
    case "ferias_abono":
      return "Abono";
    case "decimo_terceiro_p1":
      return "13º · 1ª parcela";
    case "decimo_terceiro_p2":
      return "13º · 2ª parcela";
    case "decimo_terceiro_adiantamento":
      return "13º · Adiantamento";
  }
}

const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function tituloDoCard(linha: NfPendenteQuadro): string {
  const competencia =
    linha.competencia_ano && linha.competencia_mes
      ? `${NOMES_MESES[linha.competencia_mes - 1]}/${linha.competencia_ano}`
      : null;

  switch (linha.escopo_tipo) {
    case "folha_mensal":
      return competencia ? `Folha Salarial · ${competencia}` : "Folha Salarial";
    case "ferias_usufruto":
      return "Férias · Usufruto";
    case "ferias_abono":
      return "Férias · Abono";
    case "decimo_terceiro_p1":
      return competencia ? `13º Salário · 1ª Parcela · ${competencia}` : "13º Salário · 1ª Parcela";
    case "decimo_terceiro_p2":
      return competencia ? `13º Salário · 2ª Parcela · ${competencia}` : "13º Salário · 2ª Parcela";
    case "decimo_terceiro_adiantamento":
      return competencia ? `13º Salário · Adiantamento · ${competencia}` : "13º Salário · Adiantamento";
  }
}

function BadgeTipo({ variante, texto }: { variante: BadgeVariant; texto: string }) {
  const cls: Record<BadgeVariant, string> = {
    azul: "bg-blue-100 text-blue-800",
    verde: "bg-emerald-100 text-emerald-800",
    amarelo: "bg-amber-100 text-amber-800",
    roxo: "bg-violet-100 text-violet-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls[variante]}`}
    >
      {texto}
    </span>
  );
}

function formatarValor(valor: string | null): string | null {
  if (!valor) return null;
  const num = parseFloat(valor);
  if (isNaN(num)) return null;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isEmAtraso(prazoAnexo: string | null): boolean {
  if (!prazoAnexo) return false;
  // prazo_anexo é ISO date (yyyy-mm-dd). Compara com hoje sem hora.
  const hoje = new Date();
  const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return hojeStr > prazoAnexo;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function QuadroNfLinha({
  linha,
  alocacaoResumo,
}: {
  linha: NfPendenteQuadro;
  alocacaoResumo: string | null;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const variante = badgeVariantParaEscopo(linha.escopo_tipo);
  const tipoTexto = labelEscopoTipo(linha.escopo_tipo);
  const titulo = tituloDoCard(linha);
  // descricao vem da view (ex: "Férias · 10/01 → 19/01 · 10 dias");
  // só mostra quando difere do título — pra não repetir "Folha Salarial · Nov/2026"
  const descricaoExtra =
    linha.label && !linha.label.toLowerCase().startsWith("folha mensal")
      ? labelEscopo(linha)
      : null;
  const valorFormatado = formatarValor(linha.valor);
  const semEscopoId = linha.escopo_id === null;
  const emAtraso = isEmAtraso(linha.prazo_anexo);

  function handleSelecionarArquivo() {
    inputRef.current?.click();
  }

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!linha.escopo_id) return;
    setErro(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("escopoTipo", linha.escopo_tipo);
      formData.append("escopoId", linha.escopo_id as string);
      formData.append("file", file);
      const r = await anexarNfPorEscopoForm(formData);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-4 transition-colors hover:border-border/80">
      {/* Linha de topo: valor em destaque + badges à direita */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {valorFormatado ? (
            <p className="text-2xl font-bold tracking-tight text-foreground">
              {valorFormatado}
            </p>
          ) : (
            <p className="text-sm font-medium text-muted-foreground">
              Valor a definir
            </p>
          )}
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {titulo}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <BadgeTipo variante={variante} texto={tipoTexto} />
        </div>
      </div>

      {/* Linha de alocação / descrição auxiliar */}
      {(alocacaoResumo || descricaoExtra) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {alocacaoResumo && (
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {alocacaoResumo}
            </span>
          )}
          {alocacaoResumo && descricaoExtra && <span>·</span>}
          {descricaoExtra && <span>{descricaoExtra}</span>}
        </div>
      )}

      {/* Nome do arquivo quando NF já anexada */}
      {linha.nf_anexada && linha.nf_arquivo_nome && (
        <p className="text-xs text-muted-foreground truncate">
          <span className="font-medium text-foreground/70">Arquivo:</span>{" "}
          {linha.nf_arquivo_nome}
        </p>
      )}

      {/* Mensagem de erro de upload */}
      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* Ação: status à esquerda, botão à direita, separado por divisor sutil */}
      <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
        {linha.nf_anexada ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-3 w-3" />
            NF anexada
          </span>
        ) : emAtraso ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            <AlertCircle className="h-3 w-3" />
            Em atraso
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
            <Clock className="h-3 w-3" />
            No prazo
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={handleArquivo}
          className="hidden"
        />
        {semEscopoId ? (
          <button
            type="button"
            disabled
            title="Aguardando RH"
            className="inline-flex items-center gap-2 rounded-lg bg-muted px-3.5 py-1.5 text-xs font-semibold text-muted-foreground cursor-not-allowed opacity-60"
          >
            <Upload className="h-3.5 w-3.5" />
            Aguardando RH
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSelecionarArquivo}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {linha.nf_anexada ? "Substituir NF" : "Anexar NF"}
          </button>
        )}
      </div>
    </div>
  );
}
