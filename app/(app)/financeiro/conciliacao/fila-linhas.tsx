"use client";

/**
 * As linhas da fila da Conciliação automática (decisão 234): a linha do banco
 * (clicar abre o detalhe), o grupo de linhas iguais, a baixa sem linha no
 * banco e o agrupamento achado. Todas com as mesmas colunas
 * Data | Histórico do banco | Valor | Situação | No sistema | Ação.
 */

import * as React from "react";
import { CheckCheck, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { dataBR } from "@/components/financeiro/planilha-de-titulos/planilha";
import type { ResultadoDaLinha } from "./motor-da-conta";
import { NoSistema, textoDoCentro, TituloNaCelula } from "./banco-tabela";
import { ResumoDoAgrupamento } from "./agrupar-lancamentos";
import {
  acoesDoAgrupamento,
  acoesDaBaixaSemLinha,
  acoesDaLinha,
  acoesDaLinhaDoGrupo,
  BotaoPrincipal,
  InfoDica,
  MenuMais,
  moeda,
  PilulaDoTipo,
  resumoDoSistema,
  useEscolhaDoGrupo,
  type Item,
  type PropsDaFila,
} from "./fila-da-conta";

/** As colunas da fila: o MESMO `colgroup` em todas as divisões. */
export function Colunas() {
  return (
    <colgroup>
      <col style={{ width: 40 }} />
      <col style={{ width: 96 }} />
      <col style={{ width: 330 }} />
      <col style={{ width: 130 }} />
      <col style={{ width: 170 }} />
      <col />
      <col style={{ width: 210 }} />
    </colgroup>
  );
}

function Valor({ v }: { v: number }) {
  return (
    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-mono text-xs", v < 0 ? "text-california-red" : "text-emerald-700")}>
      {v < 0 ? "− " : "+ "}
      {moeda(Math.abs(v))}
    </td>
  );
}

function CelulaDeAcao({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
      <span className="flex items-center justify-end gap-1">{children}</span>
    </td>
  );
}

export function LinhaDaFila({
  item,
  p,
  aberta,
  onAbrir,
  selecionavel,
  marcada,
  onMarcar,
}: {
  item: Extract<Item, { k: "linha" }>;
  p: PropsDaFila;
  aberta: boolean;
  onAbrir: () => void;
  selecionavel: boolean;
  marcada: boolean;
  onMarcar: () => void;
}) {
  const { r, tipo } = item;
  const d = acoesDaLinha(r, p.acoes, p.contexto);
  return (
    <>
      <tr onClick={onAbrir} className={cn("cursor-pointer border-b border-border hover:bg-muted/30", aberta && "bg-muted/30", r.resolvido && "text-muted-foreground")}>
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          {selecionavel && <Checkbox aria-label="Selecionar a linha" checked={marcada} onCheckedChange={onMarcar} className="rounded" />}
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
          <span className="inline-flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", aberta && "rotate-90")} />
            {dataBR(r.mov.data)}
          </span>
        </td>
        <td className="px-3 py-2 font-mono text-[11px]">
          <span className="block truncate" title={r.mov.historico}>
            {r.mov.historico}
          </span>
        </td>
        <Valor v={r.mov.valor} />
        <td className="px-3 py-2">
          <span className="flex items-center gap-1.5">
            <PilulaDoTipo tipo={tipo === "manual" || !r.resolvido ? tipo : "conciliado"} rotulo={r.resolvido && tipo !== "manual" ? (r.resolvido.estado === "ignorado" ? "Ignorado" : r.resolvido.sozinho ? "Conciliado sozinho" : "Conciliado") : undefined} />
          </span>
        </td>
        <td className="px-3 py-2">
          <span className="block truncate text-xs" title={resumoDoSistema(r, p.contexto)}>
            {resumoDoSistema(r, p.contexto)}
          </span>
        </td>
        <CelulaDeAcao>
          <BotaoPrincipal d={d} r={r} acoes={p.acoes} className="w-[160px]" />
          <MenuMais itens={d.secundarias} acoes={p.acoes} />
        </CelulaDeAcao>
      </tr>
      {aberta && (
        <tr className="border-b border-border bg-muted/20">
          <td />
          <td colSpan={6} className="px-3 py-3">
            <Detalhe r={r} p={p} />
          </td>
        </tr>
      )}
    </>
  );
}

/** O detalhe da linha: o que o motor achou, por quê, os candidatos e o centro. */
function Detalhe({ r, p }: { r: ResultadoDaLinha; p: PropsDaFila }) {
  const l = r.titulo ? p.contexto.linhaPorChave.get(r.titulo.id) : undefined;
  const centro = textoDoCentro(l).replace(/^ · /, "");
  const candidatos = r.candidatos.filter((c) => c.t.id !== r.titulo?.id).slice(0, 4);
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-6 text-xs">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">No sistema</p>
        {r.resolvido ? <p>{r.resolvido.texto}</p> : <NoSistema r={r} contexto={p.contexto} />}
        <p className="pt-1 font-mono text-[11px] text-muted-foreground">{r.mov.historico}</p>
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Por quê</p>
        <p>{r.motivo ?? "—"}</p>
        {centro && (
          <>
            <p className="pt-2 text-[11px] uppercase tracking-wider text-muted-foreground">Centro de custo</p>
            <p>{centro}</p>
          </>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Outros candidatos</p>
        {candidatos.length === 0 ? (
          <p className="text-muted-foreground">Nenhum.</p>
        ) : (
          candidatos.map((c) => (
            <button
              key={c.t.id}
              type="button"
              disabled={p.acoes.ocupado}
              onClick={() => p.acoes.conferirTitulo(r, c.t)}
              title="Abrir a baixa deste título com os dados do banco"
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white"
            >
              <span className="min-w-0 flex-1 truncate">
                {c.t.ref} · {c.t.contraparte}
              </span>
              <span className="shrink-0 font-mono">{moeda(c.t.liquido)}</span>
              <span className="shrink-0 text-muted-foreground">{dataBR(c.t.vencimento).slice(0, 5)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function GrupoNaFila({ item, p }: { item: Extract<Item, { k: "grupo" }>; p: PropsDaFila }) {
  const e = useEscolhaDoGrupo(item.g);
  const n = e.linhas.length;
  return (
    <>
      <tr className="border-b border-amber-200 bg-amber-50/70">
        <td />
        <td colSpan={5} className="px-3 py-1.5">
          <span className="flex items-center gap-2 text-[12px] font-semibold text-amber-900">
            <PilulaDoTipo tipo="conferir" rotulo="Linhas iguais" />
            {e.resumo}
            <InfoDica
              texto={
                <>
                  O banco não diz quem recebeu cada PIX: qual linha fica com qual título não muda o Extrato. Troque pelo ⋯ da linha.
                  {e.sobram.length > 0 && <> Fica em aberto: {e.sobram.map((t) => `${t.ref} · ${t.contraparte}`).join("; ")}.</>}
                </>
              }
            />
          </span>
        </td>
        <CelulaDeAcao>
          {n > 1 && (
            <button
              type="button"
              disabled={e.semCentro.length > 0 || p.acoes.ocupado}
              title={e.semCentro.length ? `Sem centro de custo: ${e.semCentro.map((t) => t.ref).join(", ")}. Baixe pela linha.` : undefined}
              onClick={() => p.acoes.conciliarGrupo(e.linhas, e.escolhidos)}
              className="inline-flex h-7 w-[160px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck className="h-3 w-3" />
              Conciliar as {n}
            </button>
          )}
          <span className="inline-block h-7 w-7" />
        </CelulaDeAcao>
      </tr>
      {e.linhas.map((r, k) => {
        const t = e.porId.get(e.escolha[r.mov.id]);
        if (!t) return null;
        const l = p.contexto.linhaPorChave.get(t.id);
        const d = acoesDaLinhaDoGrupo(r, t, p.acoes, e.trocasDe(r));
        return (
          <tr key={r.mov.id} className="border-b border-border">
            <td />
            <td className="whitespace-nowrap px-3 py-2 pl-7 font-mono text-xs">{dataBR(r.mov.data)}</td>
            <td className="px-3 py-2 font-mono text-[11px]">
              <span className="block truncate" title={r.mov.historico}>
                {r.mov.historico}
              </span>
            </td>
            <Valor v={r.mov.valor} />
            <td className="px-3 py-2">
              <PilulaDoTipo tipo="conferir" rotulo={n === 1 ? "Mesmo valor" : `Linha ${k + 1} de ${n}`} />
            </td>
            <td className="min-w-0 px-3 py-2">
              <TituloNaCelula t={t} l={l} />
            </td>
            <CelulaDeAcao>
              <BotaoPrincipal d={d} r={r} acoes={p.acoes} className="w-[160px]" />
              <MenuMais itens={d.secundarias} acoes={p.acoes} />
            </CelulaDeAcao>
          </tr>
        );
      })}
    </>
  );
}

export function LinhaSemBanco({ item, p, aberta, onAbrir }: { item: Extract<Item, { k: "semLinha" }>; p: PropsDaFila; aberta: boolean; onAbrir: () => void }) {
  const l = item.l;
  const d = acoesDaBaixaSemLinha(l, p.acoes);
  return (
    <>
      <tr onClick={onAbrir} className={cn("cursor-pointer border-b border-border bg-red-50/30 hover:bg-red-50/60", aberta && "bg-red-50/60")}>
        <td />
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
          <span className="inline-flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", aberta && "rotate-90")} />
            {dataBR(l.data)}
          </span>
        </td>
        <td className="px-3 py-2 text-[11px] italic text-muted-foreground">sem linha no banco</td>
        <Valor v={l.valor} />
        <td className="px-3 py-2">
          <PilulaDoTipo tipo="soSistema" />
        </td>
        <td className="px-3 py-2">
          <span className="block truncate text-xs" title={l.descricao}>
            {l.descricao}
            {l.fornecedor ? ` · ${l.fornecedor}` : ""}
          </span>
        </td>
        <CelulaDeAcao>
          <BotaoPrincipal d={d} acoes={p.acoes} className="w-[160px]" />
          <MenuMais itens={d.secundarias} acoes={p.acoes} />
        </CelulaDeAcao>
      </tr>
      {aberta && (
        <tr className="border-b border-border bg-muted/20">
          <td />
          <td colSpan={6} className="px-3 py-3 text-xs">
            Lançamento no Extrato desta conta em {dataBR(l.data)}. O banco não tem {l.valor < 0 ? "débito" : "crédito"} de {moeda(Math.abs(l.valor))} entre as linhas
            importadas: paga em outra conta, com a data errada ou não paga.
          </td>
        </tr>
      )}
    </>
  );
}

/** O agrupamento achado: uma linha com o resumo à vista e o "Conciliar";
 *  aberta, as baixas e as linhas do banco, uma a uma. */
export function LinhaDoAgrupamento({ item, p, aberta, onAbrir }: { item: Extract<Item, { k: "conjunto" }>; p: PropsDaFila; aberta: boolean; onAbrir: () => void }) {
  const d = acoesDoAgrupamento(item.c, p.acoes);
  return (
    <>
      <tr onClick={onAbrir} className={cn("cursor-pointer border-b border-border bg-emerald-50/30 hover:bg-emerald-50/60", aberta && "bg-emerald-50/60")}>
        <td />
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
          <span className="inline-flex items-center gap-1">
            <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", aberta && "rotate-90")} />
            {dataBR(item.data)}
          </span>
        </td>
        <td colSpan={4} className="px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <PilulaDoTipo tipo="dividido" />
            <ResumoDoAgrupamento c={item.c} />
          </span>
        </td>
        <CelulaDeAcao>
          <BotaoPrincipal d={d} acoes={p.acoes} className="w-[160px]" />
          <MenuMais itens={d.secundarias} acoes={p.acoes} />
        </CelulaDeAcao>
      </tr>
      {aberta && (
        <>
          {item.ls.map((l) => (
            <tr key={l.id} className="border-b border-border bg-muted/20 text-xs">
              <td />
              <td className="whitespace-nowrap px-3 py-1.5 pl-7 font-mono">{dataBR(l.data)}</td>
              <td className="truncate px-3 py-1.5" title={l.descricao}>
                {l.descricao}
                {l.fornecedor ? ` · ${l.fornecedor}` : ""}
              </td>
              <Valor v={l.valor} />
              <td className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">No sistema</td>
              <td className="px-3 py-1.5 text-[11px] text-muted-foreground">baixa sem linha no banco</td>
              <td />
            </tr>
          ))}
          {item.rs.map((r) => (
            <tr key={r.mov.id} className="border-b border-border bg-muted/20 text-xs">
              <td />
              <td className="whitespace-nowrap px-3 py-1.5 pl-7 font-mono">{dataBR(r.mov.data)}</td>
              <td className="truncate px-3 py-1.5 font-mono text-[11px]" title={r.mov.historico}>
                {r.mov.historico}
              </td>
              <Valor v={r.mov.valor} />
              <td className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">No banco</td>
              <td className="px-3 py-1.5 text-[11px] text-muted-foreground">linha do extrato</td>
              <td />
            </tr>
          ))}
        </>
      )}
    </>
  );
}
