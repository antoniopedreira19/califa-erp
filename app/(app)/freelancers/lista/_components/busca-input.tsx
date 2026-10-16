"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

/**
 * Busca em servidor: submit do form faz push na URL com `?q=`.
 * Mantém `acao` e demais params existentes.
 */
export function BuscaInput() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inicial = searchParams.get("q") ?? "";
  const [value, setValue] = React.useState(inicial);

  // Sincroniza quando o URL muda via back/forward
  React.useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  function montarQuery(novaBusca: string): string {
    const params = new URLSearchParams(searchParams.toString());
    if (novaBusca.trim()) {
      params.set("q", novaBusca.trim());
    } else {
      params.delete("q");
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/freelancers/lista${montarQuery(value)}`);
  }

  function limpar() {
    setValue("");
    router.push(`/freelancers/lista${montarQuery("")}`);
  }

  return (
    <form onSubmit={onSubmit} className="relative flex-1 min-w-[240px] max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar por nome ou CPF..."
        className="w-full h-10 rounded-lg border border-border bg-white pl-10 pr-9 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15"
      />
      {value && (
        <button
          type="button"
          onClick={limpar}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Limpar busca"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  );
}
