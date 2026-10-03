"use client";

import * as React from "react";
import { AlertCircle, Info, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppRole } from "@/lib/types";
import {
  convidarColaborador,
  vincularColaboradorAProfileExistente,
} from "../actions-acesso";

type Props = {
  colaboradorId: string;
  emailInicial: string;
  onFechar: () => void;
  onSucesso: () => void;
};

const ROLE_OPTIONS: { value: AppRole; label: string; descricao: string }[] = [
  {
    value: "colaborador",
    label: "Colaborador",
    descricao: "Acesso ao próprio /perfil. Padrão para quem só precisa consultar e solicitar.",
  },
  {
    value: "produtor",
    label: "Produtor",
    descricao: "Acessa produção. Use se o colaborador for também produtor.",
  },
  {
    value: "gerente_producao",
    label: "Gerente de produção",
    descricao: "Gerencia equipes de produção.",
  },
  {
    value: "financeiro",
    label: "Financeiro",
    descricao: "Acesso ao módulo financeiro.",
  },
  {
    value: "rh",
    label: "RH",
    descricao: "Acesso completo ao módulo de RH.",
  },
  {
    value: "freelancer",
    label: "Freelancer",
    descricao: "Role legada do sistema.",
  },
  {
    value: "administrador",
    label: "Administrador",
    descricao: "Acesso total — use com cuidado.",
  },
];

type EmailJaExiste = {
  profile_id: string;
  profile_nome: string;
  profile_email: string;
};

export function ModalConvidarAcesso({
  colaboradorId,
  emailInicial,
  onFechar,
  onSucesso,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [email, setEmail] = React.useState(emailInicial);
  const [role, setRole] = React.useState<AppRole>("colaborador");
  const [erro, setErro] = React.useState<string | null>(null);
  const [emailJaExiste, setEmailJaExiste] = React.useState<EmailJaExiste | null>(null);

  const emailMudou = email.trim().toLowerCase() !== emailInicial.trim().toLowerCase();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEmailJaExiste(null);

    startTransition(async () => {
      const res = await convidarColaborador({
        colaborador_id: colaboradorId,
        email: email.trim(),
        role,
      });

      if (res.ok) {
        onSucesso();
        return;
      }

      if (res.codigo === "email_ja_tem_profile") {
        setEmailJaExiste({
          profile_id: res.profile_id,
          profile_nome: res.profile_nome,
          profile_email: res.profile_email,
        });
        return;
      }

      setErro(res.message);
    });
  }

  function handleVincularExistente() {
    if (!emailJaExiste) return;
    setErro(null);
    startTransition(async () => {
      const res = await vincularColaboradorAProfileExistente({
        colaborador_id: colaboradorId,
        profile_id: emailJaExiste.profile_id,
        role,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onSucesso();
    });
  }

  const roleInfo = ROLE_OPTIONS.find((r) => r.value === role);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-california-red" />
            Convidar colaborador
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          {emailJaExiste ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-sm text-amber-900">
                O email <strong>{emailJaExiste.profile_email}</strong> já tem
                conta no sistema (usuário:{" "}
                <strong>{emailJaExiste.profile_nome}</strong>).
              </p>
              <p className="text-sm text-amber-900">
                Deseja vincular esse colaborador à conta existente, em vez de
                mandar um novo convite?
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleVincularExistente}
                  disabled={pending}
                  className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
                >
                  {pending ? "Vinculando..." : "Vincular"}
                </button>
                <button
                  type="button"
                  onClick={() => setEmailJaExiste(null)}
                  disabled={pending}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Trocar email
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="convite-email">Email do convite</Label>
                <Input
                  id="convite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="fulano@california.com"
                  required
                />
                {emailMudou && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700">
                    <Info className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>
                      Esse email é diferente do cadastrado no colaborador. Ao
                      enviar o convite, o email do colaborador também será
                      atualizado para manter consistência.
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="convite-role">Papel no sistema</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as AppRole)}
                >
                  <SelectTrigger id="convite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {roleInfo && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{roleInfo.descricao}</span>
                  </p>
                )}
              </div>

              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                O colaborador vai receber um email com link pra definir uma
                senha. Após isso ele acessa o sistema pelo próprio{" "}
                <code className="rounded bg-background px-1 py-0.5 text-xs">
                  /perfil
                </code>
                .
              </div>
            </>
          )}

          {!emailJaExiste && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={onFechar}
                disabled={pending}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending || !email.trim()}
                className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
              >
                {pending ? "Enviando..." : "Enviar convite"}
              </button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
