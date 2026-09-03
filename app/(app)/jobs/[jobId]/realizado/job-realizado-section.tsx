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
  PedidoCompraNaLista,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import { useRouter } from "next/navigation";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import { MenuExibirColunas } from "@/app/(app)/_planilha/exibir-colunas";
import {
  SAVE_VAZIO,
  type EstadoSaveDaLinha,
} from "@/app/(app)/_planilha/save-coluna";
import {
  SaveDialog,
  type LinhaDoSave,
} from "@/app/(app)/_planilha/save-dialog";
import type { SaldoDeSave } from "@/lib/data/saves";
import { registrarErrataDeSave } from "./save-errata-actions";
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
import { useRascunhoErrata } from "./errata-rascunho";
import { ErrataBarra } from "./errata-barra";
import { ErrataConfirmarDialog } from "./errata-confirmar-dialog";
import { registrarErrata } from "./actions-errata";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import { definirModoErrata } from "../modo-errata";

interface Props {
  job: Pick<
    Job,
    | "id"
    | "codigo"
    | "nome"
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
  /** Job já enviado para faturamento: o valor da nota está congelado em
   *  `jobs_envio_faturamento` e nem errata nem save podem mexer nele
   *  (decisão 028, nota de 27/08/2026). O servidor já recusava — sem
   *  isto a tela deixava montar a errata inteira antes de reprovar. */
  jaEnviadoParaFaturamento?: boolean;
  /** Errata devolveu o job ao mural do financeiro: nenhuma PP sai para o
   *  financeiro até a revisão da abertura ser salva (decisão 040). Gerar,
   *  editar e cancelar seguem liberados. */
  aberturaEmRevisao?: boolean;
  /** Todas as PPs ativas de cada item realizado (PPs parciais). */
  ppsPorItemId: Map<string, PedidoCompraNaLista[]>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  /** Membros ativos do tenant — usados no combo de Responsável da Verba de Produção. */
  responsaveis: Array<{ id: string; nome: string }>;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  /** Estado do save por id do item da VERSÃO, como o BV. */
  savePorItem: Record<string, EstadoSaveDaLinha>;
  /** Saldos de save que o cliente deste job tem para gastar. */
  saldosDeSave: SaldoDeSave[];
  /** Nome do cliente — aparece no texto do formulário de save. */
  clienteNome: string;
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
  jaEnviadoParaFaturamento = false,
  aberturaEmRevisao = false,
  ppsPorItemId,
  fornecedores,
  empresas,
  responsaveis,
  bvsPorItem,
  savePorItem,
  saldosDeSave,
  clienteNome,
}: Props) {
  const router = useRouter();
  // Uma chave para a página inteira. Abre em Bruto: é a tela de sempre,
  // e quem não lida com BV nunca precisa saber que a outra existe.
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);

  // MODO ERRATA — mesma razão da chave acima, levada ao extremo: a errata
  // muda a planilha, o card de Totais e a barra do rodapé ao mesmo tempo,
  // então o rascunho tem que morar no ancestral comum dos três. Antes de
  // 27/08/2026 isto era um drawer com uma segunda tabela, e o problema não
  // existia porque nada da tela reagia.
  const errata = useRascunhoErrata(itens);
  // A barra de ações do job é irmã das abas e precisa sair de cena
  // enquanto a barra da errata está no ar — as duas grudam no mesmo pé de
  // janela. Nas telas que não têm barra de ações (financeiro, conferência
  // de abertura) ninguém escuta, e o sinal se perde sem efeito.
  React.useEffect(() => {
    definirModoErrata(errata.ativo);
    return () => definirModoErrata(false);
  }, [errata.ativo]);

  const [confirmando, setConfirmando] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erroErrata, setErroErrata] = React.useState<string | null>(null);

  // Os dois lados da conta, pela MESMA função que o card de Totais e o
  // servidor usam. Reimplementar aqui faria a barra mostrar um número e a
  // gravação outro.
  const paraTotais = React.useCallback(
    (lista: ItemPlanilhaJob[]) =>
      calcularTotaisVersao(
        lista.map((i) => ({
          tipo_custo: i.tipo_custo,
          total_orcado: Number(i.total_orcado ?? 0),
          em_save: i.em_save,
          save_consumido: Number(i.save_consumido ?? 0),
        })),
        versao.percentual_honorarios,
        versao.percentual_imposto,
      ),
    [versao.percentual_honorarios, versao.percentual_imposto],
  );

  const totaisAntes = React.useMemo(() => paraTotais(itens), [paraTotais, itens]);
  const totaisDepois = React.useMemo(
    () => paraTotais(errata.itens),
    [paraTotais, errata.itens],
  );

  async function confirmarErrata(descricao: string) {
    setSalvando(true);
    setErroErrata(null);
    const r = await registrarErrata(job.id, errata.payload(descricao));
    setSalvando(false);
    if (!r.ok) {
      setErroErrata(r.message);
      return;
    }
    setConfirmando(false);
    errata.descartar();
    router.refresh();
  }

  // Recolher agrupamento, igual à planilha do orçamento: o subtotal e a
  // rentabilidade continuam à vista, que é o que justifica recolher.
  const gruposIds = React.useMemo(() => grupos.map((g) => g.id), [grupos]);
  const recolher = useGruposRecolhiveis(gruposIds);

  // SAVE — a coluna abre sozinha em quem já usa save ou tem saldo a
  // gastar; quem nunca usou liga pelo menu "Exibir", sem o qual não
  // haveria como criar o primeiro save de um job.
  const [saveLigado, setSaveLigado] = React.useState(
    Object.keys(savePorItem).length > 0 ||
      saldosDeSave.some((s) => s.disponivel > 0),
  );
  const temSave = saveLigado;
  const [linhaSave, setLinhaSave] = React.useState<ItemPlanilhaJob | null>(
    null,
  );

  // MENU "EXIBIR" (decisão 045). Estado de tela: não vai para o banco nem
  // para a URL. Orçado liga/desliga; Planejado e Realizado nunca saem —
  // o realizado é por onde se acompanham as PPs, e o planejado é o custo
  // com que ele se compara. As duas rentabilidades nascem fechadas: com
  // elas desligadas a planilha é a de sempre.
  const [orcadoVisivel, setOrcadoVisivel] = React.useState(true);
  const [rentabPlanejada, setRentabPlanejada] = React.useState(false);
  const [rentabRealizada, setRentabRealizada] = React.useState(false);
  // No job, mexer no save é ERRATA — e errata exige job aberto, a mesma
  // porta de `AlterarOrcadoButton`. O financeiro chega aqui com
  // `podeAcoes` falso e lê sem editar. Depois do envio para faturamento
  // as duas portas fecham juntas, pelo mesmo motivo.
  const podeErrata = podeAcoes && !jaEnviadoParaFaturamento;
  const podeMexerNoSave = podeErrata;
  const motivoErrataTravada = jaEnviadoParaFaturamento
    ? "Job já enviado para faturamento: o valor da nota está congelado e não há mais errata. Fale com o financeiro antes da emissão da nota."
    : null;

  // Cmd+Z / Ctrl+Z desfaz um passo do rascunho da errata.
  //
  // O listener é da janela porque a edição acontece em dezenas de inputs
  // da planilha, e o alvo do atalho é o RASCUNHO, não o campo focado —
  // esses inputs são controlados pelo React, então o desfazer nativo do
  // navegador não voltaria nada de qualquer jeito.
  //
  // O `textarea` fica de fora: é a descrição da errata, no pop-up de
  // confirmação, e lá o desfazer nativo é o certo.
  React.useEffect(() => {
    if (!errata.ativo) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const alvo = document.activeElement;
      if (alvo instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      errata.desfazer();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [errata]);

  const linhaDoDialog: LinhaDoSave | null = linhaSave
    ? {
        id: linhaSave.orcado_id,
        nome: linhaSave.item,
        grupoNome: grupos.find((g) => g.id === linhaSave.grupo_id)?.nome ?? "—",
        tipoCusto: linhaSave.tipo_custo,
        totalOrcado: Number(linhaSave.total_orcado ?? 0),
      }
    : null;

  // Antes da abertura a planilha aparece inteira — o que fica de fora são
  // as ações que geram documento. O aviso substitui o antigo bloco
  // "Realizado indisponível", que escondia a planilha toda.
  const preAbertura =
    job.status === "aguardando_abertura" ||
    job.status === "rejeitado_financeiro";

  // A planilha inteira numa tabela só desde 24/08/2026: os pares
  // grupo → itens são montados aqui e vão de uma vez para a tabela.
  //
  // A lista vem do RASCUNHO, não das props: com o modo errata desligado
  // ela é idêntica aos itens salvos, e com ele ligado já traz as linhas
  // novas e sem as removidas. É o que faz a planilha, o card de Totais e a
  // barra do rodapé mostrarem o mesmo número enquanto se digita.
  const gruposDaPlanilha = React.useMemo<GrupoDoJob[]>(() => {
    const porGrupo = new Map<string, ItemPlanilhaJob[]>();
    for (const g of grupos) porGrupo.set(g.id, []);
    for (const it of errata.itens) porGrupo.get(it.grupo_id)?.push(it);
    return grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      itens: porGrupo.get(g.id) ?? [],
    }));
  }, [grupos, errata.itens]);

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
          <MenuExibirColunas
            titulo="Colunas"
            blocos={[
              {
                chave: "save",
                rotulo: "Save",
                visivel: saveLigado,
                onAlternar: () => setSaveLigado((v) => !v),
              },
              // A errata edita o Orçado: enquanto ela está ligada o bloco
              // não pode sair da tela, e o item explica por quê.
              {
                chave: "orcado",
                rotulo: "Orçado",
                visivel: orcadoVisivel,
                onAlternar: errata.ativo
                  ? undefined
                  : () => setOrcadoVisivel((v) => !v),
                dica: errata.ativo
                  ? "Na errata o Orçado fica sempre aberto."
                  : undefined,
              },
              {
                chave: "planejado",
                rotulo: "Planejado",
                visivel: true,
                dica: "O Planejado é sempre exibido.",
              },
              {
                chave: "realizado",
                rotulo: "Realizado",
                visivel: true,
                dica: "O Realizado é sempre exibido — é por ele que se acompanham as PPs.",
              },
            ]}
            secoes={[
              {
                titulo: "Rentabilidade",
                itens: [
                  {
                    chave: "rentab_planejada",
                    rotulo: "Rentabilidade planejada",
                    visivel: rentabPlanejada,
                    onAlternar: () => setRentabPlanejada((v) => !v),
                  },
                  {
                    chave: "rentab_realizada",
                    rotulo: "Rentabilidade realizada",
                    visivel: rentabRealizada,
                    onAlternar: () => setRentabRealizada((v) => !v),
                  },
                ],
                dica: "Cada uma entra logo depois do bloco que a gera.",
              },
            ]}
          />
          {podeAcoes && (
            <AlterarOrcadoButton
              ativo={errata.ativo}
              travadoPor={motivoErrataTravada}
              onAlternar={() => {
                if (errata.ativo) {
                  errata.descartar();
                  return;
                }
                // A errata é edição do Orçado: o bloco volta à tela
                // junto com ela, esteja escondido ou não.
                setOrcadoVisivel(true);
                errata.ligar();
              }}
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
              aberturaEmRevisao={aberturaEmRevisao}
              ppsPorItemId={ppsPorItemId}
              fornecedores={fornecedores}
              empresas={empresas}
              responsaveis={responsaveis}
              jobEmpresaId={job.empresa_id ?? ""}
              jobResponsavelId={job.responsavel_id ?? ""}
              bvsPorItem={bvsPorItem}
              versaoLabel={`v${versao.numero_versao}`}
              saveVisivel={temSave}
              onAlternarSave={() => setSaveLigado((v) => !v)}
              savePorItem={savePorItem}
              onAbrirSave={
                podeMexerNoSave && !errata.ativo ? setLinhaSave : undefined
              }
              errata={podeErrata ? errata : undefined}
              orcadoVisivel={orcadoVisivel}
              rentabPlanejadaVisivel={rentabPlanejada}
              rentabRealizadaVisivel={rentabRealizada}
            />
          </div>
          <JobTotaisCard
            itens={errata.itens}
            realizadosMap={realizadosMap}
            bvsPorItem={bvsPorItem}
            jobAberto={!preAbertura}
            percentualHonorarios={versao.percentual_honorarios}
            percentualImposto={versao.percentual_imposto}
            moeda={versao.moeda}
          />
        </>
      )}

      <SaveDialog
        open={linhaSave !== null}
        onOpenChange={(aberto) => !aberto && setLinhaSave(null)}
        linha={linhaDoDialog}
        estado={
          linhaSave ? (savePorItem[linhaSave.id] ?? SAVE_VAZIO) : SAVE_VAZIO
        }
        saldos={saldosDeSave}
        moeda={versao.moeda}
        percentualHonorarios={versao.percentual_honorarios}
        percentualImposto={versao.percentual_imposto}
        clienteNome={clienteNome}
        onMarcarSave={
          linhaSave && podeMexerNoSave
            ? async (marcar) => {
                const r = await registrarErrataDeSave(
                  job.id,
                  linhaSave.orcado_id,
                  { tipo: "marcar", emSave: marcar },
                );
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
        onSalvarConsumo={
          linhaSave && podeMexerNoSave
            ? async (origens) => {
                const r = await registrarErrataDeSave(
                  job.id,
                  linhaSave.orcado_id,
                  { tipo: "consumo", origens },
                );
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
      />

      {errata.ativo && (
        <ErrataBarra
          resumo={errata.resumo}
          temMudanca={errata.temMudanca}
          faturamento={{
            antes: totaisAntes.faturamentoPrevisto,
            depois: totaisDepois.faturamentoPrevisto,
          }}
          valorJob={{
            antes: totaisAntes.valorJob,
            depois: totaisDepois.valorJob,
          }}
          moeda={versao.moeda}
          onDescartar={errata.descartar}
          onDesfazer={errata.desfazer}
          podeDesfazer={errata.podeDesfazer}
          onConfirmar={() => {
            setErroErrata(null);
            setConfirmando(true);
          }}
        />
      )}

      <ErrataConfirmarDialog
        open={confirmando}
        onOpenChange={(aberto) => {
          if (!salvando) setConfirmando(aberto);
        }}
        jobCodigo={job.codigo}
        jobNome={job.nome}
        resumo={errata.resumo}
        mudancas={errata.mudancas}
        orcado={{
          antes: totaisAntes.subtotalGeral,
          depois: totaisDepois.subtotalGeral,
        }}
        faturamento={{
          antes: totaisAntes.faturamentoPrevisto,
          depois: totaisDepois.faturamentoPrevisto,
        }}
        valorJob={{
          antes: totaisAntes.valorJob,
          depois: totaisDepois.valorJob,
        }}
        moeda={versao.moeda}
        faltaNomear={errata.faltaNomear}
        salvando={salvando}
        erro={erroErrata}
        onConfirmar={confirmarErrata}
      />
    </div>
  );
}
