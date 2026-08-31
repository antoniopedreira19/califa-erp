"use client";

import * as React from "react";
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  Categoria,
  ItemBv,
} from "@/lib/types";
import { ItensTable, type GrupoDaPlanilha } from "./itens-table";
import { AcoesDoGrupo, NomeDoGrupo } from "./grupo-linha";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import type { VisaoBv } from "@/lib/calculos/bv-planilha";
import { cn } from "@/lib/utils";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import { MenuExibirColunas } from "@/app/(app)/_planilha/exibir-colunas";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import {
  BotaoRecolherTodos,
  useGruposRecolhiveis,
} from "@/app/(app)/_planilha/recolher-grupos";

/** Map não atravessa a fronteira server → client. A página manda os pares
 *  já montados. */
export interface SecaoGrupo {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
}

interface Props {
  secoes: SecaoGrupo[];
  moeda: string;
  /** Alíquota da versão — vira o BV líquido da vista Líquido. */
  percentualImposto: number;
  /** Bruto ou Líquido (− BV). O estado mora em `PlanilhaVersao`, acima
   *  daqui, porque o card de Totais precisa da MESMA vista. */
  visao: VisaoBv;
  onMudarVisao: (v: VisaoBv) => void;
  readOnly?: boolean;
  categorias: Categoria[];
  /** BV por id do item — indexado, e não Map, porque Map não atravessa a
   *  fronteira server → client. */
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  versaoLabel: string;
  /** Gatilho de "Novo grupo" — desce até a linha tracejada no pé da
   *  tabela, que é onde o grupo novo vai nascer. Vem da página porque é
   *  ela que sabe se a versão aceita grupo novo. */
  novoGrupo?: React.ReactNode;
  /** Liga a coluna SAVE nas tabelas dos grupos. */
  saveVisivel?: boolean;
  savePorItem?: Record<string, EstadoSaveDaLinha>;
  onAbrirSave?: (item: VersaoOrcamentoItem) => void;
  /** Liga e desliga a coluna Save. Ausente ⇒ o menu some. */
  onAlternarSave?: () => void;
  /** Chave "Orçamento de save": todo item novo nasce marcado. */
  savePorPadrao?: boolean;
  onAlternarSavePadrao?: (ligado: boolean) => void;
}

export function GruposSection({
  secoes,
  moeda,
  percentualImposto,
  visao,
  onMudarVisao,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  versaoLabel,
  novoGrupo,
  saveVisivel,
  savePorItem,
  onAbrirSave,
  onAlternarSave,
  savePorPadrao,
  onAlternarSavePadrao,
}: Props) {
  // A máquina de estado mora em `_planilha/recolher-grupos`: a planilha do
  // job, a da conferência do financeiro e os blocos da visão agregada
  // usam a MESMA, e quatro cópias divergiriam na primeira correção.
  const ids = React.useMemo(() => secoes.map((s) => s.grupo.id), [secoes]);
  const recolher = useGruposRecolhiveis(ids);

  const grupos = React.useMemo<GrupoDaPlanilha[]>(
    () =>
      secoes.map((s) => ({
        id: s.grupo.id,
        nome: s.grupo.nome,
        itens: s.itens,
      })),
    [secoes],
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <BotaoRecolherTodos
          algumAberto={recolher.algumAberto}
          onAlternarTodos={recolher.alternarTodos}
        />
        <div className="flex items-center gap-3">
          {onAlternarSavePadrao && (
            <ChaveOrcamentoDeSave
              ligado={savePorPadrao ?? false}
              onChange={onAlternarSavePadrao}
            />
          )}
          <ChaveBrutoLiquido visao={visao} onChange={onMudarVisao} />
          {onAlternarSave && (
            <MenuExibirColunas
              blocos={[
                {
                  chave: "save",
                  rotulo: "Save",
                  visivel: saveVisivel ?? false,
                  onAlternar: onAlternarSave,
                },
                { chave: "orcado", rotulo: "Orçado", visivel: true },
                { chave: "planejado", rotulo: "Planejado", visivel: true },
                { chave: "realizado", rotulo: "Realizado", visivel: false },
              ]}
            />
          )}
        </div>
      </div>

      {savePorPadrao && (
        <div className="mb-3 rounded-xl border border-[#d7d5cf] bg-muted/30 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Orçamento de save ligado.</strong>{" "}
          Todo item novo nasce em save — o cliente paga, o serviço vira
          crédito. As linhas já existentes não mudam; desligar não desmarca
          nada.
        </div>
      )}

      {/* O card da planilha é desenhado pela própria `ItensTable` — a
          dica de teclado que vem embaixo dele precisa ficar fora do
          frame. */}
      <ItensTable
        grupos={grupos}
        moeda={moeda}
        percentualImposto={percentualImposto}
        visao={visao}
        readOnly={readOnly}
        categorias={categorias}
        estaAberto={recolher.estaAberto}
        onAlternarGrupo={recolher.alternar}
        nomeDoGrupo={(grupo) => <NomeDoGrupo grupo={grupo} readOnly={readOnly} />}
        acoesDoGrupo={
          readOnly ? undefined : (grupo) => <AcoesDoGrupo grupo={grupo} />
        }
        novoGrupo={novoGrupo}
        bvsPorItem={bvsPorItem}
        fornecedores={fornecedores}
        versaoLabel={versaoLabel}
        saveVisivel={saveVisivel}
        onAlternarSave={onAlternarSave}
        savePorItem={savePorItem}
        onAbrirSave={onAbrirSave}
      />
    </div>
  );
}

/** A chave do "Orçamento de save" — default de linha nova, não trava
 *  (decisão 028 §10). Fica na barra da planilha, e não no cabeçalho da
 *  página como no design: é ajuste de comportamento da planilha, e o
 *  cabeçalho é server component. */
function ChaveOrcamentoDeSave({
  ligado,
  onChange,
}: {
  ligado: boolean;
  onChange: (ligado: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => onChange(!ligado)}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
        ligado
          ? "border-[#5f5d57] bg-[#5f5d57] text-white"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-flex h-3.5 w-6 flex-none items-center rounded-full p-0.5 transition-colors",
          ligado ? "bg-white/30" : "bg-muted-foreground/25",
        )}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full bg-current transition-transform",
            ligado && "translate-x-2.5",
          )}
        />
      </span>
      Orçamento de save
    </button>
  );
}
