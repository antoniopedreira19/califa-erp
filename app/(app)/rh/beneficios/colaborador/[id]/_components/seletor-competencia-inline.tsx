"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MESES = [
  { v: 1, l: "Janeiro" }, { v: 2, l: "Fevereiro" }, { v: 3, l: "Março" },
  { v: 4, l: "Abril" }, { v: 5, l: "Maio" }, { v: 6, l: "Junho" },
  { v: 7, l: "Julho" }, { v: 8, l: "Agosto" }, { v: 9, l: "Setembro" },
  { v: 10, l: "Outubro" }, { v: 11, l: "Novembro" }, { v: 12, l: "Dezembro" },
];

export function SeletorCompetenciaInline({
  ano,
  mes,
}: {
  ano: number;
  mes: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual - 2, anoAtual - 1, anoAtual, anoAtual + 1];

  function atualizar(novoAno: number, novoMes: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("ano", String(novoAno));
    params.set("mes", String(novoMes));
    start(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Competência:</span>
      <Select
        value={String(mes)}
        onValueChange={(v) => atualizar(ano, Number(v))}
        disabled={pending}
      >
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MESES.map((m) => (
            <SelectItem key={m.v} value={String(m.v)}>
              {m.l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(ano)}
        onValueChange={(v) => atualizar(Number(v), mes)}
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
  );
}
