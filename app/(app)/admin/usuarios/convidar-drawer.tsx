"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Send, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleLabel, type AppRole } from "@/lib/types";
import { convidarUsuario, type ActionResult } from "./actions";

const ROLES: AppRole[] = [
  "gerente_producao",
  "produtor",
  "freelancer",
  "financeiro",
  "administrador",
];

export function ConvidarUsuarioDrawer() {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [sucesso, setSucesso] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<AppRole>("gerente_producao");

  function reset() {
    setError(null);
    setFieldErrors({});
    setSucesso(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();
    const formData = new FormData(e.currentTarget);
    formData.set("role", role);

    startTransition(async () => {
      const res: ActionResult = await convidarUsuario(formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setSucesso(res.message ?? "Convite enviado.");
      // Fecha o drawer após um curto delay para o admin ver a confirmação.
      setTimeout(() => {
        setOpen(false);
        reset();
        setRole("gerente_producao");
      }, 1200);
    });
  }

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
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <UserPlus className="h-4 w-4" />
          Convidar usuário
        </button>
      </DialogTrigger>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Convidar novo usuário</DialogTitle>
          <DialogDescription>
            O usuário recebe um e-mail com link para ativar a conta e definir a
            senha. Ele já entra no tenant com o papel escolhido.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <Field label="E-mail" name="email" errors={fieldErrors}>
              <Input
                name="email"
                type="email"
                placeholder="pessoa@agenciacalifornia.com.br"
                autoFocus
                autoComplete="off"
                required
              />
            </Field>

            <Field label="Nome (opcional)" name="nome" errors={fieldErrors}>
              <Input
                name="nome"
                type="text"
                placeholder="Nome de exibição"
                autoComplete="off"
                maxLength={120}
              />
              <p className="text-[11px] text-muted-foreground">
                Se em branco, usamos a parte do e-mail antes do @ como padrão.
              </p>
            </Field>

            <Field label="Papel no tenant" name="role" errors={fieldErrors}>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as AppRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                <b>Administrador</b> gerencia usuários e regras.{" "}
                <b>Gestão de Projetos</b> opera orçamentos e jobs.{" "}
                <b>Financeiro</b> acompanha resultados.
              </p>
            </Field>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {sucesso && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{sucesso}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !!sucesso}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Enviar convite
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  errors,
  children,
}: {
  label: string;
  name: string;
  errors: Record<string, string[]>;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}
