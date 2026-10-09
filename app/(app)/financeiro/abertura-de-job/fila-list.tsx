"use client";

import * as React from "react";
import {
  Check,
  CheckCheck,
  ClipboardCheck,
  FilePenLine,
  Search,
} from "lucide-react";
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
  BarraDosFiltrosDeColuna,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

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

/** O botão da linha — é por ele que a coluna Abertura filtra. */
function acaoDaLinha(x: LinhaDaFila): string {
  if (x.tipo === "save") return x.s.tipo === "gera" ? "Aprovar save" : "Aprovar consumo";
  return x.l.revisao !== null ? "Revisar abertura" : "Abrir job";
}
const ORDEM_DA_ACAO = ["Aprovar save", "Aprovar consumo", "Revisar abertura", "Abrir job"];

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
      const [codigo, nome, cliente] =
        x.tipo === "save"
          ? [x.s.projetoCodigo, x.s.projetoNome, x.s.clienteNome]
          : [x.l.projeto_codigo, x.l.projeto_nome, x.l.cliente_nome];
      return { ...celulaTexto(`${codigo ?? ""} ${nome ?? ""}`.trim()), grupo: cliente ?? "" };
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
    alinhar: "right",
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
    alinhar: "right",
    celula: (x) => ({ ...celulaTexto(acaoDaLinha(x)), ordemNaLista: ORDEM_DA_ACAO.indexOf(acaoDaLinha(x)) }),
  },
];

export function FilaAbertura({
  linhas,
  saves,
}: {
  linhas: FilaLinha[];
  /** A faixa Saves: os pedidos de save que aguardam o financeiro. */
  saves: SaveFilaLinha[];
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

  const q = busca.trim().toLowerCase();
  const jobsDaBusca = React.useMemo(() => {
    if (!q) return linhas;
    return linhas.filter((l) =>
      [l.codigo, l.nome, l.projeto_codigo, l.projeto_nome, l.cliente_nome]
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
        s.projetoCodigo,
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
  const vazio = doTopo.length === 0;
  const comFaixas =
    [savesVisiveis.length, erratas.length, novas.length].filter((n) => n > 0)
      .length >= 2;

  /** Uma linha da fila. A faixa a que ela pertence decide o clique. */
  function Linha({ l }: { l: FilaLinha }) {
    const ehErrata = l.revisao !== null;
    const abrir = () =>
      ehErrata ? setRevisandoId(l.id) : setConferindoId(l.id);

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
        className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors last:border-0 hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
      >
        <td className="px-4 py-3.5">
          <span className="font-mono text-xs font-bold text-[#b3323c]">
            {l.codigo}
          </span>
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{l.nome}</span>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {formatPeriodo(l.data_inicio_prevista, l.data_fim_prevista)}
            </span>
            <MarcaDeSave saves={l.saves} itens={l.planilha_itens} />
            {/* Decisão 162: a errata só reorganizou a planilha. */}
            {l.revisao?.soOrganizacao && (
              <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-[1px] text-[10.5px] font-semibold text-emerald-800">
                Nenhum valor alterado · itens reorganizados
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px]">
              <span className="font-mono text-xs text-muted-foreground">
                {l.projeto_codigo ?? "—"}
              </span>{" "}
              {l.projeto_nome ?? ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {[l.cliente_nome, l.produto].filter(Boolean).join(" · ") || "—"}
            </span>
          </div>
        </td>
        <td className="px-4 py-3.5 text-muted-foreground">
          {l.responsavel_nome ?? "—"}
        </td>
        <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums">
          {formatCurrency(l.valor_total)}
        </td>
        <td className="px-4 py-3.5">
          <QuemEnviou
            nome={l.enviado_por_label}
            quando={l.enviado_em_label}
            reenvio={l.reenviado && l.revisao === null}
          />
        </td>
        <td className="px-4 py-3.5">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                abrir();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              {ehErrata ? (
                <FilePenLine className="h-3.5 w-3.5" />
              ) : (
                <ClipboardCheck className="h-3.5 w-3.5" />
              )}
              {ehErrata ? "Revisar abertura" : "Abrir job"}
            </button>
          </div>
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
        className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors last:border-0 hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
      >
        <td className="px-4 py-3.5">
          <span className="font-mono text-xs font-bold text-[#b3323c]">
            {s.jobCodigo}
          </span>
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{s.jobNome}</span>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <IconeSave tipo={s.tipo} origens={s.origens.map((o) => o.codigo)} />
              {rotuloDoSave(s.tipo, s.grupoNome, s.itemDescricao)}
            </span>
          </div>
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px]">
              <span className="font-mono text-xs text-muted-foreground">
                {s.projetoCodigo ?? "—"}
              </span>{" "}
              {s.projetoNome ?? ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {[s.clienteNome, s.produto].filter(Boolean).join(" · ") || "—"}
            </span>
          </div>
        </td>
        <td className="px-4 py-3.5 text-muted-foreground">
          {s.responsavelNome ?? "—"}
        </td>
        {/* O valor da LINHA — o crédito ou o consumo —, não o do job. */}
        <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums">
          {formatCurrency(s.valor)}
        </td>
        <td className="px-4 py-3.5">
          <QuemEnviou nome={s.enviadoPorNome} quando={s.enviado_em_label} reenvio={false} />
        </td>
        <td className="px-4 py-3.5">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                abrir();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <Check className="h-3.5 w-3.5" />
              {s.tipo === "gera" ? "Aprovar save" : "Aprovar consumo"}
            </button>
          </div>
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
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("job")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("projeto")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("gp")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("valor")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("enviado")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("acao")}</th>
              </tr>
            </thead>
            <tbody>
              {/* As faixas só aparecem quando há DUAS coortes ou mais. Com
                  uma só, a tabela é a de sempre e o rótulo seria ruído. */}
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
              {colunas.visiveis.length === 0 && (
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

/** Coluna "Enviado por" da fila (decisão 136): quem mandou, e quando. */
function QuemEnviou({
  nome,
  quando,
  reenvio,
}: {
  nome: string | null;
  quando: string;
  reenvio: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-foreground">
        {nome ?? "—"}
        {reenvio && (
          <span className="rounded-md border border-california-red/30 bg-california-red/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-california-red">
            Reenvio
          </span>
        )}
      </span>
      <span className="text-[12px] text-muted-foreground">{quando}</span>
    </div>
  );
}

/**
 * O job tem save (decisão 155): a fila avisa antes da conferência, porque
 * a aprovação dos saves agora acontece no formulário da abertura. Com o
 * orçamento inteiro num modo (decisão 154), diz qual. A conta é pelas
 * linhas que a conferência já traz: todas em save, ou todas consumindo.
 */
function MarcaDeSave({
  saves,
  itens,
}: {
  saves: SaveDaConferencia[];
  itens: number;
}) {
  if (saves.length === 0) return null;
  const gera = saves.filter((s) => s.tipo === "gera").length;
  const consome = saves.length - gera;
  const inteiro = saves.length === itens && (gera === 0 || consome === 0);
  const origem = saves.find((s) => s.tipo === "consome")?.origens[0]?.codigo;
  const texto = inteiro
    ? gera > 0
      ? "Orçamento inteiro em save"
      : `Orçamento inteiro pago pelo saldo do ${origem ?? "job de origem"}`
    : `${saves.length} ${saves.length === 1 ? "linha com save" : "linhas com save"}`;
  return (
    <span className="text-[11.5px] font-medium text-muted-foreground">{texto}</span>
  );
}
