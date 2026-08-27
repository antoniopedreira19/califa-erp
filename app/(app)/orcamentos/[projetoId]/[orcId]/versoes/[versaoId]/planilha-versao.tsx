"use client";

/** Os grupos e o card de Totais da versão, sob uma chave só.
 *
 *  A chave Bruto ⇄ Líquido vale para a página inteira, e o Totais precisa
 *  estar sempre no mesmo modo que os grupos acima dele. Como os dois eram
 *  irmãos renderizados direto pela página (server), o estado não tinha
 *  onde morar — este componente é o ancestral comum que faltava.
 *
 *  No orçamento a vista Líquido tem um efeito que a do job não tem: é
 *  aqui que se decide o planejado que vai congelar na aprovação. Ver
 *  `docs/decisions/022`.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderTree } from "lucide-react";
import type {
  Categoria,
  ItemBv,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import {
  SAVE_VAZIO,
  type EstadoSaveDaLinha,
} from "@/app/(app)/_planilha/save-coluna";
import {
  SaveDialog,
  type LinhaDoSave,
} from "@/app/(app)/_planilha/save-dialog";
import type { SaldoDeSave } from "@/lib/data/saves";
import { GruposSection } from "./grupos-section";
import { NovoGrupoDrawer } from "./novo-grupo-drawer";
import { TotaisCard } from "./totais-card";
import {
  definirSavePorPadrao,
  marcarSaveDaLinha,
  salvarConsumoDeSave,
} from "./save-actions";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  /** Pares já montados: Map não atravessa a fronteira server → client. */
  secoes: Array<{ grupo: VersaoOrcamentoGrupo; itens: VersaoOrcamentoItem[] }>;
  moeda: string;
  readOnly?: boolean;
  categorias: Categoria[];
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  versaoLabel: string;
  percentualHonorarios: number;
  percentualImposto: number;
  /** Necessário para o "Novo grupo", que desde 24/08/2026 mora DENTRO da
   *  planilha — na linha tracejada do pé da tabela — em vez de na barra
   *  de ações da página. */
  versaoId: string;
  // ---- SAVE (docs/decisions/023-save-entre-jobs.md)
  /** Aparece no texto do formulário: o crédito é do cliente. */
  clienteNome: string;
  savePorPadrao: boolean;
  /** Estado do save por id do item. Só traz item que tem algo. */
  savePorItem: Record<string, EstadoSaveDaLinha>;
  /** Saldos de save que este cliente tem para gastar. */
  saldosDeSave: SaldoDeSave[];
  /** Nome do grupo por id — o formulário mostra de qual grupo é a linha. */
  nomeDoGrupo: Record<string, string>;
}

export function PlanilhaVersao({
  grupos,
  itens,
  secoes,
  moeda,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  versaoLabel,
  percentualHonorarios,
  percentualImposto,
  versaoId,
  clienteNome,
  savePorPadrao,
  savePorItem,
  saldosDeSave,
  nomeDoGrupo,
}: Props) {
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);
  const router = useRouter();

  // A coluna abre sozinha em quem já usa save, e fica fechada em quem
  // nunca usou: assim a planilha de sempre continua a de sempre.
  const temSave =
    savePorPadrao ||
    Object.keys(savePorItem).length > 0 ||
    saldosDeSave.some((s) => s.disponivel > 0);
  const [saveVisivel, setSaveVisivel] = React.useState(temSave);
  const [padrao, setPadrao] = React.useState(savePorPadrao);
  const [linhaAberta, setLinhaAberta] =
    React.useState<VersaoOrcamentoItem | null>(null);

  const editavel = !readOnly;

  const linhaDoDialog: LinhaDoSave | null = linhaAberta
    ? {
        id: linhaAberta.id,
        nome: linhaAberta.item,
        grupoNome: nomeDoGrupo[linhaAberta.grupo_id] ?? "—",
        tipoCusto: linhaAberta.tipo_custo,
        totalOrcado: Number(linhaAberta.total_orcado ?? 0),
      }
    : null;

  return (
    <>
      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <FolderTree className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Nenhum grupo ainda. Crie o primeiro grupo para começar a adicionar
            itens.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Exemplos: Equipe, Ativação, Staff, Logística...
          </p>
          {!readOnly && (
            <div className="mt-5 flex justify-center">
              {/* Sem nenhum grupo não há linha tracejada onde encaixar o
                  gatilho: aqui ele é a única ação da tela, e por isso vem
                  na forma sólida. */}
              <NovoGrupoDrawer versaoId={versaoId} />
            </div>
          )}
        </div>
      ) : (
        <GruposSection
          secoes={secoes}
          moeda={moeda}
          percentualImposto={percentualImposto}
          visao={visao}
          onMudarVisao={setVisao}
          readOnly={readOnly}
          categorias={categorias}
          bvsPorItem={bvsPorItem}
          fornecedores={fornecedores}
          versaoLabel={versaoLabel}
          saveVisivel={saveVisivel}
          savePorItem={savePorItem}
          onAbrirSave={editavel ? setLinhaAberta : undefined}
          onAlternarSave={() => setSaveVisivel((v) => !v)}
          savePorPadrao={padrao}
          onAlternarSavePadrao={
            editavel
              ? async (ligado) => {
                  setPadrao(ligado);
                  const r = await definirSavePorPadrao(versaoId, ligado);
                  if (!r.ok) setPadrao(!ligado);
                  router.refresh();
                }
              : undefined
          }
          novoGrupo={
            readOnly ? undefined : (
              <NovoGrupoDrawer versaoId={versaoId} variante="tracejada" />
            )
          }
        />
      )}

      <TotaisCard
        itens={itens}
        bvsPorItem={bvsPorItem}
        visao={visao}
        percentualHonorarios={percentualHonorarios}
        percentualImposto={percentualImposto}
        moeda={moeda}
      />

      <SaveDialog
        open={linhaAberta !== null}
        onOpenChange={(aberto) => !aberto && setLinhaAberta(null)}
        linha={linhaDoDialog}
        estado={
          linhaAberta ? (savePorItem[linhaAberta.id] ?? SAVE_VAZIO) : SAVE_VAZIO
        }
        saldos={saldosDeSave}
        moeda={moeda}
        percentualHonorarios={percentualHonorarios}
        percentualImposto={percentualImposto}
        clienteNome={clienteNome}
        onMarcarSave={
          linhaAberta
            ? async (marcar) => {
                const r = await marcarSaveDaLinha(linhaAberta.id, marcar);
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
        onSalvarConsumo={
          linhaAberta
            ? async (origens) => {
                const r = await salvarConsumoDeSave(linhaAberta.id, origens);
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
      />
    </>
  );
}
