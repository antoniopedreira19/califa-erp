"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Globe, Plus, Power, PowerOff } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClientePortal } from "@/lib/types";
import { criarPortal, editarPortal, alternarPortal } from "./portais-actions";

/**
 * Portais de fornecedor do cliente.
 *
 * Vários por cliente de propósito — certos clientes mantêm mais de um. O
 * envio do job para faturamento escolhe qual usar, e guarda a URL junto
 * do envio para o registro não depender deste cadastro no futuro.
 */
export function PortaisCard({
  clienteId,
  portais,
}: {
  clienteId: string;
  portais: ClientePortal[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [aberto, setAberto] = React.useState(false);
  const [editando, setEditando] = React.useState<ClientePortal | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [confirmando, setConfirmando] = React.useState<ClientePortal | null>(
    null,
  );

  function abrirNovo() {
    setEditando(null);
    setErro(null);
    setFieldErrors({});
    setAberto(true);
  }

  function abrirEdicao(p: ClientePortal) {
    setEditando(p);
    setErro(null);
    setFieldErrors({});
    setAberto(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = editando
        ? await editarPortal(clienteId, editando.id, formData)
        : await criarPortal(clienteId, formData);
      if (!res.ok) {
        setErro(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setAberto(false);
      router.refresh();
    });
  }

  function handleAlternar() {
    if (!confirmando) return;
    const alvo = confirmando;
    startTransition(async () => {
      const res = await alternarPortal(clienteId, alvo.id, !alvo.ativo);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <Globe className="h-4 w-4 text-california-red" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          Portais de fornecedor
        </h2>
        <button
          type="button"
          onClick={abrirNovo}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:border-california-red hover:text-california-red"
        >
          <Plus className="h-3 w-3" />
          Adicionar portal
        </button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        Onde a nota deste cliente é lançada. Aparecem no envio do job para
        faturamento — um cliente pode ter mais de um.
      </p>

      {portais.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhum portal cadastrado.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {portais.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    !p.ativo && "text-muted-foreground line-through",
                  )}
                >
                  {p.nome}
                </p>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 break-all text-xs text-california-red hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {p.url}
                </a>
              </div>
              <button
                type="button"
                onClick={() => abrirEdicao(p)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(p)}
                title={p.ativo ? "Inativar portal" : "Reativar portal"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {p.ativo ? (
                  <PowerOff className="h-3 w-3" />
                ) : (
                  <Power className="h-3 w-3" />
                )}
                {p.ativo ? "Inativar" : "Reativar"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DrawerContent>
          <DialogHeader className="border-b border-border p-6">
            <DialogTitle>
              {editando ? "Editar portal" : "Adicionar portal"}
            </DialogTitle>
            <DialogDescription>
              O nome é como o time chama o portal; o link é o endereço onde a
              nota é lançada.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmit}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <div className="space-y-2">
                <Label htmlFor="nome">
                  Nome <span className="text-california-red">*</span>
                </Label>
                <Input
                  id="nome"
                  name="nome"
                  required
                  maxLength={80}
                  defaultValue={editando?.nome ?? ""}
                  placeholder="Ex.: Coupa, Ariba, Portal NF"
                />
                {fieldErrors.nome?.map((m, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {m}
                  </p>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">
                  Link <span className="text-california-red">*</span>
                </Label>
                <Input
                  id="url"
                  name="url"
                  required
                  maxLength={500}
                  defaultValue={editando?.url ?? ""}
                  placeholder="https://..."
                />
                {fieldErrors.url?.map((m, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {m}
                  </p>
                ))}
              </div>
              {erro && (
                <p className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                  {erro}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
              >
                {pending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </DrawerContent>
      </Dialog>

      <ConfirmDialog
        open={confirmando !== null}
        onOpenChange={(o) => !o && setConfirmando(null)}
        title={
          confirmando?.ativo
            ? `Inativar "${confirmando?.nome}"?`
            : `Reativar "${confirmando?.nome}"?`
        }
        description={
          confirmando?.ativo
            ? "Ele deixa de aparecer no envio de jobs para faturamento. Envios já feitos continuam apontando para ele."
            : "Ele volta a aparecer no envio de jobs para faturamento."
        }
        confirmLabel={confirmando?.ativo ? "Inativar" : "Reativar"}
        pending={pending}
        onConfirm={handleAlternar}
      />
    </div>
  );
}
