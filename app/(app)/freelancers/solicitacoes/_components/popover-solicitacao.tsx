"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Loader2,
  Calendar,
  Briefcase,
  Wallet,
  MapPin,
  MessageSquare,
  ArrowLeft,
  Copy,
  ExternalLink,
  Ban,
  FileText,
  MessagesSquare,
} from "lucide-react";
import { cn, formatCpf, formatCurrency } from "@/lib/utils";
import type {
  FreelancerSolicitacao,
  FreelancerSolicitacaoStatus,
} from "@/lib/types";
import {
  ChipStatusSolicitacao,
  STATUS_SOLICITACAO,
} from "./chip-status-solicitacao";
import { ChatSolicitacao } from "./chat-solicitacao";
import {
  aprovarSolicitacao,
  rejeitarSolicitacao,
  cancelarSolicitacao,
} from "../actions";

interface SolicitacaoLinha extends FreelancerSolicitacao {
  solicitante_nome: string | null;
  solicitante_email: string | null;
  job_codigo: string | null;
  job_nome: string | null;
}

interface Props {
  solicitacao: SolicitacaoLinha | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeRole: string;
  userId: string;
  publicOrigin: string;
  /** Snapshot da contagem de nao-lidas recebida ao abrir. Zera ao visitar
   *  a aba Mensagens (o chat marca lidas no servidor). */
  naoLidas?: number;
}

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

export function PopoverSolicitacao({
  solicitacao: s,
  open,
  onOpenChange,
  activeRole,
  userId,
  publicOrigin,
  naoLidas = 0,
}: Props) {
  const router = useRouter();
  const [aba, setAba] = React.useState<"detalhes" | "mensagens">("detalhes");
  const [badge, setBadge] = React.useState(naoLidas);
  const [modoRejeicao, setModoRejeicao] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [acaoEmCurso, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [copiado, setCopiado] = React.useState(false);

  // Reseta estado ao trocar de solicitacao ou reabrir
  React.useEffect(() => {
    if (open) {
      setAba("detalhes");
      setBadge(naoLidas);
      setModoRejeicao(false);
      setMotivo("");
      setErro(null);
      setCopiado(false);
    }
  }, [open, s?.id, naoLidas]);

  // Escape fecha
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Lock de scroll do body enquanto aberto
  React.useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open || !s) return null;
  if (typeof document === "undefined") return null;

  const isAprovador = APROVADORES.has(activeRole);
  const isSolicitante = s.solicitante_id === userId;
  const linkPublico = `${publicOrigin}/form/freelancer-solicitacao/${s.token}`;

  const mostraAprovar = isAprovador && s.status === "pendente";
  const mostraCancelarComoSolicitante =
    s.status === "pendente" && isSolicitante && !isAprovador;
  const mostraCancelarAprovada =
    s.status === "aprovada" && (isAprovador || isSolicitante);
  // Copiar link so faz sentido quando o freela precisa preencher o form publico.
  const mostraCopiarLink = s.status === "aprovada" && !s.freelancer_id;
  const mostraAbrirPerfil = s.status === "cadastrada" && s.freelancer_id;

  function aprovar() {
    setErro(null);
    startTransition(async () => {
      const r = await aprovarSolicitacao(s!.id);
      if (!r.ok) setErro(r.message);
      else router.refresh();
    });
  }

  function rejeitar() {
    setErro(null);
    if (motivo.trim().length < 3) {
      setErro("Explique brevemente o motivo");
      return;
    }
    const fd = new FormData();
    fd.set("motivo", motivo);
    startTransition(async () => {
      const r = await rejeitarSolicitacao(s!.id, fd);
      if (!r.ok) setErro(r.message);
      else {
        router.refresh();
        onOpenChange(false);
      }
    });
  }

  function cancelar() {
    setErro(null);
    startTransition(async () => {
      const r = await cancelarSolicitacao(s!.id);
      if (!r.ok) setErro(r.message);
      else {
        router.refresh();
        onOpenChange(false);
      }
    });
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(linkPublico);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("Nao foi possivel copiar — copie manualmente");
    }
  }

  const prazoTexto = s.data_termino
    ? `${formatDate(s.data_inicio)} → ${formatDate(s.data_termino)}`
    : s.data_inicio
      ? `A partir de ${formatDate(s.data_inicio)}`
      : "—";

  const valorTexto = `${formatCurrency(Number(s.valor))} / ${
    s.tipo === "mensal" ? "mês" : s.tipo === "diarias" ? "diária" : "período"
  }`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-elevated overflow-hidden flex flex-col h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header fixo (status + nome + CPF) */}
        <div className="px-5 py-4 border-b border-border bg-muted/20 shrink-0">
          <ChipStatusSolicitacao
            status={s.status as FreelancerSolicitacaoStatus}
          />
          <h3 className="text-lg font-bold text-foreground mt-2">
            {s.nome_freela}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {s.freelancer_id
              ? s.cpf_freela
                ? `CPF ${formatCpf(s.cpf_freela)} · freela já cadastrado`
                : "Freela já cadastrado"
              : s.cpf_freela
                ? `CPF ${formatCpf(s.cpf_freela)}`
                : "CPF: a ser preenchido pelo freela"}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-white shrink-0">
          <TabButton
            ativo={aba === "detalhes"}
            onClick={() => setAba("detalhes")}
            icone={<FileText className="h-3.5 w-3.5" />}
            label="Detalhes"
          />
          <TabButton
            ativo={aba === "mensagens"}
            onClick={() => {
              setAba("mensagens");
              setBadge(0);
            }}
            icone={<MessagesSquare className="h-3.5 w-3.5" />}
            label="Mensagens"
            badge={badge > 0 ? badge : undefined}
          />
        </div>

        {aba === "mensagens" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <ChatSolicitacao solicitacaoId={s.id} userId={userId} />
          </div>
        ) : (
          <div className="p-5 space-y-3 flex-1 overflow-y-auto">
            {erro && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3">
                <p className="text-xs text-california-red font-medium">
                  {erro}
                </p>
              </div>
            )}

            <Detalhe
              icone={<Briefcase className="h-3.5 w-3.5" />}
              label="Job"
              valor={
                s.job_codigo
                  ? `${s.job_codigo} · ${s.job_nome ?? s.nome_job ?? ""}`
                  : (s.job_nome ?? s.nome_job ?? "—")
              }
            />
            {s.cargo && <Detalhe label="Cargo" valor={s.cargo} />}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Tipo
              </p>
              {(() => {
                // Infere pelo cadastro antigo quando nao tem campo tipo_solicitacao
                const tipoLabel = s.freelancer_id ? "Renovação" : "Contratação";
                const corClasse = s.freelancer_id
                  ? "bg-violet-50 text-violet-700 border-violet-500/30"
                  : "bg-sky-50 text-sky-700 border-sky-500/30";
                return (
                  <span
                    className={cn(
                      "mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      corClasse,
                    )}
                  >
                    {tipoLabel}
                  </span>
                );
              })()}
            </div>
            <Detalhe
              icone={<Wallet className="h-3.5 w-3.5" />}
              label="Valor"
              valor={valorTexto}
            />
            <Detalhe
              icone={<Calendar className="h-3.5 w-3.5" />}
              label="Prazo"
              valor={prazoTexto}
            />
            {s.cidade && (
              <Detalhe
                icone={<MapPin className="h-3.5 w-3.5" />}
                label="Cidade"
                valor={s.cidade}
              />
            )}
            {s.observacoes && (
              <Detalhe
                icone={<MessageSquare className="h-3.5 w-3.5" />}
                label="Observações"
                valor={s.observacoes}
              />
            )}

            {s.status === "rejeitada" && s.rejeicao_motivo && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3 mt-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-california-red">
                  Motivo da rejeição
                </p>
                <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">
                  {s.rejeicao_motivo}
                </p>
              </div>
            )}

            {s.status === "aprovada" && s.expira_em && (
              <p className="text-[10px] text-muted-foreground">
                Link válido até{" "}
                <span className="font-semibold text-foreground">
                  {formatDate(s.expira_em.slice(0, 10))}
                </span>
              </p>
            )}

            <div className="pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground">
                Solicitado{" "}
                {s.solicitante_nome && (
                  <>
                    por{" "}
                    <span className="font-semibold text-foreground">
                      {s.solicitante_nome}
                    </span>{" "}
                  </>
                )}
                {diasAtras(s.created_at)}
              </p>
            </div>
          </div>
        )}

        {/* Footer de acoes - modo rejeicao substitui */}
        {modoRejeicao ? (
          <div className="p-5 border-t border-border space-y-3 bg-california-red/[0.03] shrink-0">
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-california-red">
              Motivo da rejeição
            </label>
            <textarea
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Explique por que esta solicitação não pode seguir..."
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-california-red/30"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={acaoEmCurso}
                onClick={() => {
                  setModoRejeicao(false);
                  setMotivo("");
                  setErro(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-border text-foreground text-xs font-semibold px-3 py-2 hover:bg-muted/40 disabled:opacity-60"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </button>
              <button
                type="button"
                disabled={acaoEmCurso || !motivo.trim()}
                onClick={rejeitar}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-california-red text-white text-xs font-semibold px-3 py-2 hover:bg-california-red-hover transition-colors disabled:opacity-60"
              >
                {acaoEmCurso ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Confirmar rejeição
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 border-t border-border bg-muted/10 flex items-center gap-2 flex-wrap shrink-0">
            {mostraAprovar && (
              <>
                <button
                  type="button"
                  disabled={acaoEmCurso}
                  onClick={() => setModoRejeicao(true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-california-red/40 text-california-red text-xs font-semibold px-3 py-2.5 hover:bg-california-red/10 transition-colors disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                  Rejeitar
                </button>
                <button
                  type="button"
                  disabled={acaoEmCurso}
                  onClick={aprovar}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-2.5 hover:bg-emerald-700 transition-colors disabled:opacity-60"
                >
                  {acaoEmCurso ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Aprovar
                </button>
              </>
            )}

            {!mostraAprovar &&
              (mostraCancelarComoSolicitante || mostraCancelarAprovada) && (
                <button
                  type="button"
                  disabled={acaoEmCurso}
                  onClick={cancelar}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 text-california-red text-xs font-semibold px-3 py-2 hover:bg-california-red/10 transition-colors disabled:opacity-60"
                >
                  {acaoEmCurso ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Ban className="h-3.5 w-3.5" />
                  )}
                  {mostraCancelarAprovada
                    ? "Cancelar"
                    : "Cancelar solicitação"}
                </button>
              )}

            {!mostraAprovar && mostraCopiarLink && (
              <button
                type="button"
                onClick={copiarLink}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-2.5 hover:bg-emerald-700 transition-colors"
              >
                {copiado ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiado ? "Copiado" : "Copiar link do freela"}
              </button>
            )}

            {!mostraAprovar && mostraAbrirPerfil && s.freelancer_id && (
              <Link
                href={`/freelancers/${s.freelancer_id}`}
                onClick={() => onOpenChange(false)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-california-red text-white text-xs font-semibold px-3 py-2.5 hover:bg-california-red-hover transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir perfil do freela
              </Link>
            )}

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border text-foreground text-xs font-semibold px-3 py-2 hover:bg-muted/40 ml-auto"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Detalhe({
  icone,
  label,
  valor,
}: {
  icone?: React.ReactNode;
  label: string;
  valor: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-1">
        {icone}
        {label}
      </p>
      <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">
        {valor}
      </p>
    </div>
  );
}

function TabButton({
  ativo,
  onClick,
  icone,
  label,
  badge,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors border-b-2",
        ativo
          ? "border-california-red text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30",
      )}
    >
      {icone}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="tabular-nums rounded-full bg-california-red px-1.5 py-0.5 text-[9px] leading-none font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // Isola o dia pra evitar deslocamento por timezone (iso vem como "2026-10-20"
  // ou com hora; T00:00:00 normaliza pra meia-noite local).
  const dia = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return new Date(dia + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function diasAtras(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

// Guard-rail: silencia warning do STATUS_SOLICITACAO nao usado (chip ja carrega
// os labels internamente). Mantido no import pra consistencia com os outros
// consumidores da familia.
void STATUS_SOLICITACAO;
