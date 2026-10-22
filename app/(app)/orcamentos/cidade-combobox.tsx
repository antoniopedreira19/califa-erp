"use client";

import * as React from "react";
import { ChevronDown, Loader2, MapPin, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { criarCidadeDoIBGE } from "./cidades-actions";
import type { CidadeSugestao } from "@/lib/data/cidades";

export interface CidadeOption {
  id: string;
  nome: string;
  uf: string | null;
}

/**
 * Combobox híbrido de cidade.
 *
 * - Mostra na hora as cidades já cadastradas (as `iniciais`, filtradas
 *   aqui mesmo) e só depois completa com a busca no servidor.
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
  // Cidades cadastradas por aqui (IBGE em 1 clique) depois que a página
  // carregou: entram na lista local sem esperar recarregar.
  const [criadas, setCriadas] = React.useState<CidadeOption[]>([]);
  // Resposta do servidor e o termo a que ela responde: só vale enquanto o
  // termo digitado for o mesmo.
  const [resultado, setResultado] = React.useState<{
    termo: string;
    opcoes: CidadeSugestao[];
  } | null>(null);
  const [buscando, setBuscando] = React.useState(false);
  const [criando, setCriando] = React.useState<string | null>(null);
  const [erroCriacao, setErroCriacao] = React.useState<string | null>(null);
  const [erroBusca, setErroBusca] = React.useState(false);

  const termoLimpo = termo.trim();

  // As cidades já cadastradas aparecem na hora, filtradas aqui mesmo; a
  // busca no servidor só completa com as sugestões do IBGE (e com as
  // locais além das `iniciais`, se o cadastro passar de LIMITE_CIDADES).
  const locaisFiltradas = React.useMemo(() => {
    const vistos = new Set<string>();
    const chave = normalizar(termoLimpo);
    return [...iniciais, ...criadas]
      .filter((c) => {
        if (vistos.has(c.id)) return false;
        vistos.add(c.id);
        return chave.length === 0 || normalizar(c.nome).includes(chave);
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map(cidadeOptionParaSugestao);
  }, [iniciais, criadas, termoLimpo]);

  const respostaAtual =
    resultado && resultado.termo === termoLimpo ? resultado.opcoes : null;
  const opcoes = respostaAtual ?? locaisFiltradas;

  React.useEffect(() => {
    if (!open) return;
    setErroCriacao(null);
    setErroBusca(false);
    if (termoLimpo.length === 0) {
      // Sem termo, as `iniciais` já são o que o servidor devolveria.
      setBuscando(false);
      return;
    }
    // Rota GET com abort em vez de server action: server actions rodam em
    // fila e a busca velha segurava a nova — "Buscando…" para sempre.
    const controle = new AbortController();
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/cidades/busca?q=${encodeURIComponent(termoLimpo)}`,
          { signal: controle.signal, cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const opcoesDoServidor = (await res.json()) as CidadeSugestao[];
        setResultado({ termo: termoLimpo, opcoes: opcoesDoServidor });
      } catch (err) {
        if (controle.signal.aborted) return;
        console.error("[cidade-combobox.buscar]", err);
        setErroBusca(true);
      } finally {
        if (!controle.signal.aborted) setBuscando(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controle.abort();
    };
  }, [termoLimpo, open]);

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
      const criada = { id: res.id, nome: res.nome, uf: res.uf };
      setCriadas((atuais) => [...atuais, criada]);
      setResultado(null);
      onChange(criada);
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
          {opcoes.length === 0 && !buscando ? (
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
          {buscando && (
            <p className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              Procurando outras cidades…
            </p>
          )}
          {erroBusca && (
            <p className="px-2.5 py-2 text-[11px] text-california-red">
              Não foi possível procurar outras cidades. Digite de novo para tentar outra vez.
            </p>
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

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cidadeOptionParaSugestao(c: CidadeOption): CidadeSugestao {
  return { origem: "local", id: c.id, nome: c.nome, uf: c.uf };
}

function formatarCidade(c: CidadeOption): string {
  return c.uf ? `${c.nome} (${c.uf})` : c.nome;
}
