"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Save } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import type { Empresa, Regional } from "@/lib/types";
import { atualizarPermissoes, carregarPermissoes } from "./actions";
import {
  AcessoEmpresasEditor,
  type AcessoEscopo,
  type AcessoEmpresa,
} from "./acesso-empresas-editor";

export type EditarUsuarioDrawerProps = {
  userId: string;
  userNome: string;
  userEmail: string;
  empresas: Pick<Empresa, "id" | "razao_social" | "nome_fantasia">[];
  regionais: Pick<Regional, "id" | "nome" | "empresa_id">[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditarUsuarioDrawer(props: EditarUsuarioDrawerProps) {
  const {
    userId,
    userNome,
    userEmail,
    empresas,
    regionais,
    open,
    onOpenChange,
  } = props;
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState<string | null>(null);
  const [escopo, setEscopo] = React.useState<AcessoEscopo>("todas");
  const [empresasEscolhidas, setEmpresasEscolhidas] = React.useState<
    AcessoEmpresa[]
  >([]);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setSucesso(null);
    setLoading(true);
    carregarPermissoes(userId)
      .then((res) => {
        if (res.ok) {
          setEscopo(res.escopo);
          setEmpresasEscolhidas(
            res.empresas.map((e) => ({
              empresaId: e.empresa_id,
              regionais: e.regionais,
            })),
          );
        } else {
          setError(res.message);
        }
      })
      .finally(() => setLoading(false));
  }, [open, userId]);

  function handleSalvar() {
    setError(null);
    setSucesso(null);
    startTransition(async () => {
      const res = await atualizarPermissoes(
        userId,
        escopo,
        empresasEscolhidas.map((e) => ({
          empresa_id: e.empresaId,
          regionais: e.regionais,
        })),
      );
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSucesso(res.message ?? "Permissões atualizadas.");
      setTimeout(() => {
        onOpenChange(false);
        router.refresh();
      }, 900);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Permissões de {userNome}</DialogTitle>
          <DialogDescription>
            {userEmail} · Defina a quais empresas e regionais este usuário tem
            acesso.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Carregando permissões...
            </p>
          ) : (
            <AcessoEmpresasEditor
              empresas={empresas}
              regionais={regionais}
              escopo={escopo}
              empresasEscolhidas={empresasEscolhidas}
              onChange={(novoEscopo, novoEmpresas) => {
                setEscopo(novoEscopo);
                setEmpresasEscolhidas(novoEmpresas);
              }}
            />
          )}
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {sucesso && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{sucesso}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={pending || loading || !!sucesso}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salvar permissões
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
