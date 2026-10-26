"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  History,
  ArrowUpRight,
  FileSignature,
  Upload,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  Download,
  RefreshCw,
  Trash2,
  AlertCircle,
  CalendarClock,
  FileMinus,
  FileText,
  X,
  HandCoins,
  BellRing,
  Clock,
  CalendarDays,
} from "lucide-react";
import {
  cn,
  formatCurrency,
  formatDate,
  calcularDuracaoContrato,
  firstAndLastName,
} from "@/lib/utils";
import {
  CAMPO_HISTORICO_LABELS,
  TIPO_CONTRATO_LABEL,
  type FreelancerContrato,
  type FreelancerContratoHistoricoEntry,
  type TipoFreelancerContrato,
} from "@/lib/types";

interface Props {
  contrato: FreelancerContrato;
  isAtual: boolean;
  historico: FreelancerContratoHistoricoEntry[];
  /** RH/admin/financeiro — pode gerar minuta, excluir minuta, anexar distrato. */
  isRh?: boolean;
  /** RH/admin/financeiro OU GP dono do contrato — pode anexar assinado. */
  canManage?: boolean;
  /** Nome do freelancer — usado no nome do arquivo ao baixar */
  freelancerNome?: string;
  /** Mapa UUID → nome pra resolver quem solicitou o distrato. */
  gpNomesPorId?: Record<string, string>;
}

export function ContratoCard({
  contrato,
  isAtual,
  historico,
  isRh,
  canManage,
  freelancerNome,
  gpNomesPorId,
}: Props) {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [valorVisivel, setValorVisivel] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadErro, setUploadErro] = React.useState<string | null>(null);

  // ---- Slot Assinado (arquivo_url) — define o status do contrato ----
  const [arquivoPath, setArquivoPath] = React.useState<string | null>(
    contrato.arquivo_url,
  );
  const [acaoLoading, setAcaoLoading] = React.useState<
    "ver" | "baixar" | null
  >(null);

  // ---- Slot Minuta (minuta_url) — DOCX gerado, NÃO altera status ----
  const [minutaPath, setMinutaPath] = React.useState<string | null>(
    contrato.minuta_url,
  );
  const [minutaAcao, setMinutaAcao] = React.useState<"ver" | "baixar" | null>(
    null,
  );
  const [minutaErro, setMinutaErro] = React.useState<string | null>(null);
  const [gerando, setGerando] = React.useState(false);

  // ---- Slot Distrato Assinado ----
  const [distratoPath, setDistratoPath] = React.useState<string | null>(
    contrato.distrato_arquivo_url,
  );
  const [distratoAcao, setDistratoAcao] = React.useState<
    "ver" | "baixar" | null
  >(null);
  const [distratoErro, setDistratoErro] = React.useState<string | null>(null);

  // ---- Slot Minuta de Distrato ----
  const [distratoMinutaPath, setDistratoMinutaPath] = React.useState<
    string | null
  >(contrato.distrato_minuta_url);
  const [distratoMinutaAcao, setDistratoMinutaAcao] = React.useState<
    "ver" | "baixar" | null
  >(null);
  const [distratoMinutaErro, setDistratoMinutaErro] = React.useState<
    string | null
  >(null);
  const [cancelandoDistrato, setCancelandoDistrato] = React.useState(false);

  // ---- Modal: gerar minuta de distrato (RH) ----
  const [showGerarMinutaDistrato, setShowGerarMinutaDistrato] =
    React.useState(false);
  const [gerarDistratoDate, setGerarDistratoDate] = React.useState("");
  const [gerarDistratoMotivo, setGerarDistratoMotivo] = React.useState("");
  const [gerarDistratoLoading, setGerarDistratoLoading] = React.useState(false);
  const [gerarDistratoErro, setGerarDistratoErro] = React.useState<
    string | null
  >(null);

  // ---- Modal: solicitar distrato (GP) ----
  const [showSolicitarDistrato, setShowSolicitarDistrato] =
    React.useState(false);
  const [solicitarDate, setSolicitarDate] = React.useState("");
  const [solicitarMotivo, setSolicitarMotivo] = React.useState("");
  const [solicitarLoading, setSolicitarLoading] = React.useState(false);
  const [solicitarErro, setSolicitarErro] = React.useState<string | null>(null);

  // ---- Estado espelhado da solicitação (otimista sem full-reload) ----
  const [solicitadoEm, setSolicitadoEm] = React.useState<string | null>(
    contrato.distrato_solicitado_em,
  );
  const [solicitadoPor] = React.useState<string | null>(
    contrato.distrato_solicitado_por,
  );
  const [dataPropostaLocal, setDataPropostaLocal] = React.useState<
    string | null
  >(contrato.distrato_data_proposta);
  const [motivoLocal, setMotivoLocal] = React.useState<string | null>(
    contrato.distrato_motivo,
  );

  // ---- Modal: anexar distrato assinado ----
  const [showAnexarDistrato, setShowAnexarDistrato] = React.useState(false);
  const [anexarDistratoDate, setAnexarDistratoDate] = React.useState("");
  const [anexarDistratoMotivo, setAnexarDistratoMotivo] = React.useState("");
  const [anexarDistratoFile, setAnexarDistratoFile] =
    React.useState<File | null>(null);
  const [anexarDistratoLoading, setAnexarDistratoLoading] =
    React.useState(false);
  const [anexarDistratoErro, setAnexarDistratoErro] = React.useState<
    string | null
  >(null);
  const [anexarDistratoDragOver, setAnexarDistratoDragOver] =
    React.useState(false);
  const distratoFileInputRef = React.useRef<HTMLInputElement>(null);

  const hasHistorico = historico.length > 0;

  // -------------------- MINUTA DO CONTRATO --------------------

  async function handleGerar() {
    setMinutaErro(null);
    setGerando(true);
    try {
      const res = await fetch(
        `/api/freelancers/contratos/${contrato.id}/gerar-minuta`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok) {
        setMinutaErro(json.error || "Erro ao gerar minuta");
        return;
      }
      setMinutaPath(json.path);
      router.refresh();
    } catch {
      setMinutaErro("Erro de rede ao gerar minuta.");
    } finally {
      setGerando(false);
    }
  }

  // -------------------- ASSINADO DO CONTRATO --------------------

  async function handleImportar(file: File) {
    setUploadErro(null);
    const isPdf = file.type === "application/pdf";
    // Endpoint do califa-erp aceita apenas PDF.
    if (!isPdf) {
      setUploadErro("Apenas PDF.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("arquivo", file);
      const res = await fetch(
        `/api/freelancers/contratos/${contrato.id}/enviar-assinado`,
        { method: "POST", body: fd },
      );
      const json = await res.json();
      if (!res.ok) {
        setUploadErro(json.error || "Falha no upload.");
        return;
      }
      setArquivoPath(json.path);
      router.refresh();
    } catch {
      setUploadErro("Erro de rede ao enviar o assinado.");
    } finally {
      setUploading(false);
    }
  }

  // -------------------- BAIXAR / VER (comum a todos os slots) --------------------

  type TipoArquivo =
    | "minuta"
    | "assinado"
    | "distrato-minuta"
    | "distrato-assinado";

  function abrirEmNovaAba(tipo: TipoArquivo) {
    window.open(
      `/api/freelancers/contratos/${contrato.id}/baixar/${tipo}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function sanitizarNomeArquivo(s: string): string {
    return s
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function baixarComoBlob(tipo: TipoArquivo, nomeBase: string) {
    const url = `/api/freelancers/contratos/${contrato.id}/baixar/${tipo}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Falha ao baixar arquivo.");
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    const nome = firstAndLastName(freelancerNome);
    const job = contrato.nome_job?.trim() || contrato.id;
    // Infer extensão pelo content-type ou pelo path salvo
    const ct = resp.headers.get("content-type") ?? "";
    const ext = ct.includes("pdf")
      ? "pdf"
      : ct.includes("word")
        ? "docx"
        : tipo === "assinado" || tipo === "distrato-assinado"
          ? "pdf"
          : "docx";
    a.download = `${nomeBase}-${sanitizarNomeArquivo(nome)} - ${sanitizarNomeArquivo(job)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }

  async function handleVer() {
    setAcaoLoading("ver");
    try {
      abrirEmNovaAba("assinado");
    } finally {
      setAcaoLoading(null);
    }
  }

  async function handleBaixar() {
    setAcaoLoading("baixar");
    try {
      await baixarComoBlob("assinado", "ct");
    } catch (e) {
      setUploadErro(e instanceof Error ? e.message : "Erro ao baixar.");
    } finally {
      setAcaoLoading(null);
    }
  }

  async function handleVerMinuta() {
    setMinutaErro(null);
    setMinutaAcao("ver");
    try {
      abrirEmNovaAba("minuta");
    } finally {
      setMinutaAcao(null);
    }
  }

  async function handleBaixarMinuta() {
    setMinutaErro(null);
    setMinutaAcao("baixar");
    try {
      await baixarComoBlob("minuta", "minuta");
    } catch (e) {
      setMinutaErro(e instanceof Error ? e.message : "Erro ao baixar minuta.");
    } finally {
      setMinutaAcao(null);
    }
  }

  // -------------------- DISTRATO: solicitar --------------------

  function abrirSolicitarDistrato() {
    setSolicitarErro(null);
    setSolicitarMotivo("");
    if (contrato.data_termino) {
      const d = new Date(contrato.data_termino);
      d.setDate(d.getDate() - 7);
      setSolicitarDate(d.toISOString().slice(0, 10));
    } else {
      setSolicitarDate(new Date().toISOString().slice(0, 10));
    }
    setShowSolicitarDistrato(true);
  }

  async function handleSolicitarDistrato() {
    setSolicitarErro(null);
    if (!solicitarDate) {
      setSolicitarErro("Informe a data proposta.");
      return;
    }
    setSolicitarLoading(true);
    try {
      const fd = new FormData();
      fd.set("data_proposta", solicitarDate);
      fd.set("motivo", solicitarMotivo.trim());
      const res = await fetch(
        `/api/freelancers/contratos/${contrato.id}/distrato/solicitar`,
        { method: "POST", body: fd },
      );
      const json = await res.json();
      if (!res.ok) {
        setSolicitarErro(json.error || "Erro ao solicitar distrato.");
        return;
      }
      setSolicitadoEm(new Date().toISOString());
      setDataPropostaLocal(solicitarDate);
      setMotivoLocal(solicitarMotivo.trim() || null);
      setShowSolicitarDistrato(false);
      router.refresh();
    } catch {
      setSolicitarErro("Erro de rede ao solicitar distrato.");
    } finally {
      setSolicitarLoading(false);
    }
  }

  async function handleCancelarSolicitacao() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Cancelar a solicitação de distrato? A data proposta e o motivo serão apagados.",
      )
    ) {
      return;
    }
    setCancelandoDistrato(true);
    try {
      const res = await fetch(
        `/api/freelancers/contratos/${contrato.id}/distrato/cancelar`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "Erro ao cancelar solicitação.");
        return;
      }
      setSolicitadoEm(null);
      setDataPropostaLocal(null);
      setMotivoLocal(null);
      setDistratoMinutaPath(null);
      setDistratoPath(null);
      router.refresh();
    } catch {
      alert("Erro de rede ao cancelar solicitação.");
    } finally {
      setCancelandoDistrato(false);
    }
  }

  // -------------------- DISTRATO: minuta --------------------

  function abrirGerarMinutaDistrato() {
    setGerarDistratoErro(null);
    if (contrato.distrato_data_proposta) {
      setGerarDistratoDate(contrato.distrato_data_proposta);
    } else if (contrato.data_termino) {
      const d = new Date(contrato.data_termino);
      d.setDate(d.getDate() - 1);
      setGerarDistratoDate(d.toISOString().slice(0, 10));
    } else {
      setGerarDistratoDate(new Date().toISOString().slice(0, 10));
    }
    setGerarDistratoMotivo(contrato.distrato_motivo ?? "");
    setShowGerarMinutaDistrato(true);
  }

  async function handleGerarMinutaDistrato() {
    setGerarDistratoErro(null);
    if (!gerarDistratoDate) {
      setGerarDistratoErro("Informe a nova data de término.");
      return;
    }
    setGerarDistratoLoading(true);
    try {
      // 1) Atualiza data_proposta + motivo via `solicitar` (endpoint do califa-erp
      //    lê distrato_data_proposta do contrato antes de gerar o DOCX).
      const fd = new FormData();
      fd.set("data_proposta", gerarDistratoDate);
      fd.set("motivo", gerarDistratoMotivo.trim());
      const resSolic = await fetch(
        `/api/freelancers/contratos/${contrato.id}/distrato/solicitar`,
        { method: "POST", body: fd },
      );
      const jsonSolic = await resSolic.json();
      if (!resSolic.ok) {
        setGerarDistratoErro(
          jsonSolic.error || "Erro ao registrar data proposta.",
        );
        return;
      }
      // 2) Gera o DOCX
      const resGerar = await fetch(
        `/api/freelancers/contratos/${contrato.id}/distrato/gerar-minuta`,
        { method: "POST" },
      );
      const jsonGerar = await resGerar.json();
      if (!resGerar.ok) {
        setGerarDistratoErro(
          jsonGerar.error || "Erro ao gerar minuta de distrato.",
        );
        return;
      }
      setDistratoMinutaPath(jsonGerar.path);
      setDataPropostaLocal(gerarDistratoDate);
      setMotivoLocal(gerarDistratoMotivo.trim() || null);
      if (!solicitadoEm) setSolicitadoEm(new Date().toISOString());
      setShowGerarMinutaDistrato(false);
      router.refresh();
    } catch {
      setGerarDistratoErro("Erro de rede ao gerar minuta de distrato.");
    } finally {
      setGerarDistratoLoading(false);
    }
  }

  async function handleVerDistratoMinuta() {
    setDistratoMinutaErro(null);
    setDistratoMinutaAcao("ver");
    try {
      abrirEmNovaAba("distrato-minuta");
    } finally {
      setDistratoMinutaAcao(null);
    }
  }

  async function handleBaixarDistratoMinuta() {
    setDistratoMinutaErro(null);
    setDistratoMinutaAcao("baixar");
    try {
      await baixarComoBlob("distrato-minuta", "minuta-distrato");
    } catch (e) {
      setDistratoMinutaErro(
        e instanceof Error ? e.message : "Erro ao baixar minuta.",
      );
    } finally {
      setDistratoMinutaAcao(null);
    }
  }

  // -------------------- DISTRATO: assinado --------------------

  function abrirAnexarDistrato() {
    setAnexarDistratoErro(null);
    setAnexarDistratoFile(null);
    if (contrato.distrato_data_proposta) {
      setAnexarDistratoDate(contrato.distrato_data_proposta);
    } else if (contrato.data_termino) {
      const d = new Date(contrato.data_termino);
      d.setDate(d.getDate() - 1);
      setAnexarDistratoDate(d.toISOString().slice(0, 10));
    } else {
      setAnexarDistratoDate(new Date().toISOString().slice(0, 10));
    }
    setAnexarDistratoMotivo(contrato.distrato_motivo ?? "");
    setShowAnexarDistrato(true);
  }

  async function handleAnexarDistratoAssinado() {
    setAnexarDistratoErro(null);
    if (!anexarDistratoFile) {
      setAnexarDistratoErro("Selecione o arquivo do distrato assinado.");
      return;
    }
    if (!anexarDistratoDate) {
      setAnexarDistratoErro("Informe a nova data de término.");
      return;
    }
    const file = anexarDistratoFile;
    // Endpoint do califa-erp aceita apenas PDF no distrato assinado.
    if (file.type !== "application/pdf") {
      setAnexarDistratoErro("Apenas PDF.");
      return;
    }
    setAnexarDistratoLoading(true);
    try {
      // Se a minuta ainda não existe, precisamos registrar data_proposta antes
      // de enviar o assinado (o endpoint `enviar-assinado` do distrato exige
      // distrato_data_proposta setado). Idempotente.
      if (
        !distratoMinutaPath ||
        anexarDistratoDate !== contrato.distrato_data_proposta ||
        (anexarDistratoMotivo.trim() || null) !== contrato.distrato_motivo
      ) {
        const fd = new FormData();
        fd.set("data_proposta", anexarDistratoDate);
        fd.set("motivo", anexarDistratoMotivo.trim());
        const resSolic = await fetch(
          `/api/freelancers/contratos/${contrato.id}/distrato/solicitar`,
          { method: "POST", body: fd },
        );
        const jsonSolic = await resSolic.json();
        if (!resSolic.ok) {
          setAnexarDistratoErro(
            jsonSolic.error || "Erro ao registrar a antecipação.",
          );
          return;
        }
      }

      const fdArquivo = new FormData();
      fdArquivo.set("arquivo", file);
      const res = await fetch(
        `/api/freelancers/contratos/${contrato.id}/distrato/enviar-assinado`,
        { method: "POST", body: fdArquivo },
      );
      const json = await res.json();
      if (!res.ok) {
        setAnexarDistratoErro(json.error || "Erro ao anexar distrato.");
        return;
      }
      setDistratoPath(json.path);
      setDataPropostaLocal(anexarDistratoDate);
      setMotivoLocal(anexarDistratoMotivo.trim() || null);
      setShowAnexarDistrato(false);
      router.refresh();
    } catch {
      setAnexarDistratoErro("Erro de rede ao anexar distrato.");
    } finally {
      setAnexarDistratoLoading(false);
    }
  }

  async function handleVerDistrato() {
    setDistratoErro(null);
    setDistratoAcao("ver");
    try {
      abrirEmNovaAba("distrato-assinado");
    } finally {
      setDistratoAcao(null);
    }
  }

  async function handleBaixarDistrato() {
    setDistratoErro(null);
    setDistratoAcao("baixar");
    try {
      await baixarComoBlob("distrato-assinado", "distrato");
    } catch (e) {
      setDistratoErro(e instanceof Error ? e.message : "Erro ao baixar.");
    } finally {
      setDistratoAcao(null);
    }
  }

  // -------------------- Duração do contrato --------------------

  const duracao = React.useMemo(
    () => calcularDuracaoContrato(contrato.data_inicio, contrato.data_termino),
    [contrato.data_inicio, contrato.data_termino],
  );

  const restanteStyle = duracao
    ? duracao.status === "vencido"
      ? "text-california-red"
      : duracao.status === "ativo" && duracao.diasRestantes <= 15
        ? "text-amber-600"
        : "text-emerald-700"
    : "";

  const barColor = duracao
    ? duracao.status === "vencido"
      ? "bg-california-red"
      : duracao.status === "ativo" && duracao.diasRestantes <= 15
        ? "bg-amber-500"
        : "bg-emerald-500"
    : "bg-muted";

  return (
    <div
      className={cn(
        "rounded-xl border transition-all",
        isAtual
          ? "border-california-red/30 bg-california-red/[0.02]"
          : "border-border bg-white",
      )}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/freelancers/contratos/${contrato.id}`}
                prefetch={false}
                className="font-semibold text-foreground hover:text-california-red transition-colors"
              >
                {contrato.nome_job ?? "Sem nome de job"}
              </Link>
              {isAtual && (
                <span className="rounded-full bg-california-red/10 text-california-red text-[9px] font-bold uppercase tracking-wider px-2 py-0.5">
                  Atual
                </span>
              )}
              {!contrato.status_real &&
                (() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const isAgendado =
                    contrato.data_inicio !== null &&
                    contrato.data_inicio > today;
                  return isAgendado ? (
                    <span className="rounded-full bg-violet-100 text-violet-700 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5">
                      Agendado
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5">
                      Encerrado
                    </span>
                  );
                })()}
              {contrato.origem_sistema === "ag_california_rh" && (
                <span className="rounded-full bg-zinc-100 text-zinc-500 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5">
                  Legado
                </span>
              )}
            </div>
            {contrato.cargo && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {contrato.cargo}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
              <span>
                {formatDate(contrato.data_inicio)}
                {contrato.data_termino &&
                  ` → ${formatDate(contrato.data_termino)}`}
              </span>
              {contrato.cidade && (
                <>
                  <span className="h-1 w-1 rounded-full bg-border" />
                  <span>{contrato.cidade}</span>
                </>
              )}
              {contrato.tipo && (
                <>
                  <span className="h-1 w-1 rounded-full bg-border" />
                  <span>
                    {TIPO_CONTRATO_LABEL[contrato.tipo as TipoFreelancerContrato]}
                  </span>
                </>
              )}
            </div>

            {/* Contador de duração + tempo restante */}
            {duracao && (
              <div className="mt-3 rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Duração:{" "}
                      <span className="font-semibold text-foreground">
                        {duracao.totalLabel}
                      </span>
                    </span>
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 text-[11px] font-semibold tabular-nums",
                      restanteStyle,
                    )}
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    {duracao.restanteLabel}
                  </div>
                </div>
                {duracao.status !== "futuro" && (
                  <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        barColor,
                      )}
                      style={{ width: `${duracao.progresso}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="inline-flex items-center gap-1.5">
              <p className="font-bold text-foreground tabular-nums select-none">
                {valorVisivel ? formatCurrency(contrato.valor) : "R$ ••••••"}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setValorVisivel((v) => !v);
                }}
                title={valorVisivel ? "Ocultar valor" : "Mostrar valor"}
                aria-label={valorVisivel ? "Ocultar valor" : "Mostrar valor"}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {valorVisivel ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <Link
              href={`/freelancers/contratos/${contrato.id}`}
              prefetch={false}
              className="inline-block mt-1"
            >
              <ArrowUpRight className="h-4 w-4 text-muted-foreground hover:text-california-red transition-colors" />
            </Link>
          </div>
        </div>

        {/* File input escondido */}
        {canManage && (
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportar(file);
              e.target.value = "";
            }}
          />
        )}

        {/* Banner: distrato solicitado */}
        {solicitadoEm && !distratoMinutaPath && !distratoPath && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50/70 px-3 py-2.5 flex items-start gap-2">
            <BellRing className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">
                Distrato solicitado
              </p>
              <p className="text-[11px] text-amber-900/90 mt-0.5">
                Em {formatDate(solicitadoEm.slice(0, 10))}
                {solicitadoPor && gpNomesPorId?.[solicitadoPor] && (
                  <>
                    {" "}
                    por{" "}
                    <span className="font-semibold">
                      {gpNomesPorId[solicitadoPor]}
                    </span>
                  </>
                )}
                {dataPropostaLocal && (
                  <>
                    {" "}· nova data proposta:{" "}
                    <span className="font-semibold">
                      {formatDate(dataPropostaLocal)}
                    </span>
                  </>
                )}
              </p>
              {motivoLocal && (
                <p className="text-[11px] text-amber-900/80 mt-0.5 italic">
                  &ldquo;{motivoLocal}&rdquo;
                </p>
              )}
            </div>
            {canManage && (
              <button
                type="button"
                onClick={handleCancelarSolicitacao}
                disabled={cancelandoDistrato}
                className="text-[10px] font-semibold text-amber-700 hover:text-amber-900 underline decoration-dotted disabled:opacity-60 shrink-0"
              >
                {cancelandoDistrato ? "Cancelando..." : "Cancelar"}
              </button>
            )}
          </div>
        )}

        {/* Banner: antecipação aplicada (minuta ou assinado existe) */}
        {(distratoMinutaPath || distratoPath) && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-50/60 px-3 py-2.5 flex items-start gap-2">
            <FileMinus className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-rose-800">
                Antecipação aplicada
              </p>
              <p className="text-[11px] text-rose-900/90 mt-0.5">
                {contrato.data_termino && (
                  <>
                    Novo término:{" "}
                    <span className="font-semibold">
                      {formatDate(contrato.data_termino)}
                    </span>
                  </>
                )}
              </p>
              {motivoLocal && (
                <p className="text-[11px] text-rose-900/80 mt-0.5 italic">
                  &ldquo;{motivoLocal}&rdquo;
                </p>
              )}
            </div>
          </div>
        )}

        {/* Slots de arquivo */}
        {(minutaPath ||
          arquivoPath ||
          uploading ||
          distratoMinutaPath ||
          distratoPath) && (
          <div className="mt-3 space-y-1.5">
            {minutaPath && (
              <ArquivoSlot
                tone="neutral"
                icon={FileSignature}
                titulo="Minuta do contrato"
                subtitulo="Não assinada · não conta pro status"
                erro={minutaErro}
                actions={
                  <>
                    <IconAction
                      icon={Eye}
                      label="Visualizar minuta"
                      onClick={handleVerMinuta}
                      loading={minutaAcao === "ver"}
                    />
                    <IconAction
                      icon={Download}
                      label="Baixar minuta"
                      onClick={handleBaixarMinuta}
                      loading={minutaAcao === "baixar"}
                    />
                    {isRh && (
                      <IconAction
                        icon={RefreshCw}
                        label="Regerar minuta"
                        onClick={handleGerar}
                        loading={gerando}
                      />
                    )}
                    {/* TODO: endpoint de "excluir minuta" não existe no califa-erp.
                        Fluxo preferido é regerar. */}
                  </>
                }
              />
            )}
            {uploading && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Enviando assinado...
              </div>
            )}
            {arquivoPath && !uploading && (
              <ArquivoSlot
                tone="success"
                icon={CheckCircle2}
                titulo="Contrato assinado"
                subtitulo="PDF assinado"
                erro={uploadErro}
                actions={
                  <>
                    <IconAction
                      icon={Eye}
                      label="Visualizar assinado"
                      onClick={handleVer}
                      loading={acaoLoading === "ver"}
                    />
                    <IconAction
                      icon={Download}
                      label="Baixar assinado"
                      onClick={handleBaixar}
                      loading={acaoLoading === "baixar"}
                    />
                    {canManage && (
                      <IconAction
                        icon={RefreshCw}
                        label="Substituir assinado"
                        onClick={() => fileInputRef.current?.click()}
                      />
                    )}
                    {/* TODO: endpoint de "excluir assinado" não existe no califa-erp.
                        Fluxo preferido é substituir. */}
                  </>
                }
              />
            )}
            {distratoMinutaPath && (
              <ArquivoSlot
                tone="neutral"
                icon={FileMinus}
                titulo="Minuta de distrato"
                subtitulo={
                  contrato.distrato_data_proposta
                    ? `Proposta: encerrar em ${formatDate(
                        contrato.distrato_data_proposta,
                      )}`
                    : "Não assinada · não aplica antecipação"
                }
                erro={distratoMinutaErro}
                actions={
                  <>
                    <IconAction
                      icon={Eye}
                      label="Visualizar minuta de distrato"
                      onClick={handleVerDistratoMinuta}
                      loading={distratoMinutaAcao === "ver"}
                    />
                    <IconAction
                      icon={Download}
                      label="Baixar minuta de distrato"
                      onClick={handleBaixarDistratoMinuta}
                      loading={distratoMinutaAcao === "baixar"}
                    />
                    {isRh && (
                      <IconAction
                        icon={RefreshCw}
                        label="Regerar minuta de distrato"
                        onClick={abrirGerarMinutaDistrato}
                      />
                    )}
                    {isRh && (
                      <IconAction
                        icon={Trash2}
                        label="Cancelar distrato"
                        danger
                        onClick={handleCancelarSolicitacao}
                        loading={cancelandoDistrato}
                      />
                    )}
                  </>
                }
              />
            )}
            {distratoPath && (
              <ArquivoSlot
                tone="amber"
                icon={FileMinus}
                titulo="Distrato assinado"
                subtitulo={
                  contrato.data_termino_original && contrato.data_termino
                    ? `Era ${formatDate(contrato.data_termino_original)} → agora ${formatDate(contrato.data_termino)}`
                    : "Antecipação aplicada"
                }
                erro={distratoErro}
                actions={
                  <>
                    <IconAction
                      icon={Eye}
                      label="Visualizar distrato assinado"
                      onClick={handleVerDistrato}
                      loading={distratoAcao === "ver"}
                    />
                    <IconAction
                      icon={Download}
                      label="Baixar distrato assinado"
                      onClick={handleBaixarDistrato}
                      loading={distratoAcao === "baixar"}
                    />
                    {isRh && (
                      <IconAction
                        icon={Trash2}
                        label="Cancelar distrato"
                        danger
                        onClick={handleCancelarSolicitacao}
                        loading={cancelandoDistrato}
                      />
                    )}
                  </>
                }
              />
            )}
          </div>
        )}

        {/* Toggle histórico + barra de ações */}
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            disabled={!hasHistorico}
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors",
              hasHistorico
                ? "text-muted-foreground hover:text-california-red cursor-pointer"
                : "text-muted-foreground/50 cursor-default",
            )}
          >
            <History className="h-3 w-3" />
            {hasHistorico
              ? `${historico.length} alteraç${historico.length === 1 ? "ão" : "ões"}`
              : "Sem alterações"}
            {hasHistorico && (
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            )}
          </button>

          {canManage && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {!arquivoPath && !uploading && uploadErro && (
                <span className="text-[10px] text-california-red font-semibold flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {uploadErro}
                </span>
              )}
              {!minutaPath && !gerando && minutaErro && (
                <span className="text-[10px] text-california-red font-semibold flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {minutaErro}
                </span>
              )}
              {/* GP dono: solicita distrato */}
              {!isRh &&
                canManage &&
                !solicitadoEm &&
                !distratoMinutaPath &&
                !distratoPath &&
                contrato.status_real &&
                contrato.data_termino && (
                  <button
                    type="button"
                    onClick={abrirSolicitarDistrato}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 hover:border-amber-500/50 transition-all"
                  >
                    <HandCoins className="h-3 w-3" />
                    Solicitar distrato
                  </button>
                )}
              {/* RH: fluxo em 2 passos */}
              {isRh &&
                !distratoPath &&
                (contrato.status_real || distratoMinutaPath) &&
                contrato.data_termino && (
                  <>
                    <button
                      type="button"
                      onClick={abrirGerarMinutaDistrato}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-semibold text-foreground hover:border-amber-500/40 hover:text-amber-700 transition-all"
                    >
                      <FileMinus className="h-3 w-3" />
                      {distratoMinutaPath
                        ? "Regerar minuta de distrato"
                        : "Gerar minuta de distrato"}
                    </button>
                    <button
                      type="button"
                      onClick={abrirAnexarDistrato}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 hover:border-amber-500/50 transition-all"
                    >
                      <CalendarClock className="h-3 w-3" />
                      Anexar distrato assinado
                    </button>
                  </>
                )}
              {/* Anexar/substituir assinado */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60"
              >
                <Upload className="h-3 w-3" />
                {arquivoPath ? "Substituir assinado" : "Anexar assinado"}
              </button>
              {/* Gerar minuta — só RH */}
              {isRh && (
                <button
                  type="button"
                  onClick={handleGerar}
                  disabled={gerando}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all disabled:opacity-60"
                >
                  {gerando ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FileSignature className="h-3 w-3" />
                  )}
                  {gerando
                    ? "Gerando..."
                    : minutaPath
                      ? "Regerar minuta"
                      : "Gerar minuta"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Solicitar distrato (GP) */}
      {showSolicitarDistrato && (
        <ModalBackdrop
          onClose={() =>
            !solicitarLoading && setShowSolicitarDistrato(false)
          }
        >
          <div
            className="bg-white rounded-xl border border-border shadow-elevated w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="rounded-lg bg-amber-50 p-2">
                <HandCoins className="h-4 w-4 text-amber-700" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-foreground">
                  Solicitar distrato
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  O RH vai receber a solicitação e gerar a minuta com os
                  dados abaixo.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-foreground block mb-1">
                  Nova data de término
                </label>
                <input
                  type="date"
                  value={solicitarDate}
                  onChange={(e) => setSolicitarDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-california-red/40"
                />
                <p className="text-[10px] text-muted-foreground/80 mt-1">
                  Deve ser anterior a{" "}
                  {contrato.data_termino
                    ? formatDate(contrato.data_termino)
                    : "—"}
                  .
                </p>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-foreground block mb-1">
                  Motivo{" "}
                  <span className="text-muted-foreground font-normal">
                    (opcional)
                  </span>
                </label>
                <textarea
                  value={solicitarMotivo}
                  onChange={(e) => setSolicitarMotivo(e.target.value)}
                  rows={3}
                  placeholder="Ex.: freelancer não conseguirá cumprir todo o período."
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-california-red/40 resize-none"
                />
              </div>
            </div>

            {solicitarErro && (
              <p className="text-[11px] text-california-red font-semibold mt-3 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {solicitarErro}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowSolicitarDistrato(false)}
                disabled={solicitarLoading}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/30 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSolicitarDistrato}
                disabled={solicitarLoading || !solicitarDate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
              >
                {solicitarLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <HandCoins className="h-3 w-3" />
                )}
                {solicitarLoading ? "Enviando..." : "Enviar solicitação"}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Modal: Gerar minuta de distrato (RH) */}
      {showGerarMinutaDistrato && (
        <ModalBackdrop
          onClose={() =>
            !gerarDistratoLoading && setShowGerarMinutaDistrato(false)
          }
        >
          <div
            className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-white shadow-elevated overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted shrink-0">
                  <FileMinus className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-foreground">
                    Gerar minuta de distrato
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {contrato.nome_job || "Contrato"}
                    {contrato.data_termino && (
                      <>
                        {" · término atual: "}
                        <span className="font-semibold text-foreground">
                          {formatDate(contrato.data_termino)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Nova data de término *
                  </label>
                  <input
                    type="date"
                    value={gerarDistratoDate}
                    onChange={(e) => setGerarDistratoDate(e.target.value)}
                    max={
                      contrato.data_termino
                        ? (() => {
                            const d = new Date(contrato.data_termino);
                            d.setDate(d.getDate() - 1);
                            return d.toISOString().slice(0, 10);
                          })()
                        : undefined
                    }
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Motivo{" "}
                    <span className="font-normal text-muted-foreground">
                      (opcional)
                    </span>
                  </label>
                  <textarea
                    value={gerarDistratoMotivo}
                    onChange={(e) => setGerarDistratoMotivo(e.target.value)}
                    rows={3}
                    placeholder="Ex.: Encerramento do projeto, comum acordo entre as partes..."
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15 resize-none"
                  />
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-muted/40 border border-border px-3 py-2">
                <p className="text-[11px] text-muted-foreground">
                  Apenas gera o DOCX. <strong>Não</strong> antecipa o término
                  nem marca o freelancer como inativo. Para aplicar a
                  antecipação, anexe o distrato assinado depois.
                </p>
              </div>

              {gerarDistratoErro && (
                <p className="mt-3 text-xs text-california-red flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {gerarDistratoErro}
                </p>
              )}

              <div className="flex gap-2 mt-5 justify-end">
                <button
                  type="button"
                  onClick={() => setShowGerarMinutaDistrato(false)}
                  disabled={gerarDistratoLoading}
                  className="inline-flex items-center rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleGerarMinutaDistrato}
                  disabled={gerarDistratoLoading || !gerarDistratoDate}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover transition-colors disabled:opacity-60"
                >
                  {gerarDistratoLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FileSignature className="h-3 w-3" />
                  )}
                  {gerarDistratoLoading ? "Gerando..." : "Gerar minuta"}
                </button>
              </div>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Modal: Anexar distrato assinado (aplica antecipação) */}
      {showAnexarDistrato && (
        <ModalBackdrop
          onClose={() =>
            !anexarDistratoLoading && setShowAnexarDistrato(false)
          }
        >
          <div
            className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-white shadow-elevated overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 shrink-0">
                  <CalendarClock className="h-5 w-5 text-amber-700" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-foreground">
                    Anexar distrato assinado
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {contrato.nome_job || "Contrato"}
                    {contrato.data_termino && (
                      <>
                        {" · término atual: "}
                        <span className="font-semibold text-foreground">
                          {formatDate(contrato.data_termino)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Arquivo (PDF) *
                  </label>
                  <input
                    ref={distratoFileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setAnexarDistratoFile(f);
                      e.target.value = "";
                    }}
                  />
                  {anexarDistratoFile ? (
                    <div className="flex items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50/60 px-3 py-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 shrink-0">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-emerald-800 truncate">
                          {anexarDistratoFile.name}
                        </p>
                        <p className="text-[10px] text-emerald-700/70 tabular-nums">
                          {formatFileSize(anexarDistratoFile.size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => distratoFileInputRef.current?.click()}
                          title="Trocar arquivo"
                          aria-label="Trocar arquivo"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-700/80 hover:bg-emerald-100 hover:text-emerald-800 transition-colors"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnexarDistratoFile(null)}
                          title="Remover"
                          aria-label="Remover"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-700/80 hover:bg-california-red/10 hover:text-california-red transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => distratoFileInputRef.current?.click()}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setAnexarDistratoDragOver(true);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setAnexarDistratoDragOver(true);
                      }}
                      onDragLeave={() => setAnexarDistratoDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setAnexarDistratoDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) setAnexarDistratoFile(f);
                      }}
                      className={cn(
                        "w-full flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 transition-all",
                        anexarDistratoDragOver
                          ? "border-california-red bg-california-red/5"
                          : "border-border bg-muted/30 hover:border-california-red/40 hover:bg-california-red/[0.03]",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                          anexarDistratoDragOver
                            ? "bg-california-red/15 text-california-red"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Upload className="h-4 w-4" />
                      </div>
                      <p className="text-xs font-semibold text-foreground">
                        Clique para escolher
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          ou arraste o arquivo aqui
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        PDF · até 10 MB
                      </p>
                    </button>
                  )}
                </div>
                {distratoMinutaPath ? (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Da minuta gerada
                    </p>
                    <dl className="space-y-1 text-xs">
                      <div className="flex items-baseline gap-2">
                        <dt className="font-semibold text-foreground shrink-0">
                          Nova data:
                        </dt>
                        <dd className="text-foreground tabular-nums">
                          {anexarDistratoDate
                            ? formatDate(anexarDistratoDate)
                            : "—"}
                        </dd>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <dt className="font-semibold text-foreground shrink-0">
                          Motivo:
                        </dt>
                        <dd className="text-foreground/80 break-words">
                          {anexarDistratoMotivo || (
                            <span className="text-muted-foreground italic">
                              não informado
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Para mudar, regere a minuta com os novos valores antes
                      de anexar o assinado.
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        Nova data de término *
                      </label>
                      <input
                        type="date"
                        value={anexarDistratoDate}
                        onChange={(e) => setAnexarDistratoDate(e.target.value)}
                        max={
                          contrato.data_termino
                            ? (() => {
                                const d = new Date(contrato.data_termino);
                                d.setDate(d.getDate() - 1);
                                return d.toISOString().slice(0, 10);
                              })()
                            : undefined
                        }
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Motivo{" "}
                        <span className="font-normal text-muted-foreground">
                          (opcional)
                        </span>
                      </label>
                      <textarea
                        value={anexarDistratoMotivo}
                        onChange={(e) =>
                          setAnexarDistratoMotivo(e.target.value)
                        }
                        rows={3}
                        placeholder="Ex.: Encerramento do projeto, comum acordo entre as partes..."
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15 resize-none"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <p className="text-[11px] text-amber-800">
                  Ao confirmar, a antecipação será{" "}
                  <strong>aplicada</strong>: data de término muda, freelancer
                  vira <strong>inativo</strong> e o arquivo assinado é anexado
                  ao contrato.
                </p>
              </div>

              {anexarDistratoErro && (
                <p className="mt-3 text-xs text-california-red flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {anexarDistratoErro}
                </p>
              )}

              <div className="flex gap-2 mt-5 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAnexarDistrato(false)}
                  disabled={anexarDistratoLoading}
                  className="inline-flex items-center rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAnexarDistratoAssinado}
                  disabled={
                    anexarDistratoLoading ||
                    !anexarDistratoDate ||
                    !anexarDistratoFile
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover transition-colors disabled:opacity-60"
                >
                  {anexarDistratoLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {anexarDistratoLoading
                    ? "Aplicando..."
                    : "Anexar e antecipar"}
                </button>
              </div>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Histórico colapsável */}
      {expanded && hasHistorico && (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <ul className="space-y-3">
            {historico.map((h) => (
              <HistoricoEntryRow key={h.id} entry={h} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// -------------------- Subcomponentes --------------------

function ModalBackdrop({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-california-dark/70 backdrop-blur-sm" />
      {children}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ArquivoSlot({
  tone,
  icon: Icon,
  titulo,
  subtitulo,
  erro,
  actions,
}: {
  tone: "neutral" | "success" | "amber";
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  subtitulo?: string;
  erro?: string | null;
  actions: React.ReactNode;
}) {
  const styles =
    tone === "success"
      ? {
          wrap: "border-emerald-300 bg-emerald-50/60",
          iconWrap: "bg-emerald-100 text-emerald-700",
          titulo: "text-emerald-800",
          subtitulo: "text-emerald-700/70",
        }
      : tone === "amber"
        ? {
            wrap: "border-amber-400/40 bg-amber-50/60",
            iconWrap: "bg-amber-100 text-amber-700",
            titulo: "text-amber-800",
            subtitulo: "text-amber-700/80",
          }
        : {
            wrap: "border-border bg-muted/30",
            iconWrap: "bg-muted text-muted-foreground",
            titulo: "text-foreground",
            subtitulo: "text-muted-foreground",
          };
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
        styles.wrap,
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md shrink-0",
            styles.iconWrap,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p
            className={cn(
              "text-[11px] font-bold uppercase tracking-wider",
              styles.titulo,
            )}
          >
            {titulo}
          </p>
          {subtitulo && (
            <p className={cn("text-[10px] truncate", styles.subtitulo)}>
              {subtitulo}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {erro && (
          <span className="text-[10px] text-california-red font-semibold flex items-center gap-1 mr-1">
            <AlertCircle className="h-3 w-3" />
            {erro}
          </span>
        )}
        {actions}
      </div>
    </div>
  );
}

function IconAction({
  icon: Icon,
  label,
  onClick,
  loading,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-60",
        danger
          ? "text-muted-foreground hover:bg-california-red/10 hover:text-california-red"
          : "text-muted-foreground hover:bg-white hover:text-california-red",
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function HistoricoEntryRow({
  entry,
}: {
  entry: FreelancerContratoHistoricoEntry;
}) {
  const label = CAMPO_HISTORICO_LABELS[entry.campo] ?? entry.campo;
  const valorAnterior = formatHistoricoValor(entry.campo, entry.valor_anterior);
  const valorNovo = formatHistoricoValor(entry.campo, entry.valor_novo);
  const data = new Date(entry.alterado_em);
  const dataFormatada = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const horaFormatada = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center pt-1.5">
        <span className="h-2 w-2 rounded-full bg-california-red shrink-0" />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-[11px] font-semibold text-foreground">{label}</p>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {dataFormatada} · {horaFormatada}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
          <span className="rounded bg-white border border-border px-1.5 py-0.5 text-muted-foreground line-through tabular-nums">
            {valorAnterior}
          </span>
          <span className="text-muted-foreground/60">→</span>
          <span className="rounded bg-california-red/10 text-california-red border border-california-red/20 px-1.5 py-0.5 font-semibold tabular-nums">
            {valorNovo}
          </span>
        </div>
        {entry.alterado_por_nome && (
          <p className="text-[10px] text-muted-foreground mt-1">
            por{" "}
            <span className="font-semibold text-foreground">
              {entry.alterado_por_nome}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

function formatHistoricoValor(campo: string, valor: string | null): string {
  if (valor === null || valor === "") return "—";
  if (campo === "valor") {
    // Dado sensível: histórico sempre mascarado.
    return "R$ ••••••";
  }
  if (campo === "status_real") {
    return valor === "true" ? "Sim" : "Não";
  }
  if (
    campo === "data_inicio" ||
    campo === "data_termino" ||
    campo === "data_termino_original" ||
    campo === "distrato_data_proposta"
  ) {
    return formatDate(valor);
  }
  if (campo === "tipo") {
    return (
      TIPO_CONTRATO_LABEL[valor as TipoFreelancerContrato] ?? valor
    );
  }
  if (
    campo === "arquivo_url" ||
    campo === "minuta_url" ||
    campo === "distrato_arquivo_url" ||
    campo === "distrato_minuta_url"
  ) {
    return "Arquivo";
  }
  return valor;
}
