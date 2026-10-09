"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, CreditCard, ExternalLink, Info } from "lucide-react";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";
import type { DetalheDaFatura } from "@/lib/data/fatura-cartao-extrato";
import type { DetalheDoImposto } from "@/lib/data/imposto-extrato";
import { limparDescricaoDaFatura } from "@/lib/cartoes/descricao-fatura";
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
  ];
}

/** Os títulos do extrato mantêm a caixa da tabela (sem o espaçamento
 *  largo que o botão do filtro traz). */
const TITULO = "tracking-normal";

export function ConciliacaoList({
  linhas,
  highlight,
  detalhesFatura = {},
  detalhesImposto = {},
  contexto = "",
}: {
  linhas: LancamentoLinha[];
  highlight?: string;
  /** A conta e o período que a página carregou: trocar qualquer um zera os
   *  filtros dos títulos, porque os lançamentos são outros (decisão 165). */
  contexto?: string;
  /** Por id do lançamento: o que o pagamento de uma fatura de cartão abre
   *  — centro de custo → itens (decisão 093, entrega 3). */
  detalhesFatura?: Record<string, DetalheDaFatura>;
  /** Por id da linha: o que o pagamento de uma guia de imposto abre —
   *  empresa · regional, e a multa e os juros (módulo fiscal, entrega 2).
   *  A guia é UMA linha, o débito do banco: a soma dos lançamentos que a
   *  baixa grava, um por parte do rateio (`lib/data/imposto-extrato.ts`). */
  detalhesImposto?: Record<string, DetalheDoImposto>;
}) {
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  // Duas camadas de abertura: a linha do pagamento, e cada centro dentro
  // dela. Chaves: id do lançamento, e `${lancamento}|${tipo}`.
  const [abertos, setAbertos] = React.useState<Set<string>>(() => new Set());
  const alternar = (chave: string) =>
    setAbertos((prev) => {
      const prox = new Set(prev);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });

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

  if (linhas.length === 0) {
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
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          {/* Ordem da tabela: extrato bancário puro à esquerda (Data, Crédito,
              Débito, Saldo), contexto do lançamento à direita (Descrição,
              Fornecedor, Job, Centro de Custo, Trimestre, Empresa). Regional,
              Origem, Documento e rateio/save moveram pro botão de detalhes
              (ⓘ) — a coluna Origem/Rateado inline poluía sem necessidade. */}
          <tr>
            <th className="px-3 py-2 text-left">{colunas.titulo("data", TITULO)}</th>
            <th className="px-3 py-2 text-right">{colunas.titulo("credito", TITULO)}</th>
            <th className="px-3 py-2 text-right">{colunas.titulo("debito", TITULO)}</th>
            {/* Saldo corrente: sem filtro e sem ordem (ver `colunasDoExtrato`). */}
            <th
              className="px-3 py-2 text-right"
              title={colunas.ativo ? "Saldo do extrato: não muda com o filtro nem com a ordem dos títulos." : undefined}
            >
              Saldo
            </th>
            <th className="px-3 py-2 text-left">{colunas.titulo("descricao", TITULO)}</th>
            <th className="px-3 py-2 text-left">{colunas.titulo("fornecedor", TITULO)}</th>
            <th className="px-3 py-2 text-left">{colunas.titulo("job", TITULO)}</th>
            <th className="px-3 py-2 text-left">{colunas.titulo("centro", TITULO)}</th>
            <th className="px-3 py-2 text-center">{colunas.titulo("trimestre", TITULO)}</th>
            <th className="px-3 py-2 text-left">{colunas.titulo("empresa", TITULO)}</th>
            <th className="w-10 px-3 py-2 text-center" aria-label="Detalhes" />
          </tr>
        </thead>
        <tbody>
          {colunas.visiveis.length === 0 && (
            <tr>
              <td colSpan={11} className="px-3 py-10 text-center text-sm text-muted-foreground">
                Nenhum lançamento com esse filtro.
              </td>
            </tr>
          )}
          {colunas.visiveis.map((l) => {
            const estornada = l.estornada;
            const temSave = l.origens.some((o) => o.tipo === "save");
            const temRateio = l.rateio.length > 1;
            const temOrigensMultiplas = l.origens.length > 1;
            const jobParaColuna = derivarJobParaColuna(l);
            const detalhe = detalhesFatura[l.id];
            // A guia de imposto abre pelo mesmo mecanismo da fatura.
            const detalheImposto = detalhesImposto[l.id];
            const aberta = (!!detalhe || !!detalheImposto) && abertos.has(l.id);
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
                <td
                  className={cn(
                    "px-3 py-2 text-xs",
                    estornada && "text-muted-foreground line-through",
                  )}
                >
                  {detalhe ? (
                    <button
                      type="button"
                      onClick={() => alternar(l.id)}
                      aria-expanded={aberta}
                      aria-label={aberta ? "Recolher os itens da fatura" : "Ver os itens da fatura"}
                      className="inline-flex items-center gap-1.5 text-left hover:text-california-red"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-california-red transition-transform",
                          aberta && "rotate-90",
                        )}
                      />
                      <span>{limparPrefixoDescricao(l.descricao, l.origem)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        · {detalhe.centros.length}{" "}
                        {detalhe.centros.length === 1 ? "centro de custo" : "centros de custo"}
                      </span>
                    </button>
                  ) : detalheImposto ? (
                    // A seta da guia de imposto: o mesmo botão da fatura,
                    // com o rateio no lugar dos centros de custo.
                    <button
                      type="button"
                      onClick={() => alternar(l.id)}
                      aria-expanded={aberta}
                      aria-label={
                        aberta
                          ? "Recolher o rateio da guia"
                          : "Ver o rateio da guia por empresa e regional"
                      }
                      className="inline-flex items-center gap-1.5 text-left hover:text-california-red"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-california-red transition-transform",
                          aberta && "rotate-90",
                        )}
                      />
                      <span>{limparPrefixoDescricao(l.descricao, l.origem)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        · {detalheImposto.regionais}{" "}
                        {detalheImposto.regionais === 1 ? "regional" : "regionais"}
                        {detalheImposto.multaJuros > 0 && " + multa e juros"}
                      </span>
                    </button>
                  ) : (
                    limparPrefixoDescricao(l.descricao, l.origem)
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {l.fornecedor_nome ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {jobParaColuna.tipo === "link" ? (
                    <Link
                      href={`/financeiro/jobs/${jobParaColuna.id}`}
                      prefetch={false}
                      className="text-california-red hover:underline"
                    >
                      {jobParaColuna.codigo}
                    </Link>
                  ) : jobParaColuna.tipo === "multi" ? (
                    <span className="italic text-muted-foreground/70 font-sans">
                      Múltiplos
                    </span>
                  ) : (
                    <span className="italic text-muted-foreground/70 font-sans">
                      Não Vinculado
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="text-foreground">{l.tipo_nome}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-muted-foreground">{l.subtipo_nome}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                  {trimestreDe(l.data_movimento)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {l.empresa_nome ??
                    // A guia rateada entre empresas diz "Múltiplas", como a
                    // coluna Job diz "Múltiplos"; as sublinhas abrem.
                    (detalheImposto && detalheImposto.empresas > 1 ? (
                      <span className="italic text-muted-foreground/70 font-sans">
                        Múltiplas
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ))}
                </td>
                <td className="w-10 px-3 py-2 text-center">
                  <DetalhesPopover
                    linha={l}
                    temSave={temSave}
                    temRateio={temRateio}
                    temOrigensMultiplas={temOrigensMultiplas}
                  />
                </td>
                {/* variáveis temSave/temRateio/temOrigensMultiplas continuam
                    sendo lidas pelo popover pra decidir qual seção mostrar,
                    mas o ESTILO do botão não muda mais entre linhas. */}
              </tr>
              {aberta && detalhe && (
                <LinhasDaFatura
                  lancamentoId={l.id}
                  detalhe={detalhe}
                  abertos={abertos}
                  alternar={alternar}
                />
              )}
              {aberta && detalheImposto && <LinhasDoImposto detalhe={detalheImposto} />}
              </React.Fragment>
            );
          })}
        </tbody>
        {/* Só com filtro: quanto entrou e saiu nos lançamentos que sobraram
            (o "Total do filtro" da página inicial da conciliação). Sem
            filtro, os cartões de cima já dizem o do período. */}
        {colunas.filtrando && colunas.visiveis.length > 0 && (
          <tfoot className="border-t-2 border-border bg-muted/30">
            <tr>
              <td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold">
                Total do filtro
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-semibold text-emerald-700">
                {somaDoFiltro.credito > 0 ? formatMoney(somaDoFiltro.credito) : ""}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-semibold text-california-red">
                {somaDoFiltro.debito > 0 ? formatMoney(somaDoFiltro.debito) : ""}
              </td>
              <td />
              <td colSpan={7} className="px-3 py-2.5 text-xs text-muted-foreground">
                {colunas.visiveis.length} de {colunas.total}{" "}
                {colunas.total === 1 ? "lançamento" : "lançamentos"} do período
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    </>
  );
}

/**
 * O pagamento da fatura aberto em dois níveis (decisão 093, entrega 3):
 * uma linha por CENTRO DE CUSTO, com o total dele, e dentro de cada um os
 * ITENS — data, descrição, fornecedor, job, subtipo, valor. O rodapé
 * confere: a soma dos centros é o débito da linha do pagamento.
 *
 * Linhas de tabela, não uma tabela dentro da célula: assim as colunas de
 * valor ficam na mesma vertical do Débito da linha-mãe.
 */
function LinhasDaFatura({
  lancamentoId,
  detalhe,
  abertos,
  alternar,
}: {
  lancamentoId: string;
  detalhe: DetalheDaFatura;
  abertos: Set<string>;
  alternar: (chave: string) => void;
}) {
  // As células seguem as colunas da linha-mãe: valor sob DÉBITO (o que
  // fecha com o pagamento), nome sob DESCRIÇÃO, fornecedor, job e o
  // subtipo sob CENTRO DE CUSTO. Sem isso os números ficavam soltos na
  // borda direita e o olho não batia a soma.
  return (
    <>
      {detalhe.centros.map((c) => {
        const chave = `${lancamentoId}|${c.tipo_codigo}`;
        const abertoCentro = abertos.has(chave);
        return (
          <React.Fragment key={chave}>
            <tr className="border-b border-border/60 bg-muted/10 text-xs">
              <td colSpan={2} />
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold">
                {formatMoney(c.total)}
              </td>
              <td />
              <td colSpan={7} className="px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => alternar(chave)}
                  aria-expanded={abertoCentro}
                  className="inline-flex items-center gap-1.5 pl-4 font-medium hover:text-california-red"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                      abertoCentro && "rotate-90",
                    )}
                  />
                  <span className="font-mono text-muted-foreground">{c.tipo_codigo}</span>
                  <span>{c.tipo_nome}</span>
                  <span className="text-[10px] text-muted-foreground">
                    · {c.itens.length} {c.itens.length === 1 ? "item" : "itens"}
                  </span>
                </button>
              </td>
            </tr>
            {abertoCentro &&
              c.itens.map((it) => (
                <tr key={it.id} className="border-b border-border/40 bg-muted/5 text-[11.5px]">
                  <td className="whitespace-nowrap px-3 py-1.5 pl-6 font-mono text-muted-foreground">
                    {formatDate(it.data)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-emerald-700">
                    {it.valor < 0 ? formatMoney(-it.valor) : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono">
                    {it.valor > 0 ? formatMoney(it.valor) : ""}
                  </td>
                  <td />
                  <td className="px-3 py-1.5 pl-8">
                    {limparPrefixoDescricao(limparDescricaoDaFatura(it.descricao), it.origem)}
                    {it.papel === "ajuste" && (
                      <span className="ml-1.5 rounded border border-slate-300 bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-700">
                        ajuste
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {it.fornecedor_nome ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                    {it.job_id && it.job_codigo ? (
                      <Link
                        href={`/financeiro/jobs/${it.job_id}`}
                        prefetch={false}
                        className="text-california-red hover:underline"
                      >
                        {it.job_codigo}
                      </Link>
                    ) : (
                      <span className="font-sans italic text-muted-foreground/70">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{it.subtipo_nome}</td>
                  <td colSpan={3} />
                </tr>
              ))}
          </React.Fragment>
        );
      })}
      <tr className="border-b border-border bg-muted/10 text-xs">
        <td colSpan={2} />
        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-bold">
          {formatMoney(detalhe.total)}
        </td>
        <td />
        <td colSpan={7} className="px-3 py-1.5 pl-7 text-muted-foreground">
          Total da fatura {detalhe.codigo} · fecha {formatDate(detalhe.competencia_fechamento)} ·{" "}
          {detalhe.centros.reduce((s, c) => s + c.itens.length, 0)} itens
        </td>
      </tr>
    </>
  );
}

/**
 * O pagamento da guia de imposto aberto (módulo fiscal, entrega 2 —
 * protótipo aprovado em 02/10/2026). Uma sublinha por empresa · regional do
 * rateio do título, com o valor sob DÉBITO e o centro de custo do imposto
 * sob CENTRO DE CUSTO; a multa e os juros numa sublinha própria, em Despesa
 * com Juros. O rodapé confere: a soma das sublinhas é o débito da linha do
 * pagamento — o mesmo desenho das linhas da fatura, um nível só.
 */
function LinhasDoImposto({ detalhe }: { detalhe: DetalheDoImposto }) {
  return (
    <>
      {detalhe.partes.map((p) => (
        <tr key={p.chave} className="border-b border-border/60 bg-muted/10 text-xs">
          <td colSpan={2} />
          <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold">
            {formatMoney(p.valor)}
          </td>
          <td />
          <td className="px-3 py-1.5 pl-8">
            {p.rotulo}
            {p.percentual !== null && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                {p.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% do imposto
              </span>
            )}
          </td>
          <td />
          <td />
          <td className="px-3 py-1.5">
            <span className="text-foreground">{p.tipo_nome}</span>
            {p.subtipo_nome && (
              <>
                <span className="text-muted-foreground"> · </span>
                <span className="text-muted-foreground">{p.subtipo_nome}</span>
              </>
            )}
          </td>
          <td colSpan={3} />
        </tr>
      ))}
      <tr className="border-b border-border bg-muted/10 text-xs">
        <td colSpan={2} />
        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-bold">
          {formatMoney(detalhe.total)}
        </td>
        <td />
        <td colSpan={7} className="px-3 py-1.5 pl-7 text-muted-foreground">
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

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
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

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
