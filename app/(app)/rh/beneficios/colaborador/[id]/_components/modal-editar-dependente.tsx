"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { editarDependente } from "@/lib/actions/beneficios/dependentes";
import type { DependenteComPlanos } from "@/lib/queries/beneficios";

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

export function ModalEditarDependente({
  open,
  onOpenChange,
  dependente,
  onSucesso,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dependente: DependenteComPlanos | null;
  onSucesso?: (nome: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [dataNasc, setDataNasc] = useState("");
  const [parentesco, setParentesco] = useState("filho");

  useEffect(() => {
    if (!open || !dependente) return;
    setNome(dependente.nome);
    setCpf(formatarCpf(dependente.cpf));
    setDataNasc(dependente.data_nascimento ?? "");
    setParentesco(dependente.parentesco ?? "outro");
    setErro(null);
  }, [open, dependente]);

  function submeter() {
    if (!dependente) return;
    setErro(null);
    start(async () => {
      const res = await editarDependente({
        dependenteId: dependente.id,
        nome: nome.trim(),
        cpf,
        dataNascimento: dataNasc,
        parentesco,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      const nomeSalvo = nome.trim();
      onOpenChange(false);
      onSucesso?.(nomeSalvo);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar dependente</DialogTitle>
          <DialogDescription>
            Corrija nome, CPF, data de nascimento ou parentesco. Os planos
            incluídos não mudam aqui — use a aba Dependentes para incluir ou
            remover de planos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Nome completo
              </label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={200}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Parentesco
              </label>
              <Select value={parentesco} onValueChange={setParentesco}>
                <SelectTrigger className="h-10">
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

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                CPF
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={cpf}
                onChange={(e) => setCpf(formatarCpf(e.target.value))}
                placeholder="110.000.024-00"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              />
            </div>
            <div>
              <label
                htmlFor="editar-dep-data-nasc"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Data de nascimento
              </label>
              <DatePicker
                name="data_nascimento_dep"
                id="editar-dep-data-nasc"
                defaultValue={dataNasc}
                placeholder="dd/mm/aaaa"
                comSeletorAnoMes
                fromYear={1920}
                toYear={new Date().getFullYear()}
                dateDisabled={(d) => d > new Date()}
                onDateChange={(d) =>
                  setDataNasc(d ? d.toISOString().slice(0, 10) : "")
                }
              />
            </div>
          </div>

          {erro && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {erro}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
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
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
