/**
 * A planilha da versão no modelo MENSAL — Fee e Always On (decisão 078).
 *
 * Server component. Recebe o que a página já buscou (grupos, itens, BVs e
 * os meses da versão) e reparte por mês: a régua, a planilha do mês
 * selecionado com os Totais do mês, ou a vista do trimestre com os meses
 * empilhados e os Totais do trimestre.
 *
 * O fechamento de cada mês é o nacional, com os mesmos percentuais da
 * versão; o trimestre é a soma dos meses — que, com percentuais iguais, é
 * exatamente a mesma conta sobre todos os itens.
 */

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Categoria,
  ItemBv,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  VersaoOrcamentoMes,
} from "@/lib/types";
import {
  calcularResultadoOperacional,
  calcularTotaisVersao,
} from "@/lib/calculos/versao-totais";
import {
  mesesDoTrimestre,
  nomeDoMes,
  rotuloMes,
  rotuloMesCurto,
  rotuloTrimestre,
  trimestreDe,
} from "@/lib/calculos/meses-trimestre";
import type { ConfigDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import type { SaldoDeSave } from "@/lib/data/saves";
import { PlanilhaVersao } from "./versoes/[versaoId]/planilha-versao";
import { TotaisCard } from "./versoes/[versaoId]/totais-card";
import { ReguaMeses } from "./versoes/[versaoId]/regua-meses";
import { CopiarItensDoMes } from "./versoes/[versaoId]/copiar-itens-mes";
import { TrimestreEmpilhado } from "./versoes/[versaoId]/trimestre-empilhado";
import { ImportarPlanilhaDrawer } from "./versoes/importar-drawer";

/** `2026-07` — a chave do mês na URL. */
function chaveDoMes(mes: string): string {
  return mes.slice(0, 7);
}

interface Props {
  projetoId: string;
  orcamentoId: string;
  versao: VersaoOrcamento;
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  meses: VersaoOrcamentoMes[];
  /** `?mes=` da URL: `trimestre`, `2026-07` ou ausente. */
  mesPedido: string | undefined;
  /** Período do orçamento — a referência do trimestre quando a versão
   *  ainda não tem mês. */
  inicioPrevisto: string | null;
  readOnly: boolean;
  categorias: Categoria[];
  bvsPorItem: Record<string, ItemBv[]>;
  fornecedores: FornecedorOpcao[];
  clienteNome: string;
  savePorItem: Record<string, EstadoSaveDaLinha>;
  saldosDeSave: SaldoDeSave[];
  planilha: ConfigDaPlanilha;
  /** "Importar planilha" da versão (decisão 078, 15/09/2026): troca o
   *  conteúdo de todos os meses de uma vez, por isso mora na régua e não
   *  no mês. `null` esconde. */
  importacao: { disabled: boolean; disabledReason?: string } | null;
}

export function PlanilhaMensal({
  projetoId,
  orcamentoId,
  versao,
  grupos,
  itens,
  meses,
  mesPedido,
  inicioPrevisto,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  clienteNome,
  savePorItem,
  saldosDeSave,
  planilha,
  importacao,
}: Props) {
  const base = `/orcamentos/${projetoId}/${orcamentoId}?v=${versao.id}`;
  const honorarios = Number(versao.percentual_honorarios);
  const imposto = Number(versao.percentual_imposto);
  const moeda = versao.moeda;

  const itensPorGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) itensPorGrupo.get(it.grupo_id)?.push(it);

  const nomeDoGrupo = Object.fromEntries(grupos.map((g) => [g.id, g.nome]));

  function fechamento(itensDaConta: VersaoOrcamentoItem[]) {
    const t = calcularTotaisVersao(
      itensDaConta,
      honorarios,
      imposto,
      planilha.internacional,
    );
    const custoPlanejado = itensDaConta.reduce(
      (s, it) => s + Number(it.total_planejado ?? 0),
      0,
    );
    const r = calcularResultadoOperacional(
      t.valorJob,
      t.deducoesDoResultado,
      custoPlanejado,
    );
    return {
      faturamento: t.faturamentoPrevisto,
      custoPlanejado,
      resultadoOperacional: r.resultadoOperacional,
      resultadoGeral: r.resultadoGeral,
    };
  }

  const dados = meses.map((m) => {
    const gruposDoMes = grupos.filter((g) => g.mes_id === m.id);
    const itensDoMes = gruposDoMes.flatMap((g) => itensPorGrupo.get(g.id) ?? []);
    return {
      mes: m,
      grupos: gruposDoMes,
      itens: itensDoMes,
      href: `${base}&mes=${chaveDoMes(m.mes)}`,
      ...fechamento(itensDoMes),
    };
  });

  // O trimestre soma os itens que moram em algum mês. Grupo sem mês numa
  // versão mensal não deveria existir; se existir, não entra em conta que
  // a tela não mostra.
  const itensDosMeses = dados.flatMap((d) => d.itens);
  const doTrimestre = fechamento(itensDosMeses);

  const selecionado =
    mesPedido === "trimestre" || dados.length === 0
      ? "trimestre"
      : (dados.find((d) => chaveDoMes(d.mes.mes) === mesPedido)?.mes.id ??
        dados[0].mes.id);

  const referencia = meses[0]?.mes ?? inicioPrevisto;
  const trimestre = referencia ? trimestreDe(referencia) : null;
  const trimestreRotulo = trimestre ? rotuloTrimestre(trimestre) : "Trimestre";

  const descricao =
    dados.length === 0
      ? "Esta versão ainda não tem meses."
      : dados.length === 1
        ? `${rotuloMes(dados[0].mes.mes)}, pelo período do orçamento`
        : `${rotuloMesCurto(dados[0].mes.mes)} a ${nomeDoMes(
            dados[dados.length - 1].mes.mes,
          )} de ${trimestre?.ano}, pelo período do orçamento`;

  const presentes = new Set(meses.map((m) => m.mes));
  const editar =
    readOnly || !trimestre
      ? null
      : {
          versaoId: versao.id,
          trimestreRotulo,
          meses: dados.map((d) => ({
            id: d.mes.id,
            rotulo: rotuloMes(d.mes.mes),
            qtdItens: d.itens.length,
          })),
          disponiveis: mesesDoTrimestre(trimestre)
            .filter((mes) => !presentes.has(mes))
            .map((mes) => ({ mes, rotulo: rotuloMes(mes) })),
        };

  const temBv = Object.keys(bvsPorItem).length > 0;
  const calha = !readOnly ? "pr-[154px]" : temBv ? "pr-[124px]" : undefined;

  function planilhaDoMes(
    d: (typeof dados)[number],
    opcoes: { semTotais?: boolean } = {},
  ) {
    return (
      <PlanilhaVersao
        grupos={d.grupos}
        itens={d.itens}
        secoes={d.grupos.map((g) => ({
          grupo: g,
          itens: itensPorGrupo.get(g.id) ?? [],
        }))}
        moeda={moeda}
        readOnly={readOnly}
        categorias={categorias}
        bvsPorItem={bvsPorItem}
        fornecedores={fornecedores}
        versaoLabel={`v${versao.numero_versao}`}
        percentualHonorarios={honorarios}
        percentualImposto={imposto}
        versaoId={versao.id}
        clienteNome={clienteNome}
        savePorPadrao={versao.save_por_padrao === true}
        savePorItem={savePorItem}
        saldosDeSave={saldosDeSave}
        nomeDoGrupo={nomeDoGrupo}
        modeloPlanilha={planilha.modeloPlanilha}
        internacional={planilha.internacional}
        moedaEstrangeira={planilha.moedaEstrangeira}
        mes={{ id: d.mes.id, nome: nomeDoMes(d.mes.mes) }}
        semTotais={opcoes.semTotais}
        tituloTotais={`Totais de ${nomeDoMes(d.mes.mes)}`}
        subtituloTotais="Orçado × Planejado · valores calculados a partir dos itens do mês."
      />
    );
  }

  const mesAtual = dados.find((d) => d.mes.id === selecionado);

  function resumo(qtdGrupos: number, qtdItens: number) {
    return `${qtdGrupos} ${qtdGrupos === 1 ? "grupo" : "grupos"} · ${qtdItens} ${
      qtdItens === 1 ? "item" : "itens"
    }`;
  }

  return (
    <>
      <ReguaMeses
        moeda={moeda}
        descricao={descricao}
        trimestre={{
          chave: "trimestre",
          rotulo: "Trimestre",
          ...doTrimestre,
          href: `${base}&mes=trimestre`,
        }}
        meses={dados.map((d) => ({
          chave: d.mes.id,
          rotulo: rotuloMesCurto(d.mes.mes),
          faturamento: d.faturamento,
          resultadoGeral: d.resultadoGeral,
          href: d.href,
        }))}
        selecionado={selecionado}
        editar={editar}
        acao={
          importacao && !readOnly ? (
            <ImportarPlanilhaDrawer
              projetoId={projetoId}
              orcamentoId={orcamentoId}
              modeloPlanilha={planilha.modeloPlanilha}
              modo="sobrescrever"
              versaoId={versao.id}
              conteudoAtual={{
                grupos: grupos.length,
                itens: itens.length,
                bvs: Object.keys(bvsPorItem).length,
              }}
              disabled={importacao.disabled}
              disabledReason={importacao.disabledReason}
            />
          ) : null
        }
      />

      {mesAtual ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-xl font-semibold tracking-tight">
                {rotuloMes(mesAtual.mes.mes)}
              </h2>
              <span className="text-[13px] text-muted-foreground">
                {resumo(mesAtual.grupos.length, mesAtual.itens.length)}
              </span>
            </div>
            {!readOnly && (
              <CopiarItensDoMes
                destinoId={mesAtual.mes.id}
                destinoNome={nomeDoMes(mesAtual.mes.mes)}
                origens={dados
                  .filter((d) => d.mes.id !== mesAtual.mes.id)
                  .map((d) => ({
                    id: d.mes.id,
                    rotulo: rotuloMes(d.mes.mes),
                    qtdGrupos: d.grupos.length,
                    qtdItens: d.itens.length,
                  }))}
                bloqueio={
                  mesAtual.grupos.length > 0
                    ? "Só é possível copiar para um mês vazio."
                    : undefined
                }
              />
            )}
          </div>
          <div className={cn("space-y-6", calha)}>{planilhaDoMes(mesAtual)}</div>
        </>
      ) : dados.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <p className="text-sm font-semibold text-foreground">
            Esta versão ainda não tem meses
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {readOnly
              ? "Nada a mostrar."
              : "Use “Editar meses”, acima, para incluir os meses do trimestre."}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-xl font-semibold tracking-tight">{trimestreRotulo}</h2>
            <span className="text-[13px] text-muted-foreground">
              {dados.length === 1 ? "1 mês" : `${dados.length} meses`}
            </span>
          </div>
          <div className={cn("space-y-6", calha)}>
            <TrimestreEmpilhado
              moeda={moeda}
              meses={dados.map((d) => ({
                id: d.mes.id,
                titulo: rotuloMes(d.mes.mes),
                nome: nomeDoMes(d.mes.mes),
                resumo: resumo(d.grupos.length, d.itens.length),
                faturamento: d.faturamento,
                custoPlanejado: d.custoPlanejado,
                resultadoOperacional: d.resultadoOperacional,
                resultadoGeral: d.resultadoGeral,
                href: d.href,
                conteudo: planilhaDoMes(d, { semTotais: true }),
              }))}
            />
            <TotaisCard
              itens={itensDosMeses}
              bvsPorItem={bvsPorItem}
              visao="bruto"
              percentualHonorarios={honorarios}
              percentualImposto={imposto}
              moeda={moeda}
              modeloPlanilha={planilha.modeloPlanilha}
              internacional={planilha.internacional}
              moedaEstrangeira={planilha.moedaEstrangeira}
              titulo="Totais do trimestre"
              subtitulo="Orçado × Planejado · soma dos meses."
            />
          </div>
        </>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
        <p>
          A exportação e a importação de planilha de orçamentos de Fee e
          Always On ainda não estão disponíveis.
        </p>
      </div>
    </>
  );
}
