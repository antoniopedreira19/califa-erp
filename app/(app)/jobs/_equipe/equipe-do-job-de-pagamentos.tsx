"use client";

/**
 * O botão "Equipe" e o pop-up do job de pagamentos (decisão 282), no
 * cabeçalho do job no módulo Jobs e no Financeiro.
 *
 * No lugar do Equipe do projeto (decisão 174): o job de pagamentos não tem
 * GP nem Produtor Responsável (decisão 266), a equipe é dele (não do
 * projeto escondido) e cada produtor tem a chave "Envia PP". Quem criou o
 * job não aparece na lista (pedido do Tiago, 27/11/2026): muda a equipe
 * pela regra do rodapé, não por estar nela.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Send, UserPlus, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EquipeDoJobDePagamentos } from "@/lib/data/equipe-do-job-de-pagamentos";
import type { PessoaDaEquipe } from "@/lib/data/equipe-do-projeto";
import { Rostos } from "./equipe-dialog";
import { EditorDaEquipeDePagamentos, type EstadoDaEquipe } from "./editor-da-equipe-de-pagamentos";
import { salvarEquipeDoJobDePagamentos } from "./actions-job-de-pagamentos";

interface Props {
  equipe: EquipeDoJobDePagamentos;
  /** O papel muda a equipe (`jobs.editar_equipe_de_pagamentos`) ou a pessoa
   *  criou o job. O job encerrado não muda, seja quem for. */
  podeMudar: boolean;
  /** No Financeiro o job se chama pelo nome do financeiro. */
  noFinanceiro?: boolean;
}

export function BotaoEquipeDoJobDePagamentos(props: Props) {
  const { equipe } = props;
  const [aberto, setAberto] = React.useState(false);
  const pessoas = equipe.membros.map((m) => m.pessoa);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-white py-1 pl-3 pr-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
      >
        <Users className="h-3.5 w-3.5" />
        Equipe
        {pessoas.length > 0 ? (
          <Rostos pessoas={pessoas} />
        ) : (
          <span className="inline-flex h-[26px] items-center rounded-full bg-amber-50 px-2 text-[10.5px] font-semibold text-amber-700">
            Sem equipe
          </span>
        )}
      </button>
      {/* Fora do botão: o clique no Cancelar subiria pela árvore do React
          até ele e reabriria o pop-up. */}
      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto && <ConteudoDaEquipe {...props} onFechar={() => setAberto(false)} />}
      </Dialog>
    </>
  );
}

function ConteudoDaEquipe({ equipe, podeMudar: podeMudarPeloPapel, noFinanceiro, onFechar }: Props & { onFechar: () => void }) {
  const router = useRouter();
  const podeMudar = podeMudarPeloPapel && !equipe.congelado;
  const [valor, setValor] = React.useState<EstadoDaEquipe>(() => ({
    ids: equipe.membros.map((m) => m.pessoa.id),
    envia: equipe.membros.filter((m) => m.enviaPP).map((m) => m.pessoa.id),
  }));
  const [salvando, startSalvar] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  // A lista do "+" e quem já está (mesmo fora da produção, para o nome).
  const pessoas = React.useMemo(() => {
    const porId = new Map<string, PessoaDaEquipe>(equipe.candidatos.map((p) => [p.id, p]));
    for (const m of equipe.membros) if (!porId.has(m.pessoa.id)) porId.set(m.pessoa.id, m.pessoa);
    return [...porId.values()];
  }, [equipe]);

  const total = valor.ids.length;

  function salvar() {
    setErro(null);
    startSalvar(async () => {
      const r = await salvarEquipeDoJobDePagamentos({
        jobId: equipe.jobId,
        membros: valor.ids.map((id) => ({ profileId: id, enviaPP: valor.envia.includes(id) })),
      });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      onFechar();
      router.refresh();
    });
  }

  return (
    // Mais largo que o Equipe do projeto (4xl): três colunas e a chave
    // "Envia PP" no produtor; nomes reais longos cortariam.
    <DialogContent className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="shrink-0 flex-row items-start gap-4 space-y-0 border-b border-border px-6 py-5 pr-14 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <DialogTitle className="text-xl">
            Equipe · <span className="font-mono">{equipe.codigo}</span>
          </DialogTitle>
          <DialogDescription>
            {noFinanceiro ? equipe.nomeFinanceiro : equipe.nome} · {total} {total === 1 ? "pessoa" : "pessoas"}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <section className="space-y-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            Envio de PP ao financeiro
          </p>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-white px-4 py-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <Send className="h-4 w-4" />
            </span>
            <p className="min-w-0 self-center text-sm font-semibold text-foreground">
              Os GPs da equipe e os produtores com “Envia PP” ligado enviam as PPs ao financeiro
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            Equipe deste job
          </p>
          <EditorDaEquipeDePagamentos pessoas={pessoas} valor={valor} onChange={setValor} podeMudar={podeMudar} />
        </section>

        {erro && (
          <p className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {erro}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/30 px-6 py-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserPlus className="h-3.5 w-3.5" />
          {equipe.congelado
            ? "O job está encerrado: a equipe não muda mais."
            : podeMudar
              ? "O financeiro, GPs e produtores mudam a equipe."
              : "Só o financeiro, GPs e produtores mudam a equipe."}
        </span>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {podeMudar ? "Cancelar" : "Fechar"}
          </button>
          {podeMudar && (
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-california-red-hover hover:shadow-brand disabled:opacity-60"
            >
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
