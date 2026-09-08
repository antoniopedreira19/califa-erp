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

const DEBOUNCE_MS = 500;

/**
 * Sub-componente client isolado do PageHeader — responsável só pelo
 * multi-select de empresa e a integração com a server action.
 *
 * UX otimista com debounce: cliques atualizam o state local
 * imediatamente (feedback visual instantâneo); a chamada ao servidor
 * acontece 500ms depois do último clique, OU imediatamente quando o
 * operador fecha o Popover. Assim, 3 cliques em sequência viram 1
 * request só (antes viravam 3 requests sequenciais, causando latência
 * cumulativa de dezenas de segundos).
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

  const idsFromProps = React.useMemo(
    () => activeEmpresas.map((e) => e.id),
    [activeEmpresas],
  );

  const [idsLocais, setIdsLocais] = React.useState<string[]>(idsFromProps);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const idsPendentesRef = React.useRef<string[] | null>(null);

  // Sincroniza state local quando a prop muda (após router.refresh trazer
  // o resultado do servidor). Evita ficar dessincronizado se outra aba
  // mexer no cookie, ou se o commit falhar.
  React.useEffect(() => {
    setIdsLocais(idsFromProps);
  }, [idsFromProps]);

  const commit = React.useCallback(
    async (ids: string[]) => {
      idsPendentesRef.current = null;
      try {
        await setActiveEmpresas(ids);
      } catch (err) {
        console.error("[empresa-filter.commit]", err);
        // Em caso de erro, volta pro que o servidor tem.
        setIdsLocais(idsFromProps);
        return;
      }
      router.refresh();
    },
    [router, idsFromProps],
  );

  const handleSelectionChange = React.useCallback(
    (ids: string[]) => {
      setIdsLocais(ids);
      idsPendentesRef.current = ids;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pendente = idsPendentesRef.current;
        if (pendente !== null) void commit(pendente);
      }, DEBOUNCE_MS);
    },
    [commit],
  );

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      // Ao fechar o popover, se há mudança pendente, commita imediato.
      if (!open && idsPendentesRef.current !== null) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        void commit(idsPendentesRef.current);
      }
    },
    [commit],
  );

  // Cleanup: se o componente desmontar com timer pendente, commita antes
  // de sumir. Cobre o caso de o operador navegar pra outra rota no meio
  // da janela de debounce.
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (idsPendentesRef.current !== null) {
        // Fire-and-forget — a página já vai sair.
        void setActiveEmpresas(idsPendentesRef.current).catch((err) =>
          console.error("[empresa-filter.unmount-commit]", err),
        );
        idsPendentesRef.current = null;
      }
    };
  }, []);

  const activeEmpresasLocais = React.useMemo(
    () => empresas.filter((e) => idsLocais.includes(e.id)),
    [empresas, idsLocais],
  );

  return (
    <MultiSelectEmpresas
      empresas={empresas}
      selecionadas={activeEmpresasLocais.map((e) => e.id)}
      onSelectionChange={handleSelectionChange}
      onOpenChange={handleOpenChange}
    />
  );
}
