import * as React from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  Banknote,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Eye,
  FileText,
  HandCoins,
  Info,
  Landmark,
  Lock,
  MoreHorizontal,
  Pencil,
  PiggyBank,
  Plus,
  Receipt,
  Repeat,
  Scale,
  Trash2,
  Undo2,
  Upload,
  XCircle,
} from "lucide-react";
import { CARTOES, CONTAS, HOJE } from "./data";
import { BotaoDetalhes, LinhaAberta, tituloDoLancamento } from "./detalhes";

/** A variante do ⓘ (A, B ou C) e quem abre os documentos — vêm da barra
 *  do protótipo e do App. */
export const DetalhesContexto = React.createContext({ variante: "a", onVerDocumentos: () => {}, abrirAcao: () => {}, titulos: [], regional: 0, sinalBanco: "faixa", faturas: [] });
import {
  Botao,
  Busca,
  Caixa,
  Chip,
  CHIP_TIPO,
  Dica,
  centroTexto,
  cn,
  dataBR,
  diaDaSemana,
  Menu,
  moeda,
  OrigemPill,
  Pill,
  StatusChip,
  Th,
  trimestre,
} from "./ui";
import {
  aberto,
  casaVencimento,
  comSaldoPrevisto,
  dataEfetiva,
  descricaoDoLancamento,
  efeitoNaConta,
  entra,
  motivoForaDoLote,
  ORIGEM_DO_LOTE,
  colunasDaRegional,
  r2,
  regionalDe,
  textoDaRegional, comoRecomendada,
  celulaDoModulo,
  centrosDosItens,
  faturaDestino,
  rotuloCompetencia,
} from "./logica";

// ===========================================================================
// A aba Títulos como está hoje (conciliacao/aba-titulos.tsx)
// ===========================================================================

function linhaAtual(t) {
  if (t.lado === "pagar") {
    const origem =
      t.origem === "pp"
        ? t.nf
          ? `${t.ref} · NF ${t.nf}`
          : t.ref
        : t.origem === "recorrencia"
          ? "Recorrência"
          : t.origem === "desembolso"
            ? `Desembolso ${t.ref}`
            : t.origem === "verba"
              ? `Estorno de verba ${t.ref.replace(/^ESTORNO /, "")}`
              : t.origem === "fatura"
                ? `Fatura de cartão ${t.ref}`
                : t.origem === "folha"
                  ? "Folha de pagamento"
                  : "Lançamento avulso";
    return { titulo: t.titulo, referencia: t.parcela[1] > 1 ? `${origem} · parcela ${t.parcela[0]}/${t.parcela[1]}` : origem };
  }
  if (t.lado === "receber") {
    if (t.origem === "nf") return { titulo: t.titulo, referencia: t.descricaoNf };
    return { titulo: t.titulo, referencia: `${t.ref} · ${t.origem === "rendimento" ? "Rendimento" : "Recebimento avulso"}` };
  }
  if (t.lado === "imposto") return { titulo: `${t.titulo}${t.cota ? ` · cota ${t.cota}` : ""}`, referencia: `${t.ref} · ${t.competencia}` };
  return { titulo: t.titulo, referencia: t.ref };
}

/** A coluna Vencimento da aba de hoje: no a pagar, a data de pagamento
 *  vigente; no a receber, o vencimento da nota (aba-titulos.tsx). */
function dataDaAbaDeHoje(t) {
  return t.lado === "receber" ? t.vencOrig ?? t.vencimento : t.vencimento;
}

export function AbaTitulosAtual({ titulos, onBaixar, onLote }) {
  const [venc, setVenc] = React.useState("todos");
  const [tipo, setTipo] = React.useState("todos");
  const [busca, setBusca] = React.useState("");
  // A aba de hoje não mostra a transferência "A transferir" (decisão 140).
  const linhas = titulos.filter((t) => !t.pagoEm && t.lado !== "transf");
  const base = linhas.filter(
    (t) => casaVencimento(dataDaAbaDeHoje(t), venc) && (!busca || `${t.titulo} ${t.contraparte} ${t.empresa} ${t.job?.codigo ?? ""}`.toLowerCase().includes(busca.toLowerCase())),
  );
  const cont = (l) => (l === "todos" ? base.length : base.filter((t) => t.lado === l).length);
  const visiveis = (tipo === "todos" ? base : base.filter((t) => t.lado === tipo)).sort(
    (a, b) => dataDaAbaDeHoje(a).localeCompare(dataDaAbaDeHoje(b)) || a.lado.localeCompare(b.lado),
  );
  const sel = useSelecaoDoLote(visiveis);

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        Tudo que aguarda baixa no financeiro — igual para todas as contas. A conta escolhida acima já vem marcada na baixa.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vencimento</span>
        {[
          ["vencidos", "Vencidos"],
          ["ate_hoje", "Até hoje"],
          ["proximos_7", "Próximos 7 dias"],
          ["todos", "Todos"],
        ].map(([k, l]) => (
          <StatusChip key={k} ativo={venc === k} onClick={() => setVenc(k)} label={l} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Busca value={busca} onChange={setBusca} placeholder="Buscar por título, contraparte, empresa ou job..." />
        {[
          ["todos", "Todos"],
          ["pagar", "A pagar"],
          ["receber", "A receber"],
          ["imposto", "Impostos"],
        ].map(([k, l]) => (
          <Chip key={k} ativo={tipo === k} onClick={() => setTipo(k)} label={l} count={cont(k)} />
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1100px] table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[3%] py-3 pl-4 pr-1 font-semibold">
                <Caixa {...sel.cabecalho} />
              </th>
              <Th className="w-[8%]" alinhar="center">Vencimento</Th>
              <Th className="w-[8%]" alinhar="center">Tipo</Th>
              <Th className="w-[24%]">Título</Th>
              <Th className="w-[17%]">Contraparte</Th>
              <Th className="w-[10%]">Empresa</Th>
              <Th className="w-[11%]">Job</Th>
              <Th className="w-[12%]" alinhar="right">Valor</Th>
              <th className="w-[7%] px-3 py-3 font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((t) => {
              const vencido = dataDaAbaDeHoje(t) < HOJE;
              const { titulo, referencia } = linhaAtual(t);
              const motivo = sel.motivo(t);
              return (
                <tr
                  key={t.id}
                  onClick={motivo ? undefined : () => sel.alternar(t)}
                  className={cn("border-b border-border last:border-0 hover:bg-accent/40", !motivo && "cursor-pointer", sel.marcado(t) && "bg-california-red/[0.04]")}
                >
                  <td className="py-3 pl-4 pr-1 text-center" title={motivo ?? undefined}>
                    <Caixa marcado={sel.marcado(t)} onClick={() => sel.alternar(t)} desligada={!!motivo} title={motivo ?? undefined} />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span className={cn("whitespace-nowrap font-mono text-xs", vencido && "font-semibold text-california-red")}>{dataBR(dataDaAbaDeHoje(t))}</span>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <Pill className={CHIP_TIPO[t.lado][1]}>{CHIP_TIPO[t.lado][0]}</Pill>
                  </td>
                  <td className="px-3 py-3">
                    <span className="block break-words font-semibold">{titulo}</span>
                    <span className="line-clamp-2 text-[11px] text-muted-foreground">{referencia}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <span className="block truncate">{t.contraparte}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <span className="block truncate">{t.lado === "imposto" ? t.pj : t.empresa}</span>
                  </td>
                  <td className="px-2 py-3 font-mono text-xs text-muted-foreground">{t.job?.codigo ?? "—"}</td>
                  <td className={cn("whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums", t.entra && "text-emerald-700")}>
                    {t.entra ? "+ " : "− "}
                    {moeda(t.origem === "pp" ? t.valor - (t.baixado ?? 0) : aberto(t))}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBaixar(t);
                      }}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                    >
                      <CreditCard className="h-3 w-3" />
                      Baixar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <BarraDeSelecao itens={sel.itens} onLimpar={sel.limpar} onBaixar={() => onLote(sel.itens, sel.limpar)} />
    </div>
  );
}

// ===========================================================================
// Seleção do lote (uma origem por lote, decisão 140 §6)
// ===========================================================================

export function useSelecaoDoLote(visiveis, opcoes = {}) {
  const [ids, setIds] = React.useState(() => new Set());
  const itens = visiveis.filter((t) => ids.has(t.id));
  const origem = itens[0]?.origem ?? null;
  const motivo = (t) => {
    const m = motivoForaDoLote(t, opcoes);
    if (m) return m;
    if (origem && t.origem !== origem && !ids.has(t.id)) return `Só uma origem por lote: os títulos marcados são de ${ORIGEM_DO_LOTE[origem] ?? origem}.`;
    return null;
  };
  const elegiveis = visiveis.filter((t) => !motivo(t));
  const origensVisiveis = new Set(visiveis.filter((t) => !motivoForaDoLote(t, opcoes)).map((t) => t.origem));
  const podeTodos = origem !== null || origensVisiveis.size === 1;
  const todos = elegiveis.length > 0 && elegiveis.every((t) => ids.has(t.id));
  return {
    itens,
    marcado: (t) => ids.has(t.id),
    motivo,
    alternar: (t) =>
      setIds((p) => {
        const n = new Set(p);
        n.has(t.id) ? n.delete(t.id) : n.add(t.id);
        return n;
      }),
    limpar: () => setIds(new Set()),
    cabecalho: {
      marcado: todos,
      desligada: !podeTodos,
      title: podeTodos
        ? `Selecionar todos os títulos de ${ORIGEM_DO_LOTE[origem ?? [...origensVisiveis][0]] ?? ""}`
        : "Marque um título, ou filtre uma origem, para selecionar todos.",
      onClick: () => setIds(todos ? new Set() : new Set(elegiveis.map((t) => t.id))),
    },
  };
}

export function BarraDeSelecao({ itens, onLimpar, onBaixar, saldoDepois, nomeConta, onVerNoExtrato }) {
  if (itens.length === 0) return null;
  const saem = r2(itens.filter((t) => !entra(t)).reduce((s, t) => s + aberto(t), 0));
  const entram = r2(itens.filter((t) => entra(t)).reduce((s, t) => s + aberto(t), 0));
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
      <div className="pointer-events-auto flex flex-wrap items-center gap-4 rounded-2xl bg-[#282828] py-2.5 pl-5 pr-2.5 text-sm text-white shadow-elevated">
        <span className="font-semibold">
          {itens.length} {itens.length === 1 ? "título selecionado" : "títulos selecionados"}
        </span>
        <span className="h-4 w-px bg-white/20" />
        {saem > 0 && (
          <span className="text-white/75">
            Saem <strong className="font-mono font-semibold text-white">{moeda(saem)}</strong>
          </span>
        )}
        {entram > 0 && (
          <span className="text-white/75">
            Entram <strong className="font-mono font-semibold text-emerald-300">{moeda(entram)}</strong>
          </span>
        )}
        {saldoDepois !== undefined && (
          <span className="text-white/75">
            {nomeConta} fica com{" "}
            <strong className={cn("font-mono font-semibold", saldoDepois < 0 ? "text-red-300" : "text-white")}>{moeda(saldoDepois)}</strong>
          </span>
        )}
        <button type="button" onClick={onLimpar} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-white/10 hover:text-white">
          Limpar seleção
        </button>
        {onVerNoExtrato && (
          <button
            type="button"
            onClick={onVerNoExtrato}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
          >
            <Eye className="h-3.5 w-3.5" />
            Ver no Extrato antes
          </button>
        )}
        <button
          type="button"
          onClick={onBaixar}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          <CreditCard className="h-3.5 w-3.5" />
          {itens.length === 1 ? "Dar baixa" : `Dar baixa em ${itens.length}`}
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// O novo desenho: os títulos nas colunas da planilha da conciliação
// ===========================================================================

/** As ações da linha, por origem — as mesmas das telas de cada módulo. */
export function acoesDoTitulo(t, abrir) {
  const a = (acao, label, icone, extra = {}) => ({ label, icone, onClick: () => abrir(acao, t), ...extra });
  switch (t.origem) {
    case "pp":
      return [
        a("abrir_pp", "Abrir a PP", FileText, { ajuda: `${t.ref} · dossiê, anexos e chat` }),
        ...(t.baixado > 0 ? [a("ver_baixas", "Ver as baixas registradas", Eye)] : []),
      ];
    case "avulso":
    case "recorrencia":
      return [a("abrir_avulso", "Abrir o lançamento", FileText)];
    case "folha":
      return [a("devolver_folha", "Devolver para a aprovação", Undo2, { ajuda: "Para corrigir valor ou pagamento" })];
    case "desembolso":
      return [a("abrir_avulso", "Abrir o desembolso", FileText)];
    case "fatura":
      return [a("abrir_avulso", "Abrir a fatura no Cartão", CreditCard)];
    case "verba":
      return [a("abrir_pp", "Abrir a PP da verba", FileText)];
    case "nf":
      return [
        a("info_nf", "Informações de faturamento e cobrança", Info, { ajuda: "PO, descrição da NF e contatos de cobrança" }),
      ];
    case "rec_avulso":
    case "rendimento":
      return [a("excluir", "Excluir este título", Trash2, { perigo: true, cor: "text-california-red", ajuda: "Criado por engano; nada sai do extrato" })];
    case "transferencia":
      return [a("excluir", "Excluir a transferência", Trash2, { perigo: true, cor: "text-california-red" })];
    case "imposto":
      return [
        a("abrir_apuracao", "Abrir na Apuração", FileText, { ajuda: "O valor da guia se corrige lá" }),
        a("ver_guia", "Ver a guia", FileText, { ajuda: t.guiaArquivo }),
        a("cancelar_imposto", "Cancelar o imposto", XCircle, { perigo: true, cor: "text-california-red", ajuda: "Deixou de ser devido, com motivo" }),
      ];
    default:
      return [];
  }
}

const MENU_NOVO = (abrir) => [
  { secao: "A pagar" },
  { label: "Pagamento avulso", ajuda: "Conta a pagar sem PP: material, serviço, taxa", icone: Wallet2, cor: "text-california-red", onClick: () => abrir("novo_pagamento") },
  { label: "Recorrência a pagar", ajuda: "Aluguel, internet, contabilidade: vira título 30 dias antes", icone: Repeat, onClick: () => abrir("nova_recorrencia") },
  { label: "Imposto avulso", ajuda: "Guia que não passou pela apuração", icone: Scale, onClick: () => abrir("novo_imposto") },
  { secao: "A receber" },
  { label: "Recebimento avulso", ajuda: "Entrou dinheiro sem nota fiscal", icone: Banknote, cor: "text-emerald-700", onClick: () => abrir("novo_recebimento", null, "avulso") },
  { label: "Recebimento antes da NF", ajuda: "O cliente pagou antes de a nota sair", icone: HandCoins, cor: "text-emerald-700", onClick: () => abrir("antes_nf") },
  { label: "Rendimento de aplicação", ajuda: "Rendimento líquido do mês", icone: PiggyBank, cor: "text-emerald-700", onClick: () => abrir("novo_recebimento", null, "rendimento") },
  { secao: "Entre contas" },
  { label: "Transferência entre contas", ajuda: "Dinheiro que só muda de conta: fica fora do DRE", icone: ArrowLeftRight, cor: "text-sky-700", onClick: () => abrir("novo_recebimento", null, "transferencia") },
];

function Wallet2(props) {
  return <Receipt {...props} />;
}

export function BotaoNovoLancamento({ abrir }) {
  return (
    <Menu
      largura={330}
      gatilho={(alternar, aberto) => (
        <Botao onClick={alternar}>
          <Plus className="h-4 w-4" />
          Novo lançamento
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-180")} />
        </Botao>
      )}
      itens={MENU_NOVO(abrir)}
    />
  );
}

/**
 * A tabela de títulos nas colunas do Extrato: Data · Crédito · Débito ·
 * Saldo · Descrição · Fornecedor · Job · Centro de Custo · Trimestre ·
 * Empresa. Cada linha é o lançamento que a baixa vai gravar.
 */
export function PlanilhaDeTitulos({
  linhas, // [{t, saldo, efeito}]
  sel,
  mostrarSaldo,
  agrupar,
  colunaStatus,
  rotuloData = "Data prevista",
  rotuloContraparte = "Fornecedor / Cliente",
  onBaixar,
  abrir,
  contaId = "cs",
  sugestoes = {},
  saldoHoje,
  vazio = "Nenhum título com esses filtros.",
  colunasValor = ["credito", "debito"],
  // "pagar" (Contas a Pagar, Impostos a Pagar) ou "receber" (Contas a
  // Receber). O módulo não tem conta: a coluna do valor sai de `regra`
  // ("dre", a pedida; "banco", a recomendada — ver celulaDoModulo). Sem
  // módulo (aba Títulos), as duas colunas valem pela conta.
  modulo,
  regra = "dre",
  // A coluna que o módulo nunca usa: fica fina, só com "—" (pedido do
  // Tiago, 20/10/2026).
  colunaFina = null,
}) {
  const colReg = colunasDaRegional(React.useContext(DetalhesContexto).regional);
  const vazia = colunaFina;
  const cols = [
    ["sel", 36],
    ["data", 122],
    ...(colunasValor.includes("credito") ? [["credito", vazia === "credito" ? 72 : 116]] : []),
    ...(colunasValor.includes("debito") ? [["debito", vazia === "debito" ? 72 : 116]] : []),
    ...(mostrarSaldo ? [["saldo", 128]] : []),
    ["descricao", null],
    ["contraparte", 200],
    ["job", 104],
    ["centro", 176],
    ["trim", colReg.larguraTrimestre],
    ["empresa", 130],
    ...(colReg.comRegional ? [["regional", colReg.larguraRegional]] : []),
    ...(colunaStatus ? [["status", 120]] : []),
    ["acao", 120],
  ];
  const nCols = cols.length;
  const detalhes = React.useContext(DetalhesContexto);
  const [abertas, setAbertas] = React.useState(() => new Set());
  const alternarAberta = (id) =>
    setAbertas((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  // As faturas de cartão abertas em itens, embaixo da linha.
  const [comItens, setComItens] = React.useState(() => new Set());
  const alternarItens = (id) =>
    setComItens((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const grupos = [];
  linhas.forEach((l) => {
    const d = agrupar ? dataEfetiva(l.t) : "_";
    let g = grupos[grupos.length - 1];
    if (!g || g.data !== d) grupos.push((g = { data: d, linhas: [] }));
    g.linhas.push(l);
  });
  const total = modulo
    ? totalDoModulo(linhas, modulo, regra)
    : linhas.reduce(
        (s, l) => ({ c: s.c + (l.efeito > 0 ? l.efeito : 0), d: s.d + (l.efeito < 0 ? -l.efeito : 0), transf: 0 }),
        { c: 0, d: 0, transf: 0 },
      );
  const traco = <td className="px-1 py-2.5 text-center text-muted-foreground/40">—</td>;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1480px] table-fixed text-sm">
        <colgroup>
          {cols.map(([k, w]) => (
            <col key={k} style={w ? { width: w } : undefined} />
          ))}
        </colgroup>
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pl-3 pr-1 text-center">
              <Caixa {...sel.cabecalho} />
            </th>
            <Th>{rotuloData}</Th>
            {colunasValor.includes("credito") &&
              (vazia === "credito" ? (
                <th className="px-1 py-3 text-center font-semibold" title="Nenhum título deste módulo entra na conta como crédito.">
                  Crédito
                </th>
              ) : (
                <Th alinhar="right">Crédito</Th>
              ))}
            {colunasValor.includes("debito") &&
              (vazia === "debito" ? (
                <th className="px-1 py-3 text-center font-semibold" title="Nenhum título deste módulo sai da conta como débito.">
                  Débito
                </th>
              ) : (
                <Th alinhar="right">Débito</Th>
              ))}
            {mostrarSaldo && (
              <th className="px-3 py-3 text-right font-semibold" title="Saldo desta conta se cada título for baixado nela, na data prevista. O vencido entra como hoje. Não muda com o filtro, como o Saldo do Extrato.">
                Saldo previsto
              </th>
            )}
            <Th>Descrição</Th>
            <Th>{rotuloContraparte}</Th>
            <Th>Job</Th>
            <Th>Centro de Custo</Th>
            <Th alinhar="center">{colReg.rotuloTrimestre}</Th>
            <Th>Empresa</Th>
            {colReg.comRegional && <Th>{colReg.rotuloRegional}</Th>}
            {colunaStatus && <Th alinhar="center">Status</Th>}
            <th className="px-3 py-3 text-center font-semibold">Ação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 && (
            <tr>
              <td colSpan={nCols} className="px-3 py-12 text-center text-sm text-muted-foreground">
                {vazio}
              </td>
            </tr>
          )}
          {grupos.map((g) => (
            <React.Fragment key={g.data}>
              {agrupar && <FaixaDoDia g={g} cols={cols} />}
              {g.linhas.map((l) => (
                <React.Fragment key={l.t.id}>
                  <LinhaPlanilha
                    l={l}
                    sel={sel}
                    mostrarSaldo={mostrarSaldo}
                    colunaStatus={colunaStatus}
                    onBaixar={onBaixar}
                    abrir={abrir}
                    contaId={contaId}
                    sugestao={sugestoes[l.t.id]}
                    colunasValor={colunasValor}
                    modulo={modulo}
                    regra={regra}
                    aberta={abertas.has(l.t.id)}
                    onAlternar={() => alternarAberta(l.t.id)}
                    itensAbertos={comItens.has(l.t.id)}
                    onItens={() => alternarItens(l.t.id)}
                  />
                  {l.t.faturaId && comItens.has(l.t.id) && (
                    <LinhasDosItens itens={(detalhes.faturas ?? []).find((f) => f.id === l.t.faturaId)?.itens ?? []} chaves={cols.map(([k]) => k)} abreviada={colReg.abreviada} />
                  )}
                  {detalhes.variante === "c" && abertas.has(l.t.id) && (
                    <LinhaAberta
                      t={l.t}
                      colunas={nCols}
                      inicioDescricao={cols.findIndex(([k]) => k === "descricao")}
                      onVerDocumentos={detalhes.onVerDocumentos}
                      abrirAcao={abrir}
                    />
                  )}
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
        </tbody>
        {linhas.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-t-foreground bg-[#f3f2ee] text-xs">
              <td />
              <td className="whitespace-nowrap px-3 py-2.5 font-semibold">Total</td>
              {colunasValor.includes("credito") &&
                (vazia === "credito" ? (
                  traco
                ) : (
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-emerald-700">{total.c > 0 ? moeda(total.c) : ""}</td>
                ))}
              {colunasValor.includes("debito") &&
                (vazia === "debito" ? (
                  traco
                ) : (
                  // Só estornos de verba no filtro: o total fica negativo.
                  <td className={cn("whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold", total.d < 0 ? "text-teal-700" : "text-california-red")}>
                    {total.d > 0 ? moeda(total.d) : total.d < 0 ? `−${moeda(-total.d)}` : ""}
                  </td>
                ))}
              {mostrarSaldo && (
                <td className={cn("whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold", linhas[linhas.length - 1].saldo < 0 && "text-california-red")}>
                  {moeda(linhas[linhas.length - 1].saldo)}
                </td>
              )}
              <td colSpan={nCols - (mostrarSaldo ? 5 : 4) + (colunasValor.length === 1 ? 1 : 0)} className="px-3 py-2.5 text-muted-foreground">
                {linhas.length} {linhas.length === 1 ? "título" : "títulos"}
                {total.transf > 0 && <> · transferência entre contas fora do total: {moeda(total.transf)}</>}
                {mostrarSaldo && saldoHoje !== undefined && <> · saldo de hoje {moeda(saldoHoje)}</>}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** O total da planilha de um módulo, sem conta: só os títulos em aberto,
 *  cada um na coluna (e com o sinal) da regra. A transferência entre contas
 *  fica fora: não é receita nem despesa. */
function totalDoModulo(linhas, modulo, regra) {
  const tot = { c: 0, d: 0, transf: 0 };
  linhas
    .filter((l) => !l.t.pagoEm)
    .forEach(({ t }) => {
      const { coluna, sinal, fora } = celulaDoModulo(t, modulo, regra);
      if (fora) tot.transf += aberto(t);
      else if (coluna === "credito") tot.c += sinal * aberto(t);
      else tot.d += sinal * aberto(t);
    });
  return { c: r2(tot.c), d: r2(tot.d), transf: r2(tot.transf) };
}

/** Os itens de uma fatura de cartão, embaixo da linha dela, nas mesmas
 *  colunas da planilha: é o que o pagamento da fatura paga, e de onde vem o
 *  DRE (o pagamento em si fica fora). `chaves` são as colunas da tabela. */
export function LinhasDosItens({ itens, chaves, abreviada }) {
  const ordenados = [...itens].sort((a, b) => a.data.localeCompare(b.data));
  return ordenados.map((i) => {
    const ci = centroTexto(i.centro);
    return (
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
                  {i.valor < 0 ? moeda(-i.valor) : ""}
                </td>
              );
            case "debito":
              return (
                <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-[#b3323c]/80">
                  {i.valor > 0 ? moeda(i.valor) : ""}
                </td>
              );
            case "descricao":
              return (
                <td key={k} className="px-3 py-1.5">
                  <span className="text-foreground/80">{i.descricao}</span>{" "}
                  <span className={cn("ml-1 inline-block rounded border px-1 py-px text-[9px] font-bold uppercase", ITEM_TIPO[i.tipo]?.[1])}>{ITEM_TIPO[i.tipo]?.[0]}</span>{" "}
                  <span className="font-mono text-[10px]">{i.codigo}</span>
                </td>
              );
            case "contraparte":
            case "fornecedor":
              return (
                <td key={k} className="px-3 py-1.5">
                  <span className="block truncate">{i.fornecedor}</span>
                </td>
              );
            case "job":
              return (
                <td key={k} className="whitespace-nowrap px-3 py-1.5 font-mono">
                  {i.job ? <span className="text-california-red/80">{i.job.codigo}</span> : <span className="font-sans italic text-muted-foreground/60">—</span>}
                </td>
              );
            case "centro":
              return (
                <td key={k} className="px-3 py-1.5">
                  <Dica conteudo={`${ci.tipo} · ${i.centro.sub}`} className="block w-full truncate">
                    {ci.tipo}
                  </Dica>
                </td>
              );
            case "trim":
              return (
                <td key={k} className="whitespace-nowrap px-3 py-1.5 text-center font-mono">
                  {trimestre(i.data)}
                </td>
              );
            case "empresa":
              return (
                <td key={k} className="px-3 py-1.5">
                  <span className="block truncate">{i.empresa}</span>
                </td>
              );
            case "regional":
              return <CelulaRegional key={k} rateio={regionalDe({ job: i.job, empresa: i.empresa, origem: i.tipo })} abreviada={abreviada} />;
            default:
              return <td key={k} />;
          }
        })}
      </tr>
    );
  });
}

/** O tipo do item da fatura: a etiqueta e a cor. */
export const ITEM_TIPO = {
  pp: ["PP", "border-border bg-white text-muted-foreground"],
  avulso: ["Avulso", "border-violet-200 bg-violet-50 text-violet-700"],
  recorrencia: ["Recorrência", "border-blue-200 bg-blue-50 text-blue-700"],
  desembolso: ["Desembolso", "border-amber-200 bg-amber-50 text-amber-800"],
  estorno: ["Estorno", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  ajuste: ["Ajuste", "border-slate-300 bg-slate-100 text-slate-700"],
};

function FaixaDoDia({ g, cols }) {
  const c = g.linhas.reduce((s, l) => s + (l.efeito > 0 ? l.efeito : 0), 0);
  const d = g.linhas.reduce((s, l) => s + (l.efeito < 0 ? -l.efeito : 0), 0);
  const saldo = g.linhas[g.linhas.length - 1].saldo;
  const vencidos = g.linhas.filter((l) => l.t.vencimento < HOJE).length;
  const hoje = g.data === HOJE;
  return (
    <tr className="border-y border-y-[#dcd9d2] bg-[#eceae5] text-xs">
      {cols.map(([k]) => {
        if (k === "sel") return <td key={k} />;
        if (k === "data")
          return (
            <td key={k} colSpan={1} className="whitespace-nowrap px-3 py-1.5 font-semibold">
              {hoje ? "Hoje" : dataBR(g.data).slice(0, 5)}
            </td>
          );
        if (k === "credito") return <td key={k} className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-800">{c > 0 ? moeda(c) : ""}</td>;
        if (k === "debito") return <td key={k} className="px-3 py-1.5 text-right font-mono font-semibold text-[#b3323c]">{d > 0 ? moeda(d) : ""}</td>;
        if (k === "saldo")
          return (
            <td key={k} className={cn("px-3 py-1.5 text-right font-mono font-semibold", saldo < 0 && "text-california-red")}>
              {moeda(saldo)}
            </td>
          );
        if (k === "descricao")
          return (
            <td key={k} className="px-3 py-1.5 text-[#5f5d57]">
              <span className="capitalize">{diaDaSemana(g.data)}</span> · {g.linhas.length} {g.linhas.length === 1 ? "título" : "títulos"}
              {hoje && vencidos > 0 && <span className="font-semibold text-california-red"> · {vencidos} vencidos entram aqui</span>}
              {saldo < 0 && <span className="font-semibold text-california-red"> · a conta fica negativa</span>}
            </td>
          );
        return <td key={k} />;
      })}
    </tr>
  );
}

function LinhaPlanilha({ l, sel, mostrarSaldo, colunaStatus, onBaixar, abrir, contaId, sugestao, colunasValor, modulo, regra, aberta, onAlternar, itensAbertos, onItens }) {
  const detalhes = React.useContext(DetalhesContexto);
  const colReg = colunasDaRegional(detalhes.regional);
  // Como a linha diz que o título já está no extrato do banco (escolha na barra).
  const sinal = detalhes.sinalBanco ?? "faixa";
  const { t, saldo, efeito } = l;
  // Os termos padronizados (pedido do Tiago, 20/10/2026): todo título tem
  // o VENCIMENTO, que vem do documento e nunca muda, e a DATA PREVISTA de
  // pagamento ou de recebimento, que o financeiro edita pelo lápis. A
  // coluna mostra a data prevista; o atraso conta pelo vencimento.
  const venc = t.vencOrig ?? t.vencimento;
  const vencido = venc < HOJE && !t.pagoEm;
  const editavelData = ["pp", "avulso", "recorrencia", "folha", "nf", "fatura", "desembolso", "imposto"].includes(t.origem) && !t.pagoEm;
  const recebe = entra(t, contaId);
  const depoisDoVencimento = !t.pagoEm && t.vencimento > venc;
  const motivo = sel.motivo(t);
  const marcado = sel.marcado(t);
  const valor = aberto(t);
  // No módulo não há conta, então nada é "de outra conta".
  const outraConta = !modulo && efeito === 0 && !t.pagoEm;
  const ehEntrada = recebe;
  // No módulo, a coluna sai da regra escolhida (celulaDoModulo): a pedida
  // põe o que abate despesa ou custo com sinal de menos no Débito; a
  // recomendada segue o banco. A coluna que o módulo não usa mostra "—".
  const cel = modulo ? celulaDoModulo(t, modulo, regra) : null;
  const colunaDoValor = cel ? cel.coluna : ehEntrada ? "credito" : "debito";
  const negativo = cel?.sinal === -1;
  const transferencia = !!modulo && t.origem === "transferencia";
  const noCartao = t.formaPrevista === "cartao" && !t.pagoEm;
  const cartao = noCartao ? CARTOES.find((x) => x.id === t.cartaoPrevisto) : null;
  const fatura = t.faturaId ? (detalhes.faturas ?? []).find((f) => f.id === t.faturaId) : null;
  const nomeDaConta = (id) => CONTAS.find((x) => x.id === id)?.nome ?? "—";
  const c = centroTexto(t.centro);
  const diasVencido = vencido ? Math.round((Date.parse(HOJE) - Date.parse(venc)) / 86400000) : 0;
  const celValor = (lado) => {
    const mostra = colunaDoValor === "ambas" || lado === colunaDoValor;
    if (!mostra) return modulo ? <td className="px-1 py-2 text-center text-muted-foreground/40">—</td> : <td className="px-3 py-2" />;
    return (
      <td
        className={cn(
          "whitespace-nowrap px-3 py-2 text-right font-mono text-xs",
          outraConta || transferencia ? "text-muted-foreground" : negativo ? "text-teal-700" : lado === "credito" ? "text-emerald-700" : "text-california-red",
          outraConta && "opacity-60",
        )}
      >
        {/* O valor destrinchado (retenção, baixa parcial) mora num ícone ao
            lado do valor, que abre no mouse e no clique: a sublinha de antes
            invadia a coluna vizinha (pedido do Tiago, 20/10/2026). */}
        <span className="inline-flex items-center justify-end gap-1">
          {(t.retencao > 0 || t.baixado > 0) && (
            <Dica conteudo={<ValorDestrinchado t={t} />}>
              <Receipt
                className={cn("h-3.5 w-3.5", t.baixado > 0 ? "text-sky-600" : "text-amber-600")}
                aria-label={t.baixado > 0 ? "Baixa parcial: ver o valor destrinchado" : "Retido na fonte: ver o valor destrinchado"}
              />
            </Dica>
          )}
          {t.origem === "verba" && (
            <Dica
              conteudo={
                negativo ? (
                  <>
                    <strong>Estorno de verba.</strong> A sobra que o responsável devolve. Abate a despesa da PP, por isso o sinal de menos. Na baixa, entra na conta como crédito.
                  </>
                ) : (
                  <>
                    <strong>Estorno de verba.</strong> A sobra que o responsável devolve: entra na conta, e o Extrato vai mostrá-la no Crédito. No DRE é despesa negativa: abate o custo da PP em {c?.tipo ?? "02 · Custo Operacional"}.
                  </>
                )
              }
            >
              <Undo2 className="h-3.5 w-3.5 text-teal-700" aria-label="Estorno de verba" />
            </Dica>
          )}
          {noCartao && (
            <Dica
              conteudo={
                <>
                  <strong>Aprovado para pagar no cartão {cartao?.nome} ••••{cartao?.final}.</strong> É só a intenção: a baixa abre com PIX, e o item só entra numa fatura quando a baixa for no cartão.
                </>
              }
            >
              <CreditCard className="h-3.5 w-3.5 text-violet-600" aria-label="Aprovado para pagar no cartão" />
            </Dica>
          )}
          {transferencia ? (
            // Na transferência, a dica fica no próprio valor: o ícone não cabe
            // ao lado de R$ 150.000,00 na coluna.
            <Dica
              conteudo={
                colunaDoValor === "ambas" ? (
                  <>
                    <strong>Transferência entre contas.</strong> {lado === "debito" ? `Sai de ${nomeDaConta(t.origemConta)}` : `Entra em ${nomeDaConta(t.destinoConta)}`}. As duas pernas, como o Extrato de cada conta vai mostrar. Não é receita nem despesa: fica fora dos totais.
                  </>
                ) : (
                  <>
                    <strong>Transferência entre contas.</strong> Sai de {nomeDaConta(t.origemConta)} e entra em {nomeDaConta(t.destinoConta)}. Não é receita nem despesa: fica fora do total.
                  </>
                )
              }
              className="underline decoration-dotted underline-offset-2"
            >
              {moeda(valor)}
            </Dica>
          ) : (
            <span title={outraConta ? "Entra em outra conta: não mexe no saldo desta." : undefined}>
              {negativo ? "−" : ""}
              {moeda(valor)}
            </span>
          )}
        </span>
        {outraConta && <span className="block font-sans text-[10px] italic">em outra conta</span>}
      </td>
    );
  };
  return (
    <tr
      // Só a caixa seleciona: o clique no resto da linha abre as dicas da
      // Regional e do Centro de Custo, e o ⓘ (pedido do Tiago, 20/10/2026).
      className={cn(
        "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
        marcado && "bg-california-red/[0.04]",
      )}
    >
      <td
        className={cn("py-2 pl-3 pr-1 text-center", sugestao && sinal === "faixa" && "shadow-[inset_3px_0_0_0_#10b981]")}
        title={motivo ?? undefined}
      >
        {!t.pagoEm && <Caixa marcado={marcado} onClick={() => sel.alternar(t)} desligada={!!motivo} title={motivo ?? undefined} />}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="inline-flex items-center gap-1.5">
          {editavelData && (
            <button
              type="button"
              title={recebe ? "Editar data prevista de recebimento" : "Editar data prevista de pagamento"}
              onClick={(e) => {
                e.stopPropagation();
                abrir("editar_prevista", t);
              }}
              className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-california-red"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          <span className={cn("font-mono text-xs", (vencido || depoisDoVencimento) && "font-semibold text-california-red")}>{dataBR(t.pagoEm ?? t.vencimento)}</span>
          {sugestao && sinal !== "botao" && (
            <Dica
              conteudo={
                <>
                  <strong>No extrato do banco de {dataBR(sugestao.data)}.</strong> {sugestao.motivo}. “Baixar” já vem com a data e o valor do banco, e a baixa sai conciliada.
                </>
              }
            >
              <Landmark className="h-3.5 w-3.5 text-emerald-600" aria-label="Já está no extrato do banco" />
            </Dica>
          )}
        </span>
        {/* Embaixo da data prevista, só quando ela difere do vencimento:
            "venc. dd/mm" em âmbar (antes do vencimento) ou em vermelho, com o
            efeito do atraso (depois dele). Vencido: há quantos dias. */}
        {vencido ? (
          <span className="block pl-[18px] text-[10px] font-semibold text-california-red">
            venceu há {diasVencido} {diasVencido === 1 ? "dia" : "dias"}
          </span>
        ) : depoisDoVencimento ? (
          <span
            className="block pl-[18px] text-[10px] font-semibold text-california-red"
            title={recebe ? "A data prevista é depois do vencimento: o cliente fica em atraso." : "A data prevista é depois do vencimento: a baixa vai pedir a multa e os juros."}
          >
            venc. {dataBR(venc).slice(0, 5)}
            <span className="block font-normal">{recebe ? "atraso do cliente" : "multa e juros"}</span>
          </span>
        ) : (
          t.vencimento !== venc && <span className="block pl-[18px] text-[10px] text-amber-700">venc. {dataBR(venc).slice(0, 5)}</span>
        )}
      </td>
      {colunasValor.includes("credito") && celValor("credito")}
      {colunasValor.includes("debito") && celValor("debito")}
      {mostrarSaldo && (
        <td className={cn("whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold", saldo < 0 && "text-california-red")}>
          {outraConta ? <span className="text-muted-foreground/50">—</span> : moeda(saldo)}
        </td>
      )}
      <td className="px-3 py-2 text-xs">
        <span className="block break-words">{descricaoDoLancamento(t)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <OrigemPill t={t} curta={t.origem === "pp"} />
          {t.origem === "pp" && t.nf && <span>NF {t.nf}</span>}
          {t.origem === "imposto" && (
            <span>
              {t.ref}
              {t.local ? ` · ${t.local}` : ""} · {t.competencia}
              {t.cota ? ` · cota ${t.cota}` : ""}
            </span>
          )}
          {t.origem === "nf" && <span>{t.parcela[1] > 1 ? `parcela ${t.parcela[0]}/${t.parcela[1]}` : "parcela única"}</span>}
          {t.bv && (
            <Dica
              conteudo={
                negativo ? (
                  <>
                    <strong>BV como débito negativo.</strong> Abate o custo da mídia do job, por isso o sinal de menos. Na baixa, entra na conta como crédito.
                  </>
                ) : (
                  <>
                    <strong>BV (bonificação de volume).</strong> O veículo paga à agência: entra na conta, e o Extrato vai mostrá-lo no Crédito. No DRE vira custo negativo da mídia do job (decisão 184, ainda pendente).
                  </>
                )
              }
            >
              <span className="inline-block rounded border border-teal-200 bg-teal-50 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-teal-700">BV</span>
            </Dica>
          )}
          {t.loteId && <span>na remessa da folha</span>}
          {fatura && (
            <button
              type="button"
              onClick={onItens}
              aria-expanded={itensAbertos}
              className="inline-flex items-center gap-0.5 rounded px-1 font-semibold text-california-red hover:bg-california-red/5"
            >
              {fatura.itens.length} itens
              <ChevronDown className={cn("h-3 w-3 transition-transform", itensAbertos && "rotate-180")} />
            </button>
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="block truncate" title={t.contraparte}>
          {t.contraparte}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
        {t.job ? (
          <span className="text-california-red" title={t.job.nome}>
            {t.job.codigo}
          </span>
        ) : fatura && jobsDaFatura(fatura).length ? (
          <Dica conteudo={jobsDaFatura(fatura).join(" · ")} className="font-sans underline decoration-dotted underline-offset-2">
            {jobsDaFatura(fatura).length} {jobsDaFatura(fatura).length === 1 ? "job" : "jobs"}
          </Dica>
        ) : (
          <span className="font-sans italic text-muted-foreground/70">Não Vinculado</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {/* Só o tipo, numa linha; o centro de custo inteiro no título. O
            plano novo, próximo da DFP, vai ter nomes mais longos. */}
        {t.origem === "transferencia" ? (
          <span className="block truncate italic text-muted-foreground" title="Transferência entre contas · fora do DRE">
            Fora do DRE
          </span>
        ) : fatura ? (
          <Dica conteudo={<CentrosDaFatura itens={fatura.itens} />} className="block w-full truncate italic text-muted-foreground underline decoration-dotted underline-offset-2">
            Itens da fatura
          </Dica>
        ) : c ? (
          <Dica conteudo={`${c.tipo} · ${c.sub}`} className="block w-full truncate">
            {c.tipo}
          </Dica>
        ) : (
          <span className="italic text-amber-700" title="O desembolso tem o centro de custo escolhido na baixa.">
            definir na baixa
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">{trimestre(dataEfetiva(t))}</td>
      <td className="px-3 py-2 text-xs">
        <span className="block truncate">{t.lado === "imposto" ? t.pj : t.origem === "transferencia" ? "—" : t.empresa}</span>
      </td>
      {colReg.comRegional && <CelulaRegional rateio={regionalDe(t)} abreviada={colReg.abreviada} />}
      {colunaStatus && (
        <td className="px-2 py-2 text-center">
          <StatusPill t={t} />
        </td>
      )}
      <td className="py-2 pl-1.5 pr-2">
        {/* O Baixar encostado à esquerda da célula, com um respiro maior
            até o ⓘ (pedido do Tiago, 20/10/2026). */}
        <span className="flex items-center justify-start gap-2">
          {t.pagoEm ? (
            <button type="button" title="Ver as baixas registradas — estornar ou cancelar, se preciso" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
              <Eye className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBaixar(t);
              }}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] font-semibold text-white",
                sugestao ? "bg-emerald-700 hover:bg-emerald-800" : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              {/* O título ainda não teve baixa: mesmo com o banco mostrando o
                  pagamento, a ação é dar a baixa (que já sai conciliada). */}
              {sugestao ? <Landmark className="h-3 w-3" /> : t.origem === "transferencia" ? <ArrowLeftRight className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
              {t.origem === "transferencia" ? "Registrar" : "Baixar"}
            </button>
          )}
          <BotaoDetalhes t={t} variante={detalhes.variante} aberto={aberta} onAlternar={onAlternar} onVerDocumentos={detalhes.onVerDocumentos} abrirAcao={abrir} />
        </span>
      </td>
    </tr>
  );
}

/** Os jobs dos itens da fatura. */
function jobsDaFatura(f) {
  return [...new Set(f.itens.filter((i) => i.job).map((i) => i.job.codigo))];
}

/** O pagamento da fatura fica fora do DRE (decisão 084): quem entra são os
 *  itens, cada um no centro de custo dele. */
export function CentrosDaFatura({ itens }) {
  return (
    <div className="min-w-[250px] space-y-0.5 font-sans not-italic">
      <p className="mb-1 text-white/75">O pagamento fica fora do DRE; os itens entram, cada um no seu centro de custo:</p>
      {centrosDosItens(itens).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span>{k}</span>
          <span className="font-mono">{v < 0 ? `−${moeda(-v)}` : moeda(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** O valor do título destrinchado: bruto, cada retenção, o que já foi
 *  baixado e o que sai (ou entra) na conta. */
function ValorDestrinchado({ t }) {
  const irrf = t.retencao > 0 ? Math.round(t.valor * 1.5) / 100 : 0;
  const linhas = [
    ["Valor bruto", t.valor],
    ...(t.retencao > 0
      ? [
          ["(−) IRRF 1,5%", -irrf],
          ["(−) PIS/COFINS/CSLL 4,65%", -r2(t.retencao - irrf)],
        ]
      : []),
    ...(t.baixado > 0 ? [["(−) Já baixado", -t.baixado]] : []),
  ];
  return (
    <div className="min-w-[230px] space-y-0.5 font-sans">
      {linhas.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-white/75">{k}</span>
          <span className="font-mono">{moeda(Math.abs(v))}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-white/20 pt-1 font-semibold">
        <span>{t.baixado > 0 ? "Falta" : entra(t) ? "Entra na conta" : "Sai da conta"}</span>
        <span className="font-mono">{moeda(aberto(t))}</span>
      </div>
      {t.retencao > 0 && <p className="pt-1 text-[10.5px] text-white/60">As retenções da aprovação da PP: viram guias a recolher na baixa.</p>}
    </div>
  );
}

/** A célula da Regional: o nome ou a sigla; com rateio, "+N" e o rateio
 *  inteiro ao passar o mouse. */
export function CelulaRegional({ rateio, abreviada }) {
  const { texto, titulo, rateio: comRateio } = textoDaRegional(rateio, abreviada);
  return (
    <td className={cn("whitespace-nowrap px-3 py-2 text-xs", abreviada && "font-mono")}>
      {texto === "—" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        // Rateio: "Todos"/"TD" sublinhado em pontilhado; a regra abre no
        // mouse e no clique.
        <Dica conteudo={titulo} className={cn(comRateio && "underline decoration-dotted underline-offset-2")}>
          {texto}
        </Dica>
      )}
    </td>
  );
}

export function StatusPill({ t }) {
  const base = "inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";
  if (t.noCartao) return <span className={cn(base, "border-violet-200 bg-violet-50 text-violet-700")} title={`Pago no cartão: entrou na fatura ${t.noCartao.fatura}`}>No cartão</span>;
  if (t.origem === "verba") return t.pagoEm ? <span className={cn(base, "border-emerald-200 bg-emerald-50 text-emerald-700")}>Devolvido</span> : <span className={cn(base, "border-teal-200 bg-teal-50 text-teal-700")} title="Devolução pendente">A devolver</span>;
  if (t.pagoEm) return <span className={cn(base, "border-emerald-200 bg-emerald-50 text-emerald-700")}>{t.lado === "receber" ? "Recebido" : "Pago"}</span>;
  if (t.baixado > 0) return <span className={cn(base, "border-sky-200 bg-sky-50 text-sky-700")}>Parcial</span>;
  if (t.origem === "transferencia") return <span className={cn(base, "border-amber-200 bg-amber-50 text-amber-800")}>A transferir</span>;
  if (t.lado === "receber" && t.origem === "nf" && t.vencimento < HOJE) return <span className={cn(base, "border-red-200 bg-red-50 text-[#b3323c]")}>Inadimplente</span>;
  if (t.lado === "imposto" && t.vencimento < HOJE) return <span className={cn(base, "border-red-200 bg-red-50 text-[#b3323c]")}>Vencido</span>;
  return <span className={cn(base, "border-amber-200 bg-[#fffbeb] text-[#92400e]")}>{t.lado === "receber" ? "Em aberto" : "A pagar"}</span>;
}

// ===========================================================================
// A aba Títulos nova, na conciliação
// ===========================================================================

export function AbaTitulosNova({ titulos, versao, saldoHoje, onBaixar, onLote, abrir, sugestoes, irParaExtrato, onPrevia }) {
  const rec = comoRecomendada(versao);
  const [venc, setVenc] = React.useState("todos");
  const [tipo, setTipo] = React.useState("todos");
  const [busca, setBusca] = React.useState("");
  const [agrupar, setAgrupar] = React.useState(true);
  const abertos = titulos.filter((t) => !t.pagoEm);
  const todas = comSaldoPrevisto(abertos, saldoHoje, "cs");
  const base = todas.filter(
    ({ t }) =>
      casaVencimento(t.vencOrig ?? t.vencimento, venc) &&
      (!busca || `${t.titulo} ${t.ref} ${t.contraparte} ${t.empresa} ${t.job?.codigo ?? ""}`.toLowerCase().includes(busca.toLowerCase())),
  );
  const cont = (k) => (k === "todos" ? base.length : base.filter(({ t }) => t.lado === k).length);
  const visiveis = tipo === "todos" ? base : base.filter(({ t }) => t.lado === tipo);
  const sel = useSelecaoDoLote(visiveis.map((l) => l.t), { cartaoNoLote: true });
  const negativo = todas.find((l) => l.saldo < 0);
  const fim = todas.length ? todas[todas.length - 1].saldo : saldoHoje;
  const saem = todas.filter((l) => l.efeito < 0 && dataEfetiva(l.t) <= "2026-10-31").reduce((s, l) => s - l.efeito, 0);
  const entram = todas.filter((l) => l.efeito > 0 && dataEfetiva(l.t) <= "2026-10-31").reduce((s, l) => s + l.efeito, 0);
  const saldoDepois = r2(saldoHoje + sel.itens.reduce((s, t) => s + efeitoNaConta(t, "cs"), 0));
  const nSugestoes = Object.keys(sugestoes ?? {}).length;

  React.useEffect(() => {
    onPrevia?.(sel.itens);
  }, [sel.itens.map((t) => t.id).join("|")]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          Tudo que aguarda baixa no financeiro, nas colunas do Extrato: cada linha é o lançamento que a baixa vai gravar nesta conta.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="contornoVermelho" onClick={() => abrir("remessa")}>
            <Landmark className="h-4 w-4" />
            Exportar remessa Santander
          </Botao>
          <BotaoNovoLancamento abrir={abrir} />
        </div>
      </div>

      {rec && nSugestoes > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          <Landmark className="h-4 w-4 shrink-0" />
          <span>
            <strong>{nSugestoes} títulos</strong> já aparecem no extrato do banco importado em 20/10. Eles saem daqui pela aba{" "}
            <strong>Conciliação automática</strong>, com a data do banco, sem digitar nada.
          </span>
          <button type="button" onClick={() => irParaExtrato("banco")} className="ml-auto rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800">
            Conciliar com o banco
          </button>
        </div>
      )}

      {/* O resumo: o que sai e entra no mês e onde o saldo termina. */}
      <div className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-card sm:grid-cols-4">
        {[
          ["Saldo de hoje · California Santander", moeda(saldoHoje), ""],
          ["Saem até 31/10", moeda(saem), "text-california-red"],
          ["Entram até 31/10", moeda(entram), "text-emerald-700"],
          [rec ? "Saldo previsto no fim da lista" : "Saldo previsto", moeda(fim), fim < 0 ? "text-california-red" : ""],
        ].map(([k, v, c]) => (
          <div key={k} className="px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</p>
            <p className={cn("mt-0.5 font-mono text-base font-semibold", c)}>{v}</p>
          </div>
        ))}
      </div>
      {rec && negativo && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Se tudo for pago nesta conta, ela fica negativa em <strong>{dataBR(dataEfetiva(negativo.t))}</strong> ({moeda(negativo.saldo)}). Vale transferir antes ou pagar parte por outra conta.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vencimento</span>
        {[
          ["vencidos", "Vencidos"],
          ["ate_hoje", "Até hoje"],
          ["proximos_7", "Próximos 7 dias"],
          ["todos", "Todos"],
        ].map(([k, l]) => (
          <StatusChip key={k} ativo={venc === k} onClick={() => setVenc(k)} label={l} />
        ))}
        {rec && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted-foreground">
            <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} className="accent-[#E74B56]" />
            Agrupar por dia
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Busca value={busca} onChange={setBusca} placeholder="Buscar por título, contraparte, empresa ou job..." />
        {[
          ["todos", "Todos"],
          ["pagar", "A pagar"],
          ["receber", "A receber"],
          ["imposto", "Impostos"],
          ["transf", "Transferências"],
        ].map(([k, l]) => (
          <Chip key={k} ativo={tipo === k} onClick={() => setTipo(k)} label={l} count={cont(k)} />
        ))}
      </div>

      <PlanilhaDeTitulos
        linhas={visiveis}
        sel={sel}
        mostrarSaldo
        agrupar={rec && agrupar}
        onBaixar={onBaixar}
        abrir={abrir}
        sugestoes={rec ? sugestoes : {}}
        saldoHoje={saldoHoje}
      />
      <BarraDeSelecao
        itens={sel.itens}
        onLimpar={sel.limpar}
        onBaixar={() => onLote(sel.itens, sel.limpar)}
        saldoDepois={saldoDepois}
        nomeConta="A conta"
        onVerNoExtrato={rec ? () => irParaExtrato("extrato") : undefined}
      />
    </div>
  );
}

// ===========================================================================
// O Extrato (a planilha da conciliação)
// ===========================================================================

export function AbaExtrato({ lancamentos, saldoInicial, versao, previstos = [], onImportar, temImportacao, alertas = {}, travadoAte = null }) {
  const rec = comoRecomendada(versao);
  const [mostrarPrevistos, setMostrarPrevistos] = React.useState(true);
  const linhas = [...lancamentos].sort((a, b) => a.data.localeCompare(b.data));
  let s = saldoInicial;
  const comSaldo = linhas.map((l) => ({ ...l, saldo: (s = r2(s + l.valor)) }));
  const creditos = linhas.filter((l) => l.valor > 0).reduce((a, l) => a + l.valor, 0);
  const debitos = linhas.filter((l) => l.valor < 0).reduce((a, l) => a - l.valor, 0);
  const fantasmas = rec && mostrarPrevistos ? comSaldoPrevisto(previstos, s, "cs") : [];
  const pendentes = linhas.filter((l) => !l.conciliado).length;
  const detalhes = React.useContext(DetalhesContexto);
  // A coluna Regional só entra no Extrato das versões novas: o de hoje
  // fica como está no ar.
  const regExtrato = colunasDaRegional(versao === "atual" ? 0 : detalhes.regional);
  const [abertas, setAbertas] = React.useState(() => new Set());
  const alternarAberta = (id) =>
    setAbertas((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  // O pagamento da fatura abre nos itens, nas mesmas colunas (versões novas).
  const [comItens, setComItens] = React.useState(() => new Set());
  const alternarItens = (id) =>
    setComItens((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const chavesExtrato = [...(rec ? ["banco"] : []), "data", "credito", "debito", "saldo", "descricao", "fornecedor", "job", "centro", "trim", "empresa", ...(regExtrato.comRegional ? ["regional"] : []), "acao"];
  const itensDe = (l) => (l.faturaId ? (detalhes.faturas ?? []).find((f) => f.id === l.faturaId)?.itens ?? [] : []);
  const nAlertas = Object.keys(alertas).length;
  return (
    <div className="space-y-5">
      {nAlertas > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-900">
          <AlertTriangle className="h-4 w-4 shrink-0 text-california-red" />
          <span className="flex-1">
            <strong>{nAlertas === 1 ? "1 lançamento não bate" : `${nAlertas} lançamentos não batem`}</strong> com o extrato do banco importado: {nAlertas === 1 ? "está marcado" : "estão marcados"} com ⚠ na coluna Banco. A conciliação não fecha até a correção.
          </span>
          <button type="button" onClick={onImportar} className="rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover">
            Corrigir na Conciliação automática
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Saldo anterior", saldoInicial, "text-muted-foreground"],
          ["Créditos no período", creditos, "text-emerald-700"],
          ["Débitos no período", debitos, "text-california-red"],
          ["Saldo final", s, s >= 0 ? "text-emerald-700" : "text-california-red"],
        ].map(([k, v, c]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</p>
            <p className={cn("mt-1 font-mono text-lg font-semibold", c)}>{moeda(v)}</p>
          </div>
        ))}
      </div>
      {versao !== "atual" && (
        <div className="flex flex-wrap items-center gap-3">
          <Botao variante="contorno" onClick={onImportar}>
            <Upload className="h-4 w-4" />
            Importar extrato do banco (OFX)
          </Botao>
          {rec && (
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-emerald-700">{linhas.length - pendentes} conciliadas</span> com o banco ·{" "}
              <span className="font-semibold text-amber-700">{pendentes} aguardando o extrato do banco</span>
            </span>
          )}
          {rec && previstos.length > 0 && (
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-violet-700">
              <input type="checkbox" checked={mostrarPrevistos} onChange={(e) => setMostrarPrevistos(e.target.checked)} className="accent-[#7c3aed]" />
              Mostrar os {previstos.length} títulos marcados como previstos
            </label>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              {rec && <th className="w-12 px-2 py-2 text-center" title="Conciliado com o extrato do banco">Banco</th>}
              <Th className="tracking-normal">Data</Th>
              <Th alinhar="right">Crédito</Th>
              <Th alinhar="right">Débito</Th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <Th>Descrição</Th>
              <Th>Fornecedor</Th>
              <Th>Job</Th>
              <Th>Centro de Custo</Th>
              <Th alinhar="center">{regExtrato.rotuloTrimestre}</Th>
              <Th>Empresa</Th>
              {regExtrato.comRegional && <Th>{regExtrato.rotuloRegional}</Th>}
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {comSaldo.map((l) => (
              <React.Fragment key={l.id}>
              <tr className={cn("border-b border-border last:border-0 hover:bg-muted/30", l.novo && "bg-yellow-50/60", abertas.has(l.id) && "bg-muted/20")}>
                {rec && (
                  <td className="px-2 py-2 text-center">
                    {alertas[l.id] ? (
                      <Dica conteudo={alertas[l.id]}>
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-california-red" aria-label="Não bate com o banco">
                          <AlertTriangle className="h-3 w-3" />
                        </span>
                      </Dica>
                    ) : l.conciliado ? (
                      <span
                        title={travadoAte && l.data <= travadoAte ? `Conciliado e travado: o período está fechado até ${dataBR(travadoAte)}` : "Conciliado com o extrato do banco"}
                        className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                      >
                        <CheckCheck className="h-3 w-3" />
                        {travadoAte && l.data <= travadoAte && (
                          <Lock className="absolute -bottom-1 -right-1.5 h-3 w-3 rounded-full bg-white p-px text-slate-600" aria-label="Período fechado" />
                        )}
                      </span>
                    ) : (
                      <span title="Ainda não apareceu no extrato do banco" className="inline-block h-3 w-3 rounded-full border-2 border-amber-400" />
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(l.data)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{l.valor > 0 ? moeda(l.valor) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{l.valor < 0 ? moeda(-l.valor) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">{moeda(l.saldo)}</td>
                <td className="px-3 py-2 text-xs">
                  {l.descricao}
                  {l.juros > 0 && <span className="text-[10px] text-muted-foreground"> · inclui {moeda(l.juros)} de juros</span>}
                  {l.multiplas && <span className="text-[10px] text-muted-foreground"> · {l.multiplas} títulos</span>}
                  {versao !== "atual" && itensDe(l).length > 0 && (
                    <button
                      type="button"
                      onClick={() => alternarItens(l.id)}
                      aria-expanded={comItens.has(l.id)}
                      className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[10.5px] font-semibold text-california-red hover:bg-california-red/5"
                    >
                      {itensDe(l).length} itens
                      <ChevronDown className={cn("h-3 w-3 transition-transform", comItens.has(l.id) && "rotate-180")} />
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{l.fornecedor ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {l.job ? <span className="text-california-red">{l.job}</span> : <span className="font-sans italic text-muted-foreground/70">Não Vinculado</span>}
                </td>
                <td className={cn("px-3 py-2 text-xs", versao !== "atual" && "max-w-[176px]")}>
                  {versao !== "atual" && itensDe(l).length > 0 ? (
                    <Dica conteudo={<CentrosDaFatura itens={itensDe(l)} />} className="block max-w-[176px] truncate italic text-muted-foreground underline decoration-dotted underline-offset-2">
                      Itens da fatura
                    </Dica>
                  ) : l.centro?.tipo === "—" ? (
                    <span className={cn("italic text-muted-foreground", versao !== "atual" && "block max-w-[176px] truncate")} title={l.centro.sub}>
                      {versao !== "atual" ? "Fora do DRE" : l.centro.sub}
                    </span>
                  ) : versao !== "atual" ? (
                    // Nas versões novas, só o tipo, como na aba Títulos.
                    <Dica conteudo={`${centroTexto(l.centro)?.tipo} · ${l.centro?.sub}`} className="block max-w-[176px] truncate">
                      {centroTexto(l.centro)?.tipo}
                    </Dica>
                  ) : (
                    <>
                      <span>{centroTexto(l.centro)?.tipo}</span>
                      <span className="text-muted-foreground"> · {l.centro?.sub}</span>
                    </>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">{trimestre(l.data)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{l.empresa ?? <span className="text-muted-foreground">—</span>}</td>
                {regExtrato.comRegional && <CelulaRegional rateio={l.faturaId ? regionalDe({ faturaId: l.faturaId }) : l.detalhe?.rateio ?? []} abreviada={regExtrato.abreviada} />}
                <td className="px-3 py-2 text-center">
                  {/* O mesmo ⓘ da aba Títulos (a variante escolhida na
                      barra), com o título que a baixa pagou. */}
                  <BotaoDetalhes
                    t={tituloDoLancamento(l, detalhes.titulos)}
                    variante={detalhes.variante}
                    aberto={abertas.has(l.id)}
                    onAlternar={() => alternarAberta(l.id)}
                    onVerDocumentos={detalhes.onVerDocumentos}
                    abrirAcao={detalhes.abrirAcao}
                    rotulo="Ver detalhes do lançamento"
                  />
                </td>
              </tr>
              {versao !== "atual" && comItens.has(l.id) && <LinhasDosItens itens={itensDe(l)} chaves={chavesExtrato} abreviada={regExtrato.abreviada} />}
              {detalhes.variante === "c" && abertas.has(l.id) && (
                <LinhaAberta
                  t={tituloDoLancamento(l, detalhes.titulos)}
                  colunas={(rec ? 12 : 11) + (regExtrato.comRegional ? 1 : 0)}
                  inicioDescricao={rec ? 5 : 4}
                  onVerDocumentos={detalhes.onVerDocumentos}
                  abrirAcao={detalhes.abrirAcao}
                />
              )}
              </React.Fragment>
            ))}
            {fantasmas.map(({ t, saldo }) => (
              <tr key={`p-${t.id}`} className="border-b border-dashed border-violet-200 bg-violet-50/50 italic text-violet-900/80">
                <td className="px-2 py-2 text-center">
                  <span className="rounded bg-violet-100 px-1 py-px text-[9px] font-bold not-italic uppercase text-violet-700">prev.</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(dataEfetiva(t))}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">{entra(t) ? moeda(aberto(t)) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">{!entra(t) ? moeda(aberto(t)) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">{moeda(saldo)}</td>
                <td className="px-3 py-2 text-xs">{descricaoDoLancamento(t)}</td>
                <td className="px-3 py-2 text-xs">{t.contraparte}</td>
                <td className="px-3 py-2 font-mono text-xs">{t.job?.codigo ?? "—"}</td>
                <td className="max-w-[176px] px-3 py-2 text-xs">
                  <span className="block max-w-[176px] truncate" title={t.centro ? `${centroTexto(t.centro).tipo} · ${t.centro.sub}` : undefined}>
                    {t.centro ? centroTexto(t.centro).tipo : "definir na baixa"}
                  </span>
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs">{trimestre(dataEfetiva(t))}</td>
                <td className="px-3 py-2 text-xs">{t.lado === "imposto" ? t.pj : t.empresa}</td>
                {regExtrato.comRegional && <CelulaRegional rateio={regionalDe(t)} abreviada={regExtrato.abreviada} />}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fantasmas.length > 0 && (
        <p className="text-xs text-violet-700">
          As linhas em lilás ainda não existem: são os títulos marcados na aba Títulos, mostrados onde a baixa vai pô-los. Nada é gravado até a baixa.
        </p>
      )}
    </div>
  );
}
