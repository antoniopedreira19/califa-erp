"use client";

import * as React from "react";
import { ChevronDown, Loader2, MapPin, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buscarCidades, criarCidadeDoIBGE } from "./cidades-actions";
import type { CidadeSugestao } from "@/lib/data/cidades";

export interface CidadeOption {
  id: string;
  nome: string;
  uf: string | null;
}

/**
 * Combobox híbrido de cidade.
 *
 * - Busca no cadastro local do tenant primeiro (as ativas).
 * - Se o termo não bate com nenhuma local, oferece sugestões do IBGE
 *   (5.570 municípios) marcadas com badge próprio.
 * - Ao escolher uma sugestão IBGE, cadastra em 1 clique via
 *   `criarCidadeDoIBGE` e devolve o par `{id, nome, uf}` já materializado
 *   no banco — assim o formulário fica com o mesmo `cidade_id` que se
 *   tivesse escolhido uma local.
 * - Se nem IBGE serve (matriz interna, ponto fora do mapa), o produtor
 *   ainda pode cadastrar manualmente em /cadastros/cidades.
 *
 * Nunca trava: o produtor completa o orçamento sem sair do formulário
 * mesmo pra cidade não cadastrada. Ver decisão "Opção C" (05/09/2026).
 */
export function CidadeCombobox({
  value,
  onChange,
  iniciais,
  erro,
}: {
  value: CidadeOption | null;
  onChange: (cidade: CidadeOption) => void;
  /** Primeiras opções, carregadas no servidor — evita lista vazia ao abrir. */
  iniciais: CidadeOption[];
  erro?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [termo, setTermo] = React.useState("");
  const [opcoes, setOpcoes] = React.useState<CidadeSugestao[]>(
    () => iniciais.map(cidadeOptionParaSugestao),
  );
  const [buscando, setBuscando] = React.useState(false);
  const [criando, setCriando] = React.useState<string | null>(null);
  const [erroCriacao, setErroCriacao] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setErroCriacao(null);
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      const res = await buscarCidades(termo);
      if (cancelado) return;
      setOpcoes(res);
      setBuscando(false);
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [termo, open]);

  async function handleSelecionar(sugestao: CidadeSugestao) {
    if (sugestao.origem === "local") {
      onChange({ id: sugestao.id, nome: sugestao.nome, uf: sugestao.uf });
      setOpen(false);
      setTermo("");
      return;
    }
    setCriando(sugestao.ibge_codigo);
    setErroCriacao(null);
    try {
      const res = await criarCidadeDoIBGE(
        sugestao.ibge_codigo,
        sugestao.nome,
        sugestao.uf,
      );
      if (!res.ok) {
        setErroCriacao(res.message);
        return;
      }
      onChange({ id: res.id, nome: res.nome, uf: res.uf });
      setOpen(false);
      setTermo("");
    } finally {
      setCriando(null);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setTermo("");
          setErroCriacao(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3.5 text-sm font-medium transition-colors",
            erro
              ? "border-california-red ring-2 ring-california-red/15"
              : "border-border hover:border-california-red/40",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              value ? "text-foreground" : "font-normal text-muted-foreground",
            )}
          >
            {value ? formatarCidade(value) : "Selecione a cidade"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-2">
        <div className="flex h-9 items-center gap-2 rounded-lg border border-border px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar cidade…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-1.5 max-h-64 overflow-y-auto">
          {buscando ? (
            <p className="px-2.5 py-3 text-xs text-muted-foreground">Buscando…</p>
          ) : opcoes.length === 0 ? (
            <div className="px-2.5 py-3 space-y-1">
              <p className="text-xs text-muted-foreground">
                Nenhuma cidade encontrada.
              </p>
              <p className="text-[11px] text-muted-foreground">
                Você pode cadastrar manualmente em{" "}
                <span className="font-mono">/cadastros/cidades</span>.
              </p>
            </div>
          ) : (
            opcoes.map((s) => {
              const chave =
                s.origem === "local" ? `l:${s.id}` : `i:${s.ibge_codigo}`;
              const carregando =
                s.origem === "ibge" && criando === s.ibge_codigo;
              return (
                <button
                  key={chave}
                  type="button"
                  onClick={() => handleSelecionar(s)}
                  disabled={criando !== null}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground transition-colors",
                    "hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  <MapPin
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      s.origem === "local"
                        ? "text-muted-foreground"
                        : "text-california-red/70",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                  {s.uf && (
                    <span className="shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
                      {s.uf}
                    </span>
                  )}
                  {s.origem === "ibge" && (
                    <span className="shrink-0 rounded-md bg-california-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-california-red">
                      IBGE
                    </span>
                  )}
                  {carregando && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-california-red" />
                  )}
                </button>
              );
            })
          )}
          {erroCriacao && (
            <p className="mt-1 px-2.5 py-2 text-xs text-california-red">
              {erroCriacao}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function cidadeOptionParaSugestao(c: CidadeOption): CidadeSugestao {
  return { origem: "local", id: c.id, nome: c.nome, uf: c.uf };
}

function formatarCidade(c: CidadeOption): string {
  return c.uf ? `${c.nome} (${c.uf})` : c.nome;
}
