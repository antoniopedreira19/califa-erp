"use client";

import * as React from "react";
import { CheckCheck, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { JobNaFila, SaveDaConferencia, SaveNaFila } from "./dados";
import { formatPeriodo } from "./formatos";
import { ConferenciaDialog } from "./conferencia-dialog";
import { ReprovarDialog } from "./reprovar-dialog";
import { ResumoErrataDialog } from "./resumo-errata-dialog";
import { AprovarSaveDialog } from "./aprovar-save-dialog";
import { RecusarSaveDialog } from "./recusar-save-dialog";
import { IconeSave, rotuloDoSave } from "./icone-save";
import {
  LinhaCancelamentoNaFila,
  RevisarCancelamentoDialog,
  type CancelamentoDaFila,
} from "./cancelamento-na-fila";
import {
  BarraDosFiltrosDeColuna,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import {
  BotaoDaFila,
  CelulaCodigo,
  CelulaEnviado,
  CelulaGp,
  CelulaJob,
  CelulaProjeto,
  CLASSE_DA_CELULA,
  CLASSE_DA_LINHA,
  ColunasDaFila,
  ROTULO_DO_FILTRO,
  SeloDaFila,
} from "./fila-celulas";
import { resumoDosDesvios } from "@/lib/calculos/excecao-fechamento";

export interface FilaLinha extends JobNaFila {
  /** "há 2 horas" — calculado no server para não divergir na hidratação. */
  enviado_em_label: string;
  /** Quem mandou (decisão 136): na abertura, quem fez o último envio; na
   *  errata, quem a registrou. */
  enviado_por_label: string | null;
}

/** Um pedido da faixa Saves, com o rótulo relativo pronto (decisão 099). */
export interface SaveFilaLinha extends SaveNaFila {
  /** "há 2 horas" — calculado no server, como o da fila. */
  enviado_em_label: string;
}

/** Uma linha da tabela da fila: um pedido de save ou um job (errata ou
 *  abertura nova). As três faixas usam as mesmas colunas. */
type LinhaDaFila = { tipo: "save"; s: SaveFilaLinha } | { tipo: "job"; l: FilaLinha };

/** A ação da linha — é por ela que a coluna Abertura filtra. O botão diz
 *  só "Revisar" (14/10/2026); o filtro continua com o nome inteiro. */
function acaoDaLinha(x: LinhaDaFila): string {
  if (x.tipo === "save") return ROTULO_DO_FILTRO[x.s.tipo === "gera" ? "gera" : "consome"];
  return ROTULO_DO_FILTRO[x.l.revisao !== null ? "errata" : "nova"];
}
const ORDEM_DA_ACAO = [
  ROTULO_DO_FILTRO.gera,
  ROTULO_DO_FILTRO.consome,
  ROTULO_DO_FILTRO.errata,
  ROTULO_DO_FILTRO.nova,
];

/** As colunas que filtram e ordenam pelo título, como no Excel (pedido do
 *  Tiago, 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job). */
const COLUNAS: ColunaFiltravel<LinhaDaFila>[] = [
  {
    chave: "codigo",
    rotulo: "Código",
    tipo: "texto",
    celula: (x) => celulaTexto(x.tipo === "save" ? x.s.jobCodigo : x.l.codigo),
  },
  { chave: "job", rotulo: "Job", tipo: "texto", celula: (x) => celulaTexto(x.tipo === "save" ? x.s.jobNome : x.l.nome) },
  {
    chave: "projeto",
    rotulo: "Projeto · Cliente",
    tipo: "texto",
    // Árvore cliente ▸ projeto: o cliente marca todos os projetos dele.
    celula: (x) => {
      const [nome, cliente] =
        x.tipo === "save"
          ? [x.s.projetoNome, x.s.clienteNome]
          : [x.l.projeto_nome, x.l.cliente_nome];
      return { ...celulaTexto(nome ?? ""), grupo: cliente ?? "" };
    },
    rotuloSemGrupo: "(sem cliente)",
  },
  {
    chave: "gp",
    rotulo: "GP responsável",
    tipo: "texto",
    celula: (x) => celulaTexto(x.tipo === "save" ? x.s.responsavelNome : x.l.responsavel_nome),
  },
  {
    chave: "valor",
    rotulo: "Valor total",
    tipo: "valor",
    faixa: true,
    // À esquerda, como as colunas de texto (14/10/2026): o Valor total
    // fica antes do botão e começa junto do título.
    celula: (x) => celulaValor(x.tipo === "save" ? x.s.valor : x.l.valor_total, (n) => formatCurrency(n)),
  },
  {
    // Filtra por quem mandou; ordena por quando (a ordem de chegada).
    chave: "enviado",
    rotulo: "Enviado por",
    tipo: "data",
    celula: (x) => {
      const nome = x.tipo === "save" ? x.s.enviadoPorNome : x.l.enviado_por_label;
      const quando = x.tipo === "save" ? x.s.enviadoEm : (x.l.revisao?.erratas.at(-1)?.em ?? x.l.enviado_em);
      return { ...celulaTexto(nome), ordem: quando ?? "" };
    },
  },
  {
    chave: "acao",
    rotulo: "Abertura",
    tipo: "texto",
    // Centralizado sobre os botões, que têm todos a mesma largura.
    alinhar: "center",
    celula: (x) => ({ ...celulaTexto(acaoDaLinha(x)), ordemNaLista: ORDEM_DA_ACAO.indexOf(acaoDaLinha(x)) }),
  },
];

export function FilaAbertura({
  linhas,
  saves,
  cancelamentos,
  revisarInicial,
}: {
  linhas: FilaLinha[];
  /** A faixa Saves: os pedidos de save que aguardam o financeiro. */
  saves: SaveFilaLinha[];
  /** A faixa Cancelamentos (decisão 169): os pedidos da produção para
   *  cancelar job já aberto. Ficam no topo — o job está parado esperando. */
  cancelamentos: CancelamentoDaFila[];
  /** `?revisar=<job>` da URL: quem volta do "Visualizar job" do pedido
   *  encontra o mesmo pop-up aberto. */
  revisarInicial: string | null;
}) {
  const [busca, setBusca] = React.useState("");
  const [conferindoId, setConferindoId] = React.useState<string | null>(null);
  const [reprovandoId, setReprovandoId] = React.useState<string | null>(null);
  const [revisandoId, setRevisandoId] = React.useState<string | null>(null);
  // O pop-up "Aprovar save" e a recusa, que abre por cima dele (decisão
  // 099). Um só aberto por vez: a recusa troca de lugar com a aprovação, e
  // "Voltar" traz a aprovação de volta.
  const [aprovandoSaveId, setAprovandoSaveId] = React.useState<string | null>(null);
  const [recusandoSaveId, setRecusandoSaveId] = React.useState<string | null>(null);
  // O pedido de cancelamento em revisão, pelo id do JOB (é o que a URL leva).
  const [revisandoCancelamentoJob, setRevisandoCancelamentoJob] = React.useState<string | null>(
    () =>
      revisarInicial && cancelamentos.some((c) => c.jobId === revisarInicial)
        ? revisarInicial
        : null,
  );

  const q = busca.trim().toLowerCase();
  const jobsDaBusca = React.useMemo(() => {
    if (!q) return linhas;
    return linhas.filter((l) =>
      [l.codigo, l.nome, l.projeto_nome, l.cliente_nome]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [linhas, q]);

  // A busca acha o save pelo job (os mesmos campos das outras faixas) e
  // também pelo item da linha.
  const savesDaBusca = React.useMemo(() => {
    if (!q) return saves;
    return saves.filter((s) =>
      [
        s.jobCodigo,
        s.jobNome,
        s.projetoNome,
        s.clienteNome,
        s.itemDescricao,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [saves, q]);

  /** Saves e jobs numa lista só: os filtros dos títulos valem para as
   *  três faixas de uma vez. */
  const doTopo = React.useMemo<LinhaDaFila[]>(
    () => [
      ...savesDaBusca.map((s) => ({ tipo: "save" as const, s })),
      ...jobsDaBusca.map((l) => ({ tipo: "job" as const, l })),
    ],
    [savesDaBusca, jobsDaBusca],
  );
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "abertura-fila" });
  // As faixas continuam; com ordem pelo título, cada faixa vem naquela ordem.
  const savesVisiveis = React.useMemo(
    () => colunas.visiveis.flatMap((x) => (x.tipo === "save" ? [x.s] : [])),
    [colunas.visiveis],
  );
  const visiveis = React.useMemo(
    () => colunas.visiveis.flatMap((x) => (x.tipo === "job" ? [x.l] : [])),
    [colunas.visiveis],
  );

  // Três faixas na MESMA tabela, e nenhuma cor nova. Saves em cima (design
  // da decisão 099): é o pedido pontual, que se resolve numa conferência
  // de linha. Depois as erratas, que são job já aberto esperando
  // reconferência — quem está parado vem antes de quem está começando. A
  // distinção fica no rótulo da faixa, no ícone e no texto do botão
  // (design 4a, 27/08/2026).
  //
  // O job cuja revisão é SÓ de save já chega fora de `linhas` (a página
  // tira): aprovar o save é registrar a revisão, e ele aparece só na faixa
  // Saves.
  const erratas = React.useMemo(
    () => visiveis.filter((l) => l.revisao !== null),
    [visiveis],
  );
  const novas = React.useMemo(
    () => visiveis.filter((l) => l.revisao === null),
    [visiveis],
  );

  const total = visiveis.reduce((s, l) => s + (l.valor_total ?? 0), 0);
  const conferindo = linhas.find((l) => l.id === conferindoId) ?? null;
  const reprovando = linhas.find((l) => l.id === reprovandoId) ?? null;
  const revisando = linhas.find((l) => l.id === revisandoId) ?? null;
  const aprovandoSave = saves.find((s) => s.id === aprovandoSaveId) ?? null;
  const recusandoSave = saves.find((s) => s.id === recusandoSaveId) ?? null;

  // Vazio de verdade é a fila vazia ou a BUSCA sem resultado. Se foram os
  // filtros dos títulos, a tabela fica (com os títulos, para desfazer).
  // A faixa Cancelamentos não passa pela busca nem pelos filtros dos
  // títulos: são poucos pedidos, e cada um para um job inteiro.
  const vazio = doTopo.length === 0 && cancelamentos.length === 0;
  const comFaixas =
    [cancelamentos.length, savesVisiveis.length, erratas.length, novas.length].filter((n) => n > 0)
      .length >= 2;
  const revisandoCancelamento =
    cancelamentos.find((c) => c.jobId === revisandoCancelamentoJob) ?? null;

  /** Uma linha da fila. A faixa a que ela pertence decide o clique. */
  function Linha({ l }: { l: FilaLinha }) {
    const ehErrata = l.revisao !== null;
    const abrir = () =>
      ehErrata ? setRevisandoId(l.id) : setConferindoId(l.id);
    const marca = textoDaMarcaDeSave(l.saves, l.planilha_itens);

    return (
      <tr
        role="button"
        tabIndex={0}
        onClick={abrir}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            abrir();
          }
        }}
        className={CLASSE_DA_LINHA}
      >
        <td className={CLASSE_DA_CELULA}>
          <CelulaCodigo codigo={l.codigo} />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaJob
            nome={l.nome}
            periodo={formatPeriodo(l.data_inicio_prevista, l.data_fim_prevista)}
            detalhe={marca ? { texto: marca } : null}
            selo={
              // Decisão 162: a errata só reorganizou a planilha.
              l.revisao?.soOrganizacao ? (
                <SeloDaFila tipo="reorganizada" dica="Nenhum valor alterado · itens reorganizados" />
              ) : l.excecao_fechamento ? (
                <SeloDaFila tipo="excecao" dica={resumoDosDesvios(l.excecao_fechamento.taxas)} />
              ) : null
            }
          />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaProjeto
            nome={l.projeto_nome}
            cliente={[l.cliente_nome, l.produto].filter(Boolean).join(" · ") || "—"}
          />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaGp nome={l.responsavel_nome} />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaEnviado
            nome={l.enviado_por_label}
            quando={l.enviado_em_label}
            reenvio={l.reenviado && l.revisao === null}
          />
        </td>
        <td className={`${CLASSE_DA_CELULA} whitespace-nowrap font-semibold tabular-nums`}>
          {formatCurrency(l.valor_total)}
        </td>
        <td className={CLASSE_DA_CELULA}>
          <BotaoDaFila acao={ehErrata ? "errata" : "nova"} onClick={abrir} />
        </td>
      </tr>
    );
  }

  /**
   * Uma linha da faixa Saves: um pedido, não um job (decisão 099). As
   * colunas são as da fila; a segunda linha da célula Job diz o que o
   * pedido é, com o ícone da coluna Save da planilha.
   */
  function LinhaSave({ s }: { s: SaveFilaLinha }) {
    const abrir = () => setAprovandoSaveId(s.id);
    return (
      <tr
        role="button"
        tabIndex={0}
        onClick={abrir}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            abrir();
          }
        }}
        className={CLASSE_DA_LINHA}
      >
        <td className={CLASSE_DA_CELULA}>
          <CelulaCodigo codigo={s.jobCodigo} />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaJob
            nome={s.jobNome}
            periodo={null}
            detalhe={{
              texto: rotuloDoSave(s.tipo, s.grupoNome, s.itemDescricao),
              icone: <IconeSave tipo={s.tipo} origens={s.origens.map((o) => o.codigo)} />,
            }}
          />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaProjeto
            nome={s.projetoNome}
            cliente={[s.clienteNome, s.produto].filter(Boolean).join(" · ") || "—"}
          />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaGp nome={s.responsavelNome} />
        </td>
        <td className={CLASSE_DA_CELULA}>
          <CelulaEnviado nome={s.enviadoPorNome} quando={s.enviado_em_label} reenvio={false} />
        </td>
        {/* O valor da LINHA — o crédito ou o consumo —, não o do job. */}
        <td className={`${CLASSE_DA_CELULA} whitespace-nowrap font-semibold tabular-nums`}>
          {formatCurrency(s.valor)}
        </td>
        <td className={CLASSE_DA_CELULA}>
          <BotaoDaFila acao={s.tipo === "gera" ? "gera" : "consome"} onClick={abrir} />
        </td>
      </tr>
    );
  }

  /** A faixa que separa as coortes — mesmo cinza das três. */
  function Faixa({ rotulo, quantos }: { rotulo: string; quantos: number }) {
    return (
      <tr className="border-b border-border bg-muted/50">
        <td
          colSpan={7}
          className="px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
        >
          {rotulo} · {quantos}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex items-center">
          <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, job, projeto ou cliente"
            className="h-[38px] w-80 rounded-lg border border-border bg-white pl-9 pr-3 text-[13px] outline-none focus:border-california-red/40"
          />
        </div>
        {!vazio && (
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            {/* Só o que existe: com a fila só de saves, "0 jobs na fila ·
                R$ 0,00" não dizia nada (24/09/2026). O valor é dos jobs. */}
            {[
              visiveis.length > 0
                ? visiveis.length === 1
                  ? "1 job na fila"
                  : `${visiveis.length} jobs na fila`
                : null,
              erratas.length > 0
                ? `${erratas.length} ${erratas.length === 1 ? "revisão de errata" : "revisões de errata"}`
                : null,
              cancelamentos.length > 0
                ? `${cancelamentos.length} ${cancelamentos.length === 1 ? "cancelamento a decidir" : "cancelamentos a decidir"}`
                : null,
              savesVisiveis.length > 0
                ? `${savesVisiveis.length} ${savesVisiveis.length === 1 ? "save a aprovar" : "saves a aprovar"}`
                : null,
              visiveis.length > 0 ? formatCurrency(total) : null,
            ]
              .filter((parte): parte is string => parte !== null)
              .join(" · ")}
          </span>
        )}
      </div>

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="linha"
          plural="linhas"
          onLimpar={colunas.limpar}
        />
      )}

      {!vazio ? (
        // Grade fixa: em janela estreita a tabela rola de lado em vez de
        // espremer as colunas (a mesma saída de /orcamentos, 07/10/2026).
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[1500px] table-fixed border-collapse text-sm">
            <ColunasDaFila />
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("job")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("projeto")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("gp")}</th>
                {/* O Valor total vem antes do botão (14/10/2026): o número
                    fecha a linha, e as colunas de texto ficam juntas. */}
                <th className="px-4 py-3 font-semibold">{colunas.titulo("enviado")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("valor")}</th>
                <th className="px-4 py-3 text-center font-semibold">{colunas.titulo("acao")}</th>
              </tr>
            </thead>
            <tbody>
              {/* As faixas só aparecem quando há DUAS coortes ou mais. Com
                  uma só, a tabela é a de sempre e o rótulo seria ruído. */}
              {comFaixas && cancelamentos.length > 0 && (
                <Faixa rotulo="Cancelamentos" quantos={cancelamentos.length} />
              )}
              {cancelamentos.map((c) => (
                <LinhaCancelamentoNaFila
                  key={c.pedido.id}
                  c={c}
                  onAbrir={() => setRevisandoCancelamentoJob(c.jobId)}
                />
              ))}
              {comFaixas && savesVisiveis.length > 0 && (
                <Faixa rotulo="Saves" quantos={savesVisiveis.length} />
              )}
              {savesVisiveis.map((s) => (
                <LinhaSave key={s.id} s={s} />
              ))}
              {comFaixas && erratas.length > 0 && (
                <Faixa rotulo="Erratas" quantos={erratas.length} />
              )}
              {erratas.map((l) => (
                <Linha key={l.id} l={l} />
              ))}
              {comFaixas && novas.length > 0 && (
                <Faixa rotulo="Aberturas novas" quantos={novas.length} />
              )}
              {novas.map((l) => (
                <Linha key={l.id} l={l} />
              ))}
              {colunas.visiveis.length === 0 && cancelamentos.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma linha com esse filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CheckCheck className="h-5 w-5" />
          </div>
          <p className="text-base font-semibold">
            {linhas.length + saves.length === 0
              ? "Nenhum job aguardando abertura"
              : "Nada encontrado"}
          </p>
          <p className="max-w-[380px] text-[13.5px] text-muted-foreground">
            {linhas.length + saves.length === 0
              ? "Assim que a produção enviar um job, ele aparece aqui para conferência e abertura."
              : "Nenhum job corresponde à busca. Ajuste os termos."}
          </p>
        </div>
      )}

      {/* A conferência sai de cena enquanto a reprovação está aberta: dois
          modais empilhados escondem o texto que a pessoa está escrevendo. */}
      {reprovandoId === null && (
        <ConferenciaDialog
          job={conferindo}
          onOpenChange={(aberto) => !aberto && setConferindoId(null)}
          onReprovar={() => setReprovandoId(conferindoId)}
        />
      )}

      <RevisarCancelamentoDialog
        c={revisandoCancelamento}
        onOpenChange={(aberto) => !aberto && setRevisandoCancelamentoJob(null)}
      />

      <ResumoErrataDialog
        job={revisando}
        saves={revisando ? saves.filter((s) => s.jobId === revisando.id) : []}
        onOpenChange={(aberto) => !aberto && setRevisandoId(null)}
      />

      {/* A aprovação sai de cena enquanto a recusa está aberta, como a
          conferência na reprovação: dois modais empilhados escondem o
          texto que a pessoa está escrevendo. */}
      {recusandoSave === null && (
        <AprovarSaveDialog
          save={aprovandoSave}
          onOpenChange={(aberto) => !aberto && setAprovandoSaveId(null)}
          onRecusar={() => setRecusandoSaveId(aprovandoSaveId)}
        />
      )}

      {recusandoSave && (
        <RecusarSaveDialog
          save={recusandoSave}
          onVoltar={() => setRecusandoSaveId(null)}
          onRecusado={() => {
            setRecusandoSaveId(null);
            setAprovandoSaveId(null);
          }}
        />
      )}

      {reprovando && (
        <ReprovarDialog
          open
          onOpenChange={(aberto) => {
            if (!aberto) {
              setReprovandoId(null);
              setConferindoId(null);
            }
          }}
          jobId={reprovando.id}
          enviadoPorNome={reprovando.enviado_por_nome}
          enviadoEm={reprovando.enviado_em}
          jobCodigo={reprovando.codigo}
          gpNome={reprovando.responsavel_nome}
          produtorNome={reprovando.produtor_nome}
        />
      )}
    </div>
  );
}

/**
 * O job tem save (decisão 155): a fila avisa antes da conferência, porque
 * a aprovação dos saves agora acontece no formulário da abertura. Com o
 * orçamento inteiro num modo (decisão 154), diz qual. A conta é pelas
 * linhas que a conferência já traz: todas em save, ou todas consumindo.
 */
function textoDaMarcaDeSave(saves: SaveDaConferencia[], itens: number): string | null {
  if (saves.length === 0) return null;
  const gera = saves.filter((s) => s.tipo === "gera").length;
  const consome = saves.length - gera;
  const inteiro = saves.length === itens && (gera === 0 || consome === 0);
  const origem = saves.find((s) => s.tipo === "consome")?.origens[0]?.codigo;
  return inteiro
    ? gera > 0
      ? "Orçamento inteiro em save"
      : `Orçamento inteiro pago pelo saldo do ${origem ?? "job de origem"}`
    : `${saves.length} ${saves.length === 1 ? "linha com save" : "linhas com save"}`;
}
