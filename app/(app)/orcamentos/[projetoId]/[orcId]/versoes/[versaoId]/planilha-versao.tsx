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
  CategoriaModeloPlanilha,
  ItemBv,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";
import type { ParametrosInternacionais } from "@/lib/calculos/versao-totais";
import type { MoedaEstrangeira } from "@/app/(app)/_planilha/moeda-estrangeira";
import { type VisaoBv } from "@/lib/calculos/bv-planilha";
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
import { NovoGrupoInline } from "./novo-grupo-inline";
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
  /** Marcar save e consumo de save (`orcamentos.marcar_em_save`,
   *  administrador e GP — 24/09/2026). Sem ela o pop-up abre só para ver. */
  podeMarcarSave: boolean;
  categorias: Categoria[];
  bvsPorItem: Record<string, ItemBv[]>;
  fornecedores: FornecedorOpcao[];
  versaoLabel: string;
  percentualHonorarios: number;
  percentualImposto: number;
  /** Necessário para o "Novo grupo", que desde 24/08/2026 mora DENTRO da
   *  planilha — na linha tracejada do pé da tabela — em vez de na barra
   *  de ações da página. */
  versaoId: string;
  // ---- SAVE (docs/decisions/028-save-entre-jobs.md)
  /** Aparece no texto do formulário: o crédito é do cliente. */
  clienteNome: string;
  savePorPadrao: boolean;
  /** Estado do save por id do item. Só traz item que tem algo. */
  savePorItem: Record<string, EstadoSaveDaLinha>;
  /** Saldos de save que este cliente tem para gastar. */
  saldosDeSave: SaldoDeSave[];
  /** Nome do grupo por id — o formulário mostra de qual grupo é a linha. */
  nomeDoGrupo: Record<string, string>;
  // ---- MODELO DE PLANILHA (docs/decisions/072)
  /** Qual fechamento esta versão usa. Vem da CATEGORIA do orçamento, pelo
   *  campo `modelo_planilha` — nunca pelo nome dela.
   *
   *  Enum, e não booleano `internacional`: a próxima categoria com
   *  planilha própria é um `case` a mais aqui, e não uma renomeação em
   *  toda a árvore de props. */
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Os dois parâmetros extras da cadeia internacional, ou `null` no
   *  nacional — é este `null` que faz `calcularTotaisVersao` devolver o
   *  fechamento de sempre. */
  internacional: ParametrosInternacionais | null;
  /** Moeda e taxa de compra da coluna calculada da planilha. `null` fora
   *  do internacional. */
  moedaEstrangeira: MoedaEstrangeira | null;
  // ---- MODELO MENSAL (docs/decisions/078)
  /** O mês desta planilha: o "Novo grupo" nasce dentro dele. Ausente fora
   *  do modelo mensal. */
  mes?: { id: string; nome: string };
  /** Esconde o card de Totais — a vista do trimestre empilha as planilhas
   *  dos meses e fecha com um Totais só, do trimestre. */
  semTotais?: boolean;
  tituloTotais?: string;
  subtituloTotais?: string;
}

export function PlanilhaVersao({
  grupos,
  itens,
  secoes,
  moeda,
  readOnly,
  podeMarcarSave,
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
  modeloPlanilha,
  internacional,
  moedaEstrangeira,
  mes,
  semTotais,
  tituloTotais,
  subtituloTotais,
}: Props) {
  // ⚠️ FIXA em "bruto" desde 08/09/2026 (decisão 062). O BV saiu do
  // planejado, então nesta tela as duas vistas dariam o mesmo número — e
  // a chave que as alternava foi removida daqui. Deixar em "líquido"
  // manteria o rótulo "Total líquido" numa coluna que não deduz nada.
  const visao: VisaoBv = "bruto";
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
  const saveEditavel = editavel && podeMarcarSave;

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
      {/* Planilha sem agrupamento só mostra o aviso quando está TRAVADA:
          ali não há o que fazer. Editável, ela abre como qualquer outra —
          cabeçalho, linha tracejada e total — com o campo do primeiro
          agrupamento já em edição (21/09/2026). Vale igual para o mês vazio
          do modelo mensal. */}
      {grupos.length === 0 && readOnly ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <FolderTree className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {mes
              ? `Nenhum agrupamento em ${mes.nome}.`
              : "Nenhum agrupamento nesta versão."}
          </p>
        </div>
      ) : (
        <GruposSection
          secoes={secoes}
          moeda={moeda}
          percentualImposto={percentualImposto}
          visao={visao}
          readOnly={readOnly}
          categorias={categorias}
          bvsPorItem={bvsPorItem}
          fornecedores={fornecedores}
          versaoLabel={versaoLabel}
          saveVisivel={saveVisivel}
          savePorItem={savePorItem}
          onAbrirSave={editavel ? setLinhaAberta : undefined}
          onAlternarSave={() => setSaveVisivel((v) => !v)}
          moedaEstrangeira={moedaEstrangeira}
          rotuloTotal={mes ? `Total de ${mes.nome}` : undefined}
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
              <NovoGrupoInline
                // A `key` faz o estado renascer quando o mês da régua muda
                // ou quando a planilha deixa de estar vazia: sem ela o
                // campo ficaria como estava no mês anterior.
                key={`${mes?.id ?? "versao"}:${grupos.length === 0}`}
                versaoId={versaoId}
                abrirDeInicio={grupos.length === 0}
                mesId={mes?.id}
                nomeDoMes={mes?.nome}
              />
            )
          }
        />
      )}

      {!semTotais && (
        <TotaisCard
          itens={itens}
          bvsPorItem={bvsPorItem}
          visao={visao}
          percentualHonorarios={percentualHonorarios}
          percentualImposto={percentualImposto}
          moeda={moeda}
          modeloPlanilha={modeloPlanilha}
          internacional={internacional}
          moedaEstrangeira={moedaEstrangeira}
          titulo={tituloTotais}
          subtitulo={subtituloTotais}
        />
      )}

      <SaveDialog
        contexto="orcamento"
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
        internacional={internacional}
        clienteNome={clienteNome}
        onMarcarSave={
          linhaAberta && saveEditavel
            ? async (marcar) => {
                const r = await marcarSaveDaLinha(linhaAberta.id, marcar);
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
        onSalvarConsumo={
          linhaAberta && saveEditavel
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
