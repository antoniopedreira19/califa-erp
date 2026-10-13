"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, Smile } from "lucide-react";
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
import {
  criarDependente,
  incluirDepEmPlano,
} from "@/lib/actions/beneficios/dependentes";
import type { VinculoDoColaborador } from "@/lib/queries/beneficios";
import { coresBeneficio } from "@/lib/beneficios/cores";

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

export function ModalNovoDependente({
  open,
  onOpenChange,
  colaboradorId,
  vinculosAtivos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  colaboradorId: string;
  vinculosAtivos: VinculoDoColaborador[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [dataNasc, setDataNasc] = useState("");
  const [parentesco, setParentesco] = useState("filho");
  const [vinculosSelecionados, setVinculosSelecionados] = useState<Set<string>>(
    new Set(vinculosAtivos.map((v) => v.id)),
  );

  // Reset no abrir
  useEffect(() => {
    if (!open) return;
    setNome("");
    setCpf("");
    setDataNasc("");
    setParentesco("filho");
    setErro(null);
    setAviso(null);
    // Pré-selecionar todos os vínculos ativos (mais comum)
    setVinculosSelecionados(new Set(vinculosAtivos.map((v) => v.id)));
  }, [open, vinculosAtivos]);

  function toggleVinculo(vinculoId: string) {
    setVinculosSelecionados((prev) => {
      const n = new Set(prev);
      if (n.has(vinculoId)) n.delete(vinculoId);
      else n.add(vinculoId);
      return n;
    });
  }

  function submeter() {
    setErro(null);
    setAviso(null);
    start(async () => {
      // 1) Cria o dependente
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

      // 2) Inclui nos planos selecionados (erros não bloqueiam — dep já foi criado)
      const hoje = new Date().toISOString().slice(0, 10);
      const falhas: string[] = [];
      for (const vinculoId of vinculosSelecionados) {
        const inc = await incluirDepEmPlano({
          vinculoId,
          dependenteId: res.id,
          dataInicio: hoje,
        });
        if (!inc.ok) {
          const v = vinculosAtivos.find((x) => x.id === vinculoId);
          falhas.push(`${v?.beneficio_nome ?? "plano"}: ${inc.message}`);
        }
      }

      if (falhas.length > 0) {
        setAviso(
          `Dependente criado, mas falhou incluir em: ${falhas.join("; ")}. Você pode tentar incluir pela aba Dependentes.`,
        );
        router.refresh();
        return;
      }

      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo dependente</DialogTitle>
          <DialogDescription>
            Nome, CPF, data de nascimento e parentesco são obrigatórios.
            Marque em quais benefícios o dependente deve ser incluído.
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
                placeholder="000.000.000-00"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              />
            </div>
            <div>
              <label
                htmlFor="novo-dep-data-nasc"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Data de nascimento
              </label>
              <DatePicker
                name="data_nascimento_dep"
                id="novo-dep-data-nasc"
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

          {/* Checkboxes de planos */}
          <div>
            <label className="mb-2 block text-xs font-medium text-foreground">
              Incluir nos planos ativos do colaborador
            </label>
            {vinculosAtivos.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                O colaborador não tem vínculo ativo. O dependente será cadastrado
                e você poderá incluir em planos depois.
              </div>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-background p-3">
                {vinculosAtivos.map((v) => {
                  const marcado = vinculosSelecionados.has(v.id);
                  const Icon =
                    v.beneficio_tipo === "saude" ? HeartPulse : Smile;
                  const cores = coresBeneficio(v.beneficio_tipo);
                  return (
                    <label
                      key={v.id}
                      className="flex cursor-pointer items-center gap-3 text-sm hover:bg-muted/30 rounded px-2 py-1.5"
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => toggleVinculo(v.id)}
                        className="h-4 w-4 accent-california-red"
                      />
                      <Icon className={`h-4 w-4 ${cores.icon}`} />
                      <span className="font-medium text-foreground">
                        {v.beneficio_nome}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {erro && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {erro}
            </div>
          )}
          {aviso && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {aviso}
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
            {pending ? "Salvando…" : "Cadastrar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
