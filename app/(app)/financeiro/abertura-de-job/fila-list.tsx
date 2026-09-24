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
import type { JobNaFila, SaveNaFila } from "./dados";
import { formatPeriodo } from "./formatos";
import { ConferenciaDialog } from "./conferencia-dialog";
import { ReprovarDialog } from "./reprovar-dialog";
import { ResumoErrataDialog } from "./resumo-errata-dialog";
import { AprovarSaveDialog } from "./aprovar-save-dialog";
import { RecusarSaveDialog } from "./recusar-save-dialog";
import { IconeSave, rotuloDoSave } from "./icone-save";

export interface FilaLinha extends JobNaFila {
  /** "há 2 horas" — calculado no server para não divergir na hidratação. */
  enviado_em_label: string;
}

/** Um pedido da faixa Saves, com o rótulo relativo pronto (decisão 099). */
export interface SaveFilaLinha extends SaveNaFila {
  /** "há 2 horas" — calculado no server, como o da fila. */
  enviado_em_label: string;
}

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
  const visiveis = React.useMemo(() => {
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
  const savesVisiveis = React.useMemo(() => {
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

  const vazio = visiveis.length + savesVisiveis.length === 0;
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
        <td className="px-4 py-3.5 text-[12.5px] text-muted-foreground">
          {l.enviado_em_label}
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
        <td className="px-4 py-3.5 text-[12.5px] text-muted-foreground">
          {s.enviado_em_label}
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

      {!vazio ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Código</th>
                <th className="px-4 py-3 font-semibold">Job</th>
                <th className="px-4 py-3 font-semibold">Projeto · Cliente</th>
                <th className="px-4 py-3 font-semibold">GP responsável</th>
                <th className="px-4 py-3 text-right font-semibold">
                  Valor total
                </th>
                <th className="px-4 py-3 font-semibold">Enviado</th>
                <th className="px-4 py-3 text-right font-semibold">Abertura</th>
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
          jobCodigo={reprovando.codigo}
          gpNome={reprovando.responsavel_nome}
          produtorNome={reprovando.produtor_nome}
        />
      )}
    </div>
  );
}
