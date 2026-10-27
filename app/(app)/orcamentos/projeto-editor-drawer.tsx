"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Archive, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  CategoriaDominio,
  Profile,
  Projeto,
  Regional,
} from "@/lib/types";
import { ProjetoForm } from "./projeto-form";
import { arquivarProjeto, reativarProjeto } from "./actions";
import type { ApresentacaoDoProjeto } from "@/lib/apresentacoes-do-projeto";

interface Props {
  projeto: Projeto;
  empresas: { id: string; razao_social: string; nome_fantasia: string | null; principal: boolean }[];
  responsaveis: Pick<Profile, "id" | "nome">[];
  /** Quem pode ser GP (decisão 170) — ver o ProjetoForm. */
  gps: Pick<Profile, "id" | "nome">[];
  regionais: Pick<Regional, "id" | "nome" | "empresa_id">[];
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  regionaisSelecionadas: string[];
  responsaveisSelecionados: string[];
  /** Acréscimos manuais à Equipe já gravados (papel `equipe`). */
  equipeSelecionada?: string[];
  /** As apresentações gravadas no projeto (decisão 213). */
  apresentacoes?: ApresentacaoDoProjeto[];
  /** Produtores dos orçamentos do projeto — entram na Equipe travados. */
  produtoresDosOrcamentos?: string[];
}

export function ProjetoEditorDrawer({
  projeto,
  empresas,
  responsaveis,
  gps,
  regionais,
  categorias,
  regionaisSelecionadas,
  responsaveisSelecionados,
  equipeSelecionada,
  apresentacoes,
  produtoresDosOrcamentos,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmArquivar, setConfirmArquivar] = React.useState(false);
  const [confirmReativar, setConfirmReativar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleArquivar() {
    setError(null);
    startTransition(async () => {
      const res = await arquivarProjeto(projeto.id);
      if (!res.ok) setError(res.message);
      else {
        setConfirmArquivar(false);
        router.refresh();
        setOpen(false);
      }
    });
  }

  function handleReativar() {
    setError(null);
    startTransition(async () => {
      const res = await reativarProjeto(projeto.id);
      if (!res.ok) setError(res.message);
      else {
        setConfirmReativar(false);
        router.refresh();
        setOpen(false);
      }
    });
  }

  // Status e Arquivar/Reativar vão para o pé do formulário, na linha de
  // Cancelar e Salvar (opção C do Tiago, 29/09/2026).
  const statusEArquivar = (
    <div className="flex items-center gap-3">
      <p className="text-xs text-muted-foreground">
        Status: <strong className="text-foreground">{projeto.status}</strong>
      </p>
      {projeto.status === "ativo" ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirmArquivar(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Archive className="h-3.5 w-3.5" />
          Arquivar
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmReativar(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reativar
        </button>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // A recusa de um Arquivar anterior não reaparece ao reabrir.
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar projeto
      </button>

      {/* Pop-up centralizado sobre a página, com a largura do cartão do
          "Novo projeto" (max-w-3xl): os campos ficam do mesmo tamanho da
          criação. Até 29/09/2026 era um drawer de 512 px, que espremia as
          duas colunas (opção C escolhida pelo Tiago). */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl gap-0 p-6">
          <DialogHeader className="mb-6 space-y-0 pr-8">
            <DialogTitle className="text-3xl font-bold leading-tight tracking-tight">
              Editar projeto
            </DialogTitle>
            {/* Só para leitor de tela: o código do projeto não aparece
                (pedido do Tiago, 27/10/2026). */}
            <DialogDescription className="sr-only">
              Altere os dados do projeto {projeto.nome}.
            </DialogDescription>
          </DialogHeader>

          <ProjetoForm
            projeto={projeto}
            empresas={empresas}
            responsaveis={responsaveis}
            gps={gps}
            regionais={regionais}
            categorias={categorias}
            regionaisSelecionadas={regionaisSelecionadas}
            responsaveisSelecionados={responsaveisSelecionados}
            equipeSelecionada={equipeSelecionada}
            apresentacoes={apresentacoes}
            produtoresDosOrcamentos={produtoresDosOrcamentos}
            criadorId={projeto.created_by ?? undefined}
            rodapeEsquerda={statusEArquivar}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />

          {error && <p className="mt-4 text-sm text-california-red">{error}</p>}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmArquivar}
        onOpenChange={setConfirmArquivar}
        title="Arquivar projeto?"
        description={
          <>
            <p>
              O projeto sai da lista principal e passa a aparecer só quando o
              filtro &lsquo;arquivados&rsquo; estiver ligado. Projeto com
              orçamento aprovado ou com job, em qualquer status, não pode ser
              arquivado.
            </p>
            {/* A recusa do servidor aparece aqui: o erro do drawer fica
                atrás deste diálogo. */}
            {error && <p className="mt-2 text-california-red">{error}</p>}
          </>
        }
        confirmLabel="Arquivar"
        onConfirm={handleArquivar}
        pending={pending}
      />

      <ConfirmDialog
        open={confirmReativar}
        onOpenChange={setConfirmReativar}
        title="Reativar projeto?"
        description="O projeto volta pra lista de ativos."
        confirmLabel="Reativar"
        onConfirm={handleReativar}
        pending={pending}
      />
    </>
  );
}
