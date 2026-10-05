"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition, useEffect } from "react";
import { Search, X } from "lucide-react";

type BeneficioOpcao = { id: string; nome: string };

const MODOS: { value: string; label: string }[] = [
  { value: "rateado", label: "Rateado 60/40" },
  { value: "integral_empresa", label: "Integral empresa" },
  { value: "integral_empresa_com_upgrade", label: "Integral + upgrade" },
];

export function FiltrosColaboradores({
  busca: buscaInicial,
  beneficioId,
  modoCusteio,
  beneficios,
}: {
  busca?: string;
  beneficioId?: string;
  modoCusteio?: string;
  beneficios: BeneficioOpcao[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [busca, setBusca] = useState(buscaInicial ?? "");

  // Debounce busca (300ms)
  useEffect(() => {
    const atualAtual = searchParams.get("busca") ?? "";
    if (busca === atualAtual) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (busca) {
        params.set("busca", busca);
      } else {
        params.delete("busca");
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  function setParam(chave: string, valor: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor) {
      params.set(chave, valor);
    } else {
      params.delete(chave);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  const temFiltroAtivo = Boolean(busca || beneficioId || modoCusteio);

  function limparTodos() {
    setBusca("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("busca");
    params.delete("beneficioId");
    params.delete("modoCusteio");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[220px] max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome…"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
        />
      </div>
      <select
        value={beneficioId ?? ""}
        onChange={(e) => setParam("beneficioId", e.target.value || undefined)}
        disabled={pending}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
      >
        <option value="">Todos os benefícios</option>
        {beneficios.map((b) => (
          <option key={b.id} value={b.id}>
            {b.nome}
          </option>
        ))}
      </select>
      <select
        value={modoCusteio ?? ""}
        onChange={(e) => setParam("modoCusteio", e.target.value || undefined)}
        disabled={pending}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
      >
        <option value="">Todos os modos</option>
        {MODOS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {temFiltroAtivo && (
        <button
          type="button"
          onClick={limparTodos}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Limpar
        </button>
      )}
    </div>
  );
}
