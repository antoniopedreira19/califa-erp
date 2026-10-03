"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Clock, CheckCircle2, UserX, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AppRole } from "@/lib/types";
import {
  reenviarConviteColaborador,
  desvincularColaborador,
} from "../actions-acesso";
import type { AcessoColaborador } from "@/lib/auth/acesso-colaborador";
import { ModalConvidarAcesso } from "./modal-convidar-acesso";
import { ModalVincularExistente } from "./modal-vincular-existente";
import { ModalAlterarRole } from "./modal-alterar-role";

type Props = {
  colaborador: {
    id: string;
    nome: string;
    email: string | null;
    user_id: string | null;
  };
  acesso: AcessoColaborador | null;
  roleAtual: AppRole | null;
  profileNome: string | null;
};

type EstadoAcesso = "sem_acesso" | "convite_pendente" | "vinculado";

function derivarEstado(
  user_id: string | null,
  acesso: AcessoColaborador | null,
): EstadoAcesso {
  if (!user_id) return "sem_acesso";
  if (acesso && !acesso.last_sign_in_at) return "convite_pendente";
  return "vinculado";
}

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " às " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

export function CardAcesso({ colaborador, acesso, roleAtual, profileNome }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [modalConvidar, setModalConvidar] = React.useState(false);
  const [modalVincular, setModalVincular] = React.useState(false);
  const [modalRole, setModalRole] = React.useState(false);
  const [confirmandoDesvincular, setConfirmandoDesvincular] = React.useState(false);

  const estado = derivarEstado(colaborador.user_id, acesso);

  function handleReenviar() {
    startTransition(async () => {
      const res = await reenviarConviteColaborador({
        colaborador_id: colaborador.id,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
    });
  }

  function handleDesvincular() {
    startTransition(async () => {
      const res = await desvincularColaborador({
        colaborador_id: colaborador.id,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmandoDesvincular(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <KeyRound className="h-4 w-4 text-california-red" />
          </div>
          <h2 className="text-lg font-semibold">Acesso ao sistema</h2>
        </div>
      </div>

      {estado === "sem_acesso" && (
        <EstadoSemAcesso
          emailColaborador={colaborador.email}
          onConvidar={() => setModalConvidar(true)}
          onVincular={() => setModalVincular(true)}
        />
      )}

      {estado === "convite_pendente" && acesso && (
        <EstadoConvitePendente
          email={acesso.auth_email}
          invitedAt={acesso.invited_at}
          onReenviar={handleReenviar}
          onCancelar={() => setConfirmandoDesvincular(true)}
          pending={pending}
        />
      )}

      {estado === "vinculado" && acesso && (
        <EstadoVinculado
          nome={profileNome ?? "—"}
          email={acesso.auth_email}
          role={roleAtual}
          firstSignIn={acesso.email_confirmed_at}
          lastSignIn={acesso.last_sign_in_at}
          onAlterarRole={() => setModalRole(true)}
          onDesvincular={() => setConfirmandoDesvincular(true)}
          pending={pending}
        />
      )}

      {/* Modais */}
      {modalConvidar && (
        <ModalConvidarAcesso
          colaboradorId={colaborador.id}
          emailInicial={colaborador.email ?? ""}
          onFechar={() => setModalConvidar(false)}
          onSucesso={() => {
            setModalConvidar(false);
            router.refresh();
          }}
        />
      )}

      {modalVincular && (
        <ModalVincularExistente
          colaboradorId={colaborador.id}
          onFechar={() => setModalVincular(false)}
          onSucesso={() => {
            setModalVincular(false);
            router.refresh();
          }}
        />
      )}

      {modalRole && roleAtual && (
        <ModalAlterarRole
          colaboradorId={colaborador.id}
          roleAtual={roleAtual}
          onFechar={() => setModalRole(false)}
          onSucesso={() => {
            setModalRole(false);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmandoDesvincular}
        onOpenChange={(o) => !o && setConfirmandoDesvincular(false)}
        title={
          estado === "convite_pendente" ? "Cancelar convite?" : "Desvincular usuário?"
        }
        description={
          estado === "convite_pendente"
            ? `O convite enviado para ${acesso?.auth_email ?? ""} será cancelado. O colaborador volta para "Sem acesso".`
            : `${colaborador.nome} vai perder o acesso ao sistema. O usuário continua existindo em outros contextos — só o vínculo com o colaborador é removido.`
        }
        variant="destructive"
        confirmLabel={estado === "convite_pendente" ? "Cancelar convite" : "Desvincular"}
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={handleDesvincular}
      />
    </div>
  );
}

/* ---------------- Estado: sem acesso ---------------- */

function EstadoSemAcesso({
  emailColaborador,
  onConvidar,
  onVincular,
}: {
  emailColaborador: string | null;
  onConvidar: () => void;
  onVincular: () => void;
}) {
  const temEmail = !!emailColaborador?.trim();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Estado
        </p>
        <p className="mt-1 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            <UserX className="h-3 w-3" />
            Sem acesso
          </span>
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Esse colaborador ainda não tem login no sistema. Pra que ele veja o
        próprio perfil e solicite férias, envie um convite por email.
      </p>

      {temEmail && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Email cadastrado
          </p>
          <p className="text-sm font-medium">{emailColaborador}</p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2 flex-wrap">
        <button
          type="button"
          onClick={onConvidar}
          disabled={!temEmail}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Convidar
        </button>
        <button
          type="button"
          onClick={onVincular}
          className="text-sm font-medium text-california-red hover:underline"
        >
          ou vincular a usuário existente
        </button>
      </div>

      {!temEmail && (
        <p className="text-xs text-amber-700">
          Esse colaborador não tem email cadastrado. Edite os dados antes de
          convidar.
        </p>
      )}
    </div>
  );
}

/* ---------------- Estado: convite pendente ---------------- */

function EstadoConvitePendente({
  email,
  invitedAt,
  onReenviar,
  onCancelar,
  pending,
}: {
  email: string | null;
  invitedAt: string | null;
  onReenviar: () => void;
  onCancelar: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Estado
        </p>
        <p className="mt-1 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
            <Clock className="h-3 w-3" />
            Convite pendente
          </span>
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Convite enviado em{" "}
        <strong className="text-foreground">{fmtData(invitedAt)}</strong> para{" "}
        <strong className="text-foreground">{email ?? "—"}</strong>. Aguardando
        o colaborador definir a senha.
      </p>

      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onReenviar}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          Reenviar convite
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancelar convite
        </button>
      </div>
    </div>
  );
}

/* ---------------- Estado: vinculado ---------------- */

const ROLE_LABEL: Record<AppRole, string> = {
  administrador: "Administrador",
  gerente_producao: "Gerente de produção",
  financeiro: "Financeiro",
  produtor: "Produtor",
  freelancer: "Freelancer",
  rh: "RH",
  colaborador: "Colaborador",
};

function EstadoVinculado({
  nome,
  email,
  role,
  firstSignIn,
  lastSignIn,
  onAlterarRole,
  onDesvincular,
  pending,
}: {
  nome: string;
  email: string | null;
  role: AppRole | null;
  firstSignIn: string | null;
  lastSignIn: string | null;
  onAlterarRole: () => void;
  onDesvincular: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Estado
        </p>
        <p className="mt-1 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-3 w-3" />
            Vinculado
          </span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Usuário
          </p>
          <p className="mt-1 text-sm font-medium">{nome}</p>
          <p className="text-xs text-muted-foreground">{email ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Papel
          </p>
          <p className="mt-1 text-sm font-medium">
            {role ? ROLE_LABEL[role] : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Primeiro acesso
          </p>
          <p className="mt-1 text-sm">{fmtData(firstSignIn)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Último acesso
          </p>
          <p className="mt-1 text-sm">{fmtDataHora(lastSignIn)}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onAlterarRole}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" />
          Alterar papel
        </button>
        <button
          type="button"
          onClick={onDesvincular}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          Desvincular
        </button>
      </div>
    </div>
  );
}
