"use client";

import * as React from "react";
import {
  UserCircle,
  KeyRound,
  FolderOpen,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AbaKey = "dados" | "acesso" | "documentos" | "financeiro";

interface Aba {
  key: AbaKey;
  label: string;
  icon: LucideIcon;
}

const ABAS: Aba[] = [
  { key: "dados", label: "Dados pessoais", icon: UserCircle },
  { key: "documentos", label: "Documentos", icon: FolderOpen },
  { key: "financeiro", label: "Financeiro", icon: Wallet },
  { key: "acesso", label: "Acesso ao sistema", icon: KeyRound },
];

interface Props {
  defaultTab?: AbaKey;
  dados: React.ReactNode;
  acesso: React.ReactNode;
  documentos: React.ReactNode;
  financeiro: React.ReactNode;
}

export function AbasPerfil({
  defaultTab = "dados",
  dados,
  acesso,
  documentos,
  financeiro,
}: Props) {
  const [ativa, setAtiva] = React.useState<AbaKey>(defaultTab);

  return (
    <div className="space-y-4">
      <div className="border-b border-border">
        <nav
          className="flex items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {ABAS.map((a) => {
            const Icon = a.icon;
            const ativo = a.key === ativa;
            return (
              <button
                key={a.key}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => setAtiva(a.key)}
                className={cn(
                  "relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  ativo
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    ativo ? "text-california-red" : "text-muted-foreground/70",
                  )}
                />
                {a.label}
                {ativo && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-california-red"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {ativa === "dados" && <div>{dados}</div>}
      {ativa === "acesso" && <div>{acesso}</div>}
      {ativa === "documentos" && <div>{documentos}</div>}
      {ativa === "financeiro" && <div>{financeiro}</div>}
    </div>
  );
}
