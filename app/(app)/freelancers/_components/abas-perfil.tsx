"use client";

import * as React from "react";
import { UserCircle, FileText, History, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AbaKey = "dados" | "contratos" | "historico";

interface Aba {
  key: AbaKey;
  label: string;
  icon: LucideIcon;
}

const ABAS: Aba[] = [
  { key: "dados", label: "Dados pessoais", icon: UserCircle },
  { key: "contratos", label: "Contratos", icon: FileText },
  { key: "historico", label: "Histórico", icon: History },
];

interface Props {
  defaultTab?: AbaKey;
  dados: React.ReactNode;
  contratos: React.ReactNode;
  historico: React.ReactNode;
}

export function AbasPerfil({
  defaultTab = "dados",
  dados,
  contratos,
  historico,
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
      {ativa === "contratos" && <div>{contratos}</div>}
      {ativa === "historico" && <div>{historico}</div>}
    </div>
  );
}

function PlaceholderAba({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-xl mx-auto">
        {descricao}
      </p>
    </div>
  );
}
