"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition, useEffect } from "react";
import { Search, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type BeneficioOpcao = { id: string; nome: string };

const MODOS = [
  { value: "rateado", label: "Rateado 60/40" },
  { value: "integral_empresa", label: "Integral empresa" },
  { value: "integral_empresa_com_upgrade", label: "Integral + upgrade" },
];

const MESES = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

const SENTINEL = "__todos__";

export function FiltrosQuadro({
  busca: buscaInicial,
  beneficioId,
  modoCusteio,
  ano,
  mes,
  beneficios,
}: {
  busca?: string;
  beneficioId?: string;
  modoCusteio?: string;
  ano: number;
  mes: number;
  beneficios: BeneficioOpcao[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [busca, setBusca] = useState<string>(buscaInicial ?? "");

  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual - 2, anoAtual - 1, anoAtual, anoAtual + 1];

  useEffect(() => {
    const atual = searchParams.get("busca") ?? "";
    if (busca === atual) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (busca) params.set("busca", busca);
      else params.delete("busca");
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    }, 300);
    return () => clearTimeout(timer);
    // searchParams omitido de propósito: usamos .get apenas pra comparação.
    // Adicionar causa loop quando o próprio router.push atualiza searchParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  function setParam(chave: string, valor: string | number | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor !== undefined && valor !== "" && valor !== SENTINEL) {
      params.set(chave, String(valor));
    } else {
      params.delete(chave);
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const temFiltroAtivo = Boolean(busca || beneficioId || modoCusteio);

  function limparTodos() {
    setBusca("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("busca");
    params.delete("beneficioId");
    params.delete("modoCusteio");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
        />
      </div>

      <Select
        value={beneficioId ?? SENTINEL}
        onValueChange={(v) => setParam("beneficioId", v)}
        disabled={pending}
      >
        <SelectTrigger className="h-9 w-[200px]">
          <SelectValue placeholder="Todos os benefícios" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL}>Todos os benefícios</SelectItem>
          {beneficios.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={modoCusteio ?? SENTINEL}
        onValueChange={(v) => setParam("modoCusteio", v)}
        disabled={pending}
      >
        <SelectTrigger className="h-9 w-[200px]">
          <SelectValue placeholder="Todos os modos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL}>Todos os modos</SelectItem>
          {MODOS.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Competência:</span>
        <Select
          value={String(mes)}
          onValueChange={(v) => setParam("mes", Number(v))}
          disabled={pending}
        >
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MESES.map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(ano)}
          onValueChange={(v) => setParam("ano", Number(v))}
          disabled={pending}
        >
          <SelectTrigger className="h-9 w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anos.map((a) => (
              <SelectItem key={a} value={String(a)}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {temFiltroAtivo && (
        <button
          type="button"
          onClick={limparTodos}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Limpar filtros
        </button>
      )}
    </div>
  );
}
