"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TIPO_LABEL: Record<string, string> = {
  pj: "PJ",
  mei: "MEI",
  clt_recibo: "CLT + Recibo",
  clt: "CLT",
  estagio: "Estagiário",
  socio: "Sócio",
};

export type ColaboradorPicker = {
  id: string;
  nome: string;
  tipo_contratacao: string;
};

export function BotaoAdicionarBeneficiario({
  colaboradores,
  ano,
  mes,
}: {
  colaboradores: ColaboradorPicker[];
  ano: number;
  mes: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return colaboradores;
    return colaboradores.filter((c) => c.nome.toLowerCase().includes(termo));
  }, [busca, colaboradores]);

  function selecionar(id: string) {
    const params = new URLSearchParams();
    params.set("ano", String(ano));
    params.set("mes", String(mes));
    setAberto(false);
    router.push(`/rh/beneficios/colaborador/${id}?${params.toString()}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-california-red px-3 text-sm font-medium text-white hover:bg-california-red/90"
      >
        <Plus className="h-4 w-4" />
        Adicionar Beneficiário
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar beneficiário</DialogTitle>
            <DialogDescription>
              Escolha um colaborador para cadastrar um novo benefício.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              />
            </div>

            <div className="max-h-80 overflow-y-auto rounded-md border border-border">
              {filtrados.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum colaborador encontrado.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtrados.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => selecionar(c.id)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium uppercase">
                            {c.nome}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {TIPO_LABEL[c.tipo_contratacao] ?? c.tipo_contratacao}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
