"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { Empresa } from "@/lib/types";
import { MultiSelectEmpresas } from "@/components/ui/multi-select-empresas";
import { setActiveEmpresas } from "@/app/actions/set-active-empresas";

export type PageHeaderProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  eyebrow?: string;
  showEmpresaFilter?: boolean;
  /** Obrigatório se showEmpresaFilter=true. */
  empresas?: Empresa[];
  /** Obrigatório se showEmpresaFilter=true. */
  activeEmpresas?: Empresa[];
  actions?: React.ReactNode;
  filters?: React.ReactNode;
};

export function PageHeader(props: PageHeaderProps) {
  const {
    title,
    description,
    icon: Icon,
    eyebrow,
    showEmpresaFilter = false,
    empresas,
    activeEmpresas,
    actions,
    filters,
  } = props;

  const router = useRouter();

  const temLinhaDeBaixo = filters || actions;

  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wider text-california-red mb-1">
              {eyebrow}
            </p>
          )}
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="rounded-lg bg-california-red/10 p-2 shrink-0">
                <Icon className="h-5 w-5 text-california-red" />
              </div>
            )}
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          </div>
          {description && (
            <p className="text-sm text-muted-foreground max-w-2xl text-pretty mt-2">
              {description}
            </p>
          )}
        </div>

        {showEmpresaFilter && empresas && activeEmpresas && (
          <div className="shrink-0 pt-1">
            <MultiSelectEmpresas
              empresas={empresas}
              selecionadas={activeEmpresas.map((e) => e.id)}
              onSelectionChange={async (ids) => {
                await setActiveEmpresas(ids);
                router.refresh();
              }}
            />
          </div>
        )}
      </div>

      {temLinhaDeBaixo && (
        <>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              {filters}
            </div>
            {actions && (
              <div className="flex items-center gap-2 shrink-0">
                {actions}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
