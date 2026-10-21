"use client";

/**
 * A planilha de títulos (decisão 195, task 029 fase 1): a mesma grade em
 * Conciliação › Títulos, Contas a Pagar, Contas a Receber e Impostos a
 * Pagar — caixa · Data · Crédito · Débito · (Saldo previsto) · Descrição ·
 * Fornecedor/Cliente · Job · Centro de Custo · TRI · Empresa · REG ·
 * (Status) · Ação —, em `table-fixed` com `colgroup`.
 *
 * Cada linha é o lançamento que a baixa vai gravar. A tela monta as linhas
 * (`LinhaDaPlanilha`, `lib/financeiro/planilha-de-titulos.ts`) e entrega a
 * seleção, os filtros pelo título e as ações; a planilha só desenha.
 *
 * Regras do protótipo aprovado (titulos.jsx, `PlanilhaDeTitulos`):
 *   * só a caixa seleciona: o clique no resto da linha abre as dicas;
 *   * o valor vai na coluna do sentido do dinheiro no banco; a
 *     transferência, nos módulos, nas duas colunas, em cinza e fora do
 *     total, com a dica no próprio valor;
 *   * retenção e baixa parcial moram num ícone à esquerda do valor;
 *   * o Centro de Custo mostra só o tipo; a REG, a sigla ou "TD";
 *   * "Baixar" encostado à esquerda da Ação, a 6px da borda, e o ⓘ a 8px.
 */

import * as React from "react";
import { ArrowLeftRight, ChevronDown, CreditCard, Eye, Landmark, Pencil, Receipt, Undo2 } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { FAIXA_GRUPO_LISTA, TOTAL_LISTA } from "@/app/(app)/_planilha/blocos";
import {
  agruparPorDia,
  colunaDoValor,
  dataEfetiva,
  situacaoDaData,
  textoDaRegional,
  totalDaPlanilha,
  trimestreDe,
  type ItemDaFatura,
  type LinhaDaPlanilha,
  type ParteDoRateio,
  type TomDaEtiqueta,
} from "@/lib/financeiro/planilha-de-titulos";
import { colunasDaGrade, ROTULO_DO_STATUS, type ChaveDaColuna } from "./colunas";

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------

export function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function diaDaSemana(iso: string): string {
  return DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

export const TOM_DA_ETIQUETA: Record<TomDaEtiqueta, string> = {
  neutro: "border-border bg-muted text-muted-foreground",
  violeta: "border-violet-200 bg-violet-50 text-violet-700",
  azul: "border-blue-200 bg-blue-50 text-blue-700",
  rosa: "border-rose-200 bg-rose-50 text-rose-700",
  ambar: "border-amber-200 bg-amber-50 text-amber-800",
  verde_agua: "border-teal-200 bg-teal-50 text-teal-700",
  ardosia: "border-slate-300 bg-slate-100 text-slate-700",
  vermelho: "border-red-200 bg-red-50 text-california-red",
  verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ceu: "border-sky-200 bg-sky-50 text-sky-700",
};

/** A etiqueta de cada tipo de item da fatura (a planilha e o extrato da
 *  fatura, decisão 197). */
export const ITEM_TIPO: Record<ItemDaFatura["tipo"], [string, string]> = {
  pp: ["PP", "border-border bg-white text-muted-foreground"],
  avulso: ["Avulso", "border-violet-200 bg-violet-50 text-violet-700"],
  recorrencia: ["Recorrência", "border-blue-200 bg-blue-50 text-blue-700"],
  desembolso: ["Desembolso", "border-amber-200 bg-amber-50 text-amber-800"],
  estorno: ["Estorno", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  ajuste: ["Ajuste", "border-slate-300 bg-slate-100 text-slate-700"],
};

// ---------------------------------------------------------------------------
// A planilha
// ---------------------------------------------------------------------------

export interface PropsDaPlanilha<L extends LinhaDaPlanilha> {
  /** Já filtradas e na ordem; com `saldo` quando a tela mostra o saldo
   *  previsto (calculado antes do filtro). */
  linhas: Array<L & { saldo?: number }>;
  /** A conta da conciliação; `null` nos módulos, que não têm conta. */
  contaId: string | null;
  hoje: string;
  mostrarSaldo?: boolean;
  agruparPorDia?: boolean;
  colunaStatus?: boolean;
  creditoFino?: boolean;
  /** O título de cada coluna com o filtro (`useFiltrosDeColuna().titulo`). */
  titulo: (chave: Exclude<ChaveDaColuna, "sel" | "saldo" | "acao">) => React.ReactNode;
  cabecalhoDaSelecao: React.ReactNode;
  caixa: (l: L) => React.ReactNode;
  onBaixar: (l: L) => void;
  onEditarData: (l: L) => void;
  onVerBaixas: (l: L) => void;
  /** O ⓘ da linha. */
  detalhes: (l: L) => React.ReactNode;
  /** O título que o motor achou numa linha do extrato do banco ainda não
   *  conciliada (decisão 202): a faixa verde na borda, o ícone do banco ao
   *  lado da data e o "Baixar" com a data e o valor do banco. */
  sinalDoBanco?: (l: L) => SinalDoBanco | null;
  saldoHoje?: number;
  vazio: string;
}

/** O motivo do motor como frase: maiúscula no começo e ponto no fim. */
const frase = (s: string) => {
  const t = s.trim().replace(/\.$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
};

/** O título já está no extrato do banco importado (decisão 202). */
export interface SinalDoBanco {
  /** O dia da linha do banco. */
  data: string;
  /** Por que o motor achou (o motivo da sugestão). */
  motivo: string;
}

export function PlanilhaDeTitulos<L extends LinhaDaPlanilha>(p: PropsDaPlanilha<L>) {
  const grade = colunasDaGrade({ saldo: !!p.mostrarSaldo, status: !!p.colunaStatus, creditoFino: !!p.creditoFino });
  const chaves = grade.map(([k]) => k);
  const [comItens, setComItens] = React.useState<Set<string>>(() => new Set());
  const alternarItens = (chave: string) =>
    setComItens((atual) => {
      const n = new Set(atual);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  const grupos = p.agruparPorDia ? agruparPorDia(p.linhas, p.hoje) : [{ data: "", linhas: p.linhas }];
  const total = totalDaPlanilha(p.linhas, p.contaId);
  const ultimo = p.linhas[p.linhas.length - 1];

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1480px] table-fixed text-sm">
        <colgroup>
          {grade.map(([k, w]) => (
            <col key={k} style={w ? { width: w } : undefined} />
          ))}
        </colgroup>
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pl-3 pr-1 text-center">{p.cabecalhoDaSelecao}</th>
            <th className="px-3 py-3 text-left font-semibold">{p.titulo("data")}</th>
            <th
              className={cn("py-3 font-semibold", p.creditoFino ? "px-1 text-center" : "px-3 text-right")}
              title={p.creditoFino ? "Nenhum título deste módulo entra na conta como crédito." : undefined}
            >
              {p.creditoFino ? "Crédito" : p.titulo("credito")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">{p.titulo("debito")}</th>
            {p.mostrarSaldo && (
              <th
                className="px-3 py-3 text-right font-semibold"
                title="Saldo desta conta se cada título for baixado nela, na data prevista. O vencido entra como hoje. Não muda com o filtro, como o Saldo do Extrato."
              >
                Saldo previsto
              </th>
            )}
            <th className="px-3 py-3 text-left font-semibold">{p.titulo("descricao")}</th>
            <th className="px-3 py-3 text-left font-semibold">{p.titulo("contraparte")}</th>
            <th className="px-3 py-3 text-left font-semibold">{p.titulo("job")}</th>
            <th className="px-3 py-3 text-left font-semibold">{p.titulo("centro")}</th>
            <th className="px-3 py-3 text-center font-semibold">{p.titulo("tri")}</th>
            <th className="px-3 py-3 text-left font-semibold">{p.titulo("empresa")}</th>
            <th className="px-3 py-3 text-left font-semibold">{p.titulo("reg")}</th>
            {p.colunaStatus && <th className="px-3 py-3 text-center font-semibold">{p.titulo("status")}</th>}
            <th className="px-3 py-3 text-left font-semibold">Ação</th>
          </tr>
        </thead>
        <tbody>
          {p.linhas.length === 0 && (
            <tr>
              <td colSpan={grade.length} className="px-3 py-12 text-center text-sm text-muted-foreground">
                {p.vazio}
              </td>
            </tr>
          )}
          {grupos.map((g) => (
            <React.Fragment key={g.data || "_"}>
              {p.agruparPorDia && <FaixaDoDia data={g.data} linhas={g.linhas} chaves={chaves} hoje={p.hoje} contaId={p.contaId} />}
              {g.linhas.map((l) => (
                <React.Fragment key={l.chave}>
                  <LinhaDaTabela
                    l={l}
                    p={p}
                    itensAbertos={comItens.has(l.chave)}
                    onItens={() => alternarItens(l.chave)}
                  />
                  {l.itensDaFatura.length > 0 && comItens.has(l.chave) && (
                    <LinhasDosItens itens={l.itensDaFatura} chaves={chaves} />
                  )}
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
        </tbody>
        {p.linhas.length > 0 && (
          <tfoot>
            <tr className={cn(TOTAL_LISTA, "text-xs")}>
              <td />
              <td className="whitespace-nowrap px-3 py-2.5 font-semibold">Total</td>
              {p.creditoFino ? (
                <td className="px-1 py-2.5 text-center text-muted-foreground/40">—</td>
              ) : (
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-emerald-700">
                  {total.credito > 0 ? formatBRL(total.credito) : ""}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-california-red">
                {total.debito > 0 ? formatBRL(total.debito) : ""}
              </td>
              {p.mostrarSaldo && (
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold",
                    (ultimo?.saldo ?? 0) < 0 && "text-california-red",
                  )}
                >
                  {ultimo?.saldo !== undefined ? formatBRL(ultimo.saldo) : ""}
                </td>
              )}
              <td colSpan={grade.length - (p.mostrarSaldo ? 5 : 4)} className="px-3 py-2.5 text-muted-foreground">
                {p.linhas.length} {p.linhas.length === 1 ? "título" : "títulos"}
                {total.transferencias > 0 && <> · transferência entre contas fora do total: {formatBRL(total.transferencias)}</>}
                {p.mostrarSaldo && p.saldoHoje !== undefined && <> · saldo de hoje {formatBRL(p.saldoHoje)}</>}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A faixa do dia (agrupar por dia)
// ---------------------------------------------------------------------------

function FaixaDoDia({
  data,
  linhas,
  chaves,
  hoje,
  contaId,
}: {
  data: string;
  linhas: Array<LinhaDaPlanilha & { saldo?: number; efeito?: number }>;
  chaves: ChaveDaColuna[];
  hoje: string;
  contaId: string | null;
}) {
  const t = totalDaPlanilha(linhas, contaId);
  const saldo = linhas[linhas.length - 1]?.saldo;
  const vencidos = linhas.filter((l) => !l.pagoEm && (l.vencimento ?? l.dataPrevista ?? hoje) < hoje).length;
  const eHoje = data === hoje;
  return (
    <tr className={cn(FAIXA_GRUPO_LISTA, "text-xs")}>
      {chaves.map((k) => {
        if (k === "data")
          return (
            <td key={k} className="whitespace-nowrap px-3 py-1.5 font-semibold">
              {eHoje ? "Hoje" : dataBR(data).slice(0, 5)}
            </td>
          );
        if (k === "credito")
          return (
            <td key={k} className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-800">
              {t.credito > 0 ? formatBRL(t.credito) : ""}
            </td>
          );
        if (k === "debito")
          return (
            <td key={k} className="px-3 py-1.5 text-right font-mono font-semibold text-[#b3323c]">
              {t.debito > 0 ? formatBRL(t.debito) : ""}
            </td>
          );
        if (k === "saldo")
          return (
            <td key={k} className={cn("px-3 py-1.5 text-right font-mono font-semibold", (saldo ?? 0) < 0 && "text-california-red")}>
              {saldo !== undefined ? formatBRL(saldo) : ""}
            </td>
          );
        if (k === "descricao")
          return (
            <td key={k} className="px-3 py-1.5 text-[#5f5d57]">
              <span className="capitalize">{diaDaSemana(data)}</span> · {linhas.length} {linhas.length === 1 ? "título" : "títulos"}
              {eHoje && vencidos > 0 && (
                <span className="font-semibold text-california-red">
                  {" "}
                  · {vencidos} {vencidos === 1 ? "vencido entra" : "vencidos entram"} aqui
                </span>
              )}
              {saldo !== undefined && saldo < 0 && <span className="font-semibold text-california-red"> · a conta fica negativa</span>}
            </td>
          );
        return <td key={k} />;
      })}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// A linha
// ---------------------------------------------------------------------------

function LinhaDaTabela<L extends LinhaDaPlanilha>({
  l,
  p,
  itensAbertos,
  onItens,
}: {
  l: L & { saldo?: number };
  p: PropsDaPlanilha<L>;
  itensAbertos: boolean;
  onItens: () => void;
}) {
  const { coluna } = colunaDoValor(l, p.contaId);
  const modulo = p.contaId === null;
  const transferenciaNoModulo = modulo && l.transferencia !== null;
  // Na conta, o título que entra noutra (o rendimento da aplicação) não
  // mexe no saldo desta.
  const outraConta =
    !modulo &&
    !l.pagoEm &&
    ((l.contaFixa !== null && l.contaFixa !== p.contaId) ||
      (l.transferencia !== null &&
        l.transferencia.origemContaId !== p.contaId &&
        l.transferencia.destinoContaId !== p.contaId));
  const cancelado = l.status === "cancelado";
  const situacao = cancelado ? ({ tipo: "em_dia" } as const) : situacaoDaData(l, p.hoje);
  const atrasado = situacao.tipo === "vencido" || situacao.tipo === "depois_do_vencimento";
  const recebe = l.entra || (l.transferencia !== null && l.transferencia.destinoContaId === p.contaId);
  const { texto: textoReg, dica: dicaReg, rateado } = textoDaRegional(l.rateio);
  const sinal = !l.pagoEm && !cancelado ? (p.sinalDoBanco?.(l) ?? null) : null;

  const celulaDoValor = (lado: "credito" | "debito") => {
    if (lado === "credito" && p.creditoFino) {
      return <td className="px-1 py-2 text-center text-muted-foreground/40">—</td>;
    }
    const mostra = coluna === "ambas" || coluna === lado;
    if (!mostra) {
      return modulo ? (
        <td className="px-1 py-2 text-center text-muted-foreground/40">—</td>
      ) : (
        <td className="px-3 py-2" />
      );
    }
    return (
      <td
        className={cn(
          "whitespace-nowrap px-3 py-2 text-right font-mono text-xs",
          outraConta || transferenciaNoModulo
            ? "text-muted-foreground"
            : lado === "credito"
              ? "text-emerald-700"
              : "text-california-red",
          outraConta && "opacity-60",
        )}
      >
        <span className="inline-flex items-center justify-end gap-1">
          {(l.valor.retencoes.length > 0 || l.valor.baixado > 0 || l.valor.estornado > 0) && (
            <Dica
              conteudo={<ValorDestrinchado l={l} />}
              rotulo={
                l.valor.baixado > 0
                  ? "Baixa parcial: ver o valor destrinchado"
                  : l.valor.retencoes.length > 0
                    ? "Retido na fonte: ver o valor destrinchado"
                    : "Estornado: ver o valor destrinchado"
              }
            >
              <Receipt
                className={cn(
                  "h-3.5 w-3.5",
                  l.valor.baixado > 0 ? "text-sky-600" : l.valor.retencoes.length > 0 ? "text-amber-600" : "text-rose-600",
                )}
              />
            </Dica>
          )}
          {l.origem === "verba" && (
            <Dica
              rotulo="Estorno de verba"
              conteudo={
                <>
                  <strong>Estorno de verba.</strong> A sobra que o responsável devolve: entra na conta, e o Extrato vai
                  mostrá-la no Crédito. No DRE é despesa negativa: abate o custo da PP
                  {l.centro.tipo === "plano" ? ` em ${l.centro.rotulo}` : ""}.
                </>
              }
            >
              <Undo2 className="h-3.5 w-3.5 text-teal-700" />
            </Dica>
          )}
          {l.cartaoPrevisto && !l.pagoEm && (
            <Dica
              rotulo="Aprovado para pagar no cartão"
              conteudo={
                <>
                  <strong>Aprovado para pagar no cartão {l.cartaoPrevisto}.</strong> É só a intenção: o item só entra
                  numa fatura quando a baixa for no cartão.
                </>
              }
            >
              <CreditCard className="h-3.5 w-3.5 text-violet-600" />
            </Dica>
          )}
          {l.transferencia && (transferenciaNoModulo || outraConta) ? (
            // A dica fica no próprio valor: o ícone não cabe ao lado de
            // R$ 150.000,00 na coluna.
            <Dica
              className="underline decoration-dotted underline-offset-2"
              conteudo={
                transferenciaNoModulo ? (
                  <>
                    <strong>Transferência entre contas.</strong>{" "}
                    {lado === "debito" ? `Sai de ${l.transferencia.origemNome}` : `Entra em ${l.transferencia.destinoNome}`}. As
                    duas pernas, como o Extrato de cada conta vai mostrar. Não é receita nem despesa: fica fora dos totais.
                  </>
                ) : (
                  <>
                    <strong>Transferência entre contas.</strong> Sai de {l.transferencia.origemNome} e entra em{" "}
                    {l.transferencia.destinoNome}: não mexe no saldo desta conta.
                  </>
                )
              }
            >
              {formatBRL(l.valor.conta)}
            </Dica>
          ) : (
            <span title={outraConta ? "Entra em outra conta: não mexe no saldo desta." : undefined}>
              {formatBRL(l.valor.conta)}
            </span>
          )}
        </span>
        {outraConta && <span className="block font-sans text-[10px] italic">em outra conta</span>}
      </td>
    );
  };

  return (
    <tr className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
      <td className={cn("py-2 pl-3 pr-1 text-center", sinal && "shadow-[inset_3px_0_0_0_#10b981]")}>
        {!l.pagoEm && !cancelado && p.caixa(l)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="inline-flex items-center gap-1.5">
          {l.editaData && !l.pagoEm && !cancelado && (
            <button
              type="button"
              title={recebe ? "Editar data prevista de recebimento" : "Editar data prevista de pagamento"}
              aria-label={recebe ? "Editar data prevista de recebimento" : "Editar data prevista de pagamento"}
              onClick={(e) => {
                e.stopPropagation();
                p.onEditarData(l);
              }}
              className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-california-red"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          <span className={cn("font-mono text-xs", atrasado && "font-semibold text-california-red")}>
            {l.pagoEm ? dataBR(l.pagoEm) : l.dataPrevista ? dataBR(l.dataPrevista) : "—"}
          </span>
          {sinal && (
            <Dica
              rotulo="Já está no extrato do banco"
              conteudo={
                <>
                  <strong>No extrato do banco de {dataBR(sinal.data)}.</strong> {frase(sinal.motivo)} “
                  {l.transferencia ? "Registrar" : "Baixar"}” já vem com a data e o valor do banco, e a baixa sai conciliada.
                </>
              }
            >
              <Landmark className="h-3.5 w-3.5 text-emerald-600" />
            </Dica>
          )}
        </span>
        {/* Embaixo da data prevista, só quando ela difere do vencimento, ou
            quando o título venceu (há quantos dias). */}
        {situacao.tipo === "vencido" ? (
          <span className={cn("block text-[10px] font-semibold text-california-red", l.editaData && "pl-[18px]")}>
            venceu há {situacao.dias} {situacao.dias === 1 ? "dia" : "dias"}
          </span>
        ) : situacao.tipo === "depois_do_vencimento" ? (
          <span
            className={cn("block text-[10px] font-semibold text-california-red", l.editaData && "pl-[18px]")}
            title={
              recebe
                ? "A data prevista é depois do vencimento: o cliente fica em atraso."
                : "A data prevista é depois do vencimento: a baixa vai pedir a multa e os juros."
            }
          >
            venc. {dataBR(situacao.vencimento).slice(0, 5)}
            <span className="block font-normal">{recebe ? "atraso do cliente" : "multa e juros"}</span>
          </span>
        ) : situacao.tipo === "antes_do_vencimento" ? (
          <span className={cn("block text-[10px] text-amber-700", l.editaData && "pl-[18px]")}>
            venc. {dataBR(situacao.vencimento).slice(0, 5)}
          </span>
        ) : null}
      </td>
      {celulaDoValor("credito")}
      {celulaDoValor("debito")}
      {p.mostrarSaldo && (
        <td
          className={cn(
            "whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold",
            (l.saldo ?? 0) < 0 && "text-california-red",
          )}
        >
          {outraConta || l.saldo === undefined ? <span className="text-muted-foreground/50">—</span> : formatBRL(l.saldo)}
        </td>
      )}
      <td className="px-3 py-2 text-xs">
        <span className="block break-words">
          {l.urgente && (
            <span className="mr-1.5 inline-block rounded-md bg-california-red px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white">
              Urgente
            </span>
          )}
          {l.descricao}
        </span>
        {/* A justificativa da aprovação (decisão 077) — some quando o título
            é pago. */}
        {l.urgente?.justificativa && (
          <span title={l.urgente.justificativa} className="line-clamp-2 text-[11px] leading-snug text-california-red">
            “{l.urgente.justificativa}”
          </span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span
            className={cn(
              "inline-block whitespace-nowrap rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide",
              TOM_DA_ETIQUETA[l.etiqueta.tom],
            )}
          >
            {l.etiqueta.texto}
          </span>
          {l.complementos.map((c) => (
            <span key={c}>{c}</span>
          ))}
          {l.bv && (
            <Dica
              conteudo={
                <>
                  <strong>BV (bonificação de volume).</strong> O veículo paga à agência: entra na conta, e o Extrato vai
                  mostrá-lo no Crédito. No DRE vira custo negativo da mídia do job (decisão 184, ainda pendente).
                </>
              }
            >
              <span className="inline-block rounded border border-teal-200 bg-teal-50 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-teal-700">
                BV
              </span>
            </Dica>
          )}
          {l.itensDaFatura.length > 0 && (
            <button
              type="button"
              onClick={onItens}
              aria-expanded={itensAbertos}
              className="inline-flex items-center gap-0.5 rounded px-1 font-semibold text-california-red hover:bg-california-red/5"
            >
              {l.itensDaFatura.length} {l.itensDaFatura.length === 1 ? "item" : "itens"}
              <ChevronDown className={cn("h-3 w-3 transition-transform", itensAbertos && "rotate-180")} />
            </button>
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="block truncate" title={l.contraparte}>
          {l.contraparte}
          {/* Asterisco da decisão 067: o cadastro de hoje já não é o que este
              pedido manda pagar. */}
          {l.avisoDaContraparte && (
            <Dica conteudo={l.avisoDaContraparte} rotulo="O cadastro do fornecedor mudou depois desta PP" className="ml-1 inline font-bold text-amber-600">
              *
            </Dica>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
        {l.job ? (
          <span className="block truncate text-california-red" title={l.job.nome || l.job.codigo}>
            {l.job.codigo}
          </span>
        ) : l.jobsDaFatura.length > 0 ? (
          <Dica conteudo={l.jobsDaFatura.join(" · ")} className="font-sans underline decoration-dotted underline-offset-2">
            {l.jobsDaFatura.length} {l.jobsDaFatura.length === 1 ? "job" : "jobs"}
          </Dica>
        ) : (
          <span className="font-sans italic text-muted-foreground/70">Não Vinculado</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        <CelulaDoCentro l={l} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">
        {trimestreDe(dataEfetiva(l, p.hoje))}
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="block truncate" title={l.empresa ?? undefined}>
          {l.empresa ?? "—"}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
        {textoReg === "—" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Dica conteudo={dicaReg} className={cn(rateado && "underline decoration-dotted underline-offset-2")}>
            {textoReg}
          </Dica>
        )}
      </td>
      {p.colunaStatus && (
        <td className="px-2 py-2 text-center">
          <SeloDoStatus l={l} />
        </td>
      )}
      <td className="py-2 pl-1.5 pr-2">
        <span className="flex items-center justify-start gap-2">
          {cancelado ? null : l.pagoEm ? (
            <button
              type="button"
              title="Ver as baixas registradas — estornar ou cancelar, se preciso"
              aria-label="Ver as baixas registradas"
              onClick={(e) => {
                e.stopPropagation();
                p.onVerBaixas(l);
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                p.onBaixar(l);
              }}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] font-semibold text-white",
                sinal ? "bg-emerald-700 hover:bg-emerald-800" : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              {/* O título ainda não teve baixa: mesmo com o banco mostrando o
                  pagamento, a ação é dar a baixa (que já sai conciliada). */}
              {sinal ? (
                <Landmark className="h-3 w-3" />
              ) : l.transferencia ? (
                <ArrowLeftRight className="h-3 w-3" />
              ) : (
                <CreditCard className="h-3 w-3" />
              )}
              {l.transferencia ? "Registrar" : "Baixar"}
            </button>
          )}
          {p.detalhes(l)}
        </span>
      </td>
    </tr>
  );
}

function CelulaDoCentro({ l }: { l: LinhaDaPlanilha }) {
  switch (l.centro.tipo) {
    case "fora_do_dre":
      return (
        <span className="block truncate italic text-muted-foreground" title="Transferência entre contas · fora do DRE">
          Fora do DRE
        </span>
      );
    case "itens_da_fatura":
      return (
        <Dica
          conteudo={<CentrosDaFatura centros={l.centro.centros} />}
          className="block w-full truncate italic text-muted-foreground underline decoration-dotted underline-offset-2"
        >
          Itens da fatura
        </Dica>
      );
    case "plano":
      return (
        <Dica conteudo={l.centro.completo} className="block w-full truncate">
          {l.centro.rotulo}
        </Dica>
      );
    default:
      return (
        <span className="block truncate italic text-amber-700" title="O centro de custo se escolhe na baixa.">
          definir na baixa
        </span>
      );
  }
}

/** O pagamento da fatura fica fora do DRE (decisão 084): quem entra são os
 *  itens, cada um no centro de custo dele. */
export function CentrosDaFatura({ centros }: { centros: Array<{ rotulo: string; valor: number }> }) {
  return (
    <div className="min-w-[250px] space-y-0.5 font-sans not-italic">
      <p className="mb-1 text-white/75">O pagamento fica fora do DRE; os itens entram, cada um no seu centro de custo:</p>
      {centros.map((c) => (
        <div key={c.rotulo} className="flex justify-between gap-4">
          <span>{c.rotulo}</span>
          <span className="font-mono">{c.valor < 0 ? `−${formatBRL(-c.valor)}` : formatBRL(c.valor)}</span>
        </div>
      ))}
    </div>
  );
}

/** O valor destrinchado: bruto, cada retenção, o que já foi baixado e o que
 *  sai (ou entra) na conta. */
function ValorDestrinchado({ l }: { l: LinhaDaPlanilha }) {
  const linhas: Array<[string, number]> = [
    ["Valor bruto", l.valor.bruto],
    ...l.valor.retencoes.map((r): [string, number] => [`(−) ${r.rotulo}`, r.valor]),
    ...(l.valor.baixado > 0 ? ([["(−) Já baixado", l.valor.baixado]] as Array<[string, number]>) : []),
  ];
  const daAprovacao = l.valor.baixado === 0 && l.valor.retencoes.length > 0;
  return (
    <div className="min-w-[230px] space-y-0.5 font-sans">
      {linhas.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-white/75">{k}</span>
          <span className="font-mono">{formatBRL(Math.abs(v))}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-white/20 pt-1 font-semibold">
        <span>{l.pagoEm ? (l.entra ? "Entrou na conta" : "Saiu da conta") : l.valor.baixado > 0 ? "Falta" : l.entra ? "Entra na conta" : "Sai da conta"}</span>
        <span className="font-mono">{formatBRL(l.valor.conta)}</span>
      </div>
      {l.valor.estornado > 0 && (
        <div className="flex justify-between gap-4 text-rose-200">
          <span>Estornado depois da baixa</span>
          <span className="font-mono">{formatBRL(l.valor.estornado)}</span>
        </div>
      )}
      {daAprovacao && (
        <p className="pt-1 text-[10.5px] text-white/60">As retenções da aprovação da PP: viram guias a recolher na baixa.</p>
      )}
    </div>
  );
}

const BASE_DO_SELO = "inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";
const COR_DO_STATUS: Record<LinhaDaPlanilha["status"], string> = {
  a_pagar: "border-amber-200 bg-[#fffbeb] text-[#92400e]",
  em_aberto: "border-amber-200 bg-[#fffbeb] text-[#92400e]",
  parcial: "border-sky-200 bg-sky-50 text-sky-700",
  pago: "border-emerald-200 bg-emerald-50 text-emerald-700",
  recebido: "border-emerald-200 bg-emerald-50 text-emerald-700",
  devolvido: "border-emerald-200 bg-emerald-50 text-emerald-700",
  transferido: "border-emerald-200 bg-emerald-50 text-emerald-700",
  no_cartao: "border-violet-200 bg-violet-50 text-violet-700",
  a_devolver: "border-teal-200 bg-teal-50 text-teal-700",
  a_transferir: "border-amber-200 bg-amber-50 text-amber-800",
  inadimplente: "border-red-200 bg-red-50 text-[#b3323c]",
  vencido: "border-red-200 bg-red-50 text-[#b3323c]",
  cancelado: "border-border bg-muted text-muted-foreground",
};

export function SeloDoStatus({ l }: { l: LinhaDaPlanilha }) {
  // Verba paga: o status é o da prestação (decisão 081).
  if (l.situacaoDaVerba) {
    return <SituacaoVerbaChip situacao={l.situacaoDaVerba} className="whitespace-normal text-center leading-tight" />;
  }
  return (
    <span
      className={cn(BASE_DO_SELO, COR_DO_STATUS[l.status])}
      title={l.status === "no_cartao" ? "Pago no cartão: entrou na fatura" : undefined}
    >
      {ROTULO_DO_STATUS[l.status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Os itens da fatura, embaixo da linha dela
// ---------------------------------------------------------------------------

/** Os itens de uma fatura de cartão nas mesmas colunas da planilha: é o que
 *  o pagamento da fatura paga, e de onde vem o DRE. `chaves` são as colunas
 *  da tabela. */
export function LinhasDosItens({ itens, chaves }: { itens: ItemDaFatura[]; chaves: ChaveDaColuna[] }) {
  const ordenados = [...itens].sort((a, b) => a.data.localeCompare(b.data));
  return (
    <>
      {ordenados.map((i) => (
        <tr key={i.id} className="border-b border-dashed border-border/70 bg-slate-50/70 text-[11px] text-muted-foreground">
          {chaves.map((k) => {
            switch (k) {
              case "data":
                return (
                  <td key={k} className="whitespace-nowrap py-1.5 pl-6 pr-3 font-mono">
                    ↳ {dataBR(i.data).slice(0, 5)}
                  </td>
                );
              case "credito":
                return (
                  <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-emerald-700/80">
                    {i.valor < 0 ? formatBRL(-i.valor) : ""}
                  </td>
                );
              case "debito":
                return (
                  <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-[#b3323c]/80">
                    {i.valor > 0 ? formatBRL(i.valor) : ""}
                  </td>
                );
              case "descricao":
                return (
                  <td key={k} className="px-3 py-1.5">
                    <span className="text-foreground/80">{i.descricao}</span>{" "}
                    <span className={cn("ml-1 inline-block rounded border px-1 py-px text-[9px] font-bold uppercase", ITEM_TIPO[i.tipo][1])}>
                      {ITEM_TIPO[i.tipo][0]}
                    </span>{" "}
                    {i.codigo && <span className="font-mono text-[10px]">{i.codigo}</span>}
                  </td>
                );
              case "contraparte":
                return (
                  <td key={k} className="px-3 py-1.5">
                    <span className="block truncate">{i.fornecedor ?? "—"}</span>
                  </td>
                );
              case "job":
                return (
                  <td key={k} className="whitespace-nowrap px-3 py-1.5 font-mono">
                    {i.job ? <span className="text-california-red/80">{i.job}</span> : <span className="font-sans italic text-muted-foreground/60">—</span>}
                  </td>
                );
              case "centro":
                return (
                  <td key={k} className="px-3 py-1.5">
                    {i.centro ? (
                      <Dica conteudo={i.centro.completo} className="block w-full truncate">
                        {i.centro.rotulo}
                      </Dica>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              case "tri":
                return (
                  <td key={k} className="whitespace-nowrap px-3 py-1.5 text-center font-mono">
                    {trimestreDe(i.data)}
                  </td>
                );
              case "empresa":
                return (
                  <td key={k} className="px-3 py-1.5">
                    <span className="block truncate">{i.empresa ?? "—"}</span>
                  </td>
                );
              case "reg":
                return <CelulaRegionalDoItem key={k} rateio={i.rateio} />;
              default:
                return <td key={k} />;
            }
          })}
        </tr>
      ))}
    </>
  );
}

function CelulaRegionalDoItem({ rateio }: { rateio: ParteDoRateio[] }) {
  const { texto, dica, rateado } = textoDaRegional(rateio);
  return (
    <td className="whitespace-nowrap px-3 py-1.5 font-mono">
      {texto === "—" ? (
        "—"
      ) : (
        <Dica conteudo={dica} className={cn(rateado && "underline decoration-dotted underline-offset-2")}>
          {texto}
        </Dica>
      )}
    </td>
  );
}
