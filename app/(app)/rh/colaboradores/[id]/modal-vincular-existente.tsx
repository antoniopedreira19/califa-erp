"use client";

import * as React from "react";
import { AlertCircle, Search, Link2 } from "lucide-react";
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
  buscarProfilesParaVincular,
  vincularColaboradorPorBusca,
  type ProfileResumo,
} from "../actions-acesso";

type Props = {
  colaboradorId: string;
  onFechar: () => void;
  onSucesso: () => void;
};

const ROLES: { value: AppRole; label: string }[] = [
  { value: "colaborador", label: "Colaborador" },
  { value: "produtor", label: "Produtor" },
  { value: "gerente_producao", label: "Gerente de produção" },
  { value: "financeiro", label: "Financeiro" },
  { value: "rh", label: "RH" },
  { value: "freelancer", label: "Freelancer" },
  { value: "administrador", label: "Administrador" },
];

export function ModalVincularExistente({
  colaboradorId,
  onFechar,
  onSucesso,
}: Props) {
  const [termo, setTermo] = React.useState("");
  const [profiles, setProfiles] = React.useState<ProfileResumo[]>([]);
  const [buscando, setBuscando] = React.useState(false);
  const [selecionado, setSelecionado] = React.useState<ProfileResumo | null>(null);
  const [role, setRole] = React.useState<AppRole>("colaborador");
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  // Debounce da busca.
  React.useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) {
      setProfiles([]);
      return;
    }
    setBuscando(true);
    const timer = setTimeout(async () => {
      const res = await buscarProfilesParaVincular({ termo: t });
      if (res.ok) {
        setProfiles(res.profiles);
      } else {
        setErro(res.message);
      }
      setBuscando(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [termo]);

  function handleConfirmar() {
    if (!selecionado) return;
    setErro(null);
    startTransition(async () => {
      const res = await vincularColaboradorPorBusca({
        colaborador_id: colaboradorId,
        profile_id: selecionado.id,
        role,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onSucesso();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-california-red" />
            Vincular a usuário existente
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="vinc-termo">Buscar usuário</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="vinc-termo"
                type="text"
                value={termo}
                onChange={(e) => {
                  setTermo(e.target.value);
                  setSelecionado(null);
                }}
                placeholder="Digite nome ou email (mín 2 letras)"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {termo.trim().length >= 2 && (
            <div className="rounded-lg border border-border max-h-64 overflow-y-auto">
              {buscando ? (
                <p className="p-3 text-sm text-muted-foreground text-center">
                  Buscando...
                </p>
              ) : profiles.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground text-center">
                  Nenhum usuário encontrado (ou todos já estão vinculados a
                  outros colaboradores).
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {profiles.map((p) => {
                    const ativo = selecionado?.id === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setSelecionado(p)}
                          className={`w-full px-3 py-2.5 text-left transition-colors ${
                            ativo
                              ? "bg-california-red/5 border-l-2 border-california-red"
                              : "hover:bg-muted/40"
                          }`}
                        >
                          <p className="text-sm font-medium">{p.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.email}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {selecionado && (
            <div className="space-y-1.5">
              <Label htmlFor="vinc-role">Papel no sistema</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger id="vinc-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Se o usuário já é membro deste tenant, a role existente será
                atualizada para essa.
              </p>
            </div>
          )}

          {selecionado && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              Após vincular, o email do colaborador será sincronizado com{" "}
              <strong className="text-foreground">{selecionado.email}</strong>.
            </div>
          )}

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
              type="button"
              onClick={handleConfirmar}
              disabled={pending || !selecionado}
              className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
            >
              {pending ? "Vinculando..." : "Vincular"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
