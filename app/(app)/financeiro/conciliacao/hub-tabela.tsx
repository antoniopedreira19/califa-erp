"use client";

/**
 * A tabela da página inicial da Conciliação (decisão 091): uma linha por
 * conta, agrupada por empresa contábil.
 *
 * Um só `thead` no topo (os títulos das colunas não se repetem por grupo);
 * cada empresa é um `tbody` aberto pela faixa da empresa, que carrega o
 * subtotal do grupo; o `tfoot` fecha o total geral. Client por causa da
 * busca — recebe dados prontos do server component.
 *
 * A faixa da empresa é a linha do agrupamento das planilhas, em grafite
 * claro sobre linhas brancas (revisão de 16/10/2026): antes ela era um
 * cinza quase igual ao das linhas, e uma linha "Subtotal" repetia o saldo
 * que a faixa já mostrava. As colunas têm largura fixa (`table-fixed` +
 * `colgroup`), como as planilhas.
 *
 * A coluna Situação é a razão de a lista trazer conta inativa: sem ela a
 * tela seria de contas ativas e a coluna diria sempre a mesma coisa.
 *
 * A conta corrente e a aplicação automática dela (ContaMax, Rende Fácil)
 * viram uma linha só, com o saldo somado (decisão 249): o banco aplica
 * sozinho o que sobra na corrente, e só a soma das duas faz sentido. A linha
 * do par abre e recolhe as duas pela primeira coluna, com o ícone do
 * "Recolher todos" das planilhas; o "›" da direita fica só para abrir a
 * conta. Os pares chegam fechados.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { FAIXA_GRUPO_LISTA, TOTAL_LISTA, TOTAL_LISTA_FUNDO } from "@/app/(app)/_planilha/blocos";
import { dataCurta, hrefExtrato, TIPO_CONTA_LABEL, type ContaResumo } from "./hub-periodo";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

/**
 * As colunas que filtram e ordenam pelo título, como no Excel (sugestão aprovada em
 * 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job). Fica sem
 * filtro só a seta da linha. A empresa contábil é a faixa do grupo, não
 * coluna: quem filtra empresa é a busca de cima, como hoje.
 */
const COLUNAS: ColunaFiltravel<ContaResumo>[] = [
  {
    // A busca da coluna acha pelo tipo e pela agência/conta também.
    chave: "conta",
    rotulo: "Conta",
    tipo: "texto",
    celula: (c) => ({
      ...celulaTexto(c.nome),
      busca: `${c.nome} ${TIPO_CONTA_LABEL[c.tipo] ?? c.tipo} ${c.agenciaConta ?? ""}`,
    }),
  },
  { chave: "banco", rotulo: "Banco", tipo: "texto", celula: (c) => celulaTexto(c.banco) },
  {
    chave: "situacao",
    rotulo: "Situação",
    tipo: "texto",
    celula: (c) => ({ ...celulaTexto(c.ativa ? "Ativa" : "Inativa"), ordemNaLista: c.ativa ? 0 : 1 }),
  },
  { chave: "ultimo", rotulo: "Último mov.", tipo: "data", alinhar: "right", celula: (c) => celulaData(c.ultimoMovimento) },
  {
    // Contagem: a lista mostra os números, e "—" para a conta sem lançamento.
    chave: "lancamentos",
    rotulo: "Lanç.",
    tipo: "valor",
    alinhar: "right",
    celula: (c) => ({
      valor: String(c.lancamentosPeriodo),
      rotulo: c.lancamentosPeriodo ? String(c.lancamentosPeriodo) : "—",
      ordem: c.lancamentosPeriodo,
    }),
  },
  {
    chave: "entradas",
    rotulo: "Entradas",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (c) => celulaValor(c.creditosPeriodo, formatCurrency),
  },
  {
    chave: "saidas",
    rotulo: "Saídas",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (c) => celulaValor(c.debitosPeriodo, formatCurrency),
  },
  {
    chave: "saldo",
    rotulo: "Saldo atual",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (c) => celulaValor(c.saldoAtual, formatCurrency),
  },
];

/** Os títulos desta tabela são em caixa normal, sem o espaçamento largo:
 *  o botão do filtro segue o desenho dela. */
const TITULO = "normal-case tracking-normal";

/** Larguras fixas: Conta fica com a sobra. A primeira, de 32 px, é a do
 *  expandir do par, como na lista de Jobs. */
function Colunas() {
  return (
    <colgroup>
      <col className="w-[32px]" />
      <col />
      <col className="w-[180px]" />
      <col className="w-[120px]" />
      <col className="w-[120px]" />
      <col className="w-[84px]" />
      <col className="w-[160px]" />
      <col className="w-[160px]" />
      <col className="w-[180px]" />
      <col className="w-[44px]" />
    </colgroup>
  );
}

/** Célula sem valor: o traço fica claro para não pesar na leitura. */
function Traco() {
  return <span className="text-muted-foreground/40">—</span>;
}

/** O expandir da linha do par: o ícone do "Recolher todos" das planilhas
 *  (`_planilha/recolher-grupos.tsx`), numa caixinha, sem texto. */
function Expandir({ aberto }: { aberto: boolean }) {
  const Icone = aberto ? ChevronsDownUp : ChevronsUpDown;
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-white align-middle text-muted-foreground transition-colors group-hover:border-california-red/40 group-hover:text-california-red">
      <Icone className="h-3.5 w-3.5" />
    </span>
  );
}

type Item =
  | { tipo: "conta"; conta: ContaResumo }
  | { tipo: "par"; corrente: ContaResumo; aplicacao: ContaResumo };

/** As linhas da empresa, com o par junto na posição da primeira das duas.
 *  Só vira par quando as duas estão na lista e ativas: com uma escondida
 *  pelo filtro ou inativa, cada uma segue na sua linha. */
function itensDo(lista: ContaResumo[]): Item[] {
  const porId = new Map(lista.map((c) => [c.id, c]));
  const usados = new Set<string>();
  const itens: Item[] = [];
  for (const c of lista) {
    if (usados.has(c.id)) continue;
    const outroId = c.aplicacaoId ?? c.correnteId;
    const outro = outroId ? porId.get(outroId) : undefined;
    if (outro && c.ativa && outro.ativa && !usados.has(outro.id)) {
      const corrente = c.aplicacaoId ? c : outro;
      const aplicacao = c.aplicacaoId ? outro : c;
      usados.add(corrente.id);
      usados.add(aplicacao.id);
      itens.push({ tipo: "par", corrente, aplicacao });
    } else {
      usados.add(c.id);
      itens.push({ tipo: "conta", conta: c });
    }
  }
  return itens;
}

/** O produto da aplicação ("ContaMax", "Rende Fácil"): o nome dela sem as
 *  palavras que já estão no nome da corrente e no do banco. Sem sobra, o
 *  nome inteiro. */
function produtoDaAplicacao(corrente: ContaResumo, aplicacao: ContaResumo): string {
  const comuns = new Set(`${corrente.nome} ${aplicacao.banco}`.toLowerCase().split(/\s+/));
  const resto = aplicacao.nome.split(/\s+/).filter((p) => !comuns.has(p.toLowerCase()));
  return resto.length ? resto.join(" ") : aplicacao.nome;
}

export function HubTabela({
  contas,
  de,
  ate,
  totais,
}: {
  contas: ContaResumo[];
  de: string;
  ate: string;
  totais: {
    saldo: number;
    creditos: number;
    debitos: number;
    lancamentos: number;
    /** Quantas contas ATIVAS entraram no consolidado. */
    contas: number;
  };
}) {
  const [busca, setBusca] = React.useState("");
  /** Os pares abertos, pela conta corrente. Chegam fechados. */
  const [abertos, setAbertos] = React.useState<Set<string>>(() => new Set());
  const alternar = (correnteId: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(correnteId)) n.delete(correnteId);
      else n.add(correnteId);
      return n;
    });

  /** As contas que passam na busca de cima. Os títulos filtram depois. */
  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q
      ? contas.filter(
          (c) =>
            c.nome.toLowerCase().includes(q) ||
            c.banco.toLowerCase().includes(q) ||
            c.empresaContabil.toLowerCase().includes(q),
        )
      : contas;
  }, [contas, busca]);
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "conciliacao-contas" });

  const grupos = React.useMemo(() => {
    const filtradas = colunas.visiveis;

    const mapa = new Map<string, ContaResumo[]>();
    for (const c of filtradas) {
      const lista = mapa.get(c.empresaContabil) ?? [];
      lista.push(c);
      mapa.set(c.empresaContabil, lista);
    }
    return [...mapa.entries()]
      // Subtotal e total somam só conta ATIVA — é o mesmo critério do card
      // de consolidado. A linha da conta inativa continua na lista, com o
      // saldo dela em cinza, para deixar claro que está fora da conta.
      .map(([empresa, lista]) => {
        const ativas = lista.filter((c) => c.ativa);
        return {
          empresa,
          contas: lista,
          itens: itensDo(lista),
          inativas: lista.length - ativas.length,
          saldo: ativas.reduce((a, c) => a + c.saldoAtual, 0),
          creditos: ativas.reduce((a, c) => a + c.creditosPeriodo, 0),
          debitos: ativas.reduce((a, c) => a + c.debitosPeriodo, 0),
          lancamentos: ativas.reduce((a, c) => a + c.lancamentosPeriodo, 0),
        };
      })
      // Com ordem pelo título, as contas vêm naquela ordem dentro da
      // empresa, e a empresa entra na posição da sua primeira conta (o
      // `Map` guarda a ordem de chegada). Sem ordem, as empresas em ordem
      // alfabética — California, GoCrazy, Hitlab (pedido do Tiago em
      // 16/10/2026; antes era a de maior saldo primeiro).
      .sort((a, b) =>
        colunas.ordenacao ? 0 : a.empresa.localeCompare(b.empresa, "pt-BR"),
      );
  }, [colunas.visiveis, colunas.ordenacao]);

  // A busca OU um título filtrando: o rodapé vira "Total do filtro".
  const filtrando = busca.trim().length > 0 || colunas.filtrando;
  const vistas = grupos.reduce(
    (a, g) => a + g.contas.filter((c) => c.ativa).length,
    0,
  );
  const inativasVistas = grupos.reduce((a, g) => a + g.inativas, 0);
  const saldoInativasVistas = grupos.reduce(
    (a, g) =>
      a + g.contas.filter((c) => !c.ativa).reduce((s, c) => s + c.saldoAtual, 0),
    0,
  );
  const somaVisivel = {
    saldo: grupos.reduce((a, g) => a + g.saldo, 0),
    creditos: grupos.reduce((a, g) => a + g.creditos, 0),
    debitos: grupos.reduce((a, g) => a + g.debitos, 0),
    lancamentos: grupos.reduce((a, g) => a + g.lancamentos, 0),
  };
  const rodape = filtrando ? somaVisivel : totais;

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por conta, banco ou empresa..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="conta"
          plural="contas"
          onLimpar={colunas.limpar}
        />
      )}

      {/* Vazio de verdade é a BUSCA sem resultado. Se foram os títulos, a
          tabela fica (com eles, para desfazer). */}
      {doTopo.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta corresponde à busca.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          {/* As colunas fixas somam 1.080 px: o mínimo deixa 240 px para Conta,
              que some quando a tela é estreita. */}
          <table className="w-full min-w-[1320px] table-fixed text-sm">
            <Colunas />
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="w-8 px-2 py-3" aria-label="Expandir" />
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {colunas.titulo("conta", TITULO)}
                </th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">
                  {colunas.titulo("banco", TITULO)}
                </th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">
                  {colunas.titulo("situacao", TITULO)}
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">
                  {colunas.titulo("ultimo", TITULO)}
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">
                  {colunas.titulo("lancamentos", TITULO)}
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">
                  {colunas.titulo("entradas", TITULO)}
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">
                  {colunas.titulo("saidas", TITULO)}
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  {colunas.titulo("saldo", TITULO)}
                </th>
                <th className="px-2 py-3" />
              </tr>
            </thead>

            {grupos.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma conta com esse filtro.
                  </td>
                </tr>
              </tbody>
            )}
            {grupos.map((g) => (
              <tbody key={g.empresa}>
                {/* A faixa da empresa, com o subtotal do grupo nas colunas
                    de valor. */}
                <tr className="h-11">
                  <td className={FAIXA_GRUPO_LISTA} />
                  <td colSpan={4} className={`${FAIXA_GRUPO_LISTA} px-4`}>
                    <span className="text-sm font-semibold text-foreground">
                      {g.empresa}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {g.contas.length}{" "}
                      {g.contas.length === 1 ? "conta" : "contas"}
                      {g.inativas > 0 &&
                        ` · ${g.inativas} ${g.inativas === 1 ? "inativa" : "inativas"}`}
                    </span>
                  </td>
                  <td className={`${FAIXA_GRUPO_LISTA} px-3 text-right text-xs text-muted-foreground tabular-nums`}>
                    {g.lancamentos || "—"}
                  </td>
                  <td className={`${FAIXA_GRUPO_LISTA} whitespace-nowrap px-3 text-right font-mono text-xs tabular-nums`}>
                    {g.creditos > 0 ? (
                      <span className="text-emerald-700">{formatCurrency(g.creditos)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={`${FAIXA_GRUPO_LISTA} whitespace-nowrap px-3 text-right font-mono text-xs tabular-nums`}>
                    {g.debitos > 0 ? (
                      <span className="text-california-red">{formatCurrency(g.debitos)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td
                    className={`${FAIXA_GRUPO_LISTA} whitespace-nowrap px-4 text-right font-mono text-sm font-semibold tabular-nums ${
                      g.saldo < 0 ? "text-california-red" : "text-foreground"
                    }`}
                  >
                    {formatCurrency(g.saldo)}
                  </td>
                  <td className={FAIXA_GRUPO_LISTA} />
                </tr>

                {g.itens.map((it) => {
                  if (it.tipo === "conta") {
                    return <LinhaConta key={it.conta.id} c={it.conta} de={de} ate={ate} />;
                  }
                  const { corrente, aplicacao } = it;
                  const aberto = abertos.has(corrente.id);
                  return (
                    <React.Fragment key={corrente.id}>
                      <LinhaDoPar
                        corrente={corrente}
                        aplicacao={aplicacao}
                        aberto={aberto}
                        onAlternar={() => alternar(corrente.id)}
                      />
                      {aberto && <LinhaConta c={corrente} de={de} ate={ate} sub />}
                      {aberto && <LinhaConta c={aplicacao} de={de} ate={ate} sub />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            ))}

            <tfoot>
              <tr>
                <td className={TOTAL_LISTA} />
                <td className={`${TOTAL_LISTA} px-4 py-3 font-semibold`} colSpan={4}>
                  {filtrando
                    ? `Total do filtro · ${vistas} ${vistas === 1 ? "conta ativa" : "contas ativas"}`
                    : `Total geral · ${totais.contas} ${totais.contas === 1 ? "conta ativa" : "contas ativas"}`}
                </td>
                <td className={`${TOTAL_LISTA} px-3 py-3 text-right font-medium tabular-nums`}>
                  {rodape.lancamentos || "—"}
                </td>
                <td className={`${TOTAL_LISTA} whitespace-nowrap px-3 py-3 text-right font-mono font-medium text-emerald-700 tabular-nums`}>
                  {formatCurrency(rodape.creditos)}
                </td>
                <td className={`${TOTAL_LISTA} whitespace-nowrap px-3 py-3 text-right font-mono font-medium text-california-red tabular-nums`}>
                  {formatCurrency(rodape.debitos)}
                </td>
                <td
                  className={`${TOTAL_LISTA} whitespace-nowrap px-4 py-3 text-right font-mono font-bold tabular-nums ${
                    rodape.saldo < 0 ? "text-california-red" : "text-foreground"
                  }`}
                >
                  {formatCurrency(rodape.saldo)}
                </td>
                <td className={TOTAL_LISTA} />
              </tr>
              {inativasVistas > 0 && (
                <tr className={`${TOTAL_LISTA_FUNDO} text-[11px] text-muted-foreground`}>
                  <td className="px-4 pb-3" colSpan={8}>
                    Fora do total: {inativasVistas}{" "}
                    {inativasVistas === 1 ? "conta inativa" : "contas inativas"}
                    , com {formatCurrency(saldoInativasVistas)} em saldo.
                  </td>
                  <td className="whitespace-nowrap px-4 pb-3 text-right font-mono">
                    {formatCurrency(saldoInativasVistas)}
                  </td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** A linha de uma conta. `sub`: a corrente ou a aplicação dentro do par
 *  aberto, recuada sob o nome dele. */
function LinhaConta({ c, de, ate, sub = false }: { c: ContaResumo; de: string; ate: string; sub?: boolean }) {
  return (
    <tr
      className={`group relative border-b border-border transition-colors last:border-b-0 hover:bg-muted/50 ${sub ? "bg-muted/25" : ""}`}
    >
      <td className="w-8 px-2 py-2.5" />
      <td className={`py-2.5 ${sub ? "pl-10 pr-4" : "px-4"}`}>
        <Link
          href={hrefExtrato(c.id, de, ate)}
          prefetch={false}
          className="block truncate font-medium text-foreground after:absolute after:inset-0 group-hover:text-california-red"
        >
          {c.nome}
        </Link>
        <span className="block truncate text-xs text-muted-foreground">
          {TIPO_CONTA_LABEL[c.tipo] ?? c.tipo}
          {c.agenciaConta ? ` · ${c.agenciaConta}` : ""}
        </span>
      </td>
      <td className="truncate px-3 py-2.5 text-muted-foreground">
        {c.banco}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {/* "Ativa" é quase todas as linhas: ponto e texto, sem
            pílula. A inativa, que é a exceção, mantém o selo. */}
        {c.ativa ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Ativa
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            Inativa
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground tabular-nums">
        {c.ultimoMovimento ? dataCurta(c.ultimoMovimento) : <Traco />}
      </td>
      <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">
        {c.lancamentosPeriodo || <Traco />}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
        {c.creditosPeriodo > 0 ? (
          <span className="text-emerald-700">
            {formatCurrency(c.creditosPeriodo)}
          </span>
        ) : (
          <Traco />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
        {c.debitosPeriodo > 0 ? (
          <span className="text-california-red">
            {formatCurrency(c.debitosPeriodo)}
          </span>
        ) : (
          <Traco />
        )}
      </td>
      <td
        className={`whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${
          !c.ativa
            ? "text-muted-foreground"
            : c.saldoAtual < 0
              ? "text-california-red"
              : "text-foreground"
        }`}
        title={
          c.ativa
            ? undefined
            : "Conta inativa — fora do saldo consolidado"
        }
      >
        {formatCurrency(c.saldoAtual)}
      </td>
      <td className="px-2 py-2.5 text-right">
        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-california-red" />
      </td>
    </tr>
  );
}

/** A linha do par: a corrente e a aplicação somadas. A linha inteira abre e
 *  recolhe as duas, como o grupo da lista de Jobs. */
function LinhaDoPar({
  corrente,
  aplicacao,
  aberto,
  onAlternar,
}: {
  corrente: ContaResumo;
  aplicacao: ContaResumo;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const saldo = corrente.saldoAtual + aplicacao.saldoAtual;
  const creditos = corrente.creditosPeriodo + aplicacao.creditosPeriodo;
  const debitos = corrente.debitosPeriodo + aplicacao.debitosPeriodo;
  const lancamentos = corrente.lancamentosPeriodo + aplicacao.lancamentosPeriodo;
  const ultimo = [corrente.ultimoMovimento, aplicacao.ultimoMovimento].filter(Boolean).sort().pop() ?? null;
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-expanded={aberto}
      onClick={onAlternar}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAlternar();
        }
      }}
      className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
      <td className="w-8 px-0 py-2.5 text-center">
        <Expandir aberto={aberto} />
      </td>
      <td className="px-4 py-2.5">
        <span className="block truncate font-medium text-foreground group-hover:text-california-red">
          {corrente.nome} · corrente + {produtoDaAplicacao(corrente, aplicacao)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          Corrente + aplicação automática
          {corrente.agenciaConta ? ` · ${corrente.agenciaConta}` : ""}
        </span>
      </td>
      <td className="truncate px-3 py-2.5 text-muted-foreground">{corrente.banco}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Ativa
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground tabular-nums">
        {ultimo ? dataCurta(ultimo) : <Traco />}
      </td>
      <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{lancamentos || <Traco />}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
        {creditos > 0 ? <span className="text-emerald-700">{formatCurrency(creditos)}</span> : <Traco />}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
        {debitos > 0 ? <span className="text-california-red">{formatCurrency(debitos)}</span> : <Traco />}
      </td>
      <td
        className={`whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${
          saldo < 0 ? "text-california-red" : "text-foreground"
        }`}
      >
        {formatCurrency(saldo)}
      </td>
      <td className="px-2 py-2.5" />
    </tr>
  );
}
