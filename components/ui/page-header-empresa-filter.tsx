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
 * UX: estado local otimista + commit APENAS ao fechar o Popover.
 * O operador clica quantas vezes quiser dentro do dropdown (feedback
 * visual 0ms) e nada bate no servidor até ele fechar. Ao fechar, se
 * houve mudança, uma única chamada ao servidor + router.refresh.
 *
 * Design conservador comparado a debounce por tempo: só há um ponto
 * de commit (o `close`), e o estado local só é sobrescrito pela prop
 * enquanto NÃO há mudança pendente.
 */
export function PageHeaderEmpresaFilter({
  empresas,
  activeEmpresas,
}: PageHeaderEmpresaFilterProps) {
  const router = useRouter();

  // Assinatura primitiva (string) dos ids do servidor — evita loops de
  // sincronização quando o prop chega como nova referência de array.
  const propIdsKey = activeEmpresas.map((e) => e.id).sort().join(",");

  const [localIds, setLocalIds] = React.useState<string[]>(() =>
    activeEmpresas.map((e) => e.id),
  );
  const [dirty, setDirty] = React.useState(false);

  // Sincroniza local com prop enquanto NÃO há mudança pendente.
  // Assim: se outra aba mexer no cookie, ou depois de um commit,
  // o local reflete o servidor. Mas nunca sobrescrevemos escolha
  // do operador ainda não commitada.
  React.useEffect(() => {
    if (!dirty) {
      setLocalIds(activeEmpresas.map((e) => e.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propIdsKey, dirty]);

  const handleSelectionChange = React.useCallback((ids: string[]) => {
    setLocalIds(ids);
    setDirty(true);
  }, []);

  const handleOpenChange = React.useCallback(
    async (open: boolean) => {
      if (open || !dirty) return;

      // Fechou com mudança pendente — commita.
      try {
        await setActiveEmpresas(localIds);
        setDirty(false);
        router.refresh();
      } catch (err) {
        console.error("[empresa-filter.commit]", err);
        // Volta pro estado do servidor em caso de erro.
        setLocalIds(activeEmpresas.map((e) => e.id));
        setDirty(false);
      }
    },
    [dirty, localIds, router, activeEmpresas],
  );

  return (
    <MultiSelectEmpresas
      empresas={empresas}
      selecionadas={localIds}
      onSelectionChange={handleSelectionChange}
      onOpenChange={handleOpenChange}
    />
  );
}
