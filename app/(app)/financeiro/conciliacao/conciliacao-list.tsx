"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCheck, ChevronDown, CreditCard, ExternalLink, Info, Lock, Upload } from "lucide-react";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";
import type { DetalheDoImposto } from "@/lib/data/imposto-extrato";
import { Dica } from "@/components/ui/dica";
import { BotaoDetalhes } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import { CentrosDaFatura, LinhasDosItens } from "@/components/financeiro/planilha-de-titulos/planilha";
import { colunasDoExtratoNaGrade } from "@/components/financeiro/planilha-de-titulos/colunas";
import { FAIXA_GRUPO_LISTA, TOTAL_LISTA } from "@/app/(app)/_planilha/blocos";
import { agruparFolhaNoExtrato, type ItemDoExtrato } from "@/lib/financeiro/folha-no-extrato";
import {
  centrosDosItens,
  jobsDosItens,
  juntarRateio,
  rateioPonderado,
  siglaDaRegional,
  textoDaRegional,
  type ItemDaFatura,
  type ParteDoRateio,
} from "@/lib/financeiro/planilha-de-titulos";
import { gravarPrevia, lerPrevia, type LinhaPrevista } from "./previa-do-extrato";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { abrirDocumentoDoLancamento } from "./actions-documento";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type CelulaDaColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

/**
 * As colunas do extrato que filtram e ordenam pelo título, como no Excel
 * (pedido do Tiago, 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job). Servem
 * à planilha da conciliação e à fatura do cartão (`fatura-extrato.tsx`),
 * que têm as MESMAS colunas: a fatura é o extrato da conta-espelho.
 *
 * Ficam SEM filtro e sem ordem:
 *   * Saldo (aqui) e Acumulado (na fatura): é o saldo CORRENTE do extrato,
 *     que só existe na ordem do banco. Com filtro ou ordem, cada linha
 *     continua mostrando o saldo dela no extrato — não se recalcula sobre
 *     o que sobrou, porque esse número não existiria no banco;
 *   * o botão de detalhes (ⓘ) e, na fatura, a coluna Ação.
 *
 * O período (de/até) continua no SERVIDOR: os títulos filtram dentro do
 * período carregado.
 *
 * Linhas expansíveis (o pagamento da fatura de cartão e a guia de imposto):
 * o filtro olha só a linha de cima — o lançamento do banco. As sublinhas
 * acompanham a linha delas: aparecem inteiras quando ela fica, e não
 * levantam a linha quando só elas bateriam (o fornecedor de um item de
 * dentro da fatura não acha o pagamento da fatura).
 */
export function colunasDoExtrato<L extends Omit<LancamentoLinha, "saldo">>({
  descricao,
  empresa = (l) => l.empresa_nome,
}: {
  /** O texto da coluna Descrição, como a tabela mostra. */
  descricao: (l: L) => string;
  /** O texto da coluna Empresa ("Múltiplas" na guia rateada). */
  empresa?: (l: L) => string | null;
}): ColunaFiltravel<L>[] {
  return [
    { chave: "data", rotulo: "Data", tipo: "data", celula: (l) => celulaData(l.data_movimento) },
    {
      chave: "credito",
      rotulo: "Crédito",
      tipo: "valor",
      faixa: true,
      alinhar: "right",
      celula: (l) => celulaValor(l.credito, formatMoney),
    },
    {
      chave: "debito",
      rotulo: "Débito",
      tipo: "valor",
      faixa: true,
      alinhar: "right",
      celula: (l) => celulaValor(l.debito, formatMoney),
    },
    { chave: "descricao", rotulo: "Descrição", tipo: "texto", celula: (l) => celulaTexto(descricao(l)) },
    { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", celula: (l) => celulaTexto(l.fornecedor_nome) },
    {
      // O código do job. A linha "Múltiplos" (o recebimento que cobre mais
      // de um job) entra em CADA job dela: marcar TES-1001/26 traz também
      // a nota que cobre TES-1001/26 e TES-1002/26. "Não Vinculado" é um
      // valor da lista, no fim.
      chave: "job",
      rotulo: "Job",
      tipo: "texto",
      celula: (l): CelulaDaColuna | CelulaDaColuna[] => {
        const j = derivarJobParaColuna({ ...l, saldo: 0 } as LancamentoLinha);
        if (j.tipo === "link") return celulaTexto(j.codigo);
        if (j.tipo === "multi") {
          const codigos = [...new Set(l.origens.flatMap((o) => (o.job_id && o.codigo ? [o.codigo] : [])))];
          return codigos.map((c) => ({ ...celulaTexto(c), busca: `${c} Múltiplos` }));
        }
        return { valor: "", rotulo: "Não Vinculado", ordem: "￿" };
      },
    },
    {
      // Árvore centro de custo ▸ subtipo: o centro marca todos os subtipos.
      chave: "centro",
      rotulo: "Centro de Custo",
      tipo: "texto",
      celula: (l) => ({
        valor: `${l.tipo_nome} · ${l.subtipo_nome}`,
        rotulo: l.subtipo_nome || "(sem subtipo)",
        ordem: `${l.tipo_nome} · ${l.subtipo_nome}`,
        busca: `${l.tipo_nome} ${l.subtipo_nome}`,
        grupo: l.tipo_nome,
      }),
      rotuloSemGrupo: "(sem centro de custo)",
    },
    {
      chave: "trimestre",
      rotulo: "Trimestre",
      tipo: "texto",
      alinhar: "center",
      celula: (l) => celulaTexto(trimestreDe(l.data_movimento)),
    },
    { chave: "empresa", rotulo: "Empresa", tipo: "texto", celula: (l) => celulaTexto(empresa(l)) },
    {
      // A sigla da regional, ou "TD" no rateio (decisão 195).
      chave: "reg",
      rotulo: "REG",
      tipo: "texto",
      celula: (l) => {
        const partes = juntarRateio(
          l.regional_nome
            ? [{ regional: l.regional_nome, percentual: 100 }]
            : l.rateio.map((r) => ({ regional: r.regional_nome, percentual: r.percentual })),
        );
        if (partes.length === 0) return celulaTexto("—");
        return celulaTexto(partes.length === 1 ? siglaDaRegional(partes[0].regional) : "TD");
      },
    },
  ];
}

/** Os títulos do extrato mantêm a caixa da tabela (sem o espaçamento
 *  largo que o botão do filtro traz). */
const TITULO = "tracking-normal";

/**
 * O Extrato da conta (decisão 195, task 029 fase 1): as mesmas colunas e
 * larguras da planilha de títulos — Data · Crédito · Débito · Saldo ·
 * Descrição · Fornecedor · Job · Centro de Custo · TRI · Empresa · REG · ⓘ
 * —, em `table-fixed` com `colgroup` (`colunasDoExtratoNaGrade`). Até
 * 21/10/2026 a tabela tinha largura automática e não alinhava com nada.
 *
 * O ⓘ é o mesmo da planilha de títulos (variante A), lido pelo lançamento:
 * a trilha do documento que ele pagou, a baixa, o retido e os documentos.
 * O pagamento da fatura do cartão abre nos ITENS, nas mesmas colunas, cada
 * um com o centro dele; a guia de imposto continua uma linha só (decisão
 * 141), que abre no rateio.
 *
 * Com o extrato do banco importado (decisão 202), a coluna Banco primeiro:
 * ✓ conciliado com a linha do banco, ⚠ não bate (a dica diz por quê) e ○
 * ainda não apareceu no extrato do banco. Com a conciliação fechada
 * (decisão 205), o cadeado na marca das linhas até o fechamento: o caixa
 * delas não muda até reabrir.
 */

/** As marcas do banco no Extrato (decisão 202), lidas no servidor. */
export interface MarcasDoBanco {
  /** Os lançamentos do período ligados a uma linha do extrato do banco. */
  conciliados: string[];
  /** Por id de lançamento: por que o ⚠ (`alertasDoExtrato`). */
  alertas: Record<string, string>;
  /** O fechamento ativo da conciliação (decisão 205); `null` = aberta. */
  fechadoAte: string | null;
}
export function ConciliacaoList({
  linhas,
  highlight,
  itensDasFaturas = {},
  detalhesImposto = {},
  jurosDasBaixas = {},
  contexto = "",
  contaId,
  banco = null,
}: {
  linhas: LancamentoLinha[];
  highlight?: string;
  /** A conta e o período que a página carregou: trocar qualquer um zera os
   *  filtros dos títulos, porque os lançamentos são outros (decisão 165). */
  contexto?: string;
  /** Por id do lançamento: os itens que o pagamento de uma fatura de cartão
   *  pagou, cada um com o centro de custo dele (decisão 195). */
  itensDasFaturas?: Record<string, ItemDaFatura[]>;
  /** Por id da linha: o que o pagamento de uma guia de imposto abre —
   *  empresa · regional, e a multa e os juros (módulo fiscal, entrega 2).
   *  A guia é UMA linha, o débito do banco: a soma dos lançamentos que a
   *  baixa grava, um por parte do rateio (`lib/data/imposto-extrato.ts`). */
  detalhesImposto?: Record<string, DetalheDoImposto>;
  /** A baixa com juros e multa (decisão 196): linha → os juros que ela
   *  inclui. O débito da linha já é a soma; o ⓘ separa. */
  jurosDasBaixas?: Record<string, number>;
  /** A conta aberta: a prévia dos títulos marcados na aba Títulos. */
  contaId: string;
  /** `null`: a conta não tem extrato do banco importado (sem a coluna Banco). */
  banco?: MarcasDoBanco | null;
}) {
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  const [abertos, setAbertos] = React.useState<Set<string>>(() => new Set());
  const alternar = (chave: string) =>
    setAbertos((prev) => {
      const prox = new Set(prev);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });

  // "Ver no Extrato antes": os títulos marcados na aba Títulos, lidos da aba
  // do navegador depois da hidratação (o servidor não os conhece).
  const [previstas, setPrevistas] = React.useState<LinhaPrevista[]>([]);
  const [mostrarPrevistas, setMostrarPrevistas] = React.useState(true);
  React.useEffect(() => setPrevistas(lerPrevia(contaId)), [contaId]);

  React.useEffect(() => {
    if (!highlight) return;
    const el = rowRefs.current[highlight];
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("animate-pulse", "bg-yellow-50");
      const timer = setTimeout(
        () => el.classList.remove("animate-pulse", "bg-yellow-50"),
        2000,
      );
      return () => clearTimeout(timer);
    }
  }, [highlight, linhas]);

  // As colunas que filtram (a Empresa da guia rateada diz "Múltiplas",
  // como a célula). Os detalhes das guias não mudam depois da carga.
  const COLUNAS = React.useMemo(
    () =>
      colunasDoExtrato<LancamentoLinha>({
        descricao: (l) => limparPrefixoDescricao(l.descricao, l.origem),
        empresa: (l) =>
          l.empresa_nome ?? ((detalhesImposto[l.id]?.empresas ?? 0) > 1 ? "Múltiplas" : null),
      }),
    [detalhesImposto],
  );
  const colunas = useFiltrosDeColuna(linhas, COLUNAS, { guardarEm: "conciliacao-extrato", contexto });
  // Os créditos e débitos do que sobrou — o rodapé que só aparece com
  // filtro. Os cartões de cima continuam os do período: saldo anterior +
  // créditos − débitos = saldo final, que é o que se bate com o banco.
  const somaDoFiltro = colunas.visiveis.reduce(
    (s, l) => ({ credito: s.credito + l.credito, debito: s.debito + l.debito }),
    { credito: 0, debito: 0 },
  );
  const comBanco = banco !== null;
  const conciliados = React.useMemo(() => new Set(banco?.conciliados ?? []), [banco]);
  const grade = colunasDoExtratoNaGrade(comBanco);
  const chaves = grade.map(([k]) => k);
  const pendentesNoBanco = comBanco ? linhas.filter((l) => !conciliados.has(l.id)).length : 0;

  // A folha (decisão 202): os pagamentos da mesma folha no mesmo dia numa
  // faixa recolhível, só para ver — cada pagamento segue linha a linha. A
  // ordem pelo título de uma coluna desfaz a faixa, como na planilha.
  const itensDoExtrato = React.useMemo(
    () =>
      colunas.ordenacao
        ? colunas.visiveis.map((l): ItemDoExtrato<LancamentoLinha> => ({ tipo: "linha", linha: l }))
        : agruparFolhaNoExtrato(colunas.visiveis),
    [colunas.visiveis, colunas.ordenacao],
  );
  const faixaDe = (id: string | undefined) =>
    id
      ? itensDoExtrato.find(
          (i): i is Extract<ItemDoExtrato<LancamentoLinha>, { tipo: "folha" }> =>
            i.tipo === "folha" && i.linhas.some((l) => l.id === id),
        )
      : undefined;
  // A faixa do `&highlight=` já nasce aberta: a rolagem até a linha é no
  // primeiro desenho.
  const [faixasAbertas, setFaixasAbertas] = React.useState<Set<string>>(() => {
    const f = faixaDe(highlight);
    return new Set(f ? [f.chave] : []);
  });
  const alternarFaixa = (chave: string) =>
    setFaixasAbertas((prev) => {
      const prox = new Set(prev);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });
  // Um `&highlight=` novo, de um pagamento da folha, abre a faixa dele.
  React.useEffect(() => {
    const f = faixaDe(highlight);
    if (f) setFaixasAbertas((prev) => (prev.has(f.chave) ? prev : new Set(prev).add(f.chave)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);
  const saldoFinal = linhas.length ? linhas[linhas.length - 1].saldo : 0;
  const fantasmas = React.useMemo(() => {
    let s = saldoFinal;
    return [...previstas]
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((p) => ({ ...p, saldo: (s = Math.round((s + p.credito - p.debito) * 100) / 100) }));
  }, [previstas, saldoFinal]);

  /** Uma linha do Extrato (e as sublinhas da fatura e da guia). */
  const renderLinha = (l: LancamentoLinha) => {
    const estornada = l.estornada;
    const jobParaColuna = derivarJobParaColuna(l);
    const itens = itensDasFaturas[l.id] ?? [];
    // A guia de imposto abre no rateio; a fatura, nos itens.
    const detalheImposto = detalhesImposto[l.id];
    const aberta = (itens.length > 0 || !!detalheImposto) && abertos.has(l.id);
    const transferencia = l.tipo_nome === "Transferência entre contas";
    const rateio: ParteDoRateio[] = l.regional_nome
      ? [{ regional: l.regional_nome, percentual: 100 }]
      : l.rateio.map((r) => ({ regional: r.regional_nome, percentual: r.percentual }));
    const reg = textoDaRegional(itens.length > 0 ? rateioPonderado(itens) : rateio);
    const centroDoPlano = l.tipo_codigo ? `${l.tipo_codigo} · ${l.tipo_nome}` : null;
    return (
      <React.Fragment key={l.id}>
      <tr
        ref={(el) => {
          rowRefs.current[l.id] = el;
        }}
        className={cn(
          "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
          aberta && "bg-muted/20",
        )}
      >
        {comBanco && (
          <td className="px-2 py-2 text-center">
            <MarcaDoBanco
              alerta={banco?.alertas[l.id] ?? null}
              conciliado={conciliados.has(l.id)}
              fechadoAte={banco?.fechadoAte && l.data_movimento <= banco.fechadoAte ? banco.fechadoAte : null}
            />
          </td>
        )}
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
          {formatDate(l.data_movimento)}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">
          {l.credito > 0 ? formatMoney(l.credito) : ""}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">
          {l.debito > 0 ? formatMoney(l.debito) : ""}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">
          {formatMoney(l.saldo)}
        </td>
        <td className={cn("px-3 py-2 text-xs", estornada && "text-muted-foreground line-through")}>
          <span className="break-words">{limparPrefixoDescricao(l.descricao, l.origem)}</span>
          {(jurosDasBaixas[l.id] ?? 0) > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {" "}· inclui {formatMoney(jurosDasBaixas[l.id])} de juros
            </span>
          )}
          {itens.length > 0 && (
            <button
              type="button"
              onClick={() => alternar(l.id)}
              aria-expanded={aberta}
              className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[10.5px] font-semibold text-california-red hover:bg-california-red/5"
            >
              {itens.length} {itens.length === 1 ? "item" : "itens"}
              <ChevronDown className={cn("h-3 w-3 transition-transform", aberta && "rotate-180")} />
            </button>
          )}
          {detalheImposto && (
            // A guia de imposto em uma linha (decisão 141): o rateio
            // por empresa e regional abre embaixo.
            <button
              type="button"
              onClick={() => alternar(l.id)}
              aria-expanded={aberta}
              aria-label={aberta ? "Recolher o rateio da guia" : "Ver o rateio da guia por empresa e regional"}
              className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[10.5px] font-semibold text-california-red hover:bg-california-red/5"
            >
              {detalheImposto.regionais} {detalheImposto.regionais === 1 ? "regional" : "regionais"}
              {detalheImposto.multaJuros > 0 && " + multa e juros"}
              <ChevronDown className={cn("h-3 w-3 transition-transform", aberta && "rotate-180")} />
            </button>
          )}
        </td>
        <td className="px-3 py-2 text-xs">
          <span className="block truncate" title={l.fornecedor_nome ?? undefined}>
            {l.fornecedor_nome ?? <span className="text-muted-foreground">—</span>}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
          {jobParaColuna.tipo === "link" ? (
            <Link
              href={`/financeiro/jobs/${jobParaColuna.id}`}
              prefetch={false}
              className="block truncate text-california-red hover:underline"
            >
              {jobParaColuna.codigo}
            </Link>
          ) : jobParaColuna.tipo === "multi" ? (
            <span className="font-sans italic text-muted-foreground/70">Múltiplos</span>
          ) : itens.length > 0 && jobsDosItens(itens).length > 0 ? (
            <Dica conteudo={jobsDosItens(itens).join(" · ")} className="font-sans underline decoration-dotted underline-offset-2">
              {jobsDosItens(itens).length} {jobsDosItens(itens).length === 1 ? "job" : "jobs"}
            </Dica>
          ) : (
            <span className="font-sans italic text-muted-foreground/70">Não Vinculado</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs">
          {itens.length > 0 ? (
            <Dica
              conteudo={<CentrosDaFatura centros={centrosDosItens(itens)} />}
              className="block w-full truncate italic text-muted-foreground underline decoration-dotted underline-offset-2"
            >
              Itens da fatura
            </Dica>
          ) : transferencia ? (
            <span className="block truncate italic text-muted-foreground" title="Transferência entre contas · fora do DRE">
              Fora do DRE
            </span>
          ) : centroDoPlano ? (
            // Só o tipo, como na planilha de títulos; o centro
            // inteiro na dica.
            <Dica
              conteudo={l.subtipo_nome && l.subtipo_nome !== "—" ? `${centroDoPlano} · ${l.subtipo_nome}` : centroDoPlano}
              className="block w-full truncate"
            >
              {centroDoPlano}
            </Dica>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">
          {trimestreDe(l.data_movimento)}
        </td>
        <td className="px-3 py-2 text-xs">
          <span className="block truncate" title={l.empresa_nome ?? undefined}>
            {l.empresa_nome ??
              // A guia rateada entre empresas diz "Múltiplas", como a
              // coluna Job diz "Múltiplos"; as sublinhas abrem.
              (detalheImposto && detalheImposto.empresas > 1 ? (
                <span className="font-sans italic text-muted-foreground/70">Múltiplas</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ))}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
          {reg.texto === "—" ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Dica conteudo={reg.dica} className={cn(reg.rateado && "underline decoration-dotted underline-offset-2")}>
              {reg.texto}
            </Dica>
          )}
        </td>
        <td className="px-2 py-2 text-center">
          <BotaoDetalhes
            chave={`lancamento|${l.id}`}
            titulo={limparPrefixoDescricao(l.descricao, l.origem)}
            rotulo="Ver detalhes do lançamento"
            recebimento={l.natureza === "entrada"}
            job={null}
            vencimentoDiferente={null}
            retencoes={[]}
            rateio={itens.length > 0 ? rateioPonderado(itens) : rateio}
            acoes={[]}
          />
        </td>
      </tr>
      {aberta && itens.length > 0 && <LinhasDosItens itens={itens} chaves={chaves} />}
      {aberta && detalheImposto && <LinhasDoImposto detalhe={detalheImposto} comBanco={comBanco} />}
      </React.Fragment>
    );
  };
  if (linhas.length === 0 && previstas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum lançamento nesse período pra essa conta.
        </p>
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={`/financeiro/conciliacao?conta=${contaId}&aba=banco`}
        prefetch={false}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-muted/50"
      >
        <Upload className="h-4 w-4" />
        Importar extrato do banco (OFX)
      </Link>
      {comBanco && (
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-emerald-700">
            {linhas.length - pendentesNoBanco} {linhas.length - pendentesNoBanco === 1 ? "conciliada" : "conciliadas"}
          </span>{" "}
          com o banco ·{" "}
          <span className="font-semibold text-amber-700">{pendentesNoBanco} aguardando o extrato do banco</span>
        </span>
      )}
    {previstas.length > 0 && (
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-violet-700">
          <input
            type="checkbox"
            checked={mostrarPrevistas}
            onChange={(e) => setMostrarPrevistas(e.target.checked)}
            className="h-3.5 w-3.5 accent-violet-600"
          />
          {previstas.length === 1
            ? "Mostrar o título marcado como previsto"
            : `Mostrar os ${previstas.length} títulos marcados como previstos`}
        </label>
        <button
          type="button"
          onClick={() => {
            gravarPrevia(contaId, []);
            setPrevistas([]);
          }}
          className="text-xs font-semibold text-muted-foreground hover:text-california-red"
        >
          Tirar a prévia
        </button>
      </div>
    )}
    </div>
    {colunas.ativo && (
      <div>
        {/* "do período": o filtro dos títulos age dentro do período de/até
            escolhido em cima, que é lido no servidor. */}
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="lançamento do período"
          plural="lançamentos do período"
          onLimpar={colunas.limpar}
        />
      </div>
    )}
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className={cn("w-full table-fixed text-sm", comBanco ? "min-w-[1528px]" : "min-w-[1480px]")}>
        <colgroup>
          {grade.map(([k, w]) => (
            <col key={k} style={w ? { width: w } : undefined} />
          ))}
        </colgroup>
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            {comBanco && (
              <th className="px-2 py-3 text-center font-semibold" title="Conciliado com o extrato do banco">
                Banco
              </th>
            )}
            <th className="px-3 py-3 text-left">{colunas.titulo("data", TITULO)}</th>
            <th className="px-3 py-3 text-right">{colunas.titulo("credito", TITULO)}</th>
            <th className="px-3 py-3 text-right">{colunas.titulo("debito", TITULO)}</th>
            {/* Saldo corrente: sem filtro e sem ordem (ver `colunasDoExtrato`). */}
            <th
              className="px-3 py-3 text-right font-semibold"
              title={colunas.ativo ? "Saldo do extrato: não muda com o filtro nem com a ordem dos títulos." : undefined}
            >
              Saldo
            </th>
            <th className="px-3 py-3 text-left">{colunas.titulo("descricao", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("fornecedor", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("job", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("centro", TITULO)}</th>
            <th className="px-3 py-3 text-center">{colunas.titulo("trimestre", TITULO, "TRI")}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("empresa", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("reg", TITULO)}</th>
            <th className="px-3 py-3 text-center" aria-label="Detalhes" />
          </tr>
        </thead>
        <tbody>
          {colunas.visiveis.length === 0 && linhas.length > 0 && (
            <tr>
              <td colSpan={grade.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
                Nenhum lançamento com esse filtro.
              </td>
            </tr>
          )}
          {itensDoExtrato.map((item) =>
            item.tipo === "linha" ? (
              renderLinha(item.linha)
            ) : (
              <React.Fragment key={item.chave}>
                <FaixaDaFolha
                  item={item}
                  chaves={chaves}
                  banco={banco}
                  conciliados={conciliados}
                  aberta={faixasAbertas.has(item.chave)}
                  onAlternar={() => alternarFaixa(item.chave)}
                />
                {faixasAbertas.has(item.chave) && item.linhas.map(renderLinha)}
              </React.Fragment>
            ),
          )}
          {mostrarPrevistas &&
            fantasmas.map((p) => (
              <tr key={`previsto-${p.chave}`} className="border-b border-dashed border-violet-200 bg-violet-50/50 italic text-violet-900/80">
                {comBanco && <td />}
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  <span className="mr-1.5 rounded bg-violet-100 px-1 py-px text-[9px] font-bold not-italic uppercase text-violet-700">prev.</span>
                  {formatDate(p.data)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">{p.credito > 0 ? formatMoney(p.credito) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">{p.debito > 0 ? formatMoney(p.debito) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">{formatMoney(p.saldo)}</td>
                <td className="px-3 py-2 text-xs">{p.descricao}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="block truncate">{p.contraparte}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{p.job ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="block truncate" title={p.centroCompleto || undefined}>
                    {p.centro}
                  </span>
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs">{trimestreDe(p.data)}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="block truncate">{p.empresa ?? "—"}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{textoDaRegional(p.rateio).texto}</td>
                <td />
              </tr>
            ))}
        </tbody>
        {/* Só com filtro: quanto entrou e saiu nos lançamentos que sobraram
            (o "Total do filtro" da página inicial da conciliação). Sem
            filtro, os cartões de cima já dizem o do período. */}
        {colunas.filtrando && colunas.visiveis.length > 0 && (
          <tfoot className={cn(TOTAL_LISTA, "text-xs")}>
            <tr>
              {comBanco && <td />}
              <td className="whitespace-nowrap px-3 py-2.5 font-semibold">Total do filtro</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-emerald-700">
                {somaDoFiltro.credito > 0 ? formatMoney(somaDoFiltro.credito) : ""}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-california-red">
                {somaDoFiltro.debito > 0 ? formatMoney(somaDoFiltro.debito) : ""}
              </td>
              <td />
              <td colSpan={grade.length - 4 - (comBanco ? 1 : 0)} className="px-3 py-2.5 text-muted-foreground">
                {colunas.visiveis.length} de {colunas.total}{" "}
                {colunas.total === 1 ? "lançamento" : "lançamentos"} do período
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    {mostrarPrevistas && fantasmas.length > 0 && (
      <p className="text-xs text-violet-700">
        As linhas em lilás ainda não existem: são os títulos marcados na aba Títulos, mostrados onde a baixa vai pô-los.
        Nada é gravado até a baixa.
      </p>
    )}
    </>
  );
}

/**
 * A faixa da folha (decisão 202), no padrão das faixas de grupo das listas
 * (decisão 091, `FAIXA_GRUPO_LISTA`): o dia na Data, a soma no Crédito e no
 * Débito, o saldo depois do último pagamento no Saldo, e na Descrição a
 * folha, quantos pagamentos e as marcas do banco. Abre nas linhas.
 */
function FaixaDaFolha({
  item,
  chaves,
  banco,
  conciliados,
  aberta,
  onAlternar,
}: {
  item: Extract<ItemDoExtrato<LancamentoLinha>, { tipo: "folha" }>;
  chaves: string[];
  banco: MarcasDoBanco | null;
  conciliados: Set<string>;
  aberta: boolean;
  onAlternar: () => void;
}) {
  const n = item.linhas.length;
  const credito = item.linhas.reduce((s, l) => s + l.credito, 0);
  const debito = item.linhas.reduce((s, l) => s + l.debito, 0);
  const saldo = item.linhas[n - 1].saldo;
  const alertas = banco ? item.linhas.filter((l) => banco.alertas[l.id]).length : 0;
  const ok = banco ? item.linhas.filter((l) => !banco.alertas[l.id] && conciliados.has(l.id)).length : 0;
  const aguardando = banco ? n - ok - alertas : 0;
  return (
    <tr className={cn(FAIXA_GRUPO_LISTA, "text-xs")}>
      {chaves.map((k) => {
        if (k === "data")
          return (
            <td key={k} className="whitespace-nowrap px-3 py-1.5 font-semibold">
              <button
                type="button"
                onClick={onAlternar}
                aria-expanded={aberta}
                aria-label={aberta ? `Recolher os pagamentos da ${item.rotulo}` : `Ver os pagamentos da ${item.rotulo}`}
                className="inline-flex items-center gap-1 hover:text-california-red"
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !aberta && "-rotate-90")} />
                {formatDate(item.data).slice(0, 5)}
              </button>
            </td>
          );
        if (k === "credito")
          return (
            <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold text-emerald-800">
              {credito > 0 ? formatMoney(credito) : ""}
            </td>
          );
        if (k === "debito")
          return (
            <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold text-[#b3323c]">
              {debito > 0 ? formatMoney(debito) : ""}
            </td>
          );
        if (k === "saldo")
          return (
            <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold">
              {formatMoney(saldo)}
            </td>
          );
        if (k === "descricao")
          return (
            <td key={k} colSpan={2} className="px-3 py-1.5 text-[#5f5d57]">
              <span className="font-semibold text-foreground/80">{item.rotulo}</span> · {n}{" "}
              {n === 1 ? "pagamento" : "pagamentos"}
              {banco && (
                <>
                  {" "}·{" "}
                  {ok > 0 && <span className="font-semibold text-emerald-700">{ok} ✓</span>}
                  {alertas > 0 && <span className="ml-1.5 font-semibold text-california-red">{alertas} ⚠</span>}
                  {aguardando > 0 && <span className="ml-1.5 font-semibold text-amber-700">{aguardando} ○</span>}
                </>
              )}
            </td>
          );
        // A Descrição ocupa também a coluna do Fornecedor.
        if (k === "contraparte") return null;
        return <td key={k} />;
      })}
    </tr>
  );
}

/** A marca da coluna Banco (protótipo, `AbaExtrato`). `fechadoAte`: a linha
 *  está no período fechado, e a marca ganha o cadeado (decisão 205). */
function MarcaDoBanco({
  alerta,
  conciliado,
  fechadoAte,
}: {
  alerta: string | null;
  conciliado: boolean;
  fechadoAte: string | null;
}) {
  const cadeado = fechadoAte && (
    <Lock
      className="absolute -bottom-1 -right-1.5 h-3 w-3 rounded-full bg-white p-px text-slate-600"
      aria-label="Período fechado"
    />
  );
  const travado = fechadoAte ? ` Período fechado até ${formatDate(fechadoAte)}.` : "";
  if (alerta) {
    return (
      <Dica conteudo={`${alerta}${travado}`}>
        <span
          className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-california-red"
          aria-label="Não bate com o banco"
        >
          <AlertTriangle className="h-3 w-3" />
          {cadeado}
        </span>
      </Dica>
    );
  }
  if (conciliado) {
    const titulo = fechadoAte
      ? `Conciliado e travado: o período está fechado até ${formatDate(fechadoAte)}`
      : "Conciliado com o extrato do banco";
    return (
      <span
        title={titulo}
        aria-label={titulo}
        className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
      >
        <CheckCheck className="h-3 w-3" />
        {cadeado}
      </span>
    );
  }
  const titulo = `Ainda não apareceu no extrato do banco.${travado}`;
  return (
    <span title={titulo} aria-label={titulo} className="relative inline-flex h-5 w-5 items-center justify-center">
      <span className="inline-block h-3 w-3 rounded-full border-2 border-amber-400" />
      {cadeado}
    </span>
  );
}

/**
 * O pagamento da guia de imposto aberto (módulo fiscal, entrega 2 —
 * protótipo aprovado em 02/10/2026). Uma sublinha por empresa · regional do
 * rateio do título, com o valor sob DÉBITO e o centro de custo do imposto
 * sob CENTRO DE CUSTO; a multa e os juros numa sublinha própria, em Despesa
 * com Juros. O rodapé confere: a soma das sublinhas é o débito da linha do
 * pagamento. Desde a decisão 195 nas colunas da grade do Extrato.
 */
function LinhasDoImposto({ detalhe, comBanco }: { detalhe: DetalheDoImposto; comBanco: boolean }) {
  return (
    <>
      {detalhe.partes.map((p) => (
        <tr key={p.chave} className="border-b border-dashed border-border/70 bg-slate-50/70 text-[11px] text-muted-foreground">
          {comBanco && <td />}
          <td className="whitespace-nowrap py-1.5 pl-6 pr-3 font-mono">↳</td>
          <td />
          <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-[#b3323c]/80">{formatMoney(p.valor)}</td>
          <td />
          <td className="px-3 py-1.5">
            <span className="text-foreground/80">{p.rotulo}</span>
            {p.percentual !== null && (
              <span className="ml-1.5 text-[10px]">
                {p.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% do imposto
              </span>
            )}
          </td>
          <td />
          <td />
          <td className="px-3 py-1.5">
            <Dica
              conteudo={p.subtipo_nome ? `${p.tipo_nome} · ${p.subtipo_nome}` : p.tipo_nome}
              className="block w-full truncate"
            >
              {p.tipo_nome}
            </Dica>
          </td>
          <td colSpan={4} />
        </tr>
      ))}
      <tr className="border-b border-border bg-slate-50/70 text-[11px] text-muted-foreground">
        <td colSpan={comBanco ? 3 : 2} />
        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-bold">{formatMoney(detalhe.total)}</td>
        <td />
        <td colSpan={8} className="px-3 py-1.5">
          Total da {detalhe.guia}
          {detalhe.competencia && ` · ${detalhe.competencia}`}
          {detalhe.vencimento && ` · vence ${formatDate(detalhe.vencimento)}`}
        </td>
      </tr>
    </>
  );
}

/**
 * Popover com os campos que saíram da tabela principal: Regional, Origem
 * (com Recorrente e Cartão), Documento, além do detalhe de rateio de
 * regionais e do breakdown de origens (jobs cobertos + save).
 *
 * Cor do botão é sempre a mesma (vermelho California suave). A ideia
 * anterior de mudar a cor quando havia save/rateio/multi-origem foi
 * rejeitada — a distinção confundia mais do que ajudava. O popover se
 * adapta: seções de save/rateio só aparecem quando existem.
 */
export function DetalhesPopover({
  linha,
  temSave,
  temRateio,
  temOrigensMultiplas,
}: {
  linha: LancamentoLinha;
  temSave: boolean;
  temRateio: boolean;
  temOrigensMultiplas: boolean;
}) {
  const origemTag = tagDaOrigem(linha.origem);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ver detalhes do lançamento"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-california-red/40 text-california-red transition-colors hover:bg-california-red/5"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="left" className="w-80">
        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
              Detalhes do lançamento
            </p>
            {origemTag && (
              <span
                className={cn(
                  "inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                  origemTag.classes,
                )}
              >
                {origemTag.label}
              </span>
            )}
          </div>

          <Grupo label="Origem">
            {linha.origem_codigo ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="font-mono">{linha.origem_codigo}</span>
                {linha.origem_recorrente && (
                  <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                    Recorrente
                  </span>
                )}
                {linha.cartao_label && (
                  <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700">
                    <CreditCard className="h-2.5 w-2.5" />
                    {linha.cartao_label}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Grupo>

          <Grupo label="Documento">
            {linha.documento_label ? (
              linha.documento_path ? (
                <BotaoDocumento
                  lancamentoId={linha.id}
                  label={linha.documento_label}
                />
              ) : (
                <span className="font-mono">{linha.documento_label}</span>
              )
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Grupo>

          <Grupo label="Regional">
            {linha.regional_nome ? (
              <span>{linha.regional_nome}</span>
            ) : temRateio ? (
              <div className="flex flex-col gap-0.5">
                {linha.rateio.map((r) => (
                  <div
                    key={r.regional_nome}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span>{r.regional_nome}</span>
                    <span className="font-mono text-muted-foreground">
                      {r.percentual.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Grupo>

          {(temSave || temOrigensMultiplas) && (
            <div className="border-t border-border pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                De onde vem este dinheiro
              </p>
              <div className="flex flex-col gap-1">
                {linha.origens.map((o, i) => (
                  <div
                    key={`${o.tipo}-${o.codigo ?? i}`}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono font-semibold">
                        {o.codigo ?? "—"}
                      </span>
                      <span
                        className={
                          o.tipo === "save" ? "text-[#5f5d57]" : undefined
                        }
                      >
                        {o.tipo === "save"
                          ? "saldo em save — crédito do cliente"
                          : (o.nome ?? "")}
                      </span>
                    </span>
                    <span className="whitespace-nowrap font-mono font-semibold">
                      {formatMoney(o.valor)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Grupo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

/**
 * Abre o documento fiscal numa aba. A URL é assinada na hora e vive um
 * minuto: precisa ser derivada no clique, nunca vir pronta do servidor.
 */
function BotaoDocumento({
  lancamentoId,
  label,
}: {
  lancamentoId: string;
  label: string;
}) {
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={carregando}
        onClick={async () => {
          setCarregando(true);
          setErro(null);
          const r = await abrirDocumentoDoLancamento(lancamentoId);
          setCarregando(false);
          if (!r.ok) {
            setErro(r.message);
            return;
          }
          window.open(r.url, "_blank", "noopener,noreferrer");
        }}
        className="inline-flex items-center gap-1 font-mono text-california-red hover:underline disabled:opacity-50"
      >
        {label}
        <ExternalLink className="h-2.5 w-2.5" />
      </button>
      {erro && <span className="text-[10px] text-california-red">{erro}</span>}
    </span>
  );
}

function tagDaOrigem(
  origem: string,
): { label: string; classes: string } | null {
  if (origem.startsWith("pp_")) {
    return {
      label: "PP",
      classes: "border-blue-200 bg-blue-50 text-blue-700",
    };
  }
  if (origem.startsWith("avulsa_")) {
    return {
      label: "Avulsa",
      classes: "border-slate-300 bg-slate-100 text-slate-700",
    };
  }
  return null;
}

/** "21/10/2026": o ano inteiro, como a planilha de títulos (decisão 195). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Decide o que mostrar na coluna Job da tabela:
 *
 * 1. FK direta `lançamento.job_id` set → link pra esse job (PP, avulsa
 *    de job específico, desembolso de job).
 * 2. FK null MAS as origens (`vw_lancamento_origens`) apontam pra UM
 *    único job → link. É o caso do recebimento de NF que cobre um job
 *    só, direto e/ou via save do próprio job.
 * 3. Mais de um job nas origens → "Múltiplos". A pessoa abre o popover
 *    pra ver o breakdown de "de onde vem este dinheiro".
 * 4. Nenhum job em nenhum lugar → "Não Vinculado" (fatura de cartão,
 *    lançamento manual, ajuste, etc).
 */
export function derivarJobParaColuna(
  linha: LancamentoLinha,
):
  | { tipo: "link"; id: string; codigo: string }
  | { tipo: "multi" }
  | { tipo: "nao_vinculado" } {
  if (linha.job_id && linha.job_codigo) {
    return { tipo: "link", id: linha.job_id, codigo: linha.job_codigo };
  }
  const jobsUnicos = new Map<string, string>();
  for (const o of linha.origens) {
    if (o.job_id && o.codigo) jobsUnicos.set(o.job_id, o.codigo);
  }
  const arr = Array.from(jobsUnicos.entries());
  if (arr.length === 1) {
    return { tipo: "link", id: arr[0][0], codigo: arr[0][1] };
  }
  if (arr.length > 1) return { tipo: "multi" };
  return { tipo: "nao_vinculado" };
}

/**
 * A descrição gravada no banco vem prefixada com "PP" ou "Avulsa" pra
 * origens de compra ("PP PP-00009 1/3 — ..."). Com a tag movida pro
 * popover, esse prefixo virou redundante — vira "PP PP-00009 1/3" na
 * tela. Remove só quando bate com o tipo de origem, pra não estropiar
 * descrições que legitimamente começam com essas letras.
 */
export function limparPrefixoDescricao(descricao: string, origem: string): string {
  if (origem.startsWith("pp_") && descricao.startsWith("PP ")) {
    return descricao.slice(3);
  }
  if (origem.startsWith("avulsa_") && descricao.startsWith("Avulsa ")) {
    return descricao.slice(7);
  }
  return descricao;
}

export function trimestreDe(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10);
  if (m <= 3) return "T1";
  if (m <= 6) return "T2";
  if (m <= 9) return "T3";
  return "T4";
}

/** "R$ 1.443,91", como a planilha de títulos (decisão 195). */
function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
