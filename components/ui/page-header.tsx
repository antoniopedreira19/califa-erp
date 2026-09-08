import * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { Empresa } from "@/lib/types";
import { PageHeaderEmpresaFilter } from "@/components/ui/page-header-empresa-filter";

export type PageHeaderProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  eyebrow?: string;
  showEmpresaFilter?: boolean;
  empresas?: Empresa[];
  activeEmpresas?: Empresa[];
  actions?: React.ReactNode;
  filters?: React.ReactNode;
};

/**
 * Server component por default — passa a delegar o dropdown de empresa
 * pra um sub-componente client isolado. Isso evita puxar
 * useRouter + server action pra client bundle das telas que só
 * usam título/descrição.
 */
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

  const temLinhaDeBaixo = filters || actions;
  const temDropdown = showEmpresaFilter && empresas && activeEmpresas;

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

        {temDropdown && (
          <div className="shrink-0 pt-1">
            <PageHeaderEmpresaFilter
              empresas={empresas!}
              activeEmpresas={activeEmpresas!}
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
