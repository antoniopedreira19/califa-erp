"use client";

import * as React from "react";
import {
  ChevronRight,
  FolderPlus,
  FolderTree,
  Lock,
  Percent,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import type { Categoria } from "@/lib/types";
import {
  ItensTable,
  type AdaptadorItens,
  type GrupoDaPlanilha,
} from "../[projetoId]/[orcId]/versoes/[versaoId]/itens-table";
import type { AdaptadorBv, FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import type { VisaoBv } from "@/lib/calculos/bv-planilha";
import {
  BotaoRecolherTodos,
  useGruposRecolhiveis,
} from "@/app/(app)/_planilha/recolher-grupos";
import {
  AcoesDoGrupoRascunho,
  NomeDoGrupoRascunho,
} from "./grupo-rascunho-linha";
import {
  BOTAO_NOVO_GRUPO,
  ORCADO,
  PLANEJADO,
  RENTABILIDADE,
  type Bloco,
} from "@/app/(app)/_planilha/blocos";
import type { JobRascunho, ParametrosVersao } from "./tipos";
import {
  comoBvDaVersao,
  comoItemDaVersao,
  contarItens,
  totaisDoJob,
} from "./rascunho";

interface Props {
  job: JobRascunho;
  /** Código previsto ("PROJ-0001/26-03"). Vem do editor porque depende da
   *  posição na lista: remover um job renumera os de baixo. O definitivo é
   *  gerado no servidor, no salvamento. */
  codigo: string;
  parametros: ParametrosVersao;
  /** Bruto ou Líquido (− BV). O estado mora no editor: a chave vale para
   *  a página inteira, e aqui há vários orçamentos na mesma tela. */
  visao: VisaoBv;
  /** Linha de contexto do card: categoria · regional · cidade · GP · datas. */
  descricao: string;
  categorias: Categoria[];
  fornecedores: FornecedorOpcao[];
  adaptador: AdaptadorItens;
  adaptadorBv: AdaptadorBv;
  onAlternar: () => void;
  onRemover: () => void;
  onImportar: () => void;
  onCriarPlanilha: () => void;
  onNovoGrupo: () => void;
  onRenomearGrupo: (grupoId: string, nome: string) => void;
  onRemoverGrupo: (grupoId: string) => void;
  /** Preenchido, a planilha é consulta e o card explica o porquê. */
  bloqueio?: string | null;
  /** Rótulo do estado: "Rascunho", "Importado", "v2 · aprovada"... */
  badge?: string;
  /** Abre os parâmetros deste orçamento. Ausente ⇒ botão não aparece. */
  onEditarParametros?: () => void;
}

/**
 * Um orçamento de job dentro do orçamento do projeto.
 *
 * Fechado, é uma linha com os três totais — orçado, planejado e
 * rentabilidade — para dar de comparar os jobs entre si sem abrir nada.
 * Aberto, mostra a planilha: ou o convite a importar/criar, quando ela
 * ainda não existe, ou os grupos.
 */
export function JobRascunhoCard({
  job,
  codigo,
  parametros,
  visao,
  descricao,
  categorias,
  fornecedores,
  adaptador,
  adaptadorBv,
  onAlternar,
  onRemover,
  onImportar,
  onCriarPlanilha,
  onNovoGrupo,
  onRenomearGrupo,
  onRemoverGrupo,
  bloqueio,
  badge,
  onEditarParametros,
}: Props) {
  const [askRemover, setAskRemover] = React.useState(false);
  const totais = totaisDoJob(job, parametros);

  // Cada card de orçamento é uma planilha própria, com seus grupos e seu
  // subtotal — por isso o "Recolher todos" mora aqui dentro, agindo só
  // nos grupos deste orçamento. Mesma escolha da visão agregada.
  const gruposIds = React.useMemo(
    () => job.grupos.map((g) => g.id),
    [job.grupos],
  );
  const recolher = useGruposRecolhiveis(gruposIds);
  const nItens = contarItens(job.grupos);

  // O rascunho tem tipos próprios; a planilha fala o tipo da VERSÃO. A
  // tradução é a mesma de sempre — só deixou de ser feita por grupo,
  // porque agora a tabela recebe a planilha inteira de uma vez.
  const gruposDaPlanilha = React.useMemo<GrupoDaPlanilha[]>(
    () =>
      job.grupos.map((g) => ({
        id: g.id,
        nome: g.nome,
        itens: g.itens.map((it, i) => comoItemDaVersao(it, g.id, i + 1)),
      })),
    [job.grupos],
  );

  /** O grupo do RASCUNHO por id — o nome e a lixeira precisam dele, e não
   *  da tradução para o tipo da versão. */
  const grupoPorId = React.useMemo(
    () => new Map(job.grupos.map((g) => [g.id, g])),
    [job.grupos],
  );

  const bvsPorItem = React.useMemo(() => {
    const mapa: Record<string, NonNullable<ReturnType<typeof comoBvDaVersao>>> =
      {};
    for (const g of job.grupos) {
      for (const it of g.itens) {
        const bv = comoBvDaVersao(it);
        if (bv) mapa[it.id] = bv;
      }
    }
    return mapa;
  }, [job.grupos]);
  const readOnly = Boolean(bloqueio);
  // Orçamento congelado sem planilha não tem o que oferecer: não dá para
  // importar nem criar, então mostra o motivo em vez dos dois botões.
  const semPlanilha = job.origem === null && job.grupos.length === 0;

  return (
    // Sem overflow-hidden: a trilha de ações da planilha fica FORA do card
    // do grupo (absolute left-full) e seria cortada por aqui.
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-4 px-5 py-4">
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={job.aberto}
          title={job.aberto ? "Recolher orçamento" : "Expandir orçamento"}
          className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              job.aberto && "rotate-90",
            )}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xs font-bold text-california-red">
              {codigo}
            </span>
            <span className="text-base font-bold tracking-tight">
              {job.nome}
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {badge ?? (job.origem === "importado" ? "Importado" : "Rascunho")}
            </span>
            {bloqueio && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <Lock className="h-3 w-3" />
                Somente leitura
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {descricao}
          </p>
        </div>

        <div className="flex flex-none items-stretch">
          <ColunaTotal
            rotulo="Orçado"
            valor={formatCurrency(totais.orcado, parametros.moeda)}
            bloco={ORCADO}
          />
          <ColunaTotal
            rotulo="Planejado"
            valor={formatCurrency(totais.planejado, parametros.moeda)}
            bloco={PLANEJADO}
          />
          <ColunaTotal
            rotulo="Rentabilidade"
            valor={formatCurrency(totais.rentabilidade, parametros.moeda)}
            bloco={RENTABILIDADE}
          />
        </div>

        <div className="flex flex-none items-center gap-1">
          {onEditarParametros && (
            <button
              type="button"
              onClick={onEditarParametros}
              title="Moeda, honorários e imposto deste orçamento"
              className="rounded-lg p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-california-red"
            >
              <Percent className="h-4 w-4" />
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => setAskRemover(true)}
              title="Remover orçamento do rascunho"
              className="rounded-lg p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-california-red"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {job.aberto && (
        // Sem padding lateral: os cards de grupo ocupam toda a largura
        // interna do card do orçamento, que é o que faz as colunas deles
        // caírem sob as do card de Totais — ele vive um nível acima, na
        // página. Quem tem recuo é o resto do painel (`mx-5`). A calha da
        // trilha de ações é reservada pelo editor, para os dois de uma vez.
        <div className="flex flex-col gap-4 rounded-b-2xl border-t border-border bg-muted/20 py-5">
          {semPlanilha ? (
            <div className="mx-5 flex flex-col items-center gap-3.5 rounded-2xl border border-dashed border-border bg-card px-8 py-7 text-center">
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                {readOnly
                  ? "Este orçamento não tem planilha e não pode mais ser editado por aqui."
                  : "Este orçamento ainda não tem planilha. Importe uma existente ou comece do zero criando o primeiro grupo."}
              </p>
              <div
                className={cn(
                  "flex flex-wrap items-center justify-center gap-2.5",
                  readOnly && "hidden",
                )}
              >
                <button
                  type="button"
                  onClick={onImportar}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent"
                >
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  Importar planilha
                </button>
                <button
                  type="button"
                  onClick={onCriarPlanilha}
                  className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <Table2 className="h-4 w-4" />
                  Criar planilha
                </button>
              </div>
            </div>
          ) : (
            <>
              {bloqueio && (
                <div className="mx-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{bloqueio}</span>
                </div>
              )}
              <div className="mx-5 flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <FolderTree className="h-4 w-4 text-california-red" />
                  {job.grupos.length}{" "}
                  {job.grupos.length === 1 ? "grupo" : "grupos"} · {nItens}{" "}
                  {nItens === 1 ? "item" : "itens"}
                  {job.arquivoNome ? ` · ${job.arquivoNome}` : ""}
                </span>
                <div className="flex items-center gap-2.5">
                  {job.grupos.length > 0 && (
                    <BotaoRecolherTodos
                      algumAberto={recolher.algumAberto}
                      onAlternarTodos={recolher.alternarTodos}
                    />
                  )}
                </div>
              </div>

              {job.grupos.length === 0 && !readOnly && (
                // Planilha criada e ainda sem agrupamento: não há tabela,
                // e portanto não há a linha tracejada onde o "Novo grupo"
                // mora desde 24/08/2026. Sem este bloco o orçamento
                // ficaria sem nenhuma porta de entrada.
                <div className="mx-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-8 py-7 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nenhum agrupamento ainda. Crie o primeiro para começar a
                    adicionar itens.
                  </p>
                  <button
                    type="button"
                    onClick={onNovoGrupo}
                    className={BOTAO_NOVO_GRUPO}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    Novo grupo
                  </button>
                </div>
              )}

              {job.grupos.length > 0 && (
                // Um card para a planilha inteira — antes era um por
                // grupo. Sem padding lateral e sem `overflow-hidden`: as
                // colunas precisam cair sob as do card de Totais, e a
                // calha de ações precisa escapar do frame.
                <div className="rounded-2xl border border-border bg-card shadow-soft">
                  <ItensTable
                    grupos={gruposDaPlanilha}
                    moeda={parametros.moeda}
                    percentualImposto={parametros.percentual_imposto}
                    visao={visao}
                    readOnly={readOnly}
                    categorias={categorias}
                    estaAberto={recolher.estaAberto}
                    onAlternarGrupo={recolher.alternar}
                    nomeDoGrupo={(g) => (
                      <NomeDoGrupoRascunho
                        grupo={grupoPorId.get(g.id) ?? { ...g, itens: [] }}
                        readOnly={readOnly}
                        onRenomear={(nome) => onRenomearGrupo(g.id, nome)}
                      />
                    )}
                    acoesDoGrupo={
                      readOnly
                        ? undefined
                        : (g) => (
                            <AcoesDoGrupoRascunho
                              grupo={grupoPorId.get(g.id) ?? { ...g, itens: [] }}
                              onRemover={() => onRemoverGrupo(g.id)}
                            />
                          )
                    }
                    novoGrupo={
                      readOnly ? undefined : (
                        <button
                          type="button"
                          onClick={onNovoGrupo}
                          className={BOTAO_NOVO_GRUPO}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                          Novo grupo
                        </button>
                      )
                    }
                    bvsPorItem={bvsPorItem}
                    fornecedores={fornecedores}
                    versaoLabel="v1"
                    adaptador={adaptador}
                    adaptadorBv={adaptadorBv}
                    // O total do orçamento é o pé da tabela desde
                    // 24/08/2026 — era a faixa solta que ficava embaixo
                    // dos cards de grupo, com as colunas fora do eixo.
                    rotuloTotal={`Total do orçamento · ${codigo}`}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={askRemover}
        onOpenChange={setAskRemover}
        title="Remover este orçamento?"
        description={
          <>
            <strong className="text-foreground">{job.nome}</strong> sai do
            rascunho com {nItens} {nItens === 1 ? "item" : "itens"}. Nada foi
            gravado ainda — nenhum orçamento é apagado do projeto.
          </>
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

/** Mesma cor do bloco correspondente na planilha logo abaixo — o resumo
 *  do orçamento e a grade dele leem como a mesma coisa. */
function ColunaTotal({
  rotulo,
  valor,
  bloco,
}: {
  rotulo: string;
  valor: string;
  bloco: Bloco;
}) {
  return (
    <div className={cn("px-5 text-right", bloco.bordaAbre)}>
      <p
        className={cn(
          "text-[9.5px] font-bold uppercase tracking-wider",
          bloco.textoSuave,
        )}
      >
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-1 whitespace-nowrap font-mono text-sm font-bold",
          bloco.texto,
        )}
      >
        {valor}
      </p>
    </div>
  );
}
