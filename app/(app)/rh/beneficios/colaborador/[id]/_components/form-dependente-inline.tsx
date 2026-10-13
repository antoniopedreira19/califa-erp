"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { criarDependente } from "@/lib/actions/beneficios/dependentes";

const PARENTESCOS = [
  { value: "conjuge", label: "Cônjuge" },
  { value: "filho", label: "Filho" },
  { value: "filha", label: "Filha" },
  { value: "pai", label: "Pai" },
  { value: "mae", label: "Mãe" },
  { value: "irmao", label: "Irmão" },
  { value: "irma", label: "Irmã" },
  { value: "outro", label: "Outro" },
];

function formatarCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function FormDependenteInline({
  colaboradorId,
}: {
  colaboradorId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [dataNasc, setDataNasc] = useState("");
  const [parentesco, setParentesco] = useState("filho");

  function fechar() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("novo");
    router.push(`${pathname}?${params.toString()}`);
  }

  function submeter() {
    setErro(null);
    start(async () => {
      const res = await criarDependente({
        colaboradorId,
        nome: nome.trim(),
        cpf,
        dataNascimento: dataNasc,
        parentesco,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      fechar();
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-california-red/30 bg-california-red/5 p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Novo dependente
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Nome, CPF, data de nascimento e grau de parentesco são obrigatórios.
          </p>
        </div>
        <button
          type="button"
          onClick={fechar}
          disabled={pending}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">
            Nome completo
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={200}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">CPF</label>
          <input
            type="text"
            inputMode="numeric"
            value={cpf}
            onChange={(e) => setCpf(formatarCpf(e.target.value))}
            placeholder="000.000.000-00"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">
            Data de nascimento
          </label>
          <input
            type="date"
            value={dataNasc}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDataNasc(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">
            Parentesco
          </label>
          <Select value={parentesco} onValueChange={setParentesco}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARENTESCOS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {erro && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {erro}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={fechar}
          disabled={pending}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submeter}
          disabled={pending || !nome || !cpf || !dataNasc}
          className="rounded-md bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Cadastrar"}
        </button>
      </div>
    </section>
  );
}
