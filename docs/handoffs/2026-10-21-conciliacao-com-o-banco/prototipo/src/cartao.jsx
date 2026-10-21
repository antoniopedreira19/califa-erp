import * as React from "react";
import { ArrowRight, ChevronLeft, ChevronRight, CreditCard, Download, Eye, Info, Lock, LockOpen, Plus, Undo2 } from "lucide-react";
import { CARTOES, CONTAS } from "./data";
import { Botao, Campo, centroTexto, cn, dataBR, Dialogo, Dica, Entrada, moeda, Nota, Th, trimestre } from "./ui";
import { colunasDaRegional, comoRecomendada, r2, regionalDe, rotuloCompetencia, totalDosItens } from "./logica";
import { CelulaRegional, DetalhesContexto, ITEM_TIPO } from "./titulos";
import { SeletorCentro } from "./dialogos";

/**
 * A aba Cartão de Contas a Pagar (decisão 093): a capa com os cartões e,
 * dentro de um cartão, o extrato da fatura de cada competência. A capa e o
 * cabeçalho da fatura são os do sistema (cartao-capa.tsx, cartao-fatura.tsx)
 * em todas as versões; o que muda é a tabela do extrato.
 *
 *   Atual  — como está no ar: Data · Crédito · Débito · Acumulado ·
 *            Descrição · Fornecedor · Job · Centro de Custo · Trimestre ·
 *            Empresa · ⓘ · Ação, com largura automática.
 *   Novas  — a planilha da conciliação: as larguras fixas da aba Títulos,
 *            o centro de custo só pelo tipo e a Regional. A recomendada
 *            mostra ainda o pagamento da fatura como a última linha.
 *
 * A forma escolhida na aprovação da PP não põe nada aqui: intenção não é
 * ocorrência (Tiago, 20/10/2026). Só a baixa no cartão cria o item.
 */

// As cores do ChipStatus de cartao-capa.tsx.
const STATUS_FATURA = {
  aberta: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
  fechada: "border-slate-300 bg-slate-100 text-slate-700",
  paga: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function StatusFatura({ status }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_FATURA[status])}>{status}</span>;
}

const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const competenciaLonga = (comp) => `${MESES_LONGOS[Number(comp.slice(5, 7)) - 1]} ${comp.slice(0, 4)}`;
const subtituloDoCartao = (c) => `•••• ${c.final} · ${c.bandeira.toUpperCase()} · fecha ${c.fechamento}`;
const nomeDaConta = (id) => CONTAS.find((c) => c.id === id)?.nome ?? "—";

/** A fatura em curso de um cartão: a aberta mais antiga (é a que o
 *  financeiro fecha primeiro), senão a fechada que espera baixa. */
function emCursoDe(cartao, faturas) {
  const minhas = faturas.filter((f) => f.cartao === cartao.id).sort((a, b) => a.competencia.localeCompare(b.competencia));
  return minhas.find((f) => f.status === "aberta") ?? minhas.find((f) => f.status === "fechada") ?? null;
}


function BotaoLancarPagamento({ avisar, cartao }) {
  return (
    <button
      type="button"
      onClick={() =>
        avisar(
          cartao
            ? `No sistema, abre o lançamento avulso com o ${cartao.nome} já escolhido. Ele fica em Títulos a Pagar até a baixa no cartão.`
            : "No sistema, abre o lançamento avulso para escolher o cartão. Ele fica em Títulos a Pagar até a baixa no cartão.",
        )
      }
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
    >
      <Plus className="h-4 w-4" />
      Lançar pagamento
    </button>
  );
}

export function AbaCartao({ versao, faturas, titulos, onBaixar, onFechar, onReabrir, avisar }) {
  const [cartaoId, setCartaoId] = React.useState(null);
  const [faturaId, setFaturaId] = React.useState(null);
  const cartao = CARTOES.find((c) => c.id === cartaoId);
  if (!cartao) {
    return (
      <CapaDosCartoes
        faturas={faturas}
        onAbrir={(c) => {
          setCartaoId(c.id);
          setFaturaId(emCursoDe(c, faturas)?.id ?? null);
        }}
        avisar={avisar}
      />
    );
  }
  const doCartao = faturas.filter((f) => f.cartao === cartao.id).sort((a, b) => a.competencia.localeCompare(b.competencia));
  const fatura = doCartao.find((f) => f.id === faturaId) ?? emCursoDe(cartao, faturas) ?? doCartao[doCartao.length - 1];
  const i = doCartao.indexOf(fatura);
  return (
    <FaturaDoCartao
      versao={versao}
      cartao={cartao}
      fatura={fatura}
      faturas={faturas}
      titulos={titulos}
      anterior={i > 0 ? () => setFaturaId(doCartao[i - 1].id) : null}
      proxima={i < doCartao.length - 1 ? () => setFaturaId(doCartao[i + 1].id) : null}
      onVoltar={() => setCartaoId(null)}
      onTrocarCartao={(id) => {
        setCartaoId(id);
        setFaturaId(emCursoDe(CARTOES.find((c) => c.id === id), faturas)?.id ?? null);
      }}
      onBaixar={onBaixar}
      onFechar={onFechar}
      onReabrir={onReabrir}
      avisar={avisar}
    />
  );
}

// ---------------------------------------------------------------------------
// A capa — a do sistema (até cinco cartões, a grade de cards)
// ---------------------------------------------------------------------------

function CapaDosCartoes({ faturas, onAbrir, avisar }) {
  const totalAbertas = CARTOES.reduce((s, c) => {
    const f = emCursoDe(c, faturas);
    return s + (f?.status === "aberta" ? totalDosItens(f.itens) : 0);
  }, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Total em faturas abertas <span className="font-mono text-sm font-semibold text-foreground">{moeda(totalAbertas)}</span>
          </span>
          <BotaoLancarPagamento avisar={avisar} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {CARTOES.map((c) => {
          const f = emCursoDe(c, faturas);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onAbrir(c)}
              className="group flex flex-col rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:border-california-red/60"
            >
              <span className="text-[14.5px] font-semibold">{c.nome}</span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{subtituloDoCartao(c)}</span>
              <span className="mt-3 font-mono text-xl font-semibold">{f ? moeda(f.status === "fechada" ? f.valorCobrado : totalDosItens(f.itens)) : "—"}</span>
              <span className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                {f ? (
                  <span className="inline-flex items-center gap-1.5">
                    {rotuloCompetencia(f.competencia)} · <StatusFatura status={f.status} />
                  </span>
                ) : (
                  <span>sem fatura aberta</span>
                )}
                <span className="inline-flex items-center gap-1 font-semibold text-california-red">
                  Abrir <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        O item entra na fatura quando o pagamento é confirmado em Títulos a Pagar com forma “cartão”; a fatura fechada vira um título único lá, e é lá que a baixa dela acontece.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A fatura de um cartão
// ---------------------------------------------------------------------------

function Kpi({ label, valor, tom, rodape }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", tom === "entrada" && "text-emerald-700", tom === "saida" && "text-california-red")}>{moeda(valor)}</p>
      {rodape && <p className="mt-1 text-[11px] text-muted-foreground">{rodape}</p>}
    </div>
  );
}

const SETA = "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red disabled:opacity-30";
const BOTAO_PEQUENO = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border bg-white px-3 py-2 text-xs font-semibold transition-colors";

function FaturaDoCartao({ versao, cartao, fatura, faturas, titulos, anterior, proxima, onVoltar, onTrocarCartao, onBaixar, onFechar, onReabrir, avisar }) {
  const rec = comoRecomendada(versao);
  const [fechando, setFechando] = React.useState(false);
  const itens = [...(fatura?.itens ?? [])].sort((a, b) => a.data.localeCompare(b.data));
  const compras = r2(itens.filter((i) => i.valor > 0 && i.tipo !== "ajuste").reduce((s, i) => s + i.valor, 0));
  const estornos = r2(itens.filter((i) => i.valor < 0).reduce((s, i) => s - i.valor, 0));
  const ajustes = r2(itens.filter((i) => i.tipo === "ajuste").reduce((s, i) => s + i.valor, 0));
  const total = totalDosItens(itens);
  const tituloDaFatura = titulos.find((t) => t.faturaId === fatura?.id);

  return (
    <div className="space-y-4">
      {/* O cabeçalho de uma linha de cartao-fatura.tsx. */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onVoltar} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" />
          Cartões
        </button>
        <label className="relative min-w-[300px]">
          <CreditCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <select
            value={cartao.id}
            onChange={(e) => onTrocarCartao(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            aria-label="Cartão"
          >
            {CARTOES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} · {subtituloDoCartao(c)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={!anterior} onClick={anterior ?? undefined} className={SETA} aria-label="Competência anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] text-center text-[15px] font-semibold">{fatura ? competenciaLonga(fatura.competencia) : "—"}</span>
          <button type="button" disabled={!proxima} onClick={proxima ?? undefined} className={SETA} aria-label="Próxima competência">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {fatura ? (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-[#b3323c]">{fatura.codigo}</span>
            <StatusFatura status={fatura.status} />
            {fatura.status === "aberta" && (
              <span>
                fecha {dataBR(fatura.fecha)} · vence {dataBR(fatura.vence)}
              </span>
            )}
            {fatura.status === "fechada" && <span>vence {dataBR(fatura.vence)} · aguardando baixa em Títulos a Pagar</span>}
            {fatura.status === "paga" && (
              <span>
                paga em {dataBR(fatura.pagaEm)} · {nomeDaConta(fatura.pagaPor)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">sem fatura nesta competência</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <BotaoLancarPagamento avisar={avisar} cartao={cartao} />
          <button type="button" onClick={() => avisar(`Planilha da ${fatura?.codigo} exportada.`)} className={cn(BOTAO_PEQUENO, "border-border text-muted-foreground hover:border-california-red hover:text-california-red")}>
            <Download className="h-3.5 w-3.5" />
            Exportar
          </button>
          {fatura?.status === "aberta" && (
            <button type="button" onClick={() => setFechando(true)} className={cn(BOTAO_PEQUENO, "border-california-red text-california-red hover:bg-california-red/[0.06]")}>
              <CreditCard className="h-3.5 w-3.5" />
              Fechar fatura
            </button>
          )}
          {fatura?.status === "fechada" && !tituloDaFatura?.pagoEm && (
            <button type="button" onClick={() => onReabrir(fatura)} className={cn(BOTAO_PEQUENO, "border-border text-muted-foreground hover:border-california-red hover:text-california-red")}>
              <LockOpen className="h-3.5 w-3.5" />
              Reabrir fatura
            </button>
          )}
        </div>
      </div>

      {!fatura ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">{cartao.nome} não tem fatura nesta competência.</p>
          <p className="mt-1 text-xs text-muted-foreground">A fatura nasce com o primeiro pagamento confirmado no cartão para essa competência.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Compras no período" valor={compras} />
            <Kpi label="Estornos" valor={estornos} tom="entrada" />
            <Kpi label="Ajustes do fechamento" valor={ajustes} />
            <Kpi label="Total da fatura" valor={total} tom="saida" rodape={fatura.valorCobrado !== undefined ? `cobrado pelo banco: ${moeda(fatura.valorCobrado)}` : undefined} />
          </div>
          {versao === "atual" ? (
            <ExtratoAtual itens={itens} total={total} avisar={avisar} aberta={fatura.status === "aberta"} />
          ) : (
            <ExtratoNovo itens={itens} fatura={fatura} cartao={cartao} rec={rec} avisar={avisar} />
          )}
        </>
      )}

      {fechando && fatura && (
        <FecharFaturaDialog
          fatura={fatura}
          cartao={cartao}
          versao={versao}
          onFechar={() => setFechando(false)}
          onConfirmar={(p) => {
            setFechando(false);
            onFechar(fatura, p);
          }}
        />
      )}
    </div>
  );
}

/** O extrato da fatura como está no ar (fatura-extrato.tsx). */
function ExtratoAtual({ itens, total, avisar, aberta }) {
  let acc = 0;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <Th>Data</Th>
            <Th alinhar="right">Crédito</Th>
            <Th alinhar="right">Débito</Th>
            <th className="px-3 py-2 text-right">Acumulado</th>
            <Th>Descrição</Th>
            <Th>Fornecedor</Th>
            <Th>Job</Th>
            <Th>Centro de Custo</Th>
            <Th alinhar="center">Trimestre</Th>
            <Th>Empresa</Th>
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2 text-center">Ação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => {
            acc = r2(acc + i.valor);
            const c = centroTexto(i.centro);
            return (
              <tr key={i.id} className={cn("border-b border-border last:border-0 hover:bg-muted/30", i.novo && "bg-yellow-50/60")}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(i.data)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{i.valor < 0 ? moeda(-i.valor) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{i.valor > 0 ? moeda(i.valor) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">{moeda(acc)}</td>
                <td className="px-3 py-2 text-xs">
                  {i.descricao}
                  {i.tipo === "ajuste" && <span className="ml-1.5 rounded bg-slate-200 px-1 text-[10px] text-slate-700">ajuste</span>}
                </td>
                <td className="px-3 py-2 text-xs">{i.fornecedor}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{i.job ? <span className="text-california-red">{i.job.codigo}</span> : <span className="font-sans italic text-muted-foreground/70">Não Vinculado</span>}</td>
                <td className="px-3 py-2 text-xs">
                  <span>{c.tipo}</span>
                  <span className="text-muted-foreground"> · {i.centro.sub}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">{trimestre(i.data)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{i.empresa}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-california-red/40 text-california-red">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <AcoesDoItem i={i} aberta={aberta} avisar={avisar} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-t-foreground bg-[#f3f2ee] text-xs">
            <td className="px-3 py-2.5 font-semibold" colSpan={3}>
              Total da fatura · {itens.length} itens
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold">{moeda(total)}</td>
            <td colSpan={8} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function AcoesDoItem({ i, aberta, avisar }) {
  const estornavel = aberta && (i.tipo === "avulso" || i.tipo === "recorrencia");
  return (
    <span className="inline-flex items-center gap-1">
      {estornavel && (
        <button
          type="button"
          title="Estornar compra"
          onClick={() => avisar(`No sistema, abre o estorno da compra ${i.codigo}: o crédito entra nesta fatura, no mesmo centro de custo.`)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-california-red"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
      {i.tipo !== "ajuste" && (
        <button
          type="button"
          title="Ver a baixa registrada"
          onClick={() => avisar(`No sistema, abre a baixa de ${i.codigo}${aberta ? ": dá para cancelar enquanto a fatura estiver aberta." : "."}`)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/** O extrato da fatura na planilha da conciliação. O tipo do item (PP,
 *  avulso, estorno, ajuste…) fica na etiqueta embaixo da descrição. */
function ExtratoNovo({ itens, fatura, cartao, rec, avisar }) {
  const detalhes = React.useContext(DetalhesContexto);
  const colReg = colunasDaRegional(detalhes.regional);
  const aberta = fatura.status === "aberta";
  const cols = [
    ["data", 104],
    ["credito", 116],
    ["debito", 116],
    ["acumulado", 116],
    ["descricao", null],
    ["fornecedor", 180],
    ["job", 104],
    ["centro", 168],
    ["trim", colReg.larguraTrimestre],
    ["empresa", 130],
    ...(colReg.comRegional ? [["regional", colReg.larguraRegional]] : []),
    ["acao", 96],
  ];
  let acc = 0;
  const linhas = itens.map((i) => ({ ...i, acc: (acc = r2(acc + i.valor)) }));
  const totalItens = acc;
  const pagamento = rec && fatura.status === "paga" ? { valor: fatura.valorCobrado, acc: r2(totalItens - fatura.valorCobrado) } : null;
  const creditos = r2(itens.filter((i) => i.valor < 0).reduce((s, i) => s - i.valor, 0));
  const debitos = r2(itens.filter((i) => i.valor > 0).reduce((s, i) => s + i.valor, 0));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1400px] table-fixed text-sm">
          <colgroup>
            {cols.map(([k, w]) => (
              <col key={k} style={w ? { width: w } : undefined} />
            ))}
          </colgroup>
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <Th>Data</Th>
              <Th alinhar="right">Crédito</Th>
              <Th alinhar="right">Débito</Th>
              <th className="px-3 py-3 text-right font-semibold" title="Débitos menos créditos, até a linha: é o que a fatura deve naquele ponto.">
                Acumulado
              </th>
              <Th>Descrição</Th>
              <Th>Fornecedor</Th>
              <Th>Job</Th>
              <Th>Centro de Custo</Th>
              <Th alinhar="center">{colReg.rotuloTrimestre}</Th>
              <Th>Empresa</Th>
              {colReg.comRegional && <Th>{colReg.rotuloRegional}</Th>}
              <th className="px-3 py-3 text-center font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((i) => {
              const c = centroTexto(i.centro);
              return (
                <tr key={i.id} className={cn("border-b border-border hover:bg-muted/30", i.novo && "bg-yellow-50/60")}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(i.data)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{i.valor < 0 ? moeda(-i.valor) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{i.valor > 0 ? moeda(i.valor) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">{moeda(i.acc)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="block break-words">{i.descricao}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                      <span className={cn("inline-block rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide", ITEM_TIPO[i.tipo]?.[1])}>{ITEM_TIPO[i.tipo]?.[0]}</span>
                      <span className="font-mono">{i.codigo}</span>
                      {i.estornoDe && <span>estorna {i.estornoDe}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="block truncate" title={i.fornecedor}>
                      {i.fornecedor}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {i.job ? (
                      <span className="text-california-red" title={i.job.nome}>
                        {i.job.codigo}
                      </span>
                    ) : (
                      <span className="font-sans italic text-muted-foreground/70">Não Vinculado</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <Dica conteudo={`${c.tipo} · ${i.centro.sub}`} className="block w-full truncate">
                      {c.tipo}
                    </Dica>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">{trimestre(i.data)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="block truncate">{i.empresa}</span>
                  </td>
                  {colReg.comRegional && <CelulaRegional rateio={regionalDe({ job: i.job, empresa: i.empresa, origem: i.tipo })} abreviada={colReg.abreviada} />}
                  <td className="px-2 py-2 text-center">
                    <AcoesDoItem i={i} aberta={aberta} avisar={avisar} />
                  </td>
                </tr>
              );
            })}
            {pagamento && (
              <tr className="border-b border-border bg-emerald-50/40 text-xs">
                <td className="whitespace-nowrap px-3 py-2 font-mono">{dataBR(fatura.pagaEm)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-emerald-700">{moeda(pagamento.valor)}</td>
                <td />
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold">{moeda(pagamento.acc)}</td>
                <td className="px-3 py-2">
                  Pagamento da fatura {fatura.codigo}
                  <span className="block text-[10.5px] text-muted-foreground">saiu da {nomeDaConta(fatura.pagaPor)}</span>
                </td>
                <td className="px-3 py-2">{cartao.banco}</td>
                <td className="px-3 py-2 italic text-muted-foreground/70">—</td>
                <td className="px-3 py-2 italic text-muted-foreground">
                  <span className="block truncate" title="Pagamento de fatura · fora do DRE (decisão 084)">
                    Fora do DRE
                  </span>
                </td>
                <td className="px-3 py-2 text-center font-mono text-muted-foreground">{trimestre(fatura.pagaEm)}</td>
                <td className="px-3 py-2">{cartao.empresa}</td>
                {colReg.comRegional && <td className="px-3 py-2 text-muted-foreground">—</td>}
                <td />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-t-foreground bg-[#f3f2ee] text-xs">
              <td className="whitespace-nowrap px-3 py-2.5 font-semibold">Total</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-emerald-700">{creditos ? moeda(creditos) : ""}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-california-red">{moeda(debitos)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold">{moeda(totalItens)}</td>
              <td colSpan={cols.length - 4} className="px-3 py-2.5 text-muted-foreground">
                Total da fatura · {itens.length} itens
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Fechar a fatura (fechar_fatura_cartao, decisão 084)
// ---------------------------------------------------------------------------

const numero = (s) => parseFloat(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;
const texto = (n) => n.toFixed(2).replace(".", ",");

function FecharFaturaDialog({ fatura, cartao, versao, onFechar, onConfirmar }) {
  const soma = totalDosItens(fatura.itens);
  const [cobrado, setCobrado] = React.useState(texto(soma));
  const [descricao, setDescricao] = React.useState("");
  const [valorAjuste, setValorAjuste] = React.useState("");
  const [centro, setCentro] = React.useState({ tipo: "04", sub: "Tarifa bancária" });
  const [erro, setErro] = React.useState(null);
  const dif = r2(numero(cobrado) - soma);
  const falta = r2(dif - numero(valorAjuste));

  function confirmar() {
    if (!cobrado) return setErro("Informe o valor cobrado pelo banco.");
    if (dif < -0.004) return setErro("O banco cobrou menos que a soma dos itens: registre o estorno da compra antes de fechar.");
    if (dif > 0.004) {
      if (!descricao.trim()) return setErro("Descreva o ajuste (ex.: IOF e anuidade).");
      if (Math.abs(falta) > 0.004) return setErro(`Falta distribuir ${moeda(falta)}.`);
    }
    onConfirmar({ valorCobrado: numero(cobrado), ajuste: dif > 0.004 ? { descricao: descricao.trim(), valor: dif, centro } : null });
  }

  return (
    <Dialogo
      aberto
      onFechar={onFechar}
      titulo={`Fechar a fatura ${fatura.codigo}`}
      icone={Lock}
      largura={680}
      descricao={`${cartao.nome} · ${rotuloCompetencia(fatura.competencia)} · fecha ${dataBR(fatura.fecha)}, vence ${dataBR(fatura.vence)}`}
      rodape={
        <>
          {erro && <span className="mr-auto text-xs font-semibold text-california-red">{erro}</span>}
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao onClick={confirmar}>Fechar fatura</Botao>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Soma dos itens ({fatura.itens.length})</p>
          <p className="font-mono text-base font-semibold">{moeda(soma)}</p>
        </div>
        <Campo label="Valor cobrado pelo banco" obrigatorio>
          <Entrada id="fechar-cobrado" value={cobrado} onChange={setCobrado} mono className="text-right" />
        </Campo>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Diferença</p>
          <p className={cn("font-mono text-base font-semibold", dif > 0.004 ? "text-amber-700" : dif < -0.004 ? "text-california-red" : "text-emerald-700")}>{moeda(dif)}</p>
        </div>
      </div>
      {dif > 0.004 && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs font-semibold text-amber-900">O banco cobrou {moeda(dif)} a mais que os itens: vira um item de ajuste da fatura, com centro de custo e regional.</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Campo label="Descrição" obrigatorio>
              <Entrada id="ajuste-descricao" value={descricao} onChange={setDescricao} placeholder="Ex.: IOF e anuidade" />
            </Campo>
            <Campo label="Valor" obrigatorio>
              <Entrada id="ajuste-valor" value={valorAjuste} onChange={setValorAjuste} placeholder={texto(dif)} mono className="text-right" />
            </Campo>
          </div>
          <Campo label="Centro de custo" obrigatorio ajuda="A regional vem rateada na proporção dos itens desta fatura.">
            <SeletorCentro valor={centro} onChange={setCentro} />
          </Campo>
          <p className={cn("text-xs font-semibold", Math.abs(falta) > 0.004 ? "text-amber-800" : "text-emerald-700")}>
            {Math.abs(falta) > 0.004 ? `Falta distribuir ${moeda(falta)}` : "Diferença distribuída ✓"}
          </p>
        </div>
      )}
      {dif < -0.004 && <Nota tom="ambar">O banco cobrou menos que a soma dos itens. Fechar com valor menor não é aceito: registre o estorno da compra (↺ na linha do item) e feche de novo.</Nota>}
      {versao !== "atual" && (
        <Nota tom="azul" icone={Info}>
          Ao fechar, a fatura vira <strong>um título só</strong> em Títulos a Pagar, com vencimento em {dataBR(fatura.vence)}. É a baixa dele que tira o dinheiro do banco; no Extrato, a linha do pagamento abre nos itens. O pagamento fica fora do DRE: entram os itens e o ajuste, cada um no seu centro de custo.
        </Nota>
      )}
    </Dialogo>
  );
}
