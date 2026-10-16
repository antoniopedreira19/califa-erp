"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  XCircle,
  Ban,
  Copy,
  Check,
  ArrowRight,
  Loader2,
  AlertCircle,
  Mail,
  Calendar,
  MapPin,
  User,
  Briefcase,
  FileText,
  Clock,
} from "lucide-react";
import { cn, formatCpf, formatCurrency } from "@/lib/utils";
import type {
  FreelancerSolicitacao,
  FreelancerSolicitacaoStatus,
} from "@/lib/types";
import { ChipStatusSolicitacao } from "./chip-status-solicitacao";
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
}

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

export function PopoverSolicitacao({
  solicitacao: s,
  open,
  onOpenChange,
  activeRole,
  userId,
  publicOrigin,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [modoRejeicao, setModoRejeicao] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [copiado, setCopiado] = React.useState(false);

  // Resetar estado quando trocar de solicitação
  React.useEffect(() => {
    setModoRejeicao(false);
    setMotivo("");
    setErro(null);
    setCopiado(false);
  }, [s?.id]);

  if (!s) return null;

  const isAprovador = APROVADORES.has(activeRole);
  const isSolicitante = s.solicitante_id === userId;
  const linkPublico = `${publicOrigin}/form/freelancer-solicitacao/${s.token}`;

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
      setErro("Não foi possível copiar — copie manualmente abaixo");
    }
  }

  const diasAteExpirar = s.expira_em
    ? Math.max(
        0,
        Math.ceil(
          (new Date(s.expira_em).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : null;
  const expirado =
    s.status === "aprovada" && diasAteExpirar !== null && diasAteExpirar === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="min-w-0 truncate">
              {s.nome_freela}
            </DialogTitle>
            <ChipStatusSolicitacao
              status={s.status as FreelancerSolicitacaoStatus}
            />
          </div>
          <DialogDescription>
            Solicitação de contratação criada por {s.solicitante_nome ?? "—"} em{" "}
            {formatarDataBR(s.created_at)}.
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-california-red shrink-0 mt-0.5" />
            <p className="text-xs text-california-red font-medium">{erro}</p>
          </div>
        )}

        {/* Blocos de info */}
        <div className="space-y-5 divide-y divide-border">
          <BlocoInfo icon={User} titulo="Freelancer proposto">
            <Linha rotulo="Nome" valor={s.nome_freela} />
            <Linha
              rotulo="CPF"
              valor={s.cpf_freela ? formatCpf(s.cpf_freela) : "Não informado"}
            />
          </BlocoInfo>

          <BlocoInfo icon={Briefcase} titulo="Job e condições">
            <Linha
              rotulo="Job"
              valor={
                s.job_codigo
                  ? `${s.job_codigo} · ${s.job_nome ?? ""}`
                  : s.job_nome ?? "—"
              }
            />
            {s.cargo && <Linha rotulo="Cargo" valor={s.cargo} />}
            <Linha
              rotulo="Valor"
              valor={`${formatCurrency(Number(s.valor))} · ${s.tipo}`}
            />
            {(s.data_inicio || s.data_termino) && (
              <Linha
                rotulo="Período"
                valor={`${
                  s.data_inicio ? formatarDataBR(s.data_inicio) : "—"
                } → ${s.data_termino ? formatarDataBR(s.data_termino) : "em aberto"}`}
              />
            )}
            {s.cidade && <Linha rotulo="Cidade" valor={s.cidade} />}
          </BlocoInfo>

          <BlocoInfo icon={Mail} titulo="Solicitante">
            <Linha rotulo="Nome" valor={s.solicitante_nome ?? "—"} />
            {s.solicitante_email && (
              <Linha rotulo="Email" valor={s.solicitante_email} />
            )}
          </BlocoInfo>

          {s.observacoes && (
            <BlocoInfo icon={FileText} titulo="Observações">
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {s.observacoes}
              </p>
            </BlocoInfo>
          )}

          {s.status === "aprovada" && (
            <BlocoInfo
              icon={Clock}
              titulo={expirado ? "Link expirado" : "Link do freelancer"}
            >
              <p className="text-xs text-muted-foreground">
                Compartilhe este link com o freelancer para que ele preencha os
                dados pessoais e crie o contrato.
                {diasAteExpirar !== null && !expirado && (
                  <>
                    {" "}
                    O link expira em <strong>{diasAteExpirar} dia(s)</strong>.
                  </>
                )}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 min-w-0 truncate text-[11px] bg-muted/50 rounded px-2 py-1.5 border border-border">
                  {linkPublico}
                </code>
                <button
                  type="button"
                  onClick={copiarLink}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                    copiado
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-300"
                      : "bg-white text-foreground border border-border hover:border-california-red/40",
                  )}
                >
                  {copiado ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiado ? "Copiado" : "Copiar"}
                </button>
              </div>
            </BlocoInfo>
          )}

          {s.status === "cadastrada" && s.freelancer_id && (
            <BlocoInfo icon={CheckCircle2} titulo="Cadastro criado">
              <p className="text-xs text-muted-foreground">
                O freelancer preencheu os dados e o contrato foi criado.
              </p>
              <Link
                href={`/freelancers/${s.freelancer_id}`}
                prefetch={false}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover transition-colors"
              >
                Abrir perfil do freelancer
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </BlocoInfo>
          )}

          {s.status === "rejeitada" && (
            <BlocoInfo icon={XCircle} titulo="Rejeição">
              <Linha
                rotulo="Motivo"
                valor={s.rejeicao_motivo ?? "Sem motivo registrado"}
              />
              {s.rejeitado_em && (
                <Linha
                  rotulo="Quando"
                  valor={formatarDataBR(s.rejeitado_em)}
                />
              )}
            </BlocoInfo>
          )}

          {s.status === "cancelada" && (
            <BlocoInfo icon={Ban} titulo="Cancelamento">
              {s.cancelado_em && (
                <Linha
                  rotulo="Quando"
                  valor={formatarDataBR(s.cancelado_em)}
                />
              )}
            </BlocoInfo>
          )}
        </div>

        {/* Modo rejeição inline */}
        {modoRejeicao && (
          <div className="mt-4 space-y-2 rounded-lg border border-california-red/30 bg-california-red/5 p-4">
            <label className="text-xs font-semibold text-foreground">
              Motivo da rejeição
            </label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Explique brevemente para o solicitante"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModoRejeicao(false);
                  setMotivo("");
                }}
                disabled={pending}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={rejeitar}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                Confirmar rejeição
              </button>
            </div>
          </div>
        )}

        {/* Rodapé com ações */}
        {!modoRejeicao && (
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
            {s.status === "pendente" && isSolicitante && !isAprovador && (
              <button
                type="button"
                onClick={cancelar}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                Cancelar solicitação
              </button>
            )}
            {s.status === "pendente" && isAprovador && (
              <>
                <button
                  type="button"
                  onClick={() => setModoRejeicao(true)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Rejeitar
                </button>
                <button
                  type="button"
                  onClick={aprovar}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Aprovar
                </button>
              </>
            )}
            {s.status === "aprovada" && (isAprovador || isSolicitante) && (
              <button
                type="button"
                onClick={cancelar}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                Cancelar
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BlocoInfo({
  icon: Icon,
  titulo,
  children,
}: {
  icon: React.ElementType;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-5 first:pt-0 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <Icon className="h-3 w-3" />
        </div>
        <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          {titulo}
        </h4>
      </div>
      <div className="space-y-1.5 pl-8">{children}</div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-w-[80px] shrink-0">
        {rotulo}
      </dt>
      <dd className="text-sm text-foreground flex-1 min-w-0 break-words">
        {valor}
      </dd>
    </div>
  );
}

function formatarDataBR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
