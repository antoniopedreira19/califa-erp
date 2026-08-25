"use client";

/** ⚠️ Client component desde 21/08/2026, por causa de UMA coisa: a chave
 *  Bruto ⇄ Líquido. Ela vale para a planilha inteira — todos os grupos e
 *  o card de Totais —, então o estado tem que morar no ancestral comum
 *  dos três. Uma chave por grupo, como o design 3b desenha, deixaria o
 *  Totais sem bater com nenhum dos grupos.
 *
 *  Esta seção é a MESMA nas duas telas de job: a do GP (`/jobs/[jobId]`)
 *  e a do financeiro (`/financeiro/jobs/[jobId]`). Mexer aqui muda as
 *  duas, que é o que se quer — elas mostram a mesma planilha. */

import * as React from "react";
import Link from "next/link";
import { Clock, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { nomeVersao } from "@/lib/nome-versao";
import type {
  Job,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompra,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  BotaoRecolherTodos,
  useGruposRecolhiveis,
} from "@/app/(app)/_planilha/recolher-grupos";
import {
  JobItemRealizadoTable,
  type GrupoDoJob,
} from "./job-item-realizado-table";
import { JobTotaisCard } from "./job-totais-card";
import { AlterarOrcadoButton } from "./alterar-orcado-button";

interface Props {
  job: Pick<
    Job,
    | "id"
    | "status"
    | "projeto_id"
    | "orcamento_id"
    | "versao_orcamento_aprovada_id"
    | "empresa_id"
    | "responsavel_id"
  >;
  versao: Pick<VersaoOrcamento, "id" | "numero_versao" | "moeda" | "percentual_honorarios" | "percentual_imposto">;
  /** "Nome do Job" do orçamento — base do nome da versão. */
  nomeJob: string;
  grupos: VersaoOrcamentoGrupo[];
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  categoriasMap: Map<string, string>;
  /** Errata, BV e Pedido de Produção — só com o job aberto. */
  podeAcoes: boolean;
  /** Todas as PPs ativas de cada item realizado (PPs parciais). */
  ppsPorItemId: Map<string, PedidoCompra[]>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
}

export function JobRealizadoSection({
  job,
  versao,
  nomeJob,
  grupos,
  itens,
  realizadosMap,
  categoriasMap,
  podeAcoes,
  ppsPorItemId,
  fornecedores,
  empresas,
  bvsPorItem,
}: Props) {
  // Uma chave para a página inteira. Abre em Bruto: é a tela de sempre,
  // e quem não lida com BV nunca precisa saber que a outra existe.
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);

  // Recolher agrupamento, igual à planilha do orçamento: o subtotal e a
  // rentabilidade continuam à vista, que é o que justifica recolher.
  const gruposIds = React.useMemo(() => grupos.map((g) => g.id), [grupos]);
  const recolher = useGruposRecolhiveis(gruposIds);

  // Antes da abertura a planilha aparece inteira — o que fica de fora são
  // as ações que geram documento. O aviso substitui o antigo bloco
  // "Realizado indisponível", que escondia a planilha toda.
  const preAbertura =
    job.status === "aguardando_abertura" ||
    job.status === "rejeitado_financeiro";

  // A planilha inteira numa tabela só desde 24/08/2026: os pares
  // grupo → itens são montados aqui e vão de uma vez para a tabela.
  const gruposDaPlanilha = React.useMemo<GrupoDoJob[]>(() => {
    const porGrupo = new Map<string, ItemPlanilhaJob[]>();
    for (const g of grupos) porGrupo.set(g.id, []);
    for (const it of itens) porGrupo.get(it.grupo_id)?.push(it);
    return grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      itens: porGrupo.get(g.id) ?? [],
    }));
  }, [grupos, itens]);

  // A trilha lateral aparece quando há ação (BV/PP) OU quando há BV
  // lançado para consultar num job sem ação — é a mesma condição que a
  // tabela usa para desenhá-la, e a reserva tem que acompanhar as duas.
  //
  // A exceção do BV para consulta foi escrita para o job ENCERRADO, que
  // é histórico. Na pré-abertura ela não vale: ali o BV ainda é ação
  // futura, o job pode ser devolvido, e a trilha tem que sumir por
  // inteiro — como o critério da Tela 2.1 pede (18/08/2026).
  const temBvLancado = itens.some((it) => bvsPorItem[it.id]);
  const temCalha = podeAcoes || (temBvLancado && !preAbertura);

  return (
    // Quando dá pra gerar PP, reserva a calha da direita: a trilha de
    // "Adicionar BV" / "Abrir BV" / "Gerar PP" / "Ver PP" é posicionada
    // fora do card, e sem esse espaço ela era cortada na borda da página.
    //
    // 116px e não 126: a trilha tem 116px de botão ("Adicionar BV" é o
    // rótulo mais longo) + 10px de respiro, e esses 10px podem invadir o
    // padding do layout (32px) sem encostar na borda. Devolver os 10px ao
    // card é o que faz a tabela caber inteira — as bordas de 2px entre os
    // blocos somam ~5px que as porcentagens das colunas não preveem.
    // Os 12px a mais que a calha antiga foram devolvidos à página (o
    // max-w de JobDetalhe cresceu junto): a planilha não encolheu.
    <div className={cn("space-y-4", temCalha && "pr-[116px]")}>
      {preAbertura && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <Clock className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>
            {job.status === "aguardando_abertura"
              ? "Job aguardando abertura pelo financeiro — erratas, BVs e pedidos de produção ficam disponíveis após a abertura, e é da PP que o realizado nasce."
              : "Job devolvido pelo financeiro — erratas, BVs e pedidos de produção ficam disponíveis após a abertura, e é da PP que o realizado nasce."}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha do job · {nomeVersao(nomeJob, versao.numero_versao)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {grupos.length > 0 && (
            <BotaoRecolherTodos
              algumAberto={recolher.algumAberto}
              onAlternarTodos={recolher.alternarTodos}
            />
          )}
          <ChaveBrutoLiquido visao={visao} onChange={setVisao} />
          {podeAcoes && (
            <AlterarOrcadoButton
              jobId={job.id}
              itens={itens}
              grupos={grupos}
              percentualHonorarios={versao.percentual_honorarios}
              percentualImposto={versao.percentual_imposto}
              moeda={versao.moeda}
            />
          )}
          <Link
            href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
            prefetch={false}
            className="text-xs text-california-red hover:underline"
          >
            Ver versão aprovada →
          </Link>
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            A versão aprovada não tem grupos.
          </p>
        </div>
      ) : (
        <>
          {/* Um card para a planilha inteira — antes era um por grupo.
              Sem `overflow-hidden`: a calha de ações precisa escapar do
              frame, e são os filhos que arredondam os cantos. */}
          <div className="rounded-2xl border border-border bg-card shadow-soft">
            <JobItemRealizadoTable
              jobId={job.id}
              grupos={gruposDaPlanilha}
              realizadosMap={realizadosMap}
              categoriasMap={categoriasMap}
              moeda={versao.moeda}
              percentualImposto={versao.percentual_imposto}
              visao={visao}
              estaAberto={recolher.estaAberto}
              onAlternarGrupo={recolher.alternar}
              podeAcoes={podeAcoes}
              preAbertura={preAbertura}
              ppsPorItemId={ppsPorItemId}
              fornecedores={fornecedores}
              empresas={empresas}
              jobEmpresaId={job.empresa_id ?? ""}
              jobResponsavelId={job.responsavel_id ?? ""}
              bvsPorItem={bvsPorItem}
              versaoLabel={`v${versao.numero_versao}`}
            />
          </div>
          <JobTotaisCard
            itens={itens}
            realizadosMap={realizadosMap}
            bvsPorItem={bvsPorItem}
            jobAberto={!preAbertura}
            percentualHonorarios={versao.percentual_honorarios}
            percentualImposto={versao.percentual_imposto}
            moeda={versao.moeda}
          />
        </>
      )}
    </div>
  );
}
