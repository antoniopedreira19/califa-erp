"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Empresa } from "@/lib/types";
import { MultiSelectEmpresas } from "@/components/ui/multi-select-empresas";
import { setActiveEmpresas } from "@/app/actions/set-active-empresas";

export type PageHeaderEmpresaFilterProps = {
  empresas: Empresa[];
  activeEmpresas: Empresa[];
};

/**
 * Sub-componente client isolado do PageHeader — responsável só pelo
 * multi-select de empresa e a integração com a server action.
 *
 * Existe separado do PageHeader porque:
 * - PageHeader é usado em ~26 telas, a maioria SEM dropdown.
 * - Se PageHeader fosse "use client", TODAS essas telas carregariam
 *   useRouter + setActiveEmpresas no client bundle sem necessidade.
 * - Além disso, forçava SSR de client component com import de server
 *   action, o que quebrou em prod (erro server-side render).
 */
export function PageHeaderEmpresaFilter({
  empresas,
  activeEmpresas,
}: PageHeaderEmpresaFilterProps) {
  const router = useRouter();

  return (
    <MultiSelectEmpresas
      empresas={empresas}
      selecionadas={activeEmpresas.map((e) => e.id)}
      onSelectionChange={async (ids) => {
        await setActiveEmpresas(ids);
        router.refresh();
      }}
    />
  );
}
