"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Lock, Archive, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DrawerContent,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  orcamentoStatusLabel,
  type CategoriaDominio,
  type CategoriaModeloPlanilha,
  type Orcamento,
  type Profile,
  type Regional,
} from "@/lib/types";
import { arquivarOrcamento, excluirOrcamentoVazio } from "./actions";
import { esquecerPagina } from "@/components/voltar/estado";
import type { CategoriaParaServico } from "@/lib/categorias-do-servico";
import type { CidadeOption } from "../cidade-combobox";
import { OrcamentoForm } from "./orcamento-form";

interface Props {
  projetoId: string;
  orcamento: Orcamento;
  /** Com modelo de planilha e serviço exclusivo — ver `OrcamentoForm`. */
  categorias: CategoriaParaServico[];
  /** Modelo que o orçamento usa hoje: é contra ele que o formulário pede a
   *  confirmação da troca de planilha (decisão 078). */
  modeloPlanilhaAtual: CategoriaModeloPlanilha;
  /** Serviço do job — escopo `projeto` de `categorias_dominio`,
   *  lista distinta das categorias acima (decisão 037). */
  servicos: Pick<CategoriaDominio, "id" | "nome" | "investimento_interno">[];
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  cidadesIniciais: CidadeOption[];
  cidadeAtual: CidadeOption | null;
  gpsDoProjeto: Pick<Profile, "id" | "nome">[];
  produtores: Pick<Profile, "id" | "nome">[];
  /** O projeto, travado no formulário como na criação. */
  projetoNome: string;
  projetoCodigo: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Com o job devolvido (decisão 128) o editor abre para corrigir, mas o
   *  orçamento aprovado não se arquiva: o rodapé fica só com o status. */
  arquivavel: boolean;
  /** Orçamento completamente vazio — em rascunho, nunca aprovado, sem job
   *  e sem nenhum item em nenhuma versão — e quem edita pode criar
   *  orçamento. Só ele se exclui (decisão 148, entrega 2). */
  excluivel: boolean;
}

export function OrcamentoEditorDrawer({
  projetoId,
  orcamento,
  categorias,
  modeloPlanilhaAtual,
  servicos,
  regionaisDoProjeto,
  cidadesIniciais,
  cidadeAtual,
  gpsDoProjeto,
  produtores,
  projetoNome,
  projetoCodigo,
  disabled,
  disabledReason,
  arquivavel,
  excluivel,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmArquivar, setConfirmArquivar] = React.useState(false);
  const [confirmExcluir, setConfirmExcluir] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  function handleArquivar() {
    setErro(null);
    startTransition(async () => {
      const res = await arquivarOrcamento(projetoId, orcamento.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmArquivar(false);
      setOpen(false);
      router.refresh();
    });
  }

  // O servidor confere de novo que o orçamento está vazio: alguém pode ter
  // preenchido a planilha depois que esta tela abriu.
  function handleExcluir() {
    setErro(null);
    startTransition(async () => {
      const res = await excluirOrcamentoVazio(projetoId, orcamento.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmExcluir(false);
      setOpen(false);
      // A página do orçamento deixou de existir: o voltar não leva a ela.
      esquecerPagina(`/orcamentos/${projetoId}/${orcamento.id}`);
      router.replace(`/orcamentos/${projetoId}`);
    });
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground cursor-not-allowed"
      >
        <Lock className="h-3.5 w-3.5" />
        Editar
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Editar orçamento</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <OrcamentoForm
              projetoId={projetoId}
              orcamento={orcamento}
              categorias={categorias}
              modeloPlanilhaAtual={modeloPlanilhaAtual}
              servicos={servicos}
              regionaisDoProjeto={regionaisDoProjeto}
              cidadesIniciais={cidadesIniciais}
              cidadeAtual={cidadeAtual}
              gpsDoProjeto={gpsDoProjeto}
              produtores={produtores}
              projetoNome={projetoNome}
              projetoCodigo={projetoCodigo}
              onSuccess={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          </div>

          {/* Como no "Editar projeto": o status e o Arquivar no rodapé
              (decisão 118). O Arquivar só vale antes da aprovação; com o
              job devolvido o drawer abre para corrigir e ele some (128).
              O Excluir, só no orçamento completamente vazio (148). */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <p className="text-xs text-muted-foreground">
              Status:{" "}
              <strong className="text-foreground">
                {orcamentoStatusLabel(orcamento.status)}
              </strong>
            </p>
            <div className="flex items-center gap-2">
              {excluivel && (
                <button
                  type="button"
                  onClick={() => {
                    setErro(null);
                    setConfirmExcluir(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-1.5 text-xs font-semibold text-california-red transition-colors hover:bg-california-red/5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir
                </button>
              )}
              {arquivavel && (
                <button
                  type="button"
                  onClick={() => {
                    setErro(null);
                    setConfirmArquivar(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Arquivar
                </button>
              )}
            </div>
          </div>
        </DrawerContent>
      </Dialog>

      <ConfirmDialog
        open={confirmExcluir}
        onOpenChange={setConfirmExcluir}
        title="Excluir este orçamento?"
        description={
          <>
            <p>
              <strong className="text-foreground">{orcamento.nome}</strong> não
              tem nenhum item e sai do projeto. A exclusão não pode ser
              desfeita.
            </p>
            {/* A recusa do servidor aparece aqui: o drawer fica atrás. */}
            {erro && <p className="mt-2 text-california-red">{erro}</p>}
          </>
        }
        confirmLabel="Excluir"
        variant="destructive"
        onConfirm={handleExcluir}
        pending={pending}
      />

      <ConfirmDialog
        open={confirmArquivar}
        onOpenChange={setConfirmArquivar}
        title="Arquivar orçamento?"
        description={
          <>
            <p>
              O orçamento sai da visão agregada e das abas do projeto, e passa a
              aparecer só quando o filtro &lsquo;Arquivados&rsquo; da lista do
              projeto estiver ligado. Enquanto arquivado, nada nele pode ser
              editado. O &ldquo;Reativar&rdquo; devolve o orçamento como estava.
            </p>
            {/* A recusa do servidor aparece aqui: o drawer fica atrás. */}
            {erro && <p className="mt-2 text-california-red">{erro}</p>}
          </>
        }
        confirmLabel="Arquivar"
        onConfirm={handleArquivar}
        pending={pending}
      />
    </>
  );
}
