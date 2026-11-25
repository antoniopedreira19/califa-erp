"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, UserRound, HeartPulse, Smile, CircleSlash } from "lucide-react";
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
  qtde_saude: number;
  qtde_dental: number;
};

type Aba = "sem" | "com" | "todos";

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
  const [aba, setAba] = useState<Aba>("sem");

  const totais = useMemo(() => {
    let sem = 0;
    let com = 0;
    for (const c of colaboradores) {
      const tem = c.qtde_saude + c.qtde_dental > 0;
      if (tem) com += 1;
      else sem += 1;
    }
    return { sem, com, todos: colaboradores.length };
  }, [colaboradores]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return colaboradores.filter((c) => {
      const tem = c.qtde_saude + c.qtde_dental > 0;
      if (aba === "sem" && tem) return false;
      if (aba === "com" && !tem) return false;
      if (termo && !c.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [busca, aba, colaboradores]);

  function selecionar(id: string) {
    const params = new URLSearchParams();
    params.set("ano", String(ano));
    params.set("mes", String(mes));
    setAberto(false);
    router.push(`/rh/beneficios/colaborador/${id}?${params.toString()}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && filtrados.length > 0) {
      e.preventDefault();
      selecionar(filtrados[0].id);
    }
  }

  function reset() {
    setBusca("");
    setAba("sem");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setAberto(true);
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-california-red px-3 text-sm font-medium text-white hover:bg-california-red/90"
      >
        <Plus className="h-4 w-4" />
        Adicionar Beneficiário
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Adicionar beneficiário</DialogTitle>
            <DialogDescription>
              Escolha um colaborador. Por padrão aparecem os que ainda não têm
              plano ativo na competência.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1">
              <AbaBtn
                ativa={aba === "sem"}
                onClick={() => setAba("sem")}
                label="Sem benefícios"
                count={totais.sem}
              />
              <AbaBtn
                ativa={aba === "com"}
                onClick={() => setAba("com")}
                label="Com benefícios"
                count={totais.com}
              />
              <AbaBtn
                ativa={aba === "todos"}
                onClick={() => setAba("todos")}
                label="Todos"
                count={totais.todos}
              />
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Buscar por nome — Enter abre o primeiro"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              />
            </div>

            <div className="h-96 overflow-y-auto rounded-md border border-border">
              {filtrados.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                  <CircleSlash className="h-6 w-6 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground">
                    Nenhum colaborador encontrado
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {busca
                      ? "Tente outro termo ou troque a aba."
                      : aba === "sem"
                      ? "Todos os colaboradores ativos já têm plano."
                      : "Nenhum resultado nesta aba."}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtrados.map((c) => (
                    <LinhaColaborador key={c.id} c={c} onClick={() => selecionar(c.id)} />
                  ))}
                </ul>
              )}
            </div>

            <p className="px-1 text-[11px] text-muted-foreground">
              {filtrados.length}{" "}
              {filtrados.length === 1 ? "colaborador" : "colaboradores"} ·
              competência {String(mes).padStart(2, "0")}/{ano}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AbaBtn({
  ativa,
  onClick,
  label,
  count,
}: {
  ativa: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        ativa
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`ml-1.5 inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
          ativa ? "bg-california-red/10 text-california-red" : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function LinhaColaborador({
  c,
  onClick,
}: {
  c: ColaboradorPicker;
  onClick: () => void;
}) {
  const semBeneficio = c.qtde_saude + c.qtde_dental === 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              semBeneficio ? "bg-muted/60 text-muted-foreground" : "bg-california-red/10 text-california-red"
            }`}
          >
            <UserRound className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium uppercase text-foreground">
              {c.nome}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {TIPO_LABEL[c.tipo_contratacao] ?? c.tipo_contratacao}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {semBeneficio ? (
            <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Sem plano
            </span>
          ) : (
            <>
              {c.qtde_saude > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                  <HeartPulse className="h-3 w-3" />
                  {c.qtde_saude}
                </span>
              )}
              {c.qtde_dental > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  <Smile className="h-3 w-3" />
                  {c.qtde_dental}
                </span>
              )}
            </>
          )}
        </span>
      </button>
    </li>
  );
}
