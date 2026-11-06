"use client";

/**
 * A Conciliação automática como uma fila dividida (decisão 234), agrupada
 * pelo que a pessoa faz (decisão 243): Corrigir, Prontos para conciliar,
 * Conferir, Lançar avulso e Conciliados. Uma tabela só, com as mesmas colunas
 * em todas as divisões (Data | Descrição no banco | Valor | Situação | No
 * sistema · Descrição | Fornecedor | Job | Tipo | TRI | Reg | Ação), o motivo
 * de cada linha na Situação, os filtros por coluna (decisão 165) e nenhuma
 * linha que expande: o detalhe fica nas dicas.
 */

import * as React from "react";
import { AlertTriangle, CheckCheck, ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import { BotaoDaSecao, comCentro } from "./banco-tabela";
import { FaixaDoTopo, InfoDica, itensDaConta, LinhaDeAvisos, LinhaDoArquivo, type Item, type PropsDaFila } from "./fila-da-conta";
import { celulasDoItem, Colunas, GrupoNaFila, LARGURA_DA_FILA, LinhaDaFila, LinhaDoAgrupamento, LinhaSemBanco } from "./fila-linhas";

/** As divisões: pelo que a pessoa faz (decisão 243). */
type Div = "corrigir" | "pronto" | "conferir" | "lancar" | "conciliado";
const DIVS: Div[] = ["corrigir", "pronto", "conferir", "lancar", "conciliado"];
const DIV: Record<Div, { titulo: string; dica: string; ponto: string }> = {
  corrigir: {
    titulo: "Corrigir",
    dica: "A baixa do sistema não bate com o banco: está com outro valor, ou não tem linha num dia que o extrato cobre. Até corrigir, a conciliação não fecha.",
    ponto: "bg-california-red",
  },
  pronto: {
    titulo: "Prontos para conciliar",
    dica: "Um clique resolve, sem decisão: título com valor, forma e data batendo, remessa, tarifa com regra, PIX que voltou no mesmo dia, linha da planilha e a baixa já lançada no sistema que ainda não se ligou. O motivo de cada uma está na Situação.",
    ponto: "bg-emerald-500",
  },
  conferir: {
    titulo: "Conferir",
    dica: "O sistema achou o que é, mas falta uma decisão sua. O motivo está na Situação: juros, retenção, centro de custo, qual título entre linhas iguais, vários títulos, mútuo, empresa de fora ou agrupamento.",
    ponto: "bg-amber-500",
  },
  lancar: {
    titulo: "Lançar avulso · Não há no sistema",
    dica: "Nada no sistema com esse valor. Lance como avulso (a linha já vem preenchida) ou procure um título com a lupa.",
    ponto: "bg-violet-500",
  },
  conciliado: {
    titulo: "Conciliados",
    dica: "Ligado a um lançamento do Extrato. Dá para desfazer até fechar a conciliação. As baixas já lançadas no sistema ficam aqui, marcadas.",
    ponto: "bg-neutral-400",
  },
};

/** Em qual divisão cada item entra: os tipos do motor, pelo que se faz. */
function divisaoDe(i: Item): Div {
  const t = i.tipo;
  if (t === "divergencia" || t === "soSistema") return "corrigir";
  if (t === "manual") return i.k === "linha" && i.r.resolvido ? "conciliado" : "pronto";
  if (t === "conciliado") return "conciliado";
  if (t === "sem") return "lancar";
  if (t === "pronto" || t === "par" || t === "regra") return "pronto";
  if (t === "historico") return i.k === "linha" && i.r.confianca === "alta" ? "pronto" : "conferir";
  // A remessa se concilia num clique; a soma incerta pede conferência.
  if (t === "varios") return i.k === "linha" && i.r.estado === "soma" ? "pronto" : "conferir";
  return "conferir"; // conferir, linhas iguais, empresa de fora, mútuo, agrupar
}

const dia = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const somaDia = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diaSeguinte = (iso: string) => somaDia(iso, 1);
const diaAnterior = (iso: string) => somaDia(iso, -1);
/** O que a 239 guardava no navegador, por conta, até 06/11/2026: sai na
 *  primeira visita, para não ficar lixo. */
const esquecerOGuardado = (conta: string) => {
  try {
    localStorage.removeItem(`conciliacao.divisoes-abertas.${conta}`);
    localStorage.removeItem(`conciliacao.extrato-visto.${conta}`);
  } catch {
    /* sem armazenamento: nada a apagar */
  }
};
/** O item que ainda pede ação (a baixa já conciliada, não). */
const pedeAcao = (i: Item) => (i.k === "linha" ? !i.r.resolvido : true);

export function FilaDividida(p: PropsDaFila) {
  const { conciliacao, secoes, conciliarVarios, pending } = p;
  const itens = React.useMemo(() => itensDaConta({ secoes, conciliacao }), [secoes, conciliacao]);
  const conta = p.banco.conta.id;
  const ultima = p.banco.ultima;
  // As divisões abrem sempre fechadas: ao abrir a aba, ao voltar, ao trocar
  // de conta e ao chegar um extrato novo (revisão de 06/11/2026 da 239). O
  // título e a contagem de cada divisão já dizem o que há para fazer.
  const [recolhidas, setRecolhidas] = React.useState<Set<Div>>(new Set(DIVS));
  const ultimaId = ultima?.id ?? null;
  React.useEffect(() => {
    esquecerOGuardado(conta);
    // A tela não remonta ao trocar de conta ou ao importar.
    setRecolhidas(new Set(DIVS));
  }, [conta, ultimaId]);

  // Os filtros por coluna (decisão 165), como no Extrato: o que passa neles
  // fica nas divisões; guardados na aba do navegador, por conta.
  const contexto = p.contexto;
  const banco = p.banco;
  const COLUNAS = React.useMemo<ColunaFiltravel<Item>[]>(() => {
    const c = (i: Item) => celulasDoItem(i, { contexto, banco });
    return [
      { chave: "data", rotulo: "Data", tipo: "data", celula: (i) => celulaData(c(i).data) },
      { chave: "banco", rotulo: "Descrição no banco", tipo: "texto", celula: (i) => celulaTexto(c(i).banco) },
      { chave: "valor", rotulo: "Valor", tipo: "valor", faixa: true, alinhar: "right", celula: (i) => celulaValor(c(i).valor, formatBRL) },
      { chave: "situacao", rotulo: "Situação", tipo: "texto", celula: (i) => celulaTexto(c(i).situacao) },
      { chave: "sistema", rotulo: "No sistema · Descrição", tipo: "texto", celula: (i) => celulaTexto(c(i).sistema) },
      { chave: "quem", rotulo: "Fornecedor", tipo: "texto", celula: (i) => celulaTexto(c(i).quem) },
      { chave: "job", rotulo: "Job", tipo: "texto", celula: (i) => celulaTexto(c(i).job) },
      { chave: "tipo", rotulo: "Tipo", tipo: "texto", celula: (i) => celulaTexto(c(i).tipo) },
      { chave: "tri", rotulo: "TRI", tipo: "texto", alinhar: "center", celula: (i) => celulaTexto(c(i).tri) },
      { chave: "reg", rotulo: "Reg", tipo: "texto", celula: (i) => celulaTexto(c(i).reg) },
    ];
  }, [contexto, banco]);
  const filtro = useFiltrosDeColuna(itens, COLUNAS, { guardarEm: "conciliacao-automatica", contexto: conta });
  const doTipo = (t: Div) => filtro.visiveis.filter((i) => divisaoDe(i) === t);
  const linhasDe = (is: Item[]) => is.reduce((s, i) => s + (i.k === "grupo" ? i.g.linhas.length : 1), 0);

  const alternarDivisao = (t: Div) =>
    setRecolhidas((r) => {
      const x = new Set(r);
      if (x.has(t)) x.delete(t);
      else x.add(t);
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
  const sugestoes = secoes.conferir.filter((r) => r.estado === "sugestao" && comCentro(r.titulo));
  // Prontos: todos de uma vez, cada um pela ação da própria linha, em série
  // (`conciliarVarios`). O PIX que voltou vai pela linha da devolução, que
  // concilia as duas; a contagem é de linhas do banco.
  const prontos = doTipo("pronto").filter((i): i is Extract<Item, { k: "linha" }> => i.k === "linha" && !i.r.resolvido);
  const nProntos = prontos.length;
  const botaoDe = (t: Div): React.ReactNode =>
    t === "pronto" && nProntos > 1 ? (
      <BotaoDaSecao
        verde
        disabled={pending}
        onClick={() => conciliarVarios(prontos.map((i) => i.r).filter((r) => !(r.estado === "par" && r.mov.valor < 0)))}
      >
        <CheckCheck className="h-3.5 w-3.5" />
        Conciliar os {nProntos}
      </BotaoDaSecao>
    ) : t === "conferir" && sugestoes.length > 1 ? (
      <BotaoDaSecao disabled={pending} onClick={() => conciliarVarios(sugestoes)}>
        Aceitar as {sugestoes.length} sugestões
      </BotaoDaSecao>
    ) : null;

  const algumaAberta = DIVS.some((t) => doTipo(t).length > 0 && !recolhidas.has(t));
  const rotuloDoBotao = algumaAberta ? "Recolher todas as divisões" : "Expandir todas as divisões";

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

      {filtro.ativo && (
        <BarraDosFiltrosDeColuna visiveis={filtro.visiveis.length} total={filtro.total} singular="item" plural="itens" onLimpar={filtro.limpar} />
      )}

      {/* O corte entre o banco (com a situação) e o sistema (decisão 243). */}
      <style>{`.fila-corte tr > :nth-child(5) { border-left: 2px solid hsl(var(--border)); }`}</style>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table style={{ minWidth: LARGURA_DA_FILA }} className="fila-corte w-full table-fixed text-sm">
          <Colunas />
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-1 text-left">
                {/* O expandir / recolher todas as divisões fica no cabeçalho
                    de Data, depois do título (decisão 239, ponto 6). */}
                <span className="inline-flex items-center gap-1">
                  {filtro.titulo("data", "tracking-normal")}
                  <button
                    type="button"
                    title={rotuloDoBotao}
                    aria-label={rotuloDoBotao}
                    onClick={() => setRecolhidas(new Set<Div>(algumaAberta ? DIVS : []))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {algumaAberta ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
                  </button>
                </span>
              </th>
              <th className="px-3 py-2 text-left">{filtro.titulo("banco", "tracking-normal")}</th>
              <th className="px-3 py-2 text-right">{filtro.titulo("valor", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">{filtro.titulo("situacao", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">{filtro.titulo("sistema", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">{filtro.titulo("quem", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">{filtro.titulo("job", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">{filtro.titulo("tipo", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">{filtro.titulo("tri", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">{filtro.titulo("reg", "tracking-normal")}</th>
              <th className="px-3 py-2 text-left">Ação</th>
            </tr>
          </thead>
          {DIVS.map((t) => {
            const is = doTipo(t);
            if (!is.length) return null;
            // Filtrando, as divisões com resultado abrem: o que passou no
            // filtro fica à vista.
            const fechada = recolhidas.has(t) && !filtro.filtrando;
            return (
              <tbody key={t}>
                <tr className="border-b border-border bg-muted/60">
                  <td colSpan={11} className="px-3 py-2">
                    <span className="flex items-center gap-2.5">
                      <button type="button" onClick={() => alternarDivisao(t)} aria-expanded={!fechada} className="flex items-center gap-2.5 text-left">
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", fechada && "-rotate-90")} />
                        {t === "corrigir" ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-california-red" />
                        ) : (
                          <span className={cn("h-2 w-2 rounded-full", DIV[t].ponto)} />
                        )}
                        <span className="text-[13px] font-semibold text-foreground">{DIV[t].titulo}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{linhasDe(is)}</span>
                      </button>
                      <InfoDica texto={DIV[t].dica} />
                      <span className="flex-1" />
                      {botaoDe(t)}
                    </span>
                  </td>
                </tr>
                {!fechada &&
                  is
                    .slice()
                    .sort((a, b) => (filtro.ordenacao ? 0 : a.data.localeCompare(b.data)))
                    .map((i) =>
                      i.k === "grupo" ? (
                        <GrupoNaFila key={i.id} item={i} p={p} />
                      ) : i.k === "conjunto" ? (
                        <LinhaDoAgrupamento key={i.id} item={i} p={p} />
                      ) : i.k === "semLinha" ? (
                        <LinhaSemBanco key={i.id} item={i} p={p} />
                      ) : (
                        <LinhaDaFila key={i.id} item={i} p={p} />
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
