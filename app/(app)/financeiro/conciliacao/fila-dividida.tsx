"use client";

/**
 * A Conciliação automática como uma fila dividida (decisão 234): uma tabela
 * só, com as mesmas colunas Data | Histórico | Valor | Situação | No sistema |
 * Ação, o detalhe ao clicar e a seleção; dividida por tipo, na ordem do motor,
 * cada divisão com a contagem, o ⓘ, o botão de todas e recolhível. As colunas
 * alinham entre as divisões porque é a mesma tabela.
 */

import * as React from "react";
import { AlertTriangle, CheckCheck, ChevronDown, ChevronsDownUp, ChevronsUpDown, Link2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { BotaoDaSecao, COR_DO_PONTO, comCentro } from "./banco-tabela";
import {
  FaixaDoTopo,
  InfoDica,
  itensDaConta,
  LinhaDeAvisos,
  LinhaDoArquivo,
  ORDEM,
  TIPOS,
  type Item,
  type PropsDaFila,
  type Tipo,
} from "./fila-da-conta";
import { Colunas, GrupoNaFila, LinhaDaFila, LinhaDoAgrupamento, LinhaSemBanco } from "./fila-linhas";

/** Os títulos das divisões. */
const TITULO: Record<Tipo, string> = {
  divergencia: "A baixa à mão não bate com o banco",
  manual: "Baixas à mão que bateram",
  pronto: "Prontos",
  conferir: "Conferir antes",
  varios: "Uma linha, vários títulos",
  par: "Saiu e voltou",
  regra: "Pelas regras do histórico",
  historico: "Do histórico da planilha",
  fora: "Empresa de fora",
  mutuo: "Mútuo entre empresas",
  dividido: "Agrupar lançamentos",
  sem: "Sem correspondência",
  soSistema: "Baixa no sistema, sem linha no banco",
  conciliado: "Conciliados",
};

const dia = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const somaDia = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diaSeguinte = (iso: string) => somaDia(iso, 1);
const diaAnterior = (iso: string) => somaDia(iso, -1);
/** O que a pessoa deixou aberto, por conta (só neste navegador). */
const chaveAbertas = (conta: string) => `conciliacao.divisoes-abertas.${conta}`;
/** A última importação que este navegador já mostrou, por conta. */
const chaveVisto = (conta: string) => `conciliacao.extrato-visto.${conta}`;
const ler = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const gravar = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento: só não lembra */
  }
};
/** O item que ainda pede ação (a baixa à mão já conciliada, não). */
const pedeAcao = (i: Item) => (i.k === "linha" ? !i.r.resolvido : true);

export function FilaDividida(p: PropsDaFila) {
  const { secoes, conciliacao, acoes, conciliarVarios, pending } = p;
  const itens = React.useMemo(() => itensDaConta({ secoes, conciliacao }), [secoes, conciliacao]);
  const [aberto, setAberto] = React.useState<string | null>(null);
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  // As divisões nascem fechadas; depois de montar, voltam abertas as que a
  // pessoa deixou abertas nesta conta (decisão 239). Só no navegador dela.
  // O extrato que este navegador ainda não tinha mostrado chega com todas
  // fechadas (revisão de 06/11/2026 da 239, ponto 2): o título e a contagem
  // de cada divisão já dizem o que há para fazer.
  const conta = p.banco.conta.id;
  const ultima = p.banco.ultima;
  const [recolhidas, setRecolhidas] = React.useState<Set<Tipo>>(new Set(ORDEM));
  const ultimaId = ultima?.id ?? null;
  React.useEffect(() => {
    let abertas = new Set<Tipo>(JSON.parse(ler(chaveAbertas(conta)) ?? "[]") as Tipo[]);
    if (ultimaId && ler(chaveVisto(conta)) !== ultimaId) {
      abertas = new Set();
      gravar(chaveAbertas(conta), "[]");
      gravar(chaveVisto(conta), ultimaId);
    }
    setRecolhidas(new Set(ORDEM.filter((t) => !abertas.has(t))));
  }, [conta, ultimaId]);

  const doTipo = (t: Tipo) => itens.filter((i) => i.tipo === t);
  const linhasDe = (is: Item[]) => is.reduce((s, i) => s + (i.k === "grupo" ? i.g.linhas.length : 1), 0);

  const selecionavel = (i: Item): i is Extract<Item, { k: "linha" }> => i.k === "linha" && !i.r.resolvido && (i.tipo === "pronto" || i.tipo === "manual");
  const selecionaveis = itens.filter(selecionavel);
  const selecionados = selecionaveis.filter((i) => marcados.has(i.id));
  const alternar = (id: string) =>
    setMarcados((m) => {
      const x = new Set(m);
      if (x.has(id)) x.delete(id);
      else x.add(id);
      return x;
    });
  const alternarDivisao = (t: Tipo) =>
    setRecolhidas((r) => {
      const x = new Set(r);
      if (x.has(t)) x.delete(t);
      else x.add(t);
      gravar(chaveAbertas(conta), JSON.stringify(ORDEM.filter((o) => !x.has(o))));
      return x;
    });
  // Nada pendente: a faixa de tudo conciliado (decisão 239).
  const pendentes = itens.filter(pedeAcao).length;
  // Fechada até o fim do extrato (o dia em andamento não fecha).
  const fechadaNoExtrato = !!p.fechadaAte && !!ultima?.fim && p.fechadaAte >= diaAnterior(ultima.fim);
  // O dia em que o arquivo foi gerado ainda não estava completo: o próximo
  // extrato começa nele (a linha repetida não entra de novo).
  const inicioDoProximo = ultima?.fim ? (ultima.geradoDia === ultima.fim ? ultima.fim : diaSeguinte(ultima.fim)) : null;
  const saldoBate = ultima?.saldoBanco != null && p.banco.saldoSistemaNoFim != null && Math.round((ultima.saldoBanco - p.banco.saldoSistemaNoFim) * 100) === 0;

  // O botão de todas de cada divisão.
  const manuais = secoes.manual.filter((r) => !r.resolvido);
  const sugestoes = secoes.conferir.filter((r) => r.estado === "sugestao" && comCentro(r.titulo));
  const botaoDe = (t: Tipo): React.ReactNode =>
    t === "pronto" && secoes.alta.length > 1 ? (
      <BotaoDaSecao verde disabled={pending} onClick={() => conciliarVarios(secoes.alta)}>
        <CheckCheck className="h-3.5 w-3.5" />
        Conciliar os {secoes.alta.length}
      </BotaoDaSecao>
    ) : t === "manual" && manuais.length > 1 ? (
      <BotaoDaSecao verde disabled={pending} onClick={() => conciliarVarios(manuais)}>
        <Link2 className="h-3.5 w-3.5" />
        Conciliar as {manuais.length}
      </BotaoDaSecao>
    ) : t === "conferir" && sugestoes.length > 1 ? (
      <BotaoDaSecao disabled={pending} onClick={() => conciliarVarios(sugestoes)}>
        Aceitar as {sugestoes.length} sugestões
      </BotaoDaSecao>
    ) : t === "regra" && secoes.regra.length > 1 ? (
      <BotaoDaSecao disabled={pending} onClick={() => acoes.lancarRegra(secoes.regra)}>
        <Wand2 className="h-3.5 w-3.5" />
        Conciliar as {secoes.regra.length}
      </BotaoDaSecao>
    ) : t === "historico" && secoes.historico.length > 1 ? (
      <BotaoDaSecao disabled={pending} onClick={() => acoes.conciliarHistorico(secoes.historico)}>
        <Link2 className="h-3.5 w-3.5" />
        Conciliar as {secoes.historico.length}
      </BotaoDaSecao>
    ) : null;

  return (
    <>
      {/* Com tudo conciliado, o importar fica na faixa verde. */}
      <LinhaDoArquivo banco={p.banco} importar={ultima && pendentes === 0 ? null : p.importar} />
      <LinhaDeAvisos {...p} />
      <FaixaDoTopo {...p} />

      {ultima && pendentes === 0 && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center gap-3">
            <CheckCheck className="h-5 w-5 text-emerald-700" />
            <span>
              <strong>Tudo conciliado</strong> no extrato de {dia(ultima.inicio)} a {dia(ultima.fim)}
              {saldoBate ? " · o saldo do banco bate com o do sistema ✓" : " · o saldo ainda não bate: confira o Extrato"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-emerald-200 pt-3">
            <span className="flex-1">
              {fechadaNoExtrato ? (
                <>
                  Conciliação <strong>fechada até {dia(p.fechadaAte)}</strong>. Próximo passo: importe o extrato a partir de{" "}
                </>
              ) : (
                <>
                  Próximo passo: <strong>feche a conciliação</strong> (botão ao lado dos saldos) e importe o extrato a partir de{" "}
                </>
              )}
              <strong>{dia(inicioDoProximo)}</strong>.
            </span>
            {p.importar}
          </div>
        </div>
      )}

      {selecionados.length > 0 && (
        <div className="flex justify-end">
          <BotaoDaSecao
            verde
            disabled={pending}
            onClick={() => {
              conciliarVarios(selecionados.map((i) => i.r));
              setMarcados(new Set());
            }}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Conciliar selecionados ({selecionados.length})
          </BotaoDaSecao>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1150px] table-fixed text-sm">
          <Colunas />
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-1 py-2 text-left">
                {/* Expandir ou recolher todas as divisões (decisão 239), no
                    lugar do "marcar todas": cada divisão já tem o botão de todas. */}
                {(() => {
                  const algumaAberta = ORDEM.some((t) => doTipo(t).length > 0 && !recolhidas.has(t));
                  const rotulo = algumaAberta ? "Recolher todas as divisões" : "Expandir todas as divisões";
                  return (
                    <button
                      type="button"
                      title={rotulo}
                      aria-label={rotulo}
                      onClick={() => {
                        const x = new Set<Tipo>(algumaAberta ? ORDEM : []);
                        gravar(chaveAbertas(conta), JSON.stringify(ORDEM.filter((o) => !x.has(o))));
                        setRecolhidas(x);
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {algumaAberta ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
                    </button>
                  );
                })()}
              </th>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Histórico do banco</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2 text-left">Situação</th>
              <th className="px-3 py-2 text-left">No sistema</th>
              <th className="px-3 py-2 text-left">Ação</th>
            </tr>
          </thead>
          {ORDEM.map((t) => {
            const is = doTipo(t);
            if (!is.length) return null;
            const fechada = recolhidas.has(t);
            const alerta = t === "soSistema" || t === "divergencia";
            return (
              <tbody key={t}>
                <tr className="border-b border-border bg-muted/60">
                  <td colSpan={7} className="px-3 py-2">
                    <span className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => alternarDivisao(t)}
                        aria-expanded={!fechada}
                        className="flex items-center gap-2.5 text-left"
                      >
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", fechada && "-rotate-90")} />
                        {alerta ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-california-red" />
                        ) : (
                          <span className={cn("h-2 w-2 rounded-full", COR_DO_PONTO[TIPOS[t].cor])} />
                        )}
                        <span className="text-[13px] font-semibold text-foreground">{TITULO[t]}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{linhasDe(is)}</span>
                      </button>
                      <InfoDica texto={TIPOS[t].dica} />
                      <span className="flex-1" />
                      {botaoDe(t)}
                    </span>
                  </td>
                </tr>
                {!fechada &&
                  is
                    .slice()
                    .sort((a, b) => a.data.localeCompare(b.data))
                    .map((i) =>
                      i.k === "grupo" ? (
                        <GrupoNaFila key={i.id} item={i} p={p} />
                      ) : i.k === "conjunto" ? (
                        <LinhaDoAgrupamento key={i.id} item={i} p={p} aberta={aberto === i.id} onAbrir={() => setAberto(aberto === i.id ? null : i.id)} />
                      ) : i.k === "semLinha" ? (
                        <LinhaSemBanco key={i.id} item={i} p={p} aberta={aberto === i.id} onAbrir={() => setAberto(aberto === i.id ? null : i.id)} />
                      ) : (
                        <LinhaDaFila
                          key={i.id}
                          item={i}
                          p={p}
                          aberta={aberto === i.id}
                          onAbrir={() => setAberto(aberto === i.id ? null : i.id)}
                          selecionavel={selecionavel(i)}
                          marcada={marcados.has(i.id)}
                          onMarcar={() => alternar(i.id)}
                        />
                      ),
                    )}
              </tbody>
            );
          })}
        </table>
      </div>
    </>
  );
}
