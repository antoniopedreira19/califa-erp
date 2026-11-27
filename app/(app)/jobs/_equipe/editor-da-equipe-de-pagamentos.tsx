"use client";

/**
 * O editor da Equipe do job de pagamentos (decisão 282): o mesmo no
 * formulário "Criar Job de Pagamentos" e no pop-up Equipe (módulo Jobs e
 * Financeiro).
 *
 * O botão "+ Adicionar pessoas" abre uma lista com busca, agrupada por
 * papel, onde se marcam várias pessoas de uma vez e se confirma com
 * "Adicionar N" (pedido do Tiago, 26/11/2026: adicionar um de cada vez no
 * mesmo seletor não funcionava). A equipe aparece agrupada, com o ✕ de cada
 * um. Cada produtor tem a chave "Envia PP" — ligada, ele envia a PP ao
 * financeiro como o GP; pode ser mais de um. O GP envia sempre (o papel); o
 * freelancer gera. O produtor que entra nasce com a chave ligada.
 */

import * as React from "react";
import { Plus, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/types";
import type { PessoaDaEquipe } from "@/lib/data/equipe-do-projeto";
import { Avatar, ROTULO_DO_PAPEL } from "./equipe-dialog";

const GRUPOS: { titulo: string; papeis: AppRole[] }[] = [
  { titulo: "GPs", papeis: ["administrador", "gerente_producao"] },
  { titulo: "Produtores", papeis: ["produtor"] },
  { titulo: "Freelancers", papeis: ["freelancer"] },
];
const PAPEIS_DOS_GRUPOS = new Set<AppRole | null>(GRUPOS.flatMap((g) => g.papeis));

const semAcento = (x: string) =>
  x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface EstadoDaEquipe {
  /** Quem está na equipe. */
  ids: string[];
  /** Os produtores com a chave "Envia PP" ligada. */
  envia: string[];
}

interface Props {
  /** Quem pode entrar (a produção ativa) — e quem já está, mesmo inativo. */
  pessoas: PessoaDaEquipe[];
  valor: EstadoDaEquipe;
  onChange: (v: EstadoDaEquipe) => void;
  podeMudar: boolean;
  /** No formulário de criação: sem a grade vazia e com o texto de ajuda. */
  noFormulario?: boolean;
}

/** Põe pessoas: o produtor que entra nasce com a chave ligada. */
function por(pessoas: PessoaDaEquipe[], v: EstadoDaEquipe, novos: string[]): EstadoDaEquipe {
  const entram = novos.filter((id) => !v.ids.includes(id));
  const produtores = entram.filter((id) => pessoas.find((p) => p.id === id)?.papel === "produtor");
  return {
    ids: [...v.ids, ...entram],
    envia: [...v.envia, ...produtores.filter((id) => !v.envia.includes(id))],
  };
}

function tirar(v: EstadoDaEquipe, id: string): EstadoDaEquipe {
  return { ids: v.ids.filter((x) => x !== id), envia: v.envia.filter((x) => x !== id) };
}

/** A chave "Envia PP", no desenho da chave do Equipe (decisão 174). */
function ChaveEnviaPP({
  ligada,
  onChange,
  pode,
  nome,
}: {
  ligada: boolean;
  onChange: (v: boolean) => void;
  pode: boolean;
  nome: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", pode ? "cursor-pointer" : "cursor-not-allowed")}>
      <button
        type="button"
        role="switch"
        aria-checked={ligada}
        aria-label={`${nome} envia PP ao financeiro`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pode) onChange(!ligada);
        }}
        disabled={!pode}
        className={cn(
          "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          ligada ? "bg-california-red" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            ligada ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
      <span className={cn("text-[11.5px] font-medium", ligada ? "text-foreground" : "text-muted-foreground")}>
        Envia PP
      </span>
    </span>
  );
}

export function EditorDaEquipeDePagamentos({ pessoas, valor, onChange, podeMudar, noFormulario }: Props) {
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const membros = valor.ids
    .map((id) => porId.get(id))
    .filter((p): p is PessoaDaEquipe => Boolean(p));
  const vazio = membros.length === 0;
  const enviam = membros.filter((m) => m.papel === "produtor" && valor.envia.includes(m.id)).length;
  // A lista do "+" só tem a produção ativa; quem saiu fica só na grade.
  const elegiveis = pessoas.filter((p) => PAPEIS_DOS_GRUPOS.has(p.papel));

  return (
    <div className="space-y-3">
      {podeMudar && (
        <div className="flex flex-wrap items-center gap-3">
          <BotaoAdicionar
            pessoas={elegiveis}
            ids={valor.ids}
            onAdicionar={(novos) => onChange(por(pessoas, valor, novos))}
          />
          <span className="text-xs text-muted-foreground">
            {vazio
              ? noFormulario
                ? "Marque várias pessoas de uma vez; dá para completar depois, no botão Equipe do job."
                : "Ninguém na equipe ainda."
              : `${membros.length} ${membros.length === 1 ? "pessoa" : "pessoas"} na equipe · ${enviam} ${
                  enviam === 1 ? "produtor envia" : "produtores enviam"
                } PP.`}
          </span>
        </div>
      )}
      {(!vazio || !noFormulario) && (
        <GradeDaEquipe
          membros={membros}
          envia={valor.envia}
          podeMudar={podeMudar}
          onTirar={(id) => onChange(tirar(valor, id))}
          onEnvia={(id, liga) =>
            onChange({
              ids: valor.ids,
              envia: liga ? [...valor.envia, id] : valor.envia.filter((x) => x !== id),
            })
          }
        />
      )}
    </div>
  );
}

function BotaoAdicionar({
  pessoas,
  ids,
  onAdicionar,
}: {
  pessoas: PessoaDaEquipe[];
  ids: string[];
  onAdicionar: (novos: string[]) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [marcadas, setMarcadas] = React.useState<string[]>([]);
  const naEquipe = new Set(ids);
  const termo = semAcento(busca.trim());
  const visiveis = pessoas.filter((p) => !termo || semAcento(p.nome).includes(termo));

  function abrir(o: boolean) {
    setAberto(o);
    if (o) {
      setBusca("");
      setMarcadas([]);
    }
  }
  function alternar(id: string) {
    setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }
  function adicionar() {
    if (marcadas.length === 0) return;
    onAdicionar(marcadas);
    setAberto(false);
  }

  return (
    // `modal`: a lista abre sempre dentro de um diálogo (o formulário ou o
    // Equipe), e o diálogo trava a rolagem do que está fora dele — sem o
    // modal, a roda do mouse não rola a lista. É o que o Combobox do sistema
    // faz dentro de diálogo.
    <Popover open={aberto} onOpenChange={abrir} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3 text-[13px] font-semibold text-california-red transition-colors hover:bg-california-red/5"
        >
          <Plus className="h-4 w-4" />
          Adicionar pessoas
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[440px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <div className="border-b border-border p-3">
          <p className="text-[13px] font-semibold">Adicionar à equipe</p>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              aria-label="Buscar pessoa"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              // Enter aqui não pode enviar o formulário em volta.
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Buscar pelo nome"
              className="h-9 w-full rounded-lg border border-border bg-white pl-8 pr-3 text-[13px] outline-none focus:border-california-red/40"
            />
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto px-1.5 py-1.5">
          {visiveis.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-muted-foreground">
              {busca.trim() ? `Ninguém com “${busca.trim()}”.` : "Ninguém da produção para adicionar."}
            </p>
          ) : (
            GRUPOS.map((g) => {
              const doGrupo = visiveis.filter((p) => p.papel && g.papeis.includes(p.papel));
              if (doGrupo.length === 0) return null;
              return (
                <div key={g.titulo}>
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
                    {g.titulo}
                  </p>
                  {doGrupo.map((p) => {
                    const ja = naEquipe.has(p.id);
                    const marcada = ja || marcadas.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5",
                          ja ? "cursor-default opacity-60" : "cursor-pointer hover:bg-muted/50",
                        )}
                      >
                        <Checkbox
                          checked={marcada}
                          disabled={ja}
                          onCheckedChange={() => !ja && alternar(p.id)}
                          aria-label={p.nome}
                        />
                        <Avatar pessoa={p} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{p.nome}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {ja ? "Na equipe" : (p.papel && ROTULO_DO_PAPEL[p.papel]) ?? ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">
            {marcadas.length === 0
              ? "Marque quem entra."
              : `${marcadas.length} ${marcadas.length === 1 ? "marcada" : "marcadas"}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[12.5px] font-semibold text-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={adicionar}
              disabled={marcadas.length === 0}
              className="rounded-lg bg-california-red px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {marcadas.length > 1 ? `Adicionar ${marcadas.length}` : "Adicionar"}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A equipe agrupada por papel: o ✕ de cada um e, nos produtores, a chave. */
function GradeDaEquipe({
  membros,
  envia,
  podeMudar,
  onTirar,
  onEnvia,
}: {
  membros: PessoaDaEquipe[];
  envia: string[];
  podeMudar: boolean;
  onTirar: (id: string) => void;
  onEnvia: (id: string, liga: boolean) => void;
}) {
  // Quem saiu do tenant ou da produção continua na equipe até alguém tirar.
  const fora = membros.filter((m) => !PAPEIS_DOS_GRUPOS.has(m.papel));
  const grupos = [
    ...GRUPOS.map((g) => ({
      titulo: g.titulo,
      membros: membros.filter((m) => m.papel && g.papeis.includes(m.papel)),
    })),
    ...(fora.length > 0 ? [{ titulo: "Fora da produção", membros: fora }] : []),
  ];
  return (
    <div className={cn("grid gap-x-6 gap-y-4", grupos.length > 3 ? "md:grid-cols-4" : "md:grid-cols-3")}>
      {grupos.map((g) => (
        <div key={g.titulo} className="min-w-0">
          <p className="mb-1.5 flex items-baseline gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            {g.titulo}
            <span className="font-mono text-[10px] font-normal">{g.membros.length}</span>
          </p>
          {g.membros.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">—</p>
          ) : (
            <ul className="space-y-1">
              {g.membros.map((m) => {
                const produtor = m.papel === "produtor";
                return (
                  <li key={m.id} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-muted/40">
                    <Avatar pessoa={m} tamanho="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground" title={m.nome}>
                        {m.nome}
                      </span>
                      {produtor ? (
                        <span className="mt-0.5 block">
                          <ChaveEnviaPP
                            ligada={envia.includes(m.id)}
                            pode={podeMudar}
                            nome={m.nome}
                            onChange={(v) => onEnvia(m.id, v)}
                          />
                        </span>
                      ) : (
                        <span className="block text-[11.5px] leading-snug text-muted-foreground">
                          {m.papel === "freelancer"
                            ? "Gera PP"
                            : m.papel === "administrador" || m.papel === "gerente_producao"
                              ? "Envia PP sempre"
                              : "Não é mais da produção"}
                        </span>
                      )}
                    </span>
                    {podeMudar && (
                      <button
                        type="button"
                        onClick={() => onTirar(m.id)}
                        aria-label={`Tirar ${m.nome} da equipe`}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
