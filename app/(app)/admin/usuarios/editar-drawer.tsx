"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Save, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleLabel, type AppRole, type Empresa, type Regional } from "@/lib/types";
import {
  atualizarPapel,
  atualizarPermissoes,
  carregarPermissoes,
} from "./actions";
import {
  AcessoEmpresasEditor,
  type AcessoEscopo,
  type AcessoEmpresa,
} from "./acesso-empresas-editor";

const ROLES: AppRole[] = [
  "gerente_producao",
  "produtor",
  "freelancer",
  "financeiro",
  "administrador",
];

export type EditarUsuarioDrawerProps = {
  userId: string;
  userNome: string;
  userEmail: string;
  userRole: AppRole;
  isSelf: boolean;
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
    userRole,
    isSelf,
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
  const [role, setRole] = React.useState<AppRole>(userRole);
  const [escopo, setEscopo] = React.useState<AcessoEscopo>("todas");
  const [empresasEscolhidas, setEmpresasEscolhidas] = React.useState<
    AcessoEmpresa[]
  >([]);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setSucesso(null);
    setRole(userRole);
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
  }, [open, userId, userRole]);

  function handleSalvar() {
    setError(null);
    setSucesso(null);

    const papelMudou = role !== userRole;
    const perderaAdmin =
      isSelf && userRole === "administrador" && role !== "administrador";

    if (perderaAdmin) {
      const ok = window.confirm(
        "Você está trocando o SEU papel de Administrador para outro. " +
          "Depois de salvar, você perde acesso à área de Administração. Continuar?",
      );
      if (!ok) return;
    }

    startTransition(async () => {
      if (papelMudou) {
        const resPapel = await atualizarPapel(userId, role);
        if (!resPapel.ok) {
          setError(resPapel.message);
          return;
        }
      }

      const resPerm = await atualizarPermissoes(
        userId,
        escopo,
        empresasEscolhidas.map((e) => ({
          empresa_id: e.empresaId,
          regionais: e.regionais,
        })),
      );
      if (!resPerm.ok) {
        setError(resPerm.message);
        return;
      }

      setSucesso(
        papelMudou
          ? "Papel e permissões atualizados."
          : (resPerm.message ?? "Permissões atualizadas."),
      );
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
          <DialogTitle>Editar {userNome}</DialogTitle>
          <DialogDescription>
            {userEmail} · Ajuste o papel do usuário no tenant e a quais
            empresas e regionais ele tem acesso.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="role">Papel no tenant</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as AppRole)}
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="inline-flex items-center gap-1.5">
                      {r === "administrador" && (
                        <ShieldCheck className="h-3.5 w-3.5 text-california-red" />
                      )}
                      {roleLabel(r)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              <b>Administrador</b> gerencia usuários e regras.{" "}
              <b>Gerente de Projeto</b> opera orçamentos e jobs.{" "}
              <b>Financeiro</b> acompanha resultados.
            </p>
            {isSelf && userRole === "administrador" && role !== "administrador" && (
              <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Ao salvar, você perde acesso à área de Administração. Só
                  outro administrador poderá promover você de volta.
                </span>
              </div>
            )}
          </div>

          <div className="pt-1 border-t border-border">
            <p className="text-[11px] text-muted-foreground pt-4 pb-2">
              Administrador vê tudo do tenant automaticamente. Para os demais
              papéis, escolha <b>Todas</b> para acesso amplo, ou{" "}
              <b>Personalizado</b> para restringir a empresas e regionais
              específicas.
            </p>
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
          </div>

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
                Salvar
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
