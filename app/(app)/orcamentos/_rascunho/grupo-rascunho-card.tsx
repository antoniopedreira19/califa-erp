"use client";

import * as React from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { Categoria } from "@/lib/types";
import {
  ItensTable,
  type AdaptadorItens,
} from "../[projetoId]/[orcId]/versoes/[versaoId]/itens-table";
import type { AdaptadorBv, FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import type { VisaoBv } from "@/lib/calculos/bv-planilha";
import type { GrupoRascunho } from "./tipos";
import { comoBvDaVersao, comoItemDaVersao } from "./rascunho";

interface Props {
  grupo: GrupoRascunho;
  moeda: string;
  /** Alíquota do orçamento — vira o BV líquido da vista Líquido. */
  percentualImposto: number;
  /** Bruto ou Líquido (− BV). O estado mora no editor, que é o dono da
   *  página inteira. */
  visao: VisaoBv;
  categorias: Categoria[];
  fornecedores: FornecedorOpcao[];
  adaptador: AdaptadorItens;
  adaptadorBv: AdaptadorBv;
  onRenomear: (nome: string) => void;
  onRemover: () => void;
  /** Versão congelada (aprovada, job aberto): a planilha vira consulta. */
  readOnly?: boolean;
}

/**
 * Grupo dentro de um orçamento do rascunho.
 *
 * O nome é editado direto no cabeçalho, sem passo de confirmação: nesta
 * tela o usuário está montando vários orçamentos em sequência e cada
 * clique a mais é atrito. A planilha embaixo é a MESMA da tela da versão
 * — muda só para onde ela grava.
 */
export function GrupoRascunhoCard({
  grupo,
  moeda,
  percentualImposto,
  visao,
  categorias,
  fornecedores,
  adaptador,
  adaptadorBv,
  onRenomear,
  onRemover,
  readOnly,
}: Props) {
  const [aberto, setAberto] = React.useState(true);
  const [askRemover, setAskRemover] = React.useState(false);

  const itens = grupo.itens.map((it, i) =>
    comoItemDaVersao(it, grupo.id, i + 1),
  );

  const bvsPorItem = Object.fromEntries(
    grupo.itens
      .map((it) => [it.id, comoBvDaVersao(it)] as const)
      .filter((par): par is [string, NonNullable<ReturnType<typeof comoBvDaVersao>>] =>
        par[1] !== null,
      ),
  );

  /** Identidade do grupo — mora na faixa do thead, ao lado de ORÇADO /
   *  PLANEJADO / RENTABILIDADE. Aqui o nome é editado direto, sem passo
   *  de confirmação: nesta tela o usuário monta vários orçamentos em
   *  sequência e cada clique a mais é atrito. */
  const cabecalho = (
    <div className="flex min-w-0 items-center gap-2.5">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={aberto ? "Ocultar itens do grupo" : "Mostrar itens do grupo"}
        aria-expanded={aberto}
        className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md border border-border bg-white text-muted-foreground hover:text-california-red hover:border-california-red/40 transition-colors"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-150",
            !aberto && "-rotate-90",
          )}
        />
      </button>

      {readOnly ? (
        <span className="truncate px-1.5 py-1 text-base font-semibold text-foreground">
          {grupo.nome}
        </span>
      ) : (
        <input
          value={grupo.nome}
          onChange={(e) => onRenomear(e.target.value)}
          placeholder="Nome do grupo"
          aria-label="Nome do grupo"
          className="w-full min-w-0 rounded-md bg-transparent px-1.5 py-1 text-base font-semibold text-foreground outline-none transition-colors hover:bg-muted/60 focus:bg-white focus:ring-2 focus:ring-california-red/15"
        />
      )}
    </div>
  );

  /** Contador e remover: calha à direita da tabela, na altura da faixa. */
  const acoes = (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">
        {grupo.itens.length} {grupo.itens.length === 1 ? "item" : "itens"}
      </span>
      {!readOnly && (
        <button
          type="button"
          onClick={() => setAskRemover(true)}
          title="Remover grupo"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <ItensTable
        grupoId={grupo.id}
        grupoNome={grupo.nome}
        itens={itens}
        moeda={moeda}
        percentualImposto={percentualImposto}
        visao={visao}
        readOnly={readOnly}
        categorias={categorias}
        aberto={aberto}
        bvsPorItem={bvsPorItem}
        fornecedores={fornecedores}
        versaoLabel="v1"
        adaptador={adaptador}
        adaptadorBv={adaptadorBv}
        cabecalhoGrupo={cabecalho}
        acoesGrupo={acoes}
      />

      <ConfirmDialog
        open={askRemover}
        onOpenChange={setAskRemover}
        title="Remover grupo?"
        description={
          grupo.itens.length > 0 ? (
            <>
              O grupo <strong className="text-foreground">{grupo.nome}</strong>{" "}
              e seus {grupo.itens.length}{" "}
              {grupo.itens.length === 1 ? "item" : "itens"} saem do rascunho.
              Nada foi gravado ainda, então nada some do banco.
            </>
          ) : (
            <>
              Remover <strong className="text-foreground">{grupo.nome}</strong>?
              O grupo está vazio.
            </>
          )
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        onConfirm={() => {
          setAskRemover(false);
          onRemover();
        }}
      />
    </div>
  );
}
