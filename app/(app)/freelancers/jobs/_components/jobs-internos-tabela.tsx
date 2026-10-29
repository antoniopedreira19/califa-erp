"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Check, Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FreelancerJobInterno } from "@/lib/types";
import {
  arquivarJobInterno,
  criarJobInterno,
  editarJobInterno,
} from "../actions";

interface Props {
  jobs: FreelancerJobInterno[];
  podeEscrever: boolean;
}

/**
 * Tabela com CRUD inline dos jobs internos. Linha arquivada aparece com
 * texto esmaecido e badge "Arquivado" — nunca some, pra preservar contexto
 * dos contratos antigos. Edição inline por linha (código + nome + descrição).
 */
export function JobsInternosTabela({ jobs, podeEscrever }: Props) {
  return (
    <div className="space-y-4">
      {podeEscrever && <NovoJobInternoForm />}

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center">
          <h2 className="text-xl font-semibold">Nenhum job interno cadastrado</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Jobs internos são rótulos pra agrupar freelancers em time fixo ou
            outras estruturas sem orçamento, projeto ou cliente.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 w-[140px]">Código</th>
                <th className="text-left px-4 py-3 w-[280px]">Nome</th>
                <th className="text-left px-4 py-3">Descrição</th>
                {podeEscrever && <th className="w-[120px]" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => (
                <JobInternoRow key={j.id} job={j} podeEscrever={podeEscrever} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NovoJobInternoForm() {
  const [aberto, setAberto] = React.useState(false);
  const [codigo, setCodigo] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [erros, setErros] = React.useState<Record<string, string[]>>({});
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    setCodigo("");
    setNome("");
    setDescricao("");
    setErros({});
    setErroGeral(null);
  }

  function fechar() {
    reset();
    setAberto(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("codigo", codigo);
    fd.set("nome", nome);
    fd.set("descricao", descricao);

    startTransition(async () => {
      const r = await criarJobInterno(fd);
      if (!r.ok) {
        setErros(r.fieldErrors ?? {});
        setErroGeral(r.message);
        return;
      }
      fechar();
    });
  }

  if (!aberto) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo job interno
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-card p-5 shadow-soft space-y-4"
    >
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Código *
          </label>
          <input
            type="text"
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              if (erros.codigo) setErros((p) => ({ ...p, codigo: [] }));
            }}
            placeholder="INT-01"
            disabled={pending}
            autoFocus
            className={cn(
              "mt-1 w-full h-10 rounded-lg border bg-white px-3 text-sm focus:outline-none focus:ring-2",
              erros.codigo?.length
                ? "border-california-red focus:ring-california-red/15"
                : "border-border focus:border-california-red focus:ring-california-red/15",
            )}
          />
          {erros.codigo?.[0] && (
            <p className="mt-1 text-[11px] text-california-red">{erros.codigo[0]}</p>
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Nome *
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              if (erros.nome) setErros((p) => ({ ...p, nome: [] }));
            }}
            placeholder="Time fixo da estrutura"
            disabled={pending}
            className={cn(
              "mt-1 w-full h-10 rounded-lg border bg-white px-3 text-sm focus:outline-none focus:ring-2",
              erros.nome?.length
                ? "border-california-red focus:ring-california-red/15"
                : "border-border focus:border-california-red focus:ring-california-red/15",
            )}
          />
          {erros.nome?.[0] && (
            <p className="mt-1 text-[11px] text-california-red">{erros.nome[0]}</p>
          )}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground">
          Descrição (opcional)
        </label>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
          placeholder="Pra que serve este job interno"
          disabled={pending}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-california-red focus:ring-california-red/15"
        />
      </div>
      {erroGeral && (
        <p className="text-xs text-california-red">{erroGeral}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={fechar}
          disabled={pending}
          className="inline-flex items-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending || !codigo.trim() || !nome.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="h-4 w-4" />
          Criar
        </button>
      </div>
    </form>
  );
}

function JobInternoRow({
  job,
  podeEscrever,
}: {
  job: FreelancerJobInterno;
  podeEscrever: boolean;
}) {
  const [editando, setEditando] = React.useState(false);
  const [codigo, setCodigo] = React.useState(job.codigo);
  const [nome, setNome] = React.useState(job.nome);
  const [descricao, setDescricao] = React.useState(job.descricao ?? "");
  const [erros, setErros] = React.useState<Record<string, string[]>>({});
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const arquivado = job.arquivado_em !== null;

  function cancelar() {
    setCodigo(job.codigo);
    setNome(job.nome);
    setDescricao(job.descricao ?? "");
    setErros({});
    setErroGeral(null);
    setEditando(false);
  }

  function salvar() {
    const fd = new FormData();
    fd.set("id", job.id);
    fd.set("codigo", codigo);
    fd.set("nome", nome);
    fd.set("descricao", descricao);
    startTransition(async () => {
      const r = await editarJobInterno(fd);
      if (!r.ok) {
        setErros(r.fieldErrors ?? {});
        setErroGeral(r.message);
        return;
      }
      setErros({});
      setErroGeral(null);
      setEditando(false);
    });
  }

  function toggleArquivar() {
    const fd = new FormData();
    fd.set("id", job.id);
    fd.set("arquivar", String(!arquivado));
    startTransition(async () => {
      await arquivarJobInterno(fd);
    });
  }

  return (
    <tr className={cn(arquivado && "bg-muted/20")}>
      <td className="px-4 py-3 align-top">
        {editando ? (
          <input
            type="text"
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              if (erros.codigo) setErros((p) => ({ ...p, codigo: [] }));
            }}
            disabled={pending}
            className={cn(
              "w-full h-9 rounded-md border bg-white px-2 text-sm focus:outline-none focus:ring-2",
              erros.codigo?.length
                ? "border-california-red focus:ring-california-red/15"
                : "border-border focus:border-california-red focus:ring-california-red/15",
            )}
          />
        ) : (
          <span
            className={cn(
              "font-mono text-xs font-semibold",
              arquivado ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {job.codigo}
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {editando ? (
          <input
            type="text"
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              if (erros.nome) setErros((p) => ({ ...p, nome: [] }));
            }}
            disabled={pending}
            className={cn(
              "w-full h-9 rounded-md border bg-white px-2 text-sm focus:outline-none focus:ring-2",
              erros.nome?.length
                ? "border-california-red focus:ring-california-red/15"
                : "border-border focus:border-california-red focus:ring-california-red/15",
            )}
          />
        ) : (
          <span
            className={cn(
              arquivado && "text-muted-foreground line-through",
            )}
          >
            {job.nome}
          </span>
        )}
        {arquivado && !editando && (
          <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Arquivado
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {editando ? (
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            disabled={pending}
            rows={1}
            className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:border-california-red focus:ring-california-red/15"
          />
        ) : (
          <span
            className={cn(
              "text-muted-foreground",
              arquivado && "line-through",
            )}
          >
            {job.descricao ?? "—"}
          </span>
        )}
        {erroGeral && editando && (
          <p className="mt-1 text-[11px] text-california-red">{erroGeral}</p>
        )}
      </td>
      {podeEscrever && (
        <td className="px-4 py-3 align-top">
          <div className="flex items-center justify-end gap-1">
            {editando ? (
              <>
                <button
                  type="button"
                  onClick={salvar}
                  disabled={pending}
                  className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                  aria-label="Salvar"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={cancelar}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
                  aria-label="Cancelar"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditando(true)}
                  disabled={arquivado}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Editar"
                  title={arquivado ? "Desarquive para editar" : "Editar"}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={toggleArquivar}
                  disabled={pending}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  aria-label={arquivado ? "Desarquivar" : "Arquivar"}
                  title={arquivado ? "Desarquivar" : "Arquivar"}
                >
                  {arquivado ? (
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                </button>
              </>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
