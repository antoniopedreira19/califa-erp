"use client";

/**
 * A tabela da conciliação dia a dia (decisão 254): a linha do banco e, ao
 * lado, os lançamentos do sistema que a compõem, na ordem do extrato.
 *
 * Uma regra só para todos os casos: cada linha do banco tem uma lista de
 * lançamentos do sistema (baixas já feitas, títulos em aberto, linhas da
 * planilha). O sistema preenche a lista com o que achou no dia; a pessoa
 * retira, adiciona e troca no próprio lugar, e nada é gravado até o
 * Conciliar. A coluna "Status" tem três estados (Pronto, A definir,
 * Faltando), e a ação é sempre Conciliar.
 *
 * O saldo depois de cada linha parte do saldo do banco que o fechamento
 * confere (`condicoes_do_fechamento`), e não de uma soma feita na tela a
 * partir do zero.
 *
 * Decisão 262 (protótipo aprovado pelo Tiago em 16/11/2026, versão 56):
 * - nada vem preenchido: a linha vem vazia e a sugestão do sistema é a
 *   primeira da lista do "Adicionar lançamento" (a opção A, a sugestão
 *   apagada na linha com o "Usar", ficou dormente);
 * - o ajuste (juros e multa, retenção, baixa parcial, correção da baixa e
 *   "Corrigir o valor do título") não vem junto com a sugestão: a pessoa
 *   escolhe embaixo da linha, nos botões amarelos com o i;
 * - sem a coluna Status: a Ação diz o que falta — "Conciliar" (só esta linha)
 *   ou "Completar" (a baixa completa, com o motivo na dica); os filtros são
 *   Pendentes · A completar · A conciliar · Conciliadas;
 * - o que foi acertado fica guardado no banco (`conciliacao_acertos`) e
 *   "Conciliar tudo o que foi acertado" grava de uma vez, depois de um resumo;
 * - o centro de custo (Tipo e Subtipo) troca em qualquer lançamento, por dois
 *   campos de busca, e é gravado na conciliação (`conciliacao_centros`);
 * - a linha da planilha que é de uma PP (pelo código na descrição) ou de um
 *   custo fixo (pela chave da recorrência, decisão 235) não é oferecida: no
 *   lugar dela vem o título;
 * - Só no sistema em dois grupos: as baixas sem linha (travam o mês) e os
 *   previstos (não travam);
 * - no ⋯ da linha de entrada, "Recebimento antes da NF" (D11): a data, o
 *   valor e a conta vêm da linha; o banco grava e concilia de uma vez, e o
 *   Desfazer da linha cancela o recebimento.
 */

import * as React from "react";
import { AlertCircle, ArrowDown, Check, CheckCheck, ChevronDown, ChevronRight, CircleSlash, FilePlus2, HandCoins, Link2, ListChecks, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Save, Search, Undo2, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dica } from "@/components/ui/dica";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { siglaDaRegional, textoDaRegional, trimestreDe } from "@/lib/financeiro/planilha-de-titulos";
import { BotaoDaSecao, comCentro, CONTORNO, VERDE } from "./banco-tabela";
import { InfoDica, linhasComMutuo, resumoDoSistema, type AcaoDescrita, type Item, type PropsDaFila } from "./fila-da-conta";
import { celulasDoItem } from "./fila-linhas";
import { itemDoLote, type ResultadoDaLinha } from "./motor-da-conta";
import { EditarDataPagamentoDialog } from "../contas-a-pagar/editar-data-pagamento-dialog";
import { EditarPrevisaoDialog } from "../contas-a-receber/editar-previsao-dialog";
import { naOrdemDoExtrato, saldosDoExtrato, type SaldoBase } from "@/lib/conciliacao/dia-a-dia";
import type { EntradaDaBaixaEmLote } from "@/lib/financeiro/baixa-em-lote";
import type { LancamentoSemLinha } from "./banco-dados";
import { correcaoDaBaixaCabe, RETENCOES_COMUNS, retencaoQueExplica, type TituloDoMotor } from "@/lib/conciliacao/motor";
import type { Linha } from "./linhas-da-aba";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import { carregarDadosDoNovoLancamento } from "./actions-novo-lancamento";
import { carregarAlvosDoRecebimentoAntesNf, type AlvoDaConciliacao } from "../contas-a-receber/actions-recebimento-antes-nf";
import { somaDosRecebidos } from "../contas-a-receber/recebimento-antes-nf-dialog";
import {
  baixarEConciliar as acaoBaixarEConciliar,
  conciliarLinha as acaoConciliarLinha,
  conciliarPeloHistorico as acaoConciliarPeloHistorico,
  corrigirBaixa as acaoCorrigirBaixa,
  lancarPelaRegra as acaoLancarPelaRegra,
  registrarSaiuEVoltou as acaoRegistrarSaiuEVoltou,
} from "./actions-conciliacao";
import {
  conciliarMisto as acaoConciliarMisto,
  corrigirValorDoTituloEBaixar,
  registrarRecebimentoAntesNfPelaLinha,
  salvarAcertoDaLinha,
  salvarCentroDaConciliacao,
  trocarCentroDasPrevisoes,
  trocarCentroDosLancamentos,
} from "./actions-dia-a-dia";

const moeda = formatBRL;
const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (v: number) => Math.round(Math.abs(v) * 100);
const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
const comSinal = (v: number) => `${v < 0 ? "− " : "+ "}${moeda(Math.abs(v))}`;
const CEL = "px-3 py-2 align-top";
const Traco = () => <span className="text-muted-foreground/60">—</span>;
/** O texto que pode não caber: cortado na célula, inteiro ao passar o mouse
 *  (a mesma dica das outras planilhas do sistema). */
function Txt({ t, dica, className }: { t: string | null | undefined; dica?: React.ReactNode; className?: string }) {
  if (!t) return <Traco />;
  return (
    <Dica conteudo={dica ?? t} className={cn("block w-full truncate text-left", className)}>
      {t}
    </Dica>
  );
}

// ---------------------------------------------------------------------------
// Os lançamentos do sistema que podem compor uma linha do banco
// ---------------------------------------------------------------------------

type Base = { id: string; data: string; valor: number; descricao: string; quem: string | null; /** A linha do banco a que o sistema o propôs; nulo, está livre. */ daLinha: string | null };
export type Candidato =
  | (Base & { k: "baixa"; l: LancamentoSemLinha })
  | (Base & { k: "titulo"; t: TituloDoMotor })
  | (Base & { k: "planilha"; h: NonNullable<PropsDaFila["banco"]["previsoes"]>[number]; /** Previsão (ainda não aconteceu) ou linha já realizada da planilha. */ previsao: boolean });

/** Tudo o que o sistema tem e ainda não está conciliado: o que está livre e o
 *  que o sistema propôs a alguma linha (dá para tirar de lá pela lupa). */
export function itensDoSistema(p: PropsDaFila): Candidato[] {
  const daL = new Map<string, string>();
  const daT = new Map<string, string>();
  const daH = new Map<string, string>();
  for (const r of p.conciliacao.resultados) {
    if (r.resolvido) continue;
    if (r.lancamento) {
      daL.set(r.lancamento.id, r.mov.id);
      ((r.lancamento as { membros?: string[] }).membros ?? []).forEach((id) => daL.set(id, r.mov.id));
    }
    for (const t of [r.titulo, ...(r.titulos ?? []), ...(r.lote?.titulos ?? [])]) if (t) daT.set(t.id, r.mov.id);
    for (const h of r.historicos ?? []) daH.set(h.id, r.mov.id);
  }
  const saida: Candidato[] = [];
  for (const l of p.banco.lancamentos) saida.push({ k: "baixa", id: "l:" + l.id, data: l.data, valor: l.valor, descricao: l.descricao, quem: l.fornecedor, daLinha: daL.get(l.id) ?? null, l });
  for (const t of p.conciliacao.titulos.values()) {
    const l = p.contexto.linhaPorChave.get(t.id);
    saida.push({ k: "titulo", id: "t:" + t.id, data: t.vencimento, valor: (t.lado === "receber" || t.entra ? 1 : -1) * t.liquido, descricao: l?.descricao ?? t.ref, quem: t.contraparte, daLinha: daT.get(t.id) ?? null, t });
  }
  const daPlanilha = (h: NonNullable<PropsDaFila["banco"]["previsoes"]>[number], previsao: boolean) =>
    saida.push({ k: "planilha", id: "h:" + h.id, data: h.data, valor: h.valor, descricao: h.descricao ?? h.job ?? "Planilha", quem: h.fornecedor ?? null, daLinha: daH.get(h.id) ?? null, h, previsao });
  for (const h of p.banco.previsoes ?? []) daPlanilha(h, true);
  for (const h of p.banco.historico ?? []) daPlanilha(h, false);
  return saida;
}

/** O que a tabela pede ao servidor além das ações de sempre da aba. */
export interface AcoesDoDia {
  /** Baixas já feitas e títulos em aberto pagos pela mesma linha do banco. */
  conciliarMisto: (linhaId: string, lancamentoIds: string[], itens: EntradaDaBaixaEmLote["itens"]) => void;
  mudarDataDoTitulo: (l: Linha, data: string) => void;
  /** A baixa lançada no dia errado, ainda sem linha do banco. */
  mudarDataDaBaixa: (lancamentoIds: string[], data: string) => void;
  /** A previsão da planilha: a data ajustada sobrevive à carga nova. */
  mudarDataDaPrevisao: (movimentoId: string, data: string) => void;
}

// ---------------------------------------------------------------------------
// A composição de uma linha do banco
// ---------------------------------------------------------------------------

/** O ajuste que fecha a conta quando a soma não é igual à do banco. "valor":
 *  o custo fixo com o valor estimado passa a valer o que o banco pagou. */
type Ajuste = "juros" | "retencao" | "parcial" | "correcao" | "valor";
/** O que o sistema resolve sem lançamento existente. */
interface Especial {
  k: "regra" | "par" | "mutuo";
  texto: string;
}
/** O centro de custo escolhido na linha para um título (16/11/2026). */
type CentroEscolhido = { tipoId: string; subtipoId: string | null };
interface Edicao {
  itens: string[];
  ajuste: Ajuste | null;
  /** A tarifa, o PIX que voltou e o mútuo também entram pelo "Usar". */
  especial?: Especial | null;
  /** O centro de custo trocado na própria linha, por lançamento (16/11/2026). */
  centros?: Record<string, CentroEscolhido>;
}

/** A opção da proposta: "a", a sugestão apagada na linha, com o "Usar";
 *  "b", a linha vazia e a sugestão na lista do "Adicionar lançamento". */
// 16/11/2026: o Tiago escolheu a B; o código da A fica dormente até o porte.
const opcao = (): "a" | "b" => "b";
/** Como uma linha acertada vai para o banco no "Conciliar tudo". */
type TipoDoAcerto = "regra" | "par" | "planilha" | "correcao" | "ligada" | "valor" | "juros" | "parcial" | "misto" | "baixa";
interface Chamada {
  nome: string;
  args: unknown[];
  tipo: TipoDoAcerto;
  /** A outra linha que a mesma chamada resolve (o PIX que saiu e voltou). */
  tambem?: string;
}
/** As ações do "Conciliar" e do "Conciliar tudo", pelo nome da chamada do acerto (decisão 262). */
type ResultadoDaChamada = { ok: true; mensagem?: string } | { ok: false; message: string };
const ACOES_DO_ACERTO: Record<string, (...args: never[]) => Promise<ResultadoDaChamada>> = {
  baixarEConciliar: acaoBaixarEConciliar,
  conciliarMisto: acaoConciliarMisto,
  lancarPelaRegra: acaoLancarPelaRegra,
  registrarSaiuEVoltou: acaoRegistrarSaiuEVoltou,
  conciliarPeloHistorico: acaoConciliarPeloHistorico,
  corrigirBaixa: acaoCorrigirBaixa,
  conciliarLinha: acaoConciliarLinha,
  corrigirValorDoTituloEBaixar,
};
function executarChamada(ch: Chamada): Promise<ResultadoDaChamada> {
  const acao = ACOES_DO_ACERTO[ch.nome];
  if (!acao) return Promise.resolve({ ok: false, message: "Ação desconhecida." });
  return (acao as (...args: unknown[]) => Promise<ResultadoDaChamada>)(...ch.args);
}
const ROTULO_DO_ACERTO: Record<TipoDoAcerto, string> = {
  baixa: "Baixa do título em aberto",
  misto: "Baixa já feita + título em aberto",
  parcial: "Baixa parcial (o resto do título fica em aberto)",
  ligada: "Ligada à baixa já feita",
  correcao: "Baixa corrigida para o valor do banco",
  juros: "Baixa com juros e multa",
  valor: "Título passa ao valor do banco, com a baixa",
  planilha: "Pela linha da planilha (sem título no sistema)",
  regra: "Lançada pela regra do histórico",
  par: "PIX que saiu e voltou",
};
/** A sugestão do sistema que ainda não foi usada. */
interface Sugestao {
  itens: Candidato[];
  especial: Especial | null;
  ajuste: Ajuste | null;
  /** O título sugerido tem uma linha da planilha, que não é oferecida ("da PP-00818", "do título “…”"). */
  daPlanilha: string | null;
}
const normalizar = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** A linha da planilha já reconhecida como de um título não volta a ser
 *  oferecida depois que o título é baixado (no sistema, a regra da recorrência
 *  da decisão 235 tira a previsão do fluxo de vez; a da PP, pelo código). */
const PLANILHA_DE_TITULO = new Set<string>();
/** A linha da planilha que é de um título do sistema: o título dela. */
function donosDaPlanilha(itens: Candidato[]): Map<string, string> {
  const m = new Map<string, string>();
  const titulos = itens.filter((x): x is Extract<Candidato, { k: "titulo" }> => x.k === "titulo");
  for (const x of itens) {
    if (x.k !== "planilha") continue;
    const codigo = x.descricao.match(/PP-\d{5}/)?.[0];
    const t = codigo
      ? titulos.find((t) => t.t.ref.includes(codigo) || t.descricao.includes(codigo))
      : titulos.find((t) => !!normalizar(x.quem) && normalizar(t.quem) === normalizar(x.quem) && normalizar(t.descricao) === normalizar(x.descricao));
    if (t) m.set(x.id, t.id);
  }
  return m;
}
interface Comp {
  r: ResultadoDaLinha;
  itens: Candidato[];
  especial: Especial | null;
  ajuste: Ajuste | null;
  editada: boolean;
  soma: number;
  /** Banco menos sistema: positivo, o banco tem mais (em valor absoluto). */
  falta: number;
  estado: "bate" | "ajuste" | "difere" | "vazio";
  /** A Situação que a pessoa lê: três estados, pelo que ela faz.
   *  Pronto: a soma fecha, é só conciliar. A definir: há o que decidir (a soma
   *  não fecha, ou o sistema tem mais de um lançamento possível, no dia ou em
   *  outra data). Sem lançamento: o sistema não tem nada com esse valor. */
  situacao: "pronto" | "conferir" | "sem";
  /** Sem lançamento na linha: quantos livres o sistema tem com o mesmo valor, no dia e a até 7 dias. */
  iguaisNoDia: number;
  emOutraData: number;
  /** A sugestão do sistema ainda não usada (a linha não foi acertada). */
  sug: Sugestao | null;
  /** O centro de custo escolhido na linha, por lançamento. */
  centros: Record<string, CentroEscolhido>;
}

const ROTULO_DO_TIPO: Record<Candidato["k"], string> = { baixa: "baixado", titulo: "em aberto", planilha: "planilha" };
const ROTULO_DO_AJUSTE: Record<Ajuste, string> = { juros: "juros e multa", retencao: "retenção na fonte", parcial: "baixa parcial", correcao: "corrige a baixa", valor: "valor do banco" };

/** As siglas do Tipo, como a planilha do financeiro escreve (decisão 243). */
const SIGLA_DO_TIPO: Record<string, string> = {
  "01": "REC", "02": "CO", "03": "CT", "04": "CF", "05": "DP", "06": "DM", "07": "DA", "08": "DC",
  "09": "DT", "10": "RF", "11": "DJ", "12": "EMP", "13": "IMOB", "14": "PL", "15": "DL",
};

// ---- Um pop-up por vez (16/11/2026, pedido do Tiago): a lista de lançamentos, o Tipo ou o Subtipo ----
let popupAtivo: string | null = null;
const ouvintesDoPopup = new Set<() => void>();
function abrirPopup(id: string) {
  popupAtivo = id;
  ouvintesDoPopup.forEach((o) => o());
}
function usePopupAtivo() {
  return React.useSyncExternalStore(
    (o) => {
      ouvintesDoPopup.add(o);
      return () => ouvintesDoPopup.delete(o);
    },
    () => popupAtivo,
    () => popupAtivo,
  );
}

// ---- O centro de custo na linha (16/11/2026) ----
/** O plano de contas para a escolha na linha (lido uma vez pela tabela). */
type PlanoDeContas = { tipos: Array<{ id: string; codigo: string; nome: string; natureza_padrao?: string | null }>; subtipos: Array<{ id: string; tipo_id: string; codigo: string; nome: string }> };
const PlanoCtx = React.createContext<PlanoDeContas | null>(null);
/** O centro de custo trocado, por lançamento (16/11/2026): vale onde o lançamento aparecer — na linha, na sugestão
 *  e em Só no sistema — e é gravado quando ele for conciliado. */
const CentrosCtx = React.createContext<{ centros: Record<string, CentroEscolhido>; trocar: (id: string, centro: CentroEscolhido) => void } | null>(null);

/** O que dá para escolher no centro de custo de um lançamento da linha. Só o
 *  título que ainda vai ser baixado; a PP é sempre Custo Operacional (só o
 *  subtipo); impostos, faturas, folha, transferência e rendimento têm o centro
 *  deles. A baixa já feita não muda por aqui. */
function regraDoCentro(_c: Candidato, _p: PropsDaFila): { tipoCodigo: string | null } | null {
  // 16/11/2026 (Tiago): "permita a seleção de todos os campos de tipo e subtipo em todos os lançamentos. Não faça
  // restrições." Antes: só título avulso/recorrência/nota, a PP presa ao 02 e o resto sem troca.
  return { tipoCodigo: null };
}

/** Por que o centro de custo deste lançamento não se troca na linha (a dica das células). */
function semTrocaDoCentro(c: Candidato, p: PropsDaFila): string {
  if (c.k === "baixa")
    return String(c.l.origem) === "pp_baixa"
      ? "Baixa de PP: sempre Custo Operacional. O subtipo se escolhe quando o Custo Operacional tiver mais de um (hoje só tem Geral (provisório))."
      : "O centro de custo desta baixa vem da origem dela (imposto, fatura, transferência, juros) e não muda por aqui.";
  if (c.k === "planilha") return "Linha da planilha: o centro de custo é o da planilha.";
  const l = p.contexto.linhaPorChave.get(c.t.id);
  if (l?.lado === "pagar" && String(l.t.origem) === "pp")
    return "PP: sempre Custo Operacional. O subtipo se escolhe quando o Custo Operacional tiver mais de um (hoje só tem Geral (provisório)).";
  return "O centro de custo vem da origem do título (imposto, fatura, folha, transferência, rendimento) e não muda por aqui.";
}

/** O título na baixa da linha, com o centro escolhido nela (se houver). */
function itemComCentro(l: Linha | undefined, centro: CentroEscolhido | undefined) {
  if (!l) return null;
  const base = itemDoLote(l);
  if (!centro) return base;
  // O tipo trocado sem o subtipo ainda: a linha não sai num clique (o "Completar" diz o que falta).
  if (!centro.subtipoId) return null;
  const c2 = { tipoId: centro.tipoId, subtipoId: centro.subtipoId };
  if (base) return { ...base, centro: c2 };
  // O título que só não entrava num clique por não ter centro (a nota a receber).
  if (l.lote && l.motivoForaDoLote === null && l.lote.tipo !== "imposto")
    return { chave: l.lote.chave, rotulo: l.lote.titulo.slice(0, 200), alvo: l.lote.alvo, aberto: r2(l.lote.aberto), centro: c2, imposto: null };
  return null;
}

/** A célula do Subtipo que escolhe o centro de custo: tipo à esquerda, subtipo à direita. */
function CentroDoItem({
  c,
  p,
  centro,
  onCentro,
  sub,
  aberto,
  setAberto,
}: {
  c: Candidato;
  p: PropsDaFila;
  centro: CentroEscolhido | null;
  onCentro: (centro: CentroEscolhido) => void;
  sub: string | null;
  /** Aberto de fora: o clique na célula Tipo também abre a escolha. */
  aberto: boolean;
  setAberto: (v: boolean) => void;
}) {
  const plano = React.useContext(PlanoCtx);
  const regra = regraDoCentro(c, p);
  const todosOsTipos = plano ? (regra?.tipoCodigo ? plano.tipos.filter((t) => t.codigo === regra.tipoCodigo) : plano.tipos) : [];
  // Opção B (Tiago, 16/11/2026): primeiro os tipos da direção da linha (entrada: "entrada" ou "ambos"; saída: "saida" ou "ambos");
  // os outros ficam atrás do "Mostrar todos", para a exceção (um estorno, por exemplo).
  const direcao = c.valor > 0 ? "entrada" : "saida";
  const daDirecao = (t: { natureza_padrao?: string | null }) => !t.natureza_padrao || t.natureza_padrao === "ambos" || t.natureza_padrao === direcao;
  const [verTodos, setVerTodos] = React.useState(false);
  const subsDe = (tipoId: string | undefined) => (plano?.subtipos ?? []).filter((x) => x.tipo_id === tipoId);
  const l = c.k === "titulo" ? p.contexto.linhaPorChave.get(c.t.id) : undefined;
  const doTitulo = (l?.t as { plano_conta_tipo_id?: string | null } | undefined)?.plano_conta_tipo_id ?? null;
  const tipoInicial = centro?.tipoId ?? doTitulo ?? null;
  // O tipo que já está no título (ou escolhido) aparece mesmo se for da outra direção.
  const foraDaDirecao = todosOsTipos.filter((t) => !daDirecao(t));
  const mostraTodos = verTodos || foraDaDirecao.some((t) => t.id === tipoInicial);
  const tipos = mostraTodos ? todosOsTipos : todosOsTipos.filter(daDirecao);
  const [tipoSel, setTipoSel] = React.useState<string | undefined>(tipoInicial ?? todosOsTipos.filter(daDirecao)[0]?.id);
  // Só quando há escolha: a PP com um subtipo só (hoje, o 02 tem só "Geral (provisório)") fica como está.
  const editavel = !!regra && !!plano && (regra.tipoCodigo ? subsDe(todosOsTipos[0]?.id).length > 1 : todosOsTipos.length > 0);
  const nome = centro ? plano?.subtipos.find((x) => x.id === centro.subtipoId)?.nome ?? sub : sub;
  if (!editavel)
    // 16/11/2026: o clique nunca abre a troca do lançamento; onde não troca, mostra o porquê.
    return (
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button type="button" onClick={(ev) => ev.stopPropagation()} className="flex w-full min-w-0 items-center text-left">
            <span className="min-w-0 flex-1 truncate">{sub ?? "—"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[300px] p-3 text-xs" onClick={(ev) => ev.stopPropagation()} onOpenAutoFocus={(ev) => ev.preventDefault()}>
          <div className="pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Centro de custo</div>
          <div className="pb-1.5 font-semibold">{sub ?? "Sem subtipo"}</div>
          <div className="text-muted-foreground">{semTrocaDoCentro(c, p)}</div>
        </PopoverContent>
      </Popover>
    );
  const tipoAtual = tipoSel ?? tipos[0]?.id;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
         
          onClick={(ev) => ev.stopPropagation()}
          title={nome ? `${nome}: clique para trocar o centro de custo.` : "Sem centro de custo: clique para escolher."}
          className="group/centro flex w-full min-w-0 items-center gap-0.5 rounded text-left hover:bg-muted"
        >
          <span className={cn("min-w-0 flex-1 truncate", !nome && "font-semibold text-amber-700")}>{nome ?? "Escolher"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50 group-hover/centro:text-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[460px] p-0" onClick={(ev) => ev.stopPropagation()} onOpenAutoFocus={(ev) => ev.preventDefault()}>
        <div className="border-b border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Centro de custo{regra?.tipoCodigo ? " · a PP é sempre Custo Operacional" : ""}
        </div>
        <div className="grid max-h-[320px] grid-cols-2">
          <div className="overflow-y-auto border-r border-border p-1">
            {tipos.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTipoSel(t.id)}
                className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted", t.id === tipoAtual && "bg-muted font-semibold")}
              >
                <span className="font-mono text-[11px] text-muted-foreground">{t.codigo}</span>
                <span className="truncate">{t.nome}</span>
              </button>
            ))}
            {!mostraTodos && foraDaDirecao.length > 0 && (
              <button
                type="button"
                onClick={() => setVerTodos(true)}
                title={`Os tipos de ${direcao === "entrada" ? "saída" : "entrada"}, para a exceção (um estorno, por exemplo).`}
                className="mt-1 w-full rounded-md border-t border-border px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Mostrar todos ({foraDaDirecao.length} de {direcao === "entrada" ? "saída" : "entrada"})
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-1">
            {subsDe(tipoAtual).map((x) => {
              const sel = centro ? centro.subtipoId === x.id : (l?.t as { plano_conta_subtipo_id?: string | null } | undefined)?.plano_conta_subtipo_id === x.id;
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => {
                    if (tipoAtual) onCentro({ tipoId: tipoAtual, subtipoId: x.id });
                    setAberto(false);
                  }}
                  className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted", sel && "bg-emerald-50 font-semibold text-emerald-800")}
                >
                  <span className="font-mono text-[11px] text-muted-foreground">{x.codigo}</span>
                  <span className="min-w-0 flex-1 truncate">{x.nome}</span>
                  {sel && <Check className="h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** O centro de custo que o lançamento tem hoje (ids do plano), para os campos Tipo e Subtipo. */
function centroAtual(c: Candidato, p: PropsDaFila, plano: PlanoDeContas): { tipoId: string | null; subtipoId: string | null } {
  let cod: string | null = null;
  let subNome: string | null = null;
  let subId: string | null = null;
  if (c.k === "titulo") {
    const l = p.contexto.linhaPorChave.get(c.t.id);
    cod = l?.centro.tipo === "plano" ? l.centro.rotulo?.match(/^(\d{2})\b/)?.[1] ?? null : null;
    subId = (l?.t as { plano_conta_subtipo_id?: string | null } | undefined)?.plano_conta_subtipo_id ?? null;
    subNome = subtipoDoCentro(l?.centro);
  } else if (c.k === "baixa") {
    const e = p.banco.extratoPorLancamento[c.l.id] as { tipo?: string | null; subtipo?: string | null } | undefined;
    cod = e?.tipo ?? null;
    subNome = e?.subtipo ?? null;
  } else if (c.k === "planilha") {
    const sigla = c.h.grupo ?? null;
    cod = Object.entries(SIGLA_DO_TIPO).find(([, s]) => s === sigla)?.[0] ?? null;
    subNome = (c.h as { subtipo?: string | null }).subtipo ?? null;
  }
  const tipo = plano.tipos.find((t) => t.codigo === cod) ?? null;
  if (!subId && tipo && subNome) subId = plano.subtipos.find((x) => x.tipo_id === tipo.id && x.nome === subNome)?.id ?? null;
  return { tipoId: tipo?.id ?? null, subtipoId: subId };
}

/** As células Tipo e Subtipo de um lançamento, com a troca do centro de custo
 *  (o clique em qualquer das duas abre a escolha; onde não dá, a dica diz por quê). */
function CelulasDoCentro({ c, p, e, onAbrir, className }: { c: Candidato; p: PropsDaFila; e: { tipo: string | null; sub: string | null }; onAbrir?: () => void; className?: string }) {
  const plano = React.useContext(PlanoCtx);
  const ctx = React.useContext(CentrosCtx);
  const escolhido = ctx?.centros[c.id] ?? null;
  const regra = ctx ? regraDoCentro(c, p) : null;
  // 16/11/2026 (Tiago): dois campos de busca, um de cada vez — o Tipo só com os tipos, o Subtipo só com os subtipos do tipo.
  const atual = plano ? centroAtual(c, p, plano) : { tipoId: null, subtipoId: null };
  const tipoId = escolhido?.tipoId ?? atual.tipoId;
  const subtipoId = escolhido ? escolhido.subtipoId : atual.subtipoId;
  const tipoFixo = regra?.tipoCodigo ? plano?.tipos.find((t) => t.codigo === regra.tipoCodigo) ?? null : null;
  const subsDoTipo = (id: string | null) => (plano?.subtipos ?? []).filter((x) => x.tipo_id === id);
  const trocaTipo = !!regra && !!plano && !regra.tipoCodigo;
  // Sem restrições (16/11/2026): o Subtipo é campo mesmo com uma só opção.
  const trocaSub = !!regra && !!plano;
  const direcao = c.valor > 0 ? "entrada" : "saida";
  const daDirecao = (t: { natureza_padrao?: string | null }) => !t.natureza_padrao || t.natureza_padrao === "ambos" || t.natureza_padrao === direcao;
  const itensDoTipo = plano
    ? [...plano.tipos.filter(daDirecao), ...plano.tipos.filter((t) => !daDirecao(t))].map((t) => ({
        value: t.id,
        label: `${t.codigo} · ${t.nome}`,
        curto: SIGLA_DO_TIPO[t.codigo] ?? t.codigo,
        busca: SIGLA_DO_TIPO[t.codigo] ?? "",
        grupo: daDirecao(t) ? (direcao === "entrada" ? "De entrada" : "De saída") : direcao === "entrada" ? "Outros (de saída)" : "Outros (de entrada)",
      }))
    : [];
  const itensDoSub = subsDoTipo(tipoFixo?.id ?? tipoId).map((x) => ({ value: x.id, label: x.nome, busca: x.codigo }));
  const dica = ctx ? semTrocaDoCentro(c, p) : undefined;
  // O clique no Tipo ou no Subtipo nunca abre a troca do lançamento.
  const parar = (ev: React.MouseEvent) => {
    if (ctx) ev.stopPropagation();
    else onAbrir?.();
  };
  const CAMPO = "h-7 rounded-md border-transparent bg-transparent px-1.5 py-0 text-[11px] font-normal hover:border-border [&_svg]:h-3 [&_svg]:w-3";
  const idDoPopup = React.useId();
  const idTipo = "tipo" + idDoPopup;
  const idSub = "sub" + idDoPopup;
  const popupDaVez = usePopupAtivo();
  const [chaves, setChaves] = React.useState({ tipo: 0, sub: 0 });
  const ultimo = React.useRef<string | null>(null);
  const fechar = (id: string) => setChaves((k) => (id === idTipo ? { ...k, tipo: k.tipo + 1 } : { ...k, sub: k.sub + 1 }));
  React.useEffect(() => {
    if (ultimo.current && popupDaVez !== ultimo.current) {
      fechar(ultimo.current);
      ultimo.current = null;
    }
  }, [popupDaVez]); // eslint-disable-line react-hooks/exhaustive-deps
  const abrir = (id: string) => {
    if (ultimo.current && ultimo.current !== id) fechar(ultimo.current);
    ultimo.current = id;
    abrirPopup(id);
  };
  return (
    <>
      <td onClick={parar} title={trocaTipo ? undefined : dica} className={cn("font-mono text-[11px]", className, CEL, trocaTipo && "!px-1 !py-1")}>
        {trocaTipo ? (
          <span onPointerDownCapture={() => abrir(idTipo)}>
            <Combobox
              key={chaves.tipo}
              items={itensDoTipo}
              value={tipoId}
              onChange={(v) => {
                if (!v || !ctx) return;
                const subs = subsDoTipo(v);
                // Tipo com um só subtipo já fica completo; com mais, o Subtipo pede a escolha.
                ctx.trocar(c.id, { tipoId: v, subtipoId: subs.length === 1 ? subs[0].id : v === tipoId ? subtipoId : null });
              }}
              placeholder="Tipo"
              ariaLabel="Tipo do centro de custo"
              buscaPlaceholder="Buscar o tipo…"
              larguraLista="w-[280px]"
              className={CAMPO}
            />
          </span>
        ) : escolhido ? (
          SIGLA_DO_TIPO[plano?.tipos.find((t) => t.id === escolhido.tipoId)?.codigo ?? ""] ?? e.tipo ?? <Traco />
        ) : (
          e.tipo ?? <Traco />
        )}
      </td>
      <td onClick={parar} title={trocaSub ? undefined : dica} className={cn("text-[11px]", className, CEL, trocaSub && "!px-1 !py-1")}>
        {trocaSub ? (
          <span onPointerDownCapture={() => abrir(idSub)}>
            <Combobox
              key={chaves.sub}
              items={itensDoSub}
              value={subtipoId}
              onChange={(v) => {
                if (!v || !ctx) return;
                ctx.trocar(c.id, { tipoId: (tipoFixo?.id ?? tipoId) as string, subtipoId: v });
              }}
              placeholder="Escolher"
              ariaLabel="Subtipo do centro de custo"
              buscaPlaceholder="Buscar o subtipo…"
              larguraLista="w-[280px]"
              alinharLista="end"
              className={cn(CAMPO, !subtipoId && "[&>span:first-child]:font-semibold [&>span:first-child]:text-amber-700")}
            />
          </span>
        ) : (
          <TxtPassivo t={escolhido ? (escolhido.subtipoId ? plano?.subtipos.find((x) => x.id === escolhido.subtipoId)?.nome ?? null : null) : e.sub} />
        )}
      </td>
    </>
  );
}

/** Job, Tipo, TRI e Reg de um lançamento do sistema. */
function extras(c: Candidato, p: PropsDaFila): { job: string | null; tipo: string | null; sub: string | null; tri: string; reg: string | null } {
  if (c.k === "baixa") {
    const e = p.banco.extratoPorLancamento[c.l.id];
    return { job: e?.job?.codigo ?? null, tipo: e?.tipo ? SIGLA_DO_TIPO[e.tipo] ?? e.tipo : null, sub: (e as { subtipo?: string | null } | undefined)?.subtipo ?? null, tri: e?.tri ?? trimestreDe(c.data), reg: e?.reg ? (e.reg === "TD" ? "TD" : siglaDaRegional(e.reg)) : null };
  }
  if (c.k === "planilha") return { job: c.h.job ?? null, tipo: c.h.grupo ?? null, sub: (c.h as { subtipo?: string | null }).subtipo ?? null, tri: trimestreDe(c.data), reg: c.h.regional ? (c.h.regional === "TD" ? "TD" : siglaDaRegional(c.h.regional)) : null };
  const l = p.contexto.linhaPorChave.get(c.t.id);
  const cod = l?.centro.tipo === "plano" ? l.centro.rotulo.match(/^(\d{2})\b/)?.[1] : null;
  const reg = l?.rateio.length ? textoDaRegional(l.rateio).texto : "—";
  return { job: l?.job?.codigo ?? null, tipo: cod ? SIGLA_DO_TIPO[cod] ?? cod : null, sub: subtipoDoCentro(l?.centro), tri: trimestreDe(c.data), reg: reg === "—" ? null : reg };
}

/** O subtipo (centro de custo) de um centro "04 · Custo Fixo · Aluguel": o que vem depois do tipo. */
function subtipoDoCentro(centro: { tipo: string; rotulo?: string; completo?: string } | undefined | null): string | null {
  if (!centro || centro.tipo !== "plano" || !centro.rotulo || !centro.completo) return null;
  return centro.completo.length > centro.rotulo.length + 3 ? centro.completo.slice(centro.rotulo.length + 3) : null;
}

/** O subtipo da linha já conciliada: o da baixa principal, ou o da linha da planilha. */
function subtipoDaConciliada(r: ResultadoDaLinha, p: PropsDaFila): string | null {
  const ligados = r.mov.linha.ligados ?? [];
  const principal = ligados.find((x) => x.origem !== "juros_baixa") ?? ligados[0];
  if (principal) return (p.banco.extratoPorLancamento[principal.id] as { subtipo?: string | null } | undefined)?.subtipo ?? null;
  const subs = [...new Set((r.mov.linha.historicos ?? []).map((h) => (h as { subtipo?: string | null }).subtipo).filter(Boolean))];
  return subs.length === 1 ? (subs[0] as string) : null;
}

/** O que o sistema achou para a linha, como lista de lançamentos. */
function sugestaoDe(r: ResultadoDaLinha, nosGrupos: Set<string>, p: PropsDaFila): { itens: string[]; especial: Especial | null; ajuste: Ajuste | null } {
  const vazio = { itens: [] as string[], especial: null as Especial | null, ajuste: null as Ajuste | null };
  if (r.mutuo) return { ...vazio, especial: { k: "mutuo", texto: resumoDoSistema(r, p.contexto) } };
  switch (r.estado) {
    case "regra":
      return { ...vazio, especial: { k: "regra", texto: resumoDoSistema(r, p.contexto) } };
    case "par":
      return { ...vazio, especial: { k: "par", texto: resumoDoSistema(r, p.contexto) } };
    case "ja_lancado": {
      const membros = (r.lancamento as { membros?: string[] } | undefined)?.membros;
      return { ...vazio, itens: (membros ?? (r.lancamento ? [r.lancamento.id] : [])).map((id) => "l:" + id) };
    }
    case "divergencia":
      return { ...vazio, itens: r.lancamento ? ["l:" + r.lancamento.id] : [], ajuste: "correcao" };
    case "sugestao":
      return nosGrupos.has(r.mov.id) || !r.titulo ? vazio : { ...vazio, itens: ["t:" + r.titulo.id] };
    case "diferenca":
      return { ...vazio, itens: r.titulo ? ["t:" + r.titulo.id] : [], ajuste: r.retencaoSugerida ? "retencao" : "juros" };
    case "combinacao":
      return r.confianca === "alta" ? { ...vazio, itens: (r.titulos ?? []).map((t) => "t:" + t.id) } : vazio;
    case "soma":
      return { ...vazio, itens: (r.lote?.titulos ?? []).map((t) => "t:" + t.id) };
    case "historico":
      return r.confianca === "alta" ? { ...vazio, itens: (r.historicos ?? []).map((h) => "h:" + h.id) } : vazio;
    default:
      return vazio;
  }
}

/** O ajuste que cabe na composição (o que a diferença pode ser). */
function ajustesPossiveis(c: Pick<Comp, "itens" | "falta" | "r">): Ajuste[] {
  if (!c.itens.length || cents(c.falta) === 0) return [];
  const baixas = c.itens.filter((i) => i.k === "baixa");
  const titulos = c.itens.filter((i) => i.k === "titulo");
  const bancoMaior = Math.abs(c.r.mov.valor) > Math.abs(c.r.mov.valor - c.falta);
  // A correção só quando o pop-up "Corrigir a baixa" a aceita: o banco que debitou a mais fora do boleto não corrige.
  if (baixas.length === 1 && c.itens.length === 1) return baixas[0].k === "baixa" && correcaoDaBaixaCabe(baixas[0].l, c.r.mov) ? ["correcao"] : [];
  if (baixas.length || !titulos.length || titulos.length !== c.itens.length) return [];
  // O custo fixo (avulso ou recorrência) com o valor estimado passa ao valor do banco.
  const t0 = titulos[0] as Extract<Candidato, { k: "titulo" }>;
  const valor: Ajuste[] = titulos.length === 1 && c.r.mov.valor < 0 && ["avulso", "recorrencia"].includes(String(t0.t.origem)) ? ["valor"] : [];
  if (bancoMaior) return titulos.length === 1 && c.r.mov.valor < 0 ? ["juros", ...valor] : valor;
  // Sobra: o último título pode ser pago só em parte, se a parte for positiva.
  const cabeParcial = Math.abs(titulos[titulos.length - 1].valor) - Math.abs(c.falta) > 0.004;
  const parcial: Ajuste[] = cabeParcial ? ["parcial"] : [];
  // A retenção na fonte só quando as alíquotas de sempre explicam a diferença (o mesmo critério do motor e da lupa).
  const unico = titulos.length === 1 && titulos[0].k === "titulo" ? titulos[0].t : null;
  const retencao: Ajuste[] = unico && c.r.mov.valor > 0 && retencaoQueExplica(unico, Math.abs(c.r.mov.valor)) ? ["retencao"] : [];
  return [...retencao, ...parcial, ...valor];
}

/** Quanto o último título paga na baixa parcial. */
const parteDoUltimo = (c: Pick<Comp, "itens" | "falta">) => r2(Math.abs(c.itens[c.itens.length - 1]?.valor ?? 0) - Math.abs(c.falta));

// ---------------------------------------------------------------------------
// A tabela
// ---------------------------------------------------------------------------

/**
 * As larguras: banco (Data, Descrição, Valor, Saldo) e sistema (Data, Valor,
 * Descrição, Fornecedor, Job, Tipo, TRI, Reg), depois Status e Ação.
 */
// 16/11/2026: a coluna Subtipo entra depois de Tipo; Descrição, Fornecedor, Job, TRI e Reg cedem a largura.
const LARGURAS = [70, 170, 122, 108, 104, 114, 180, 116, 90, 46, 110, 40, 44, 104, 152];
/** Débito e crédito em colunas (opção "Uma coluna para cada", 16/11/2026): cada Valor vira Débito e Crédito.
 *  A largura sai das descrições (banco 170→140, sistema 180→156), do Fornecedor, do Job, do Subtipo e do Saldo. */
const LARGURAS_DC = [70, 140, 94, 94, 100, 96, 94, 94, 156, 104, 84, 46, 100, 40, 44, 104, 152];
/** Sem a coluna Status (opção do seletor "Status", 16/11/2026): os 104 px dela vão para as descrições (banco +50, sistema +54). */
// 16/11/2026: o Tipo virou campo (58 px; a descrição do sistema cede 12).
const LARGURAS_SEM_STATUS = [70, 220, 122, 108, 104, 114, 222, 116, 90, 58, 110, 40, 44, 152];
const LARGURAS_DC_SEM_STATUS = [70, 190, 94, 94, 100, 96, 94, 94, 198, 104, 84, 58, 100, 40, 44, 152];
// Decisão 262: os débitos e créditos ficam no quadro do dia (a opção em colunas ficou no protótipo).
const emColunas = () => false;
/** Sem a coluna Status: o Pronta vai para a Ação; o Só no sistema se divide em Baixados sem linha e Previstos. */
// Decisão 262: sem a coluna Status (a Ação diz o que falta).
const semStatus = () => true;
/** O ajuste pela coluna Status só existe com a coluna. */
const ajusteNoStatus = () => false;
const larguras = () => (emColunas() ? (semStatus() ? LARGURAS_DC_SEM_STATUS : LARGURAS_DC) : semStatus() ? LARGURAS_SEM_STATUS : LARGURAS);
const largura = () => larguras().reduce((s, w) => s + w, 0);
const colunas = () => larguras().length;
/** Onde começam e acabam as colunas do lado do sistema (a lista de troca abre embaixo delas). */
const sistemaDe = () => (emColunas() ? 5 : 4);
const sistemaAte = () => (emColunas() ? 15 : 13);
/** Quantas colunas o lado do sistema tem (Data … Reg). */
const doSistema = () => sistemaAte() - sistemaDe();
/** O valor sem sinal e sem "R$" (como o Saldo): na opção em colunas, a coluna diz se é débito ou crédito. */
const semSinal = (v: number) => Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** O valor numa coluna só, com sinal; ou, na opção em colunas, no Débito ou no Crédito. */
function CelulasDeValor({ v, className, onClick, rowSpan, conteudo, cor = true }: { v: number; className?: string; onClick?: () => void; rowSpan?: number; conteudo?: React.ReactNode; cor?: boolean }) {
  const tom = cor ? (v < 0 ? "text-california-red" : "text-emerald-700") : "";
  if (!emColunas())
    return (
      <td rowSpan={rowSpan} onClick={onClick} className={cn("whitespace-nowrap text-right font-mono text-xs", CEL, tom, className)}>
        {conteudo ?? comSinal(v)}
      </td>
    );
  const cel = (aqui: boolean) => (
    <td rowSpan={rowSpan} onClick={onClick} className={cn("whitespace-nowrap text-right font-mono text-xs", CEL, "px-2", tom, className)}>
      {aqui ? (conteudo ?? semSinal(v)) : null}
    </td>
  );
  return (
    <>
      {cel(v < 0)}
      {cel(v > 0)}
    </>
  );
}
const BOTAO_DA_ACAO = "w-[92px]";

const CSS_DA_TABELA =
  ".comp-corte tr > td.corte, .comp-corte tr > th.corte { border-left: 2px solid hsl(var(--border)); } .comp-corte tr:hover > td.sis { background-color: hsl(var(--muted) / 0.7); }";

const Saldos = React.createContext<Map<string, number>>(new Map());
const DICA_DO_SALDO = "O saldo do banco depois desta linha, na ordem do extrato.";
/** Sem o "R$" (como no extrato): cabe até a casa dos milhões. */
const textoDoSaldo = (v: number) => `${v < 0 ? "− " : ""}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CelulaDoSaldo({ id, rowSpan, apagada }: { id: string; rowSpan?: number; apagada?: boolean }) {
  const v = React.useContext(Saldos).get(id);
  return (
    <td rowSpan={rowSpan} title={v === undefined ? "O extrato importado não informa o saldo do banco." : DICA_DO_SALDO} className={cn("whitespace-nowrap text-right align-top font-mono text-xs", CEL, v !== undefined && v < 0 ? "text-california-red" : apagada ? "text-muted-foreground" : "text-foreground/80")}>
      {v === undefined ? <Traco /> : textoDoSaldo(v)}
    </td>
  );
}

type Filtro = "todas" | "conferir" | "sem" | "pronto" | "conciliadas" | "confirmar" | "escolher" | "ajustar" | "lancar" | "pendentes" | "completar" | "aconciliar";

export function TabelaDeComposicoes({
  totais = null,
  p,
  dia,
  itensDoSistema,
  saldoBase,
  servidor,
  avisar,
  avisarOk,
}: {
  p: PropsDaFila;
  /** O dia aberto; nulo, todos os dias em aberto. */
  dia: string | null;
  itensDoSistema: Candidato[];
  /** O saldo do banco no fim de um dia, conferido pelo servidor; nulo, o extrato não informa saldo. */
  saldoBase: SaldoBase | null;
  servidor: AcoesDoDia;
  avisar: (texto: string) => void;
  /** O aviso verde do que deu certo (o "Conciliar" de uma linha, o "Conciliar tudo" sem falha). */
  avisarOk: (texto: string) => void;
  /** Protótipo de 16/11/2026: os créditos e os débitos no topo da tabela (a opção "No topo da tabela"); nulo, não mostra. */
  totais?: { banco: { creditos: number; debitos: number }; sistema: { creditos: number; debitos: number } } | null;
}) {
  const { acoes, pending } = p;
  // A linha da planilha que é de um título sai das opções; no lugar dela vem o título.
  const dono = React.useMemo(() => {
    const m = donosDaPlanilha(itensDoSistema);
    for (const id of m.keys()) PLANILHA_DE_TITULO.add(id);
    return m;
  }, [itensDoSistema]);
  const candidatos = React.useMemo(() => itensDoSistema.filter((x) => !dono.has(x.id) && !PLANILHA_DE_TITULO.has(x.id)), [itensDoSistema, dono]);
  const porId = React.useMemo(() => new Map(candidatos.map((c) => [c.id, c])), [candidatos]);
  const resultados = React.useMemo(() => linhasComMutuo(p.secoes, p.conciliacao.resultados), [p.secoes, p.conciliacao.resultados]);
  const nosGrupos = React.useMemo(() => new Set(p.secoes.grupos.flatMap((g) => g.linhas.map((r) => r.mov.id as string))), [p.secoes.grupos]);
  const saldos = React.useMemo(() => saldosDoExtrato(p.banco.linhas, saldoBase), [p.banco.linhas, saldoBase]);

  // ---- O que a pessoa acertou: fica guardado no banco até a conciliação (decisão 262) ----
  // Dá para parar, recarregar a página ou outra pessoa do financeiro continuar.
  // O centro de custo trocado é por lançamento: vale onde ele aparecer.
  const [centros, setCentros] = React.useState<Record<string, CentroEscolhido>>(() => ({ ...p.banco.centros }));
  const centrosCtx = React.useMemo(() => ({ centros, trocar: (id: string, centro: CentroEscolhido) => setCentros((m) => ({ ...m, [id]: centro })) }), [centros]);
  const [edicoes, setEdicoes] = React.useState<Record<string, Edicao>>(() => ({ ...p.banco.acertos }) as Record<string, Edicao>);
  const [salvoEm, setSalvoEm] = React.useState<string | null>(null);
  // O que já está no banco: guarda só o que mudou desde a última vez.
  const noBanco = React.useRef({ edicoes: { ...p.banco.acertos } as Record<string, unknown>, centros: { ...p.banco.centros } as Record<string, unknown> });
  const horaAgora = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const antes = noBanco.current.edicoes;
      const mudou = [...new Set([...Object.keys(antes), ...Object.keys(edicoes)])].filter((id) => JSON.stringify(antes[id] ?? null) !== JSON.stringify(edicoes[id] ?? null));
      if (!mudou.length) return;
      for (const id of mudou) {
        const e = edicoes[id];
        const r = await salvarAcertoDaLinha({ linhaId: id, itens: e?.itens ?? [], ajuste: e?.ajuste ?? null, especial: e?.especial ?? null });
        if (!r.ok) return avisar(r.message);
        const proximo = { ...noBanco.current.edicoes };
        if (e) proximo[id] = JSON.parse(JSON.stringify(e));
        else delete proximo[id];
        noBanco.current.edicoes = proximo;
      }
      setSalvoEm(horaAgora());
    }, 400);
    return () => clearTimeout(t);
  }, [edicoes]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const antes = noBanco.current.centros;
      const mudou = [...new Set([...Object.keys(antes), ...Object.keys(centros)])].filter((id) => JSON.stringify(antes[id] ?? null) !== JSON.stringify(centros[id] ?? null));
      if (!mudou.length) return;
      for (const item of mudou) {
        const ce = centros[item];
        const r = await salvarCentroDaConciliacao({ contaId: p.banco.conta.id, item, tipoId: ce?.tipoId ?? null, subtipoId: ce?.subtipoId ?? null });
        if (!r.ok) return avisar(r.message);
        const proximo = { ...noBanco.current.centros };
        if (ce) proximo[item] = { ...ce };
        else delete proximo[item];
        noBanco.current.centros = proximo;
      }
      setSalvoEm(horaAgora());
    }, 400);
    return () => clearTimeout(t);
  }, [centros]); // eslint-disable-line react-hooks/exhaustive-deps
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [recolhidas, setRecolhidas] = React.useState<Set<string>>(new Set());

  const comps = React.useMemo(() => {
    const pend = resultados.filter((r) => !r.resolvido && (!dia || r.mov.data === dia));
    const todasPend = resultados.filter((r) => !r.resolvido);
    const tomados = new Map<string, string>();
    for (const r of todasPend) for (const id of edicoes[r.mov.id]?.itens ?? []) tomados.set(id, r.mov.id);
    const base = new Map<string, { itens: string[]; especial: Especial | null; ajuste: Ajuste | null; editada: boolean; centros?: Record<string, CentroEscolhido> }>();
    // A sugestão fica ao lado, sem entrar na linha.
    const sugeridas = new Map<string, Sugestao>();
    const sugeridos = new Set<string>();
    const comPlanilha = new Set(dono.values());
    for (const r of todasPend) {
      const e = edicoes[r.mov.id];
      if (e) {
        base.set(r.mov.id, { itens: e.itens, especial: e.especial ?? null, ajuste: e.ajuste, editada: true, centros: e.centros });
        continue;
      }
      const s = sugestaoDe(r, nosGrupos, p);
      // A linha da planilha de um título vira o título; o ajuste, se houver, a pessoa escolhe.
      const daPlanilha = s.itens.find((id) => dono.has(id)) ?? null;
      const ids = [...new Set(s.itens.map((id) => dono.get(id) ?? id))].filter((id) => !tomados.has(id) && !sugeridos.has(id) && porId.has(id));
      ids.forEach((id) => sugeridos.add(id));
      const itens = ids.map((id) => porId.get(id) as Candidato);
      const titulo = itens.find((i) => i.k === "titulo" && comPlanilha.has(i.id));
      if (itens.length || s.especial)
        sugeridas.set(r.mov.id, {
          itens,
          especial: s.especial,
          ajuste: daPlanilha || ids.length !== s.itens.length ? null : s.ajuste,
          daPlanilha: titulo?.k === "titulo" ? (/^PP-/.test(titulo.t.ref) ? `da ${titulo.t.ref.split(" ")[0]}` : `do título “${titulo.descricao}”`) : null,
        });
      base.set(r.mov.id, { itens: [], especial: null, ajuste: null, editada: false });
    }
    const montar = (r: ResultadoDaLinha): Comp => {
      const b = base.get(r.mov.id)!;
      const itens = b.itens.map((id) => porId.get(id)).filter((c): c is Candidato => !!c);
      const soma = r2(itens.reduce((s, c) => s + c.valor, 0));
      const falta = r2(r.mov.valor - soma);
      const c = { r, itens, especial: b.especial, ajuste: b.ajuste, editada: b.editada, soma, falta, centros: Object.fromEntries(itens.filter((i) => centros[i.id]).map((i) => [i.id, centros[i.id]])) };
      const ajuste = b.ajuste && ajustesPossiveis(c).includes(b.ajuste) ? b.ajuste : null;
      const estado: Comp["estado"] = b.especial ? "bate" : !itens.length ? "vazio" : cents(falta) === 0 ? "bate" : ajuste ? "ajuste" : "difere";
      const mesmoValor = (x: Candidato) => !tomados.has(x.id) && cents(x.valor) === cents(r.mov.valor) && Math.sign(x.valor) === Math.sign(r.mov.valor);
      const iguaisNoDia = estado === "vazio" ? candidatos.filter((x) => mesmoValor(x) && x.data === r.mov.data).length : 0;
      const emOutraData = estado === "vazio" ? candidatos.filter((x) => mesmoValor(x) && x.data !== r.mov.data && Math.abs(diasEntre(r.mov.data, x.data)) <= 7).length : 0;
      const sug = !b.editada ? sugeridas.get(r.mov.id) ?? null : null;
      const situacao: Comp["situacao"] = estado === "bate" || estado === "ajuste" ? "pronto" : estado === "difere" || sug || iguaisNoDia || emOutraData ? "conferir" : "sem";
      return { ...c, ajuste, estado, situacao, iguaisNoDia, emOutraData, sug };
    };
    // Todas as pendentes montadas: a linha de origem de um lançamento pode ser de outro dia.
    const porLinha = new Map(todasPend.map((r) => [r.mov.id as string, montar(r)]));
    return { lista: pend.map((r) => porLinha.get(r.mov.id) as Comp), tomados, porLinha, sugeridos };
  }, [resultados, edicoes, nosGrupos, porId, dia, p, candidatos, dono, centros]);

  const editar = (c: Comp, itens: string[], ajuste: Ajuste | null = null) => {
    setEdicoes((e) => {
      const novo = { ...e, [c.r.mov.id]: { itens, ajuste, centros: e[c.r.mov.id]?.centros } };
      // O lançamento que veio de outra linha editada sai de lá.
      for (const [linha, ed] of Object.entries(novo)) if (linha !== c.r.mov.id) novo[linha] = { ...ed, itens: ed.itens.filter((id) => !itens.includes(id)) };
      return novo;
    });
    setAbertas((a) => ({ ...a, [c.r.mov.id]: true }));
  };
  // O lançamento escolhido está em outra linha do banco: antes de mover, a
  // confirmação mostra de onde sai e para onde vai (pedido do Tiago, 10/11/2026).
  const [movendo, setMovendo] = React.useState<{ destino: Comp; id: string; trocarDe: string | null } | null>(null);
  /** A linha de entrada com o "Recebimento antes da NF" aberto (decisão 262, D11). */
  const [recebidoAntes, setRecebidoAntes] = React.useState<Comp | null>(null);
  // O plano de contas para o centro de custo na linha (16/11/2026), lido uma vez.
  const [plano, setPlano] = React.useState<PlanoDeContas | null>(null);
  React.useEffect(() => {
    let vivo = true;
    carregarDadosDoNovoLancamento()
      .then((r: any) => {
        if (vivo && r?.ok) setPlano({ tipos: r.dados.tipos ?? [], subtipos: r.dados.subtipos ?? [] });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  const aplicar = (c: Comp, id: string, trocarDe: string | null) =>
    editar(c, trocarDe ? c.itens.map((i) => (i.id === trocarDe ? id : i.id)) : [...c.itens.map((i) => i.id), id], null);
  const escolher = (c: Comp, id: string, trocarDe: string | null) => {
    const outra = comps.tomados.get(id);
    if (outra && outra !== c.r.mov.id && comps.porLinha.has(outra)) setMovendo({ destino: c, id, trocarDe });
    else aplicar(c, id, trocarDe);
  };
  /** O centro de custo trocado na linha (a baixa sai com ele). */
  const editarCentro = (_c: Comp, itemId: string, centro: CentroEscolhido) => setCentros((m) => ({ ...m, [itemId]: centro }));
  const desfazerEdicao = (c: Comp) =>
    setEdicoes((e) => {
      const { [c.r.mov.id]: _fora, ...resto } = e;
      return resto;
    });

  // ---- Só no sistema: o que é do dia e não está em nenhuma linha ----
  const livres = React.useMemo(
    () =>
      candidatos
        // O que o sistema sugeriu a uma linha aparece lá, apagado, e não aqui.
        .filter((c) => !comps.tomados.has(c.id) && !comps.sugeridos.has(c.id) && (dia ? c.data === dia : c.k === "baixa"))
        .sort((a, b) => (a.k === "baixa" ? 0 : 1) - (b.k === "baixa" ? 0 : 1) || a.data.localeCompare(b.data)),
    [candidatos, comps.tomados, comps.sugeridos, dia],
  );
  const conciliadas = resultados.filter((r) => r.resolvido && (!dia || r.mov.data === dia));

  // ---- Usar a sugestão e conciliar tudo o que foi acertado ----
  const usar = (c: Comp) => {
    const s = c.sug;
    if (!s) return;
    const ids = s.itens.map((i) => i.id);
    setEdicoes((e) => {
      // Só os lançamentos: o ajuste (juros, retenção, parcial, correção) a pessoa escolhe no rodapé.
      const n: Record<string, Edicao> = { ...e, [c.r.mov.id]: { itens: ids, ajuste: null, especial: s.especial } };
      for (const [linha, ed] of Object.entries(n)) if (linha !== c.r.mov.id) n[linha] = { ...ed, itens: ed.itens.filter((id) => !ids.includes(id)) };
      return n;
    });
    setAbertas((a) => ({ ...a, [c.r.mov.id]: true }));
  };
  /** Como a linha acertada vai para o banco, numa chamada só (null: pede a baixa completa, uma a uma). */
  const chamadaDoAcerto = (c: Comp): Chamada | null => {
    const r = c.r;
    if (c.itens.some((i) => c.centros[i.id] && !c.centros[i.id].subtipoId)) return null;
    if (c.especial) {
      if (c.especial.k === "regra") return r.regra?.id ? { nome: "lancarPelaRegra", args: [[{ linhaId: r.mov.id, regraId: r.regra.id as string }]], tipo: "regra" } : null;
      if (c.especial.k === "par" && r.par) {
        const l = r.titulo ? p.contexto.linhaPorChave.get(r.titulo.id) : undefined;
        const referencia = r.titulo ? `${r.titulo.ref} · ${r.titulo.contraparte}` : null;
        const [saida, volta] = r.mov.valor < 0 ? [r, r.par] : [r.par, r];
        return { nome: "registrarSaiuEVoltou", args: [saida.mov.id, volta.mov.id, referencia, l?.lado === "pagar" ? l.t.parte_id : null], tipo: "par", tambem: r.par.mov.id };
      }
      return null; // o mútuo abre o lançamento entre as empresas
    }
    const baixas = c.itens.filter((i): i is Extract<Candidato, { k: "baixa" }> => i.k === "baixa");
    const titulos = c.itens.filter((i): i is Extract<Candidato, { k: "titulo" }> => i.k === "titulo");
    const planilha = c.itens.filter((i): i is Extract<Candidato, { k: "planilha" }> => i.k === "planilha");
    if (planilha.length) return baixas.length || titulos.length ? null : { nome: "conciliarPeloHistorico", args: [r.mov.id, planilha.map((i) => i.h.id), null], tipo: "planilha" };
    if (c.ajuste === "correcao" && baixas.length === 1)
      return { nome: "corrigirBaixa", args: [baixas[0].l.id, r.mov.id, `Acerto da conciliação de ${ddmm(r.mov.data)}: o banco debitou ${moeda(Math.abs(r.mov.valor))}.`], tipo: "correcao" };
    if (c.estado !== "bate" && c.estado !== "ajuste") return null;
    if (!titulos.length) return baixas.length ? { nome: "conciliarLinha", args: [r.mov.id, baixas.flatMap((b) => b.l.ids), null], tipo: "ligada" } : null;
    const linhas = titulos.map((t) => p.contexto.linhaPorChave.get(t.t.id));
    // O centro de custo escolhido na linha entra na baixa; o título que só não tinha centro (a nota) passa a sair num clique.
    const itens = linhas.map((l, k) => itemComCentro(l, c.centros[titulos[k].id]));
    if (itens.some((i) => !i)) return null;
    const parte = c.ajuste === "parcial" ? parteDoUltimo(c) : null;
    // O título pago em parte com retenção na fonte pede a baixa completa (como no Conciliar da linha).
    if (parte !== null && cents(itens[itens.length - 1]?.aberto ?? 0) !== cents(titulos[titulos.length - 1].valor)) return null;
    const finais = itens.map((i, k) => (parte !== null && k === itens.length - 1 ? { ...i!, aberto: parte } : i!));
    // "Corrigir o valor do título": o título avulso passa ao valor do banco e sai a baixa pela linha (decisão 262).
    if (c.ajuste === "valor") return titulos.length === 1 && !baixas.length ? { nome: "corrigirValorDoTituloEBaixar", args: [{ linhaId: r.mov.id, itens: [finais[0]] }], tipo: "valor" } : null;
    // A retenção abre a baixa com os impostos; o juros sem boleto também.
    if (c.ajuste === "retencao") return null;
    if (c.ajuste === "juros") return titulos.length === 1 && !baixas.length && /TITULO|BOLETO|CONCESSIONARIA/i.test(r.mov.historico) ? { nome: "baixarEConciliar", args: [{ linhaId: r.mov.id, itens: finais }], tipo: "juros" } : null;
    if (baixas.length || parte !== null) return { nome: "conciliarMisto", args: [{ linhaId: r.mov.id, lancamentoIds: baixas.flatMap((b) => b.l.ids), itens: finais }], tipo: parte !== null ? "parcial" : "misto" };
    return { nome: "baixarEConciliar", args: [{ linhaId: r.mov.id, itens: finais }], tipo: "baixa" };
  };
  /** Por que a linha acertada pede o "Completar" (a dica do botão, 16/11/2026). */
  const motivoDoCompletar = (c: Comp): string => {
    if (c.itens.some((i) => c.centros[i.id] && !c.centros[i.id].subtipoId)) return "Falta o subtipo do centro de custo: escolha na coluna Subtipo.";
    if (c.especial?.k === "mutuo") return "Mútuo entre empresas: falta o lançamento entre as empresas.";
    if (c.especial) return "Falta a regra do histórico.";
    const titulos = c.itens.filter((i): i is Extract<Candidato, { k: "titulo" }> => i.k === "titulo");
    if (c.itens.some((i) => i.k === "planilha") && titulos.length) return "Linha da planilha junto com título: conclua pela baixa.";
    if (c.ajuste === "retencao") return "Retenção na fonte: confira os impostos retidos antes de gravar.";
    if (c.ajuste === "juros") return "Juros e multa pagos por PIX ou TED: lance os juros na baixa.";
    for (const t of titulos) {
      const l = p.contexto.linhaPorChave.get(t.t.id);
      if (!l || itemComCentro(l, c.centros[t.id])) continue;
      if (l.motivoForaDoLote) return l.motivoForaDoLote;
      if (l.lote?.tipo === "imposto") return "Falta a guia do imposto.";
      if (l.lote && !l.lote.centroDeCusto) return `Falta o centro de custo ${l.lote.referencia ? `da ${l.lote.referencia}` : "do título"}: escolha na coluna Subtipo.`;
    }
    if (c.ajuste === "parcial") return "Baixa parcial de título com retenção na fonte: faça a baixa completa.";
    return "Esta linha pede a baixa completa.";
  };
  const acertadas = comps.lista.filter((c) => c.editada && (c.estado === "bate" || c.estado === "ajuste"));
  const doAcerto = acertadas.map((c) => ({ c, ch: chamadaDoAcerto(c) }));
  const semUmClique = new Set(doAcerto.filter((x) => !x.ch).map((x) => x.c.r.mov.id as string));
  const [resumo, setResumo] = React.useState(false);
  const [andamento, setAndamento] = React.useState<{ feitas: number; total: number } | null>(null);
  const conciliarTudo = async () => {
    const fila = doAcerto.filter((x): x is { c: Comp; ch: Chamada } => !!x.ch);
    const resolvidas = new Set<string>();
    const falhas: Array<{ c: Comp; msg: string }> = [];
    setAndamento({ feitas: 0, total: fila.length });
    for (const [k, { c, ch }] of fila.entries()) {
      if (!resolvidas.has(c.r.mov.id)) {
        try {
          const erroDoCentro = await aplicarCentrosDasBaixas(c);
          if (erroDoCentro) throw new Error(erroDoCentro);
          const r = await executarChamada(ch);
          if (r?.ok) {
            resolvidas.add(c.r.mov.id);
            if (ch.tambem) resolvidas.add(ch.tambem);
          } else falhas.push({ c, msg: r?.message ?? "Não foi possível conciliar." });
        } catch (e) {
          falhas.push({ c, msg: String((e as Error)?.message ?? e) });
        }
      }
      setAndamento({ feitas: k + 1, total: fila.length });
    }
    setEdicoes((e) => Object.fromEntries(Object.entries(e).filter(([linha]) => !resolvidas.has(linha))));
    setAndamento(null);
    setResumo(false);
    const n = fila.filter((x) => resolvidas.has(x.c.r.mov.id)).length;
    const feitas = n === 1 ? "1 linha conciliada" : `${n} linhas conciliadas`;
    if (falhas.length) avisar(`${feitas}; ${falhas.length === 1 ? "1 não foi" : `${falhas.length} não foram`} (${ddmm(falhas[0].c.r.mov.data)}, ${moeda(Math.abs(falhas[0].c.r.mov.valor))}): ${falhas[0].msg}`);
    else avisarOk(`${feitas} de uma vez.`);
  };

  /** O centro de custo trocado na linha numa baixa já feita: gravado antes da conciliação da linha. */
  const aplicarCentrosDasBaixas = async (c: Comp): Promise<string | null> => {
    for (const it of c.itens) {
      const ce = c.centros[it.id];
      if ((it.k !== "baixa" && it.k !== "planilha") || !ce) continue;
      if (!ce.subtipoId) return "Falta o subtipo do centro de custo: escolha na coluna Subtipo.";
      const r =
        it.k === "baixa"
          ? await trocarCentroDosLancamentos(it.l.ids, ce.tipoId, ce.subtipoId)
          : await trocarCentroDasPrevisoes([it.h.id], ce.tipoId, ce.subtipoId);
      if (!r?.ok) return r?.message ?? "Não foi possível trocar o centro de custo.";
    }
    return null;
  };
  // Sem a coluna Status (16/11/2026): o "Conciliar" da Ação grava só esta linha,
  // com a mesma chamada do "Conciliar tudo o que foi acertado".
  const [gravando, setGravando] = React.useState<string | null>(null);
  const conciliarUma = async (c: Comp) => {
    const ch = chamadaDoAcerto(c);
    const erroDoCentro = await aplicarCentrosDasBaixas(c);
    if (erroDoCentro) return avisar(erroDoCentro);
    if (!ch) return conciliar(c);
    setGravando(c.r.mov.id);
    try {
      const r = await executarChamada(ch);
      if (r?.ok) {
        const fora = new Set([c.r.mov.id as string, ...(ch.tambem ? [ch.tambem] : [])]);
        setEdicoes((e) => Object.fromEntries(Object.entries(e).filter(([linha]) => !fora.has(linha))));
        avisarOk(`Linha de ${ddmm(c.r.mov.data)} (${moeda(Math.abs(c.r.mov.valor))}) conciliada.`);
      } else avisar(r?.message ?? "Não foi possível conciliar.");
    } catch (e) {
      avisar(String((e as Error)?.message ?? e));
    } finally {
      setGravando(null);
    }
  };

  // ---- Conciliar: a mesma ação para todos os casos ----
  const conciliarMisto = (r: ResultadoDaLinha, baixas: Array<Extract<Candidato, { k: "baixa" }>>, titulos: Array<Extract<Candidato, { k: "titulo" }>>, parteDoUltimoTitulo: number | null = null) => {
    const itens = titulos.map((c, k) => {
      const l = p.contexto.linhaPorChave.get(c.t.id);
      const item = l ? itemDoLote(l) : null;
      // A baixa parcial: o último título sai só pela parte que o banco pagou.
      return item && parteDoUltimoTitulo !== null && k === titulos.length - 1 ? { ...item, aberto: parteDoUltimoTitulo } : item;
    });
    const prontos = itens.filter((i): i is NonNullable<typeof i> => !!i);
    const ultimo = titulos[titulos.length - 1];
    const doUltimo = ultimo ? p.contexto.linhaPorChave.get(ultimo.t.id) : undefined;
    if (parteDoUltimoTitulo !== null && doUltimo && cents(itemDoLote(doUltimo)?.aberto ?? 0) !== cents(ultimo.valor)) {
      return avisar("O título pago em parte tem retenção na fonte: concilie-o sozinho nesta linha, pela baixa completa, e junte o resto depois.");
    }
    if (prontos.length !== itens.length) return avisar("Um dos títulos pede a baixa completa (centro de custo, fatura ou guia): concilie este título sozinho primeiro.");
    servidor.conciliarMisto(r.mov.id, baixas.flatMap((c) => c.l.ids), prontos);
  };
  /** O título que a baixa de um clique aceita: com centro de custo completo e
   *  sem nada que peça a baixa completa (o mesmo critério do lote da aba). */
  const deUmCliqueOTitulo = (t: TituloDoMotor | null | undefined) => {
    if (!t || !comCentro(t)) return false;
    const l = p.contexto.linhaPorChave.get(t.id);
    return !!l && itemDoLote(l) !== null;
  };
  const conciliar = (c: Comp) => {
    const r = c.r;
    if (c.especial) return c.especial.k === "regra" ? acoes.lancarRegra([r]) : c.especial.k === "par" ? acoes.conciliarPar(r) : acoes.lancarMutuo(r);
    const baixas = c.itens.filter((i): i is Extract<Candidato, { k: "baixa" }> => i.k === "baixa");
    const titulos = c.itens.filter((i): i is Extract<Candidato, { k: "titulo" }> => i.k === "titulo");
    const planilha = c.itens.filter((i): i is Extract<Candidato, { k: "planilha" }> => i.k === "planilha");
    if (planilha.length) return acoes.conciliarHistorico([{ ...r, estado: "historico", historicos: planilha.map((i) => i.h) }]);
    if (c.ajuste === "correcao" && baixas.length === 1) return acoes.corrigirBaixa({ ...r, estado: "divergencia", lancamento: baixas[0].l, diferencaBaixa: r2(Math.abs(baixas[0].valor) - Math.abs(r.mov.valor)) });
    if (baixas.length && titulos.length) return conciliarMisto(r, baixas, titulos, c.ajuste === "parcial" ? parteDoUltimo(c) : null);
    if (baixas.length === 1) return acoes.ligar({ ...r, estado: "ja_lancado", lancamento: baixas[0].l });
    if (baixas.length) return acoes.conciliarAgrupamento([r.mov.id], baixas.flatMap((i) => i.l.ids), [r.mov.data, ...baixas.map((i) => i.data)]);
    const ts = titulos.map((i) => i.t);
    // Um título: o que não é de um clique (ajuste, centro de custo) abre a baixa preenchida.
    if (ts.length === 1) {
      if (c.estado === "bate" && deUmCliqueOTitulo(ts[0])) return acoes.conciliarGrupo([r], ts);
      // A baixa completa abre com o ajuste escolhido na linha: a retenção na
      // fonte vai preenchida; a baixa parcial não leva a retenção que o motor sugeriu.
      const semRetencao = { ...r, retencaoSugerida: undefined, retencaoAliquotas: undefined };
      const base = r.titulo?.id === ts[0].id ? r : { ...semRetencao, diferenca: undefined };
      const ret = c.ajuste === "retencao" ? retencaoQueExplica(ts[0], Math.abs(r.mov.valor)) : null;
      const aliquotas = ret ? RETENCOES_COMUNS.find((x) => x.nome === ret.nome)?.aliquotas : undefined;
      if (ret && aliquotas) return acoes.conferirTitulo({ ...base, retencaoSugerida: ret.retidos, retencaoAliquotas: aliquotas }, ts[0]);
      return acoes.conferirTitulo(c.ajuste === "parcial" ? { ...base, retencaoSugerida: undefined, retencaoAliquotas: undefined } : base, ts[0]);
    }
    if (c.estado === "bate") return acoes.conciliarCombinacao({ ...r, estado: "combinacao", titulos: ts });
    if (c.ajuste === "parcial") return conciliarMisto(r, [], titulos, parteDoUltimo(c));
    return acoes.conferirCombinacao({ ...r, estado: "combinacao", titulos: ts });
  };

  // "Conciliar os N": só o que o sistema sugeriu, ninguém mexeu e sai num clique.
  const deUmClique = (c: Comp) =>
    !c.editada &&
    c.estado === "bate" &&
    !c.r.mutuo &&
    (["ja_lancado", "soma", "regra"].includes(c.r.estado) ||
      (c.r.estado === "historico" && !!c.r.historicos?.length) ||
      (c.r.estado === "par" && c.r.mov.valor > 0) ||
      (c.r.estado === "sugestao" && deUmCliqueOTitulo(c.r.titulo)) ||
      (c.r.estado === "combinacao" && (c.r.titulos ?? []).every((t) => deUmCliqueOTitulo(t))));
  const emLote = comps.lista.filter(deUmClique);

  // ---- Editar a data, como na aba Títulos ----
  const [editando, setEditando] = React.useState<Candidato | null>(null);
  const linhaDe = (c: Candidato | null): Linha | null => (c?.k === "titulo" ? (p.contexto.linhaPorChave.get(c.t.id) ?? null) : null);
  const salvarData = (c: Candidato, data: string) => {
    setEditando(null);
    if (c.k === "baixa") return servidor.mudarDataDaBaixa(c.l.ids, data);
    if (c.k === "planilha") return servidor.mudarDataDaPrevisao(c.h.id, data);
    const l = linhaDe(c);
    if (l?.editaData) servidor.mudarDataDoTitulo(l, data);
  };
  /** O que muda de data por aqui: a baixa, a previsão da planilha e o título
   *  que a aba Títulos já edita (PP, avulso e nota). O desembolso, a fatura, a
   *  guia, o estorno e a transferência em aberto ficam para depois. */
  const editaData = (c: Candidato) => (c.k === "baixa" ? true : c.k === "planilha" ? c.previsao : !!linhaDe(c)?.editaData);
  const lEdit = linhaDe(editando);
  const notaAReceber = editando?.k === "titulo" && lEdit?.lado === "receber" && lEdit?.editaData;

  // ---- As seções ----
  const prontas = comps.lista.filter((c) => c.situacao === "pronto");
  const aConferir = comps.lista.filter((c) => c.situacao === "conferir");
  const semLancamento = comps.lista.filter((c) => c.situacao === "sem");
  const abertas2 = [...aConferir, ...semLancamento];
  const alternar = (k: string) =>
    setRecolhidas((s) => {
      const x = new Set(s);
      if (x.has(k)) x.delete(k);
      else x.add(k);
      return x;
    });
  // O "Conciliar as N prontas" (o que o sistema sugeriu, sem ninguém olhar) sai:
  // concilia-se o que alguém acertou, linha a linha.
  void emLote;
  const nNoLote = doAcerto.length - semUmClique.size;
  const botaoEmLote = (
    <span className="flex items-center gap-3">
      {salvoEm && Object.keys(edicoes).length > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title="O que foi acertado fica salvo: dá para parar, recarregar a página ou outra pessoa continuar. Nada é conciliado até o “Conciliar tudo o que foi acertado”.">
          <Save className="h-3.5 w-3.5" />
          Acertos salvos às {salvoEm}
        </span>
      )}
      <BotaoDaSecao verde disabled={pending || !!andamento || nNoLote === 0} onClick={() => setResumo(true)}>
        <ListChecks className="h-3.5 w-3.5" />
        Conciliar tudo o que foi acertado{nNoLote > 0 ? ` · ${nNoLote}` : ""}
      </BotaoDaSecao>
    </span>
  );

  const cabecalho = (k: string, titulo: string, n: number, ponto: string, dica: string, botao: React.ReactNode = null) => (
    <tbody key={"cab-" + k}>
      <tr className="border-b border-border bg-muted/60">
        <td colSpan={colunas()} className="px-3 py-2">
          <span className="flex items-center gap-2.5">
            <button type="button" onClick={() => alternar(k)} aria-expanded={!recolhidas.has(k)} className="flex items-center gap-2.5 text-left">
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", recolhidas.has(k) && "-rotate-90")} />
              <span className={cn("h-2 w-2 rounded-full", ponto)} />
              <span className="text-[13px] font-semibold text-foreground">{titulo}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{n}</span>
            </button>
            <InfoDica texto={dica} />
            <span className="flex-1" />
            {botao}
          </span>
        </td>
      </tr>
    </tbody>
  );

  const linhaDaComp = (c: Comp) => (
    <LinhaDoBanco
      key={c.r.mov.id}
      c={c}
      p={p}
      aberta={abertas[c.r.mov.id] ?? (c.estado === "difere" || c.estado === "vazio")}
      alternar={() => setAbertas((a) => ({ ...a, [c.r.mov.id]: !(a[c.r.mov.id] ?? (c.estado === "difere" || c.estado === "vazio")) }))}
      candidatos={candidatos}
      tomados={comps.tomados}
      onRetirar={(id) => editar(c, c.itens.filter((i) => i.id !== id).map((i) => i.id))}
      onAdicionar={(id) => escolher(c, id, null)}
      onTrocar={(de, para) => escolher(c, para, de)}
      onAjuste={(a) => editar(c, c.itens.map((i) => i.id), a)}
      onDesfazerEdicao={() => desfazerEdicao(c)}
      onConciliar={async () => {
        const erroDoCentro = await aplicarCentrosDasBaixas(c);
        if (erroDoCentro) return avisar(erroDoCentro);
        conciliar(c);
      }}
      onConciliarUma={() => conciliarUma(c)}
      gravando={!!gravando}
      onUsar={() => usar(c)}
      onDispensar={() => editar(c, [])}
      onRecebidoAntes={() => setRecebidoAntes(c)}
      pedeABaixa={semUmClique.has(c.r.mov.id)}
      motivoDoCompletar={semUmClique.has(c.r.mov.id) ? motivoDoCompletar(c) : null}
      onCentro={(id, centro) => editarCentro(c, id, centro)}
    />
  );
  const linhaLivre = (c: Candidato) => (
    <LinhaSoNoSistema
      key={c.id}
      c={c}
      p={p}
      linhas={abertas2}
      onEditarData={editaData(c) ? () => setEditando(c) : null}
      onAssociar={(alvo) => editar(alvo, [...alvo.itens.map((i) => i.id), c.id], null)}
    />
  );
  const linhaConciliada = (r: ResultadoDaLinha) => <LinhaConciliada key={r.mov.id} r={r} p={p} />;

  const baixadosSemLinha = livres.filter((c) => c.k === "baixa");
  const previstos = livres.filter((c) => c.k !== "baixa");
  const DICA_BAIXADOS =
    "Pagos (ou recebidos) no sistema neste dia, e o banco não mostra a linha deles. O mês não fecha até resolver: associe a uma linha do banco ou mude a data da baixa (o lápis).";
  const DICA_PREVISTOS =
    "Títulos em aberto previstos para este dia (de qualquer conta) e previsões da planilha. Não travam o fechamento: se o banco pagou, associe à linha; o lápis muda a data.";
  const DICA_SO_SISTEMA =
    "O que o sistema tem neste dia e o banco não mostra: baixa já feita (até resolver, o dia não fecha), título em aberto previsto para o dia (de qualquer conta) e previsão da planilha. O lápis muda a data, como na aba Títulos. Associar leva o lançamento para uma linha do banco.";

  return (
    <>
      {(
        <div className="flex flex-wrap items-center gap-2">
          {(
            reduzidos()
              ? ([
                  ["todas", `Todas · ${comps.lista.length + conciliadas.length}`],
                  // 16/11/2026 (Tiago): as prontas se dividem pelo botão da Ação — "A completar" (Completar) e "A conciliar" (Conciliar).
                  ["pendentes", `Pendentes · ${comps.lista.filter((c) => statusDaLinha(c) !== "pronta").length}`],
                  ["completar", `A completar · ${prontas.filter((c) => semUmClique.has(c.r.mov.id)).length}`],
                  ["aconciliar", `A conciliar · ${prontas.filter((c) => !semUmClique.has(c.r.mov.id)).length}`],
                  ["conciliadas", `Conciliadas · ${conciliadas.length}`],
                ] as Array<[Filtro, string]>)
              : revisados()
              ? ([
                  ["todas", `Todas · ${comps.lista.length + conciliadas.length}`],
                  ...(["confirmar", "escolher", "ajustar", "lancar"] as const).map((k) => [k, `${STATUS_DA_LINHA[k].filtro} · ${comps.lista.filter((c) => statusDaLinha(c) === k).length}`]),
                  ["pronto", `Prontas · ${prontas.length}`],
                  ["conciliadas", `Conciliadas · ${conciliadas.length}`],
                ] as Array<[Filtro, string]>)
              : ([
                  ["todas", `Todas · ${comps.lista.length + conciliadas.length}`],
                  ["pronto", `Prontas · ${prontas.length}`],
                  ["conferir", `A definir · ${aConferir.length}`],
                  ["sem", `${"Faltando"} · ${semLancamento.length}`],
                  ["conciliadas", `Conciliadas · ${conciliadas.length}`],
                ] as Array<[Filtro, string]>)
          ).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filtro === k}
              onClick={() => setFiltro(k)}
              className={cn("h-8 rounded-full border px-3 text-xs font-semibold", filtro === k ? "border-foreground bg-foreground text-white" : "border-border bg-white text-foreground hover:bg-muted/50")}
            >
              {rotulo}
            </button>
          ))}
          <span className="flex-1" />
          {botaoEmLote}
        </div>
      )}

      {/* O corte entre o banco e o sistema, e o realce do lado do sistema (onde o clique troca o lançamento).
          Por `dangerouslySetInnerHTML`: como texto, o ">" do seletor sai escapado no servidor e a hidratação falha. */}
      <style dangerouslySetInnerHTML={{ __html: CSS_DA_TABELA }} />
      <PlanoCtx.Provider value={plano}>
      <CentrosCtx.Provider value={centrosCtx}>
      <Saldos.Provider value={saldos}>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table style={{ minWidth: largura() }} className="comp-corte w-full table-fixed text-sm">
          <colgroup>
            {larguras().map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Descrição no banco</th>
              {emColunas() ? (
                <>
                  <th className="px-2 py-2 text-right">Débito</th>
                  <th className="px-2 py-2 text-right">Crédito</th>
                </>
              ) : (
                <th className="px-3 py-2 text-right">Valor</th>
              )}
              <th className="px-3 py-2 text-right" title="O saldo do banco depois de cada linha, na ordem do extrato.">
                Saldo
              </th>
              <th className="corte px-3 py-2 text-left">
                Data
              </th>
              {emColunas() ? (
                <>
                  <th className="px-2 py-2 text-right">Débito</th>
                  <th className="px-2 py-2 text-right">Crédito</th>
                </>
              ) : (
                <th className="px-3 py-2 text-right">Valor</th>
              )}
              <th className="px-3 py-2 text-left">No sistema · Descrição</th>
              <th className="px-3 py-2 text-left">Fornecedor</th>
              <th className="px-3 py-2 text-left">Job</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left" title="O subtipo do plano de contas (o centro de custo).">
                Subtipo
              </th>
              <th className="px-3 py-2 text-left">TRI</th>
              <th className="px-3 py-2 text-left">Reg</th>
              {!semStatus() && (
              <th className="px-3 py-2 text-left">
                {revisados() ? (
                  <span className="inline-flex items-center gap-1">
                    Status
                    <InfoDica texto={<LegendaDoStatus />} largura={400} />
                  </span>
                ) : (
                  "Status"
                )}
              </th>
              )}
              <th className="px-3 py-2 text-left">Ação</th>
            </tr>
            {totais && (emColunas() ? <LinhaDosTotaisEmColunas totais={totais} /> : <LinhaDosTotais totais={totais} />)}
          </thead>

          {
            [...comps.lista.map((c) => ({ id: c.r.mov.id as string, ordem: c.r.mov.ordem, data: c.r.mov.data, c, r: null as ResultadoDaLinha | null })), ...conciliadas.map((r) => ({ id: r.mov.id as string, ordem: r.mov.ordem, data: r.mov.data, c: null as Comp | null, r }))]
              .sort(naOrdemDoExtrato)
              .filter((x) =>
                filtro === "todas"
                  ? true
                  : filtro === "conciliadas"
                    ? !!x.r
                    : !!x.c &&
                      (filtro === "pendentes"
                        ? statusDaLinha(x.c) !== "pronta"
                        : filtro === "completar"
                          ? statusDaLinha(x.c) === "pronta" && semUmClique.has(x.c.r.mov.id)
                          : filtro === "aconciliar"
                            ? statusDaLinha(x.c) === "pronta" && !semUmClique.has(x.c.r.mov.id)
                            : filtro === "pronto" || filtro === "conferir" || filtro === "sem"
                              ? x.c.situacao === filtro
                              : statusDaLinha(x.c) === filtro),
              )
              .map((x) => (x.c ? linhaDaComp(x.c) : linhaConciliada(x.r as ResultadoDaLinha)))
          }

          {semStatus() ? (
            <>
              {baixadosSemLinha.length > 0 && !["pronto", "completar", "aconciliar", "conciliadas"].includes(filtro) && cabecalho("baixados", "Só no sistema · baixados sem linha no banco: travam o mês", baixadosSemLinha.length, "bg-california-red", DICA_BAIXADOS)}
              {!["pronto", "completar", "aconciliar", "conciliadas"].includes(filtro) && !recolhidas.has("baixados") && baixadosSemLinha.map(linhaLivre)}
              {previstos.length > 0 && !["pronto", "completar", "aconciliar", "conciliadas"].includes(filtro) && cabecalho("previstos", "Só no sistema · previstos: não travam", previstos.length, "bg-muted-foreground/50", DICA_PREVISTOS)}
              {!["pronto", "completar", "aconciliar", "conciliadas"].includes(filtro) && !recolhidas.has("previstos") && previstos.map(linhaLivre)}
            </>
          ) : (
            <>
              {livres.length > 0 && !["pronto", "completar", "aconciliar", "conciliadas"].includes(filtro) && cabecalho("livres", "Só no sistema", livres.length, "bg-california-red", DICA_SO_SISTEMA)}
              {!["pronto", "completar", "aconciliar", "conciliadas"].includes(filtro) && !recolhidas.has("livres") && livres.map(linhaLivre)}
            </>
          )}

          {!comps.lista.length && !conciliadas.length && !livres.length && (
            <tbody>
              <tr>
                <td colSpan={colunas()} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma linha do banco neste dia.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      </Saldos.Provider>
      </CentrosCtx.Provider>
      </PlanoCtx.Provider>

      {resumo && (
        <ResumoDoAcerto
          dia={dia}
          linhas={doAcerto}
          ficam={comps.lista.filter((c) => !(c.editada && (c.estado === "bate" || c.estado === "ajuste")))}
          andamento={andamento}
          onFechar={() => !andamento && setResumo(false)}
          onConfirmar={conciliarTudo}
        />
      )}

      {recebidoAntes && (
        <RecebidoAntesDaLinha
          c={recebidoAntes}
          conta={p.banco.conta}
          plano={plano}
          onFechar={() => setRecebidoAntes(null)}
          onFeito={(mensagem) => {
            const id = recebidoAntes.r.mov.id as string;
            setEdicoes((e) => Object.fromEntries(Object.entries(e).filter(([linha]) => linha !== id)));
            setRecebidoAntes(null);
            avisarOk(mensagem);
          }}
        />
      )}

      {movendo &&
        (() => {
          const item = porId.get(movendo.id);
          const origem = comps.porLinha.get(comps.tomados.get(movendo.id) ?? "");
          if (!item || !origem) return null;
          return (
            <MoverDeLinha
              item={item}
              origem={origem}
              destino={movendo.destino}
              trocarDe={movendo.trocarDe}
              onFechar={() => setMovendo(null)}
              onConfirmar={() => {
                aplicar(movendo.destino, movendo.id, movendo.trocarDe);
                setMovendo(null);
              }}
            />
          );
        })()}

      {/* O mesmo pop-up do lápis da aba Títulos. */}
      <EditarDataPagamentoDialog
        open={!!editando && !notaAReceber}
        onOpenChange={(o) => !o && setEditando(null)}
        alvo={
          editando && !notaAReceber
            ? {
                titulo: editando.descricao,
                origem:
                  editando.k === "baixa"
                    ? "Baixa já lançada no sistema"
                    : editando.k === "planilha"
                      ? "Previsão da planilha"
                      : lEdit?.lado === "pagar"
                        ? lEdit.t.origem === "pp"
                          ? `${lEdit.t.origem_label} · ${lEdit.t.parcela_numero}/${lEdit.t.parcela_total}`
                          : lEdit.t.origem_label
                        : (lEdit?.origem ?? "Título"),
                vencOriginal:
                  editando.k === "titulo"
                    ? ((lEdit?.lado === "pagar" ? lEdit.t.venc_original : lEdit?.vencimento) ?? null)
                    : editando.k === "planilha"
                      ? (editando.h.dataDaPlanilha ?? editando.data)
                      : null,
                primeiraData: editando.k === "titulo" && lEdit?.lado === "pagar" ? (lEdit.t.data_pagamento_primeira ?? null) : null,
                dataAtual: editando.data,
              }
            : null
        }
        pending={pending}
        erro={null}
        onSalvar={(d) => editando && salvarData(editando, d)}
      />
      <EditarPrevisaoDialog
        open={!!editando && !!notaAReceber}
        onOpenChange={(o) => !o && setEditando(null)}
        alvo={
          editando && notaAReceber
            ? {
                numeroNf: lEdit.t.fat_numero_nf,
                parcela: `${lEdit.t.numero_parcela}/${lEdit.t.total_parcelas}`,
                cliente: lEdit.t.contraparte_nome,
                vencimento: lEdit.t.data_vencimento,
                primeiraPrevisao: lEdit.t.data_previsao_recebimento_primeira,
                previsaoAtual: lEdit.t.data_previsao_recebimento,
              }
            : null
        }
        pending={pending}
        erro={null}
        onSalvar={(d) => editando && salvarData(editando, d)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// A confirmação de mover um lançamento de uma linha do banco para outra
// ---------------------------------------------------------------------------

/** Como a linha fica com estes lançamentos: fecha com o banco, falta ou sobra. */
function comoFica(r: ResultadoDaLinha, itens: Candidato[]): { texto: string; fecha: boolean } {
  const n = itens.length;
  if (!n) return { texto: "Fica sem lançamento", fecha: false };
  const soma = r2(itens.reduce((s, c) => s + c.valor, 0));
  const falta = r2(r.mov.valor - soma);
  const quantos = `Fica com ${n === 1 ? "1 lançamento" : `${n} lançamentos`}`;
  if (cents(falta) === 0) return { texto: `${quantos} · fecha com o banco`, fecha: true };
  return { texto: `${quantos} · ${Math.abs(r.mov.valor) > Math.abs(soma) ? "falta" : "sobra"} ${moeda(Math.abs(falta))}`, fecha: false };
}

function MoverDeLinha({ item, origem, destino, trocarDe, onFechar, onConfirmar }: { item: Candidato; origem: Comp; destino: Comp; trocarDe: string | null; onFechar: () => void; onConfirmar: () => void }) {
  const depoisNaOrigem = origem.itens.filter((i) => i.id !== item.id);
  const depoisNoDestino = trocarDe ? destino.itens.map((i) => (i.id === trocarDe ? item : i)) : [...destino.itens, item];
  const sai = trocarDe ? destino.itens.find((i) => i.id === trocarDe) : null;
  const caixa = (rotulo: string, c: Comp, itens: Candidato[], tom: string) => {
    const f = comoFica(c.r, itens);
    return (
      <div className={cn("rounded-lg border px-3 py-2.5", tom)}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{rotulo}</div>
        <div className="mt-1 grid grid-cols-[48px_1fr_auto] items-baseline gap-3 text-sm">
          <span className="font-mono text-xs font-semibold">{ddmm(c.r.mov.data)}</span>
          <span className="min-w-0 truncate font-mono text-[11px]" title={c.r.mov.historico}>
            {c.r.mov.historico}
          </span>
          <span className={cn("whitespace-nowrap font-mono text-xs font-semibold", c.r.mov.valor < 0 ? "text-california-red" : "text-emerald-700")}>{comSinal(c.r.mov.valor)}</span>
        </div>
        <div className={cn("mt-1 text-xs", f.fecha ? "text-emerald-700" : "text-amber-800")}>{f.texto}</div>
      </div>
    );
  };
  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Tem certeza? O lançamento já está em outra linha</DialogTitle>
          <DialogDescription>Nada é gravado até você conciliar.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-muted/50 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-sm font-semibold">{item.descricao}</span>
            <span className={cn("whitespace-nowrap font-mono text-xs font-semibold", item.valor < 0 ? "text-california-red" : "text-emerald-700")}>{comSinal(item.valor)}</span>
          </div>
          {item.quem && <div className="text-xs text-muted-foreground">{item.quem}</div>}
        </div>
        <div className="space-y-1.5">
          {caixa("Sai de", origem, depoisNaOrigem, "border-border bg-white")}
          <div className="flex justify-center text-muted-foreground">
            <ArrowDown className="h-4 w-4" />
          </div>
          {caixa("Vai para", destino, depoisNoDestino, "border-california-red/40 bg-california-red/5")}
          {sai && (
            <div className="px-1 text-xs text-muted-foreground">
              <strong className="font-semibold text-foreground">{sai.descricao}</strong> volta para “Só no sistema”.
            </div>
          )}
        </div>
        <DialogFooter>
          <button type="button" onClick={onFechar} className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold hover:bg-muted">
            Cancelar
          </button>
          <button type="button" onClick={onConfirmar} className="inline-flex h-9 items-center gap-2 rounded-lg bg-california-red px-3 text-sm font-semibold text-white hover:opacity-90">
            Sim, mover
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Como fechar a diferença (protótipo, 16/11/2026): no lugar dos botões
// amarelos com a frase inteira, três jeitos (seletor "Ajuste da diferença").
// ---------------------------------------------------------------------------

const NOME_DO_AJUSTE: Record<Ajuste, string> = {
  juros: "Juros e multa",
  retencao: "Retenção na fonte",
  parcial: "Baixa parcial",
  correcao: "Corrigir a baixa",
  valor: "Corrigir o valor do título",
};
/** O nome do ajuste (16/11/2026: o do "valor" virou "Corrigir o valor do título", escolha do Tiago). */
const nomeDoAjuste = (a: Ajuste) => NOME_DO_AJUSTE[a];
/** O que o ajuste faz, por extenso (o "i", a dica e a lista), com os valores da linha. */
function textoDoAjuste(a: Ajuste, c: Comp): string {
  const n = c.itens.length;
  const dif = moeda(Math.abs(c.falta));
  const banco = moeda(Math.abs(c.r.mov.valor));
  const titulo = n > 1 ? "do último título" : "do título";
  if (a === "juros")
    return `O banco pagou ${dif} a mais que o título (o atraso do boleto). O título é baixado pelo valor dele e os ${dif} viram um lançamento de juros e multa, junto da baixa.`;
  if (a === "retencao")
    return `O banco pagou ${dif} a menos porque o imposto foi retido na fonte. A baixa abre com a retenção já preenchida, para conferir os impostos antes de gravar.`;
  if (a === "parcial") return `O banco pagou só uma parte. A baixa ${titulo} é de ${moeda(parteDoUltimo(c))}, e o resto continua em aberto, para o próximo pagamento.`;
  if (a === "correcao") return `A baixa já lançada no sistema está com valor diferente do banco. Ela passa a ${banco}, o valor que o banco mostra.`;
  return `O valor do título estava errado (por exemplo, a conta de consumo lançada com o valor estimado). O título passa a ${banco}, o que o banco pagou, e é baixado por esse valor, sem lançamento de juros.`;
}

function EscolhaDoAjuste({
  c,
  possiveis,
  onAjuste,
  modo,
  rotulo,
}: {
  c: Comp;
  possiveis: Ajuste[];
  onAjuste: (a: Ajuste | null) => void;
  modo: "botoes" | "menu" | "status";
  /** Na coluna Status: o detalhe que já aparecia ("sobra R$ 310,00"). */
  rotulo?: React.ReactNode;
}) {
  const [aberto, setAberto] = React.useState(false);
  const diferenca = moeda(Math.abs(c.falta));
  if (modo === "botoes")
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Diferença de {diferenca}:</span>
        {possiveis.map((a) => {
          const sel = c.ajuste === a;
          return (
            // A pílula amarela (alerta: há uma diferença a resolver), sem fundo branco; o "i" ao lado explica o ajuste.
            <span key={a} className={cn("inline-flex h-6 items-center rounded-full pr-1.5 transition-colors", sel ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900 hover:bg-amber-200")}>
              <button type="button" aria-pressed={sel} onClick={() => onAjuste(sel ? null : a)} className="inline-flex h-6 items-center gap-1 rounded-full pl-2.5 pr-1 text-[11px] font-medium">
                {sel && <Check className="h-3 w-3" />}
                {nomeDoAjuste(a)}
              </button>
              <InfoDica texto={textoDoAjuste(a, c)} largura={300} className={sel ? "text-emerald-700/70 hover:text-emerald-900" : "text-amber-700/80 hover:text-amber-950"} />
            </span>
          );
        })}
      </span>
    );
  const lista = (
    <PopoverContent align="start" className="w-[340px] p-1.5" onOpenAutoFocus={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
      <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fechar a diferença de {diferenca}</div>
      {possiveis.map((a) => {
        const sel = c.ajuste === a;
        return (
          <button
            key={a}
            type="button"
            onClick={() => {
              onAjuste(a);
              setAberto(false);
            }}
            className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted", sel && "bg-emerald-50")}
          >
            <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", sel ? "text-emerald-700" : "text-transparent")} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{nomeDoAjuste(a)}</span>
              <span className="block text-[11px] text-muted-foreground">{textoDoAjuste(a, c)}</span>
            </span>
          </button>
        );
      })}
      {c.ajuste && (
        <button
          type="button"
          onClick={() => {
            onAjuste(null);
            setAberto(false);
          }}
          className="mt-1 w-full rounded-md border-t border-border px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted"
        >
          Deixar sem ajuste (a linha volta a “{reduzidos() ? "Pendente" : revisados() ? "Ajustar" : "A definir"}”)
        </button>
      )}
    </PopoverContent>
  );
  if (modo === "menu")
    return (
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
           
            className={cn(
              "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold",
              c.ajuste ? "border-transparent bg-emerald-100 text-emerald-800" : "border-transparent bg-amber-100 text-amber-900 hover:bg-amber-200",
            )}
          >
            {c.ajuste ? <Check className="h-3 w-3" /> : null}
            {c.ajuste ? nomeDoAjuste(c.ajuste) : `Fechar a diferença de ${diferenca}`}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {lista}
      </Popover>
    );
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
         
          title="Escolha como fechar a diferença"
          className="mt-0.5 inline-flex max-w-full items-center gap-0.5 rounded text-left text-[10px] font-normal leading-tight underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          <span className="min-w-0">{rotulo}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </PopoverTrigger>
      {lista}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Os créditos e os débitos no topo da tabela (protótipo, 16/11/2026)
// ---------------------------------------------------------------------------

function LinhaDosTotais({ totais }: { totais: { banco: { creditos: number; debitos: number }; sistema: { creditos: number; debitos: number } } }) {
  const dois = (cred: number, deb: number) => (
    <>
      <span className="block text-emerald-700">{cents(cred) === 0 ? moeda(0) : comSinal(cred)}</span>
      <span className="block text-california-red">{cents(deb) === 0 ? moeda(0) : comSinal(deb)}</span>
    </>
  );
  const dif = (a: number, b: number) => (cents(a - b) === 0 ? <span className="block text-emerald-700">bate ✓</span> : <span className="block text-california-red">{moeda(Math.abs(r2(a - b)))}</span>);
  const rot = (
    <>
      <span className="block">Créditos</span>
      <span className="block">Débitos</span>
    </>
  );
  return (
    <tr className="border-t border-border bg-white text-[11px] normal-case leading-tight">
      <td colSpan={2} className="px-3 py-1.5 text-right font-semibold text-muted-foreground">
        {rot}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold">{dois(totais.banco.creditos, totais.banco.debitos)}</td>
      <td />
      <td className="corte px-3 py-1.5 text-right font-semibold text-muted-foreground">{rot}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold">{dois(totais.sistema.creditos, totais.sistema.debitos)}</td>
      <td colSpan={7} className="px-3 py-1.5 align-middle text-muted-foreground">
        No sistema: o que já foi conciliado e as baixas ainda sem linha no banco. A diferença fica {semStatus() ? "à direita" : "em Status"}.
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono font-semibold">
        {dif(totais.banco.creditos, totais.sistema.creditos)}
        {dif(totais.banco.debitos, totais.sistema.debitos)}
      </td>
      {!semStatus() && <td />}
    </tr>
  );
}

/** Os totais do dia na opção em colunas: cada total no topo da sua coluna; no
 *  sistema, embaixo do total, quanto falta (ou sobra) para bater com o banco. */
function LinhaDosTotaisEmColunas({ totais }: { totais: { banco: { creditos: number; debitos: number }; sistema: { creditos: number; debitos: number } } }) {
  const total = (v: number, cor: string) => <span className={cn("block", cents(v) === 0 ? "text-muted-foreground" : cor)}>{semSinal(v)}</span>;
  const dif = (banco: number, sistema: number) => {
    const d = r2(Math.abs(banco) - Math.abs(sistema));
    return cents(d) === 0 ? (
      <span className="block font-sans text-[10px] font-semibold text-emerald-700">bate ✓</span>
    ) : (
      <span className="block font-sans text-[10px] font-semibold text-california-red">
        {d > 0 ? "falta" : "sobra"} {semSinal(d)}
      </span>
    );
  };
  const CEL_T = "whitespace-nowrap px-2 py-1.5 text-right align-top font-mono font-semibold";
  return (
    <tr className="border-t border-border bg-white text-[11px] normal-case leading-tight">
      <td colSpan={2} className="px-3 py-1.5 text-right align-top font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          Total do dia no banco
          <InfoDica texto="As linhas do banco do dia (a ignorada fica de fora), somadas por coluna." />
        </span>
      </td>
      <td className={CEL_T}>{total(totais.banco.debitos, "text-california-red")}</td>
      <td className={CEL_T}>{total(totais.banco.creditos, "text-emerald-700")}</td>
      <td />
      <td className="corte whitespace-nowrap px-2 py-1.5 text-right align-top font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          No sistema
          <InfoDica texto="O que o sistema tem neste dia: o que já foi conciliado e as baixas ainda sem linha no banco. Embaixo do total, quanto falta (ou sobra) para bater com o banco. A linha acertada entra quando for conciliada." />
        </span>
      </td>
      <td className={CEL_T}>
        {total(totais.sistema.debitos, "text-california-red")}
        {dif(totais.banco.debitos, totais.sistema.debitos)}
      </td>
      <td className={CEL_T}>
        {total(totais.sistema.creditos, "text-emerald-700")}
        {dif(totais.banco.creditos, totais.sistema.creditos)}
      </td>
      <td colSpan={semStatus() ? 8 : 9} />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// O resumo antes de conciliar tudo o que foi acertado
// ---------------------------------------------------------------------------

function ResumoDoAcerto({
  dia,
  linhas,
  ficam,
  andamento,
  onFechar,
  onConfirmar,
}: {
  dia: string | null;
  linhas: Array<{ c: Comp; ch: Chamada | null }>;
  /** As linhas do dia ainda sem acerto. */
  ficam: Comp[];
  andamento: { feitas: number; total: number } | null;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  const vao = linhas.filter((x): x is { c: Comp; ch: Chamada } => !!x.ch);
  const fora = linhas.filter((x) => !x.ch);
  const grupos = (Object.keys(ROTULO_DO_ACERTO) as TipoDoAcerto[]).map((t) => ({ t, ls: vao.filter((x) => x.ch.tipo === t) })).filter((g) => g.ls.length);
  const soma = (ls: Array<{ c: Comp }>) => r2(ls.reduce((s, x) => s + x.c.r.mov.valor, 0));
  const descricao = (c: Comp) => c.especial?.texto ?? c.itens.map((i) => i.descricao).join(" + ");
  const valorCls = (v: number) => (v < 0 ? "text-california-red" : "text-emerald-700");
  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Conciliar o que foi acertado{dia ? ` em ${ddmm(dia)}` : ""}</DialogTitle>
          <DialogDescription>Confira antes de gravar. Cada linha do banco é conciliada com o que foi acertado nela, e as baixas saem com a data, a conta e a forma de pagamento do banco.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col style={{ width: 80 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead className="border-b border-border bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">O que vai ser gravado</th>
                <th className="px-3 py-1.5 text-right">Linhas</th>
                <th className="px-3 py-1.5 text-right">No banco</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.t} className="border-b border-border/50">
                  <td className="px-3 py-1.5">{ROTULO_DO_ACERTO[g.t]}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{g.ls.length}</td>
                  <td className={cn("px-3 py-1.5 text-right font-mono text-xs", valorCls(soma(g.ls)))}>{comSinal(soma(g.ls))}</td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-semibold">
                <td className="px-3 py-1.5">Total</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{vao.length}</td>
                <td className={cn("px-3 py-1.5 text-right font-mono text-xs", valorCls(soma(vao)))}>{comSinal(soma(vao))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Ver as {vao.length === 1 ? "1 linha" : `${vao.length} linhas`}, uma a uma</summary>
          <div className="max-h-[220px] overflow-y-auto border-t border-border">
            {vao.map(({ c, ch }) => (
              <div key={c.r.mov.id} className="grid grid-cols-[46px_minmax(0,1fr)_190px_118px] items-baseline gap-3 border-b border-border/40 px-3 py-1.5 text-xs">
                <span className="font-mono">{ddmm(c.r.mov.data)}</span>
                <span className="truncate" title={descricao(c)}>
                  {descricao(c)}
                </span>
                <span className="truncate text-muted-foreground" title={ROTULO_DO_ACERTO[ch.tipo]}>
                  {ROTULO_DO_ACERTO[ch.tipo]}
                </span>
                <span className={cn("text-right font-mono", valorCls(c.r.mov.valor))}>{comSinal(c.r.mov.valor)}</span>
              </div>
            ))}
          </div>
        </details>
        {fora.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>{fora.length === 1 ? "1 linha acertada fica fora" : `${fora.length} linhas acertadas ficam fora`}</strong>: pedem a baixa completa (centro de custo, retenção na fonte ou mútuo). Conclua cada uma pelo “Completar” da linha.
          </div>
        )}
        {ficam.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Ficam para depois: {ficam.length === 1 ? "1 linha" : `${ficam.length} linhas`} {dia ? "do dia" : ""} ainda sem acerto ({reduzidos() ? "Pendentes" : revisados() ? "Confirmar, Escolher, Ajustar ou Lançar" : "A definir ou Faltando"}). Elas continuam pendentes e não impedem esta gravação.
          </div>
        )}
        {andamento && (
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="h-4 w-4 animate-spin" />
            Conciliando {andamento.feitas} de {andamento.total}…
          </div>
        )}
        <DialogFooter>
          <button type="button" disabled={!!andamento} onClick={onFechar} className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" disabled={!!andamento || !vao.length} onClick={onConfirmar} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <CheckCheck className="h-4 w-4" />
            {vao.length === 1 ? "Conciliar 1 linha" : `Conciliar ${vao.length} linhas`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A coluna Status e a Ação (sempre as mesmas)
// ---------------------------------------------------------------------------

/** Os nomes do Status (protótipo, 16/11/2026), pelo seletor "Status". Revisados: o
 *  que falta fazer diz a ação (Confirmar, Escolher, Ajustar, Lançar); o que está
 *  feito diz o estado (Pronta, Conciliada). "Como estão": Pronto, A definir e Faltando. */
const revisados = () => true;
/** Reduzidos (16/11/2026): a linha do banco é Pendente, Pronta ou Conciliada; o porquê da pendência vai embaixo. */
const reduzidos = () => true;
type StatusDaLinha = "pronta" | "confirmar" | "escolher" | "ajustar" | "lancar";
function statusDaLinha(c: Comp): StatusDaLinha {
  if (c.situacao === "pronto") return "pronta";
  if (c.sug) return "confirmar";
  if (c.estado === "difere") return "ajustar";
  if (c.iguaisNoDia || c.emOutraData) return "escolher";
  return "lancar";
}
const STATUS_DA_LINHA: Record<StatusDaLinha, { nome: string; filtro: string; cor: string; significa: string }> = {
  confirmar: {
    nome: "Confirmar",
    filtro: "Confirmar",
    cor: "text-amber-700",
    significa: "O sistema achou o lançamento desta linha. Ele é a primeira opção do Adicionar lançamento e só entra quando você escolhe.",
  },
  escolher: {
    nome: "Escolher",
    filtro: "Escolher",
    cor: "text-amber-700",
    significa: "O sistema tem lançamento com o mesmo valor, mas não sabe qual é: há mais de um no dia, ou só em outra data (até 7 dias). Escolha no Adicionar lançamento.",
  },
  ajustar: {
    nome: "Ajustar",
    filtro: "Ajustar",
    cor: "text-amber-700",
    significa: "O lançamento escolhido não soma o valor do banco. Escolha um ajuste embaixo da linha (juros e multa, baixa parcial…) ou troque o lançamento.",
  },
  lancar: {
    nome: "Lançar",
    filtro: "Lançar",
    cor: "text-california-red",
    significa: "O sistema não achou nada para esta linha: nenhum lançamento com esse valor no dia ou a até 7 dias. Procure no Adicionar lançamento (outro valor, outra data) ou lance um novo.",
  },
  pronta: {
    nome: "Pronta",
    filtro: "Prontas",
    cor: "text-emerald-700",
    significa: "Acertada nesta tela: o lançamento soma o valor do banco, ou a diferença tem ajuste. Entra no “Conciliar tudo o que foi acertado”.",
  },
};
const SO_NO_SISTEMA: Record<Candidato["k"], { nome: string; detalhe: string; cor: string; significa: string }> = {
  baixa: {
    nome: "Baixado",
    detalhe: "sem linha",
    cor: "text-california-red",
    significa: "Pago (ou recebido) no sistema neste dia, e o banco não mostra a linha dele. O mês não fecha até resolver: associe a uma linha do banco ou mude a data da baixa.",
  },
  titulo: {
    nome: "Em aberto",
    detalhe: "previsto",
    cor: "text-muted-foreground",
    significa: "Título ainda não pago, previsto para este dia. Não impede o fechamento: se o banco pagou, associe à linha.",
  },
  planilha: {
    nome: "Previsão",
    detalhe: "da planilha",
    cor: "text-muted-foreground",
    significa: "Linha da planilha para este dia: é previsão, não lançamento. Não impede o fechamento.",
  },
};

/** A legenda do "i" da coluna Status (a dica é escura: as cores são as claras de cada status). */
function LegendaDoStatus() {
  const item = (nome: string, cor: string, significa: string) => (
    <span key={nome} className="grid grid-cols-[74px_1fr] gap-2 py-0.5">
      <strong className={cor}>{nome}</strong>
      <span>{significa}</span>
    </span>
  );
  const CLARO: Record<StatusDaLinha, string> = { confirmar: "text-amber-300", escolher: "text-amber-300", ajustar: "text-amber-300", lancar: "text-red-300", pronta: "text-emerald-300" };
  const CLARO_SO: Record<Candidato["k"], string> = { baixa: "text-red-300", titulo: "text-zinc-300", planilha: "text-zinc-300" };
  if (reduzidos())
    return (
      <span className="block text-left text-xs normal-case">
        <span className="block pb-1 font-semibold">Linhas do banco</span>
        {item("Pendente", "text-amber-300", "Falta acertar. Embaixo, o porquê: sugestão, 3 no dia, falta (ou sobra) R$ X ou nada no sistema. Passe o mouse no status para ver o que fazer em cada caso.")}
        {item("Pronta", CLARO.pronta, STATUS_DA_LINHA.pronta.significa)}
        {item("Conciliada", "text-white", "Gravada: a linha do banco e o lançamento estão conciliados. Desfazer volta a linha para a conferência.")}
        {item("Ignorada", "text-white", "Ficou fora da conciliação pelo “Ignorar esta linha”. Desfazer volta a linha para a conferência.")}
        <span className="block pb-1 pt-2 font-semibold">Só no sistema</span>
        {item("Baixado", "text-red-300", SO_NO_SISTEMA_REDUZIDO.baixa.significa)}
        {item("Previsto", "text-zinc-300", "Título em aberto ou previsão da planilha para este dia (embaixo, qual dos dois). Não trava o fechamento: se o banco pagou, associe à linha.")}
      </span>
    );
  return (
    <span className="block text-left text-xs normal-case">
      <span className="block pb-1 font-semibold">Linhas do banco: a fazer</span>
      {(["confirmar", "escolher", "ajustar", "lancar"] as StatusDaLinha[]).map((k) => item(STATUS_DA_LINHA[k].nome, CLARO[k], STATUS_DA_LINHA[k].significa))}
      <span className="block pb-1 pt-2 font-semibold">Linhas do banco: feitas</span>
      {item("Pronta", CLARO.pronta, STATUS_DA_LINHA.pronta.significa)}
      {item("Conciliada", "text-white", "Gravada: a linha do banco e o lançamento estão conciliados. Desfazer volta a linha para a conferência.")}
      <span className="block pb-1 pt-2 font-semibold">Só no sistema</span>
      {(["baixa", "titulo", "planilha"] as Candidato["k"][]).map((k) => item(SO_NO_SISTEMA[k].nome, CLARO_SO[k], SO_NO_SISTEMA[k].significa))}
    </span>
  );
}

/** O porquê da linha pendente, em poucas palavras (embaixo do "Pendente"). */
function motivoDaPendencia(c: Comp): string {
  const s = statusDaLinha(c);
  if (s === "confirmar") return "sugestão";
  if (s === "ajustar") return `${Math.abs(c.r.mov.valor) > Math.abs(c.soma) ? "falta" : "sobra"} ${moeda(Math.abs(c.falta))}`;
  if (s === "escolher") return c.iguaisNoDia ? `${c.iguaisNoDia} no dia` : `${c.emOutraData} em ${c.emOutraData === 1 ? "outro dia" : "outros dias"}`;
  if (s === "lancar") return "nada no sistema";
  return "";
}

/** Em Só no sistema, com os nomes reduzidos: Baixado (trava o mês) e Previsto (não trava). */
const SO_NO_SISTEMA_REDUZIDO: Record<Candidato["k"], { nome: string; detalhe: string; cor: string; significa: string }> = {
  baixa: {
    nome: "Baixado",
    detalhe: "trava o mês",
    cor: "text-california-red",
    significa: "Pago (ou recebido) no sistema neste dia, e o banco não mostra a linha dele. O mês não fecha até resolver: associe a uma linha do banco ou mude a data da baixa.",
  },
  titulo: {
    nome: "Previsto",
    detalhe: "título em aberto",
    cor: "text-muted-foreground",
    significa: "Título ainda não pago, previsto para este dia. Não trava o fechamento: se o banco pagou, associe à linha.",
  },
  planilha: {
    nome: "Previsto",
    detalhe: "da planilha",
    cor: "text-muted-foreground",
    significa: "Previsão da planilha para este dia, não é lançamento. Não trava o fechamento.",
  },
};
const soNoSistema = () => (reduzidos() ? SO_NO_SISTEMA_REDUZIDO : SO_NO_SISTEMA);

/** O Status com os nomes revisados (ou reduzidos). */
function StatusRevisado({ c, detalhe }: { c: Comp; detalhe: (t: React.ReactNode) => React.ReactNode }) {
  const s = statusDaLinha(c);
  const d0 = STATUS_DA_LINHA[s];
  // Reduzidos: o nome é "Pendente"; a dica continua a do caso (o que fazer).
  const d = reduzidos() && s !== "pronta" ? { ...d0, nome: "Pendente", cor: "text-amber-700" } : d0;
  const bancoMaior = Math.abs(c.r.mov.valor) > Math.abs(c.soma);
  return (
    <span className={cn("block text-xs font-semibold leading-tight", d.cor)} title={d.significa}>
      {s === "pronta" ? (
        <span className="inline-flex items-center gap-1">
          <CheckCheck className="h-3.5 w-3.5" />
          {d.nome}
        </span>
      ) : (
        d.nome
      )}
      {s === "pronta" &&
        c.estado === "ajuste" &&
        detalhe(
          c.ajuste === "parcial"
            ? `baixa parcial: fica ${moeda(Math.abs(c.falta))} em aberto`
            : c.ajuste === "valor"
              ? `o título passa a ${moeda(Math.abs(c.r.mov.valor))}`
              : `${ROTULO_DO_AJUSTE[c.ajuste as Ajuste]}: ${moeda(Math.abs(c.falta))}`,
        )}
      {s === "confirmar" && (
        <span className="flex items-center gap-1 text-[10px] font-normal leading-tight">
          sugestão
          {c.sug?.daPlanilha && (
            <InfoDica
              texto={
                <>
                  A planilha tem este pagamento como <strong>{c.sug.daPlanilha}</strong>, que está em aberto no sistema: no lugar da linha da planilha, a sugestão é o título.
                </>
              }
            />
          )}
        </span>
      )}
      {s === "ajustar" && detalhe(`${bancoMaior ? "falta" : "sobra"} ${moeda(Math.abs(c.falta))}`)}
      {s === "escolher" && detalhe(c.iguaisNoDia ? `${c.iguaisNoDia} no dia` : `${c.emOutraData} em ${c.emOutraData === 1 ? "outro dia" : "outros dias"}`)}
      {s === "lancar" && detalhe("nada no sistema")}
    </span>
  );
}

function Situacao({ c, ajustes = null }: { c: Comp; /** Opção "Na coluna Status": o detalhe da diferença abre a escolha do ajuste. */ ajustes?: { possiveis: Ajuste[]; onAjuste: (a: Ajuste | null) => void } | null }) {
  const detalhe = (t: React.ReactNode) =>
    ajustes ? (
      <EscolhaDoAjuste c={c} possiveis={ajustes.possiveis} onAjuste={ajustes.onAjuste} modo="status" rotulo={t} />
    ) : (
      <span className="block text-[10px] font-normal leading-tight">{t}</span>
    );
  if (revisados()) return <StatusRevisado c={c} detalhe={detalhe} />;
  if (c.situacao === "pronto")
    return (
      <span className="block text-xs font-semibold leading-tight text-emerald-700">
        <span className="inline-flex items-center gap-1">
          <CheckCheck className="h-3.5 w-3.5" />
          Pronto
        </span>
        {c.estado === "ajuste" &&
          detalhe(
            c.ajuste === "parcial"
              ? `baixa parcial: fica ${moeda(Math.abs(c.falta))} em aberto`
              : c.ajuste === "valor"
                ? `o título passa a ${moeda(Math.abs(c.r.mov.valor))}`
                : `${ROTULO_DO_AJUSTE[c.ajuste as Ajuste]}: ${moeda(Math.abs(c.falta))}`,
          )}
      </span>
    );
  // A sugestão do sistema, ainda fora da linha.
  if (c.sug)
    return (
      <span
        className="block text-xs font-semibold leading-tight text-amber-700"
        title={
          opcao() === "b"
            ? "O sistema tem uma sugestão para esta linha: é a primeira da lista do Adicionar lançamento. Nada entra sozinho."
            : "O sistema tem uma sugestão para esta linha, apagada ao lado. Confira e clique em Usar: nada entra sozinho."
        }
      >
        A definir
        <span className="flex items-center gap-1 text-[10px] font-normal leading-tight">
          sugestão
          {c.sug.daPlanilha && (
            <InfoDica
              texto={
                <>
                  A planilha tem este pagamento como <strong>{c.sug.daPlanilha}</strong>, que está em aberto no sistema: no lugar da linha da planilha, a sugestão é o título.
                </>
              }
            />
          )}
        </span>
      </span>
    );
  if (c.situacao === "sem")
    return (
      <span className="text-xs font-semibold text-california-red" title="O sistema não tem nada com esse valor, nem em outras datas.">
        {"Faltando"}
      </span>
    );
  const bancoMaior = Math.abs(c.r.mov.valor) > Math.abs(c.soma);
  return (
    <span
      className="block text-xs font-semibold leading-tight text-amber-700"
      title={
        c.estado === "difere"
          ? bancoMaior
            ? "O banco tem mais do que a soma dos lançamentos do sistema."
            : "A soma dos lançamentos do sistema passa do valor do banco."
          : c.iguaisNoDia
            ? "O sistema tem mais de um lançamento possível para esta linha: escolha."
            : "O sistema tem esse valor em outra data: confira se é este pagamento."
      }
    >
      A definir
      {detalhe(
        c.estado === "difere"
          ? `${bancoMaior ? "falta" : "sobra"} ${moeda(Math.abs(c.falta))}`
          : c.iguaisNoDia
            ? `${c.iguaisNoDia} de ${moeda(Math.abs(c.r.mov.valor))} no dia`
            : `${c.emOutraData} em ${c.emOutraData === 1 ? "outra data" : "outras datas"}`,
      )}
    </span>
  );
}

function BotaoConciliar({ habilitado, motivo, onClick, ocupado }: { habilitado: boolean; motivo: string; onClick: () => void; ocupado: boolean }) {
  return (
    <button type="button" disabled={!habilitado || ocupado} onClick={onClick} title={habilitado ? "Concilia a linha do banco com os lançamentos do sistema ao lado." : motivo} aria-label="Conciliar" className={cn(habilitado ? VERDE : CONTORNO, BOTAO_DA_ACAO, "disabled:cursor-not-allowed disabled:opacity-50")}>
      <CheckCheck className="h-3 w-3" />
      Conciliar
    </button>
  );
}

// ---------------------------------------------------------------------------
// A linha do banco com os lançamentos dela
// ---------------------------------------------------------------------------

function CelulasDoItem({
  c,
  p,
  dataDoBanco,
  onRetirar,
  onAbrir,
  primeira,
  toggle,
  campo,
  centro = null,
  onCentro,
}: {
  c: Candidato;
  p: PropsDaFila;
  dataDoBanco: string;
  onRetirar: () => void;
  /** Clicar em qualquer ponto do lado do sistema abre a troca do lançamento. */
  onAbrir: () => void;
  primeira: boolean;
  toggle: React.ReactNode;
  /** O campo do lançamento: a âncora da lista de troca. */
  campo: React.ReactNode;
  /** O centro de custo escolhido na linha (16/11/2026). */
  centro?: CentroEscolhido | null;
  onCentro?: (centro: CentroEscolhido) => void;
}) {
  const e = extras(c, p);
  const outraData = c.data !== dataDoBanco;
  const SIS = "sis cursor-pointer";
  return (
    <>
      <td onClick={onAbrir} className={cn("corte whitespace-nowrap font-mono text-xs", SIS, CEL)}>
        <span className="flex items-start gap-1">
          {primeira ? <span onClick={(ev) => ev.stopPropagation()}>{toggle}</span> : <span className="inline-block w-5 shrink-0" />}
          <span className="leading-tight">
            {outraData ? (
              <span className="font-semibold text-amber-700" title={`O lançamento é de ${ddmm(c.data)}: ao conciliar, passa a ter a data do banco, ${ddmm(dataDoBanco)}.`}>
                {ddmm(c.data)} → {ddmm(dataDoBanco)}
              </span>
            ) : (
              ddmm(c.data)
            )}
            <span className="block font-sans text-[10px] text-muted-foreground">{ROTULO_DO_TIPO[c.k]}</span>
          </span>
        </span>
      </td>
      <CelulasDeValor v={c.valor} onClick={onAbrir} className={SIS} />
      <td onClick={onAbrir} className={cn("text-xs", SIS, CEL)}>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onRetirar();
            }}
            title="Retirar este lançamento desta linha do banco. Ele volta para Só no sistema."
            aria-label="Retirar este lançamento"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-red-50 hover:text-california-red"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {campo}
        </span>
      </td>
      <td onClick={onAbrir} className={cn("text-xs", SIS, CEL)}>
        <TxtPassivo t={c.quem} />
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SIS, CEL)}>
        <TxtPassivo t={e.job} />
      </td>
      <CelulasDoCentro c={c} p={p} e={e} onAbrir={onAbrir} className={SIS} />
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SIS, CEL)}>
        {e.tri}
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SIS, CEL)}>
        {e.reg ?? <Traco />}
      </td>
    </>
  );
}

/** Dispensar a sugestão: a linha fica vazia, para adicionar outro lançamento. */
function BotaoDispensar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onClick();
      }}
      title="Dispensar a sugestão: a linha fica vazia, para adicionar outro lançamento. O ⋯ traz a sugestão de volta."
      aria-label="Dispensar a sugestão"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-red-50 hover:text-california-red"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

/** O lançamento que o sistema sugere, apagado, fora da linha até o "Usar":
 *  as mesmas células da linha de hoje, e o clique abre a troca. */
function CelulasDaSugestao({ c, p, dataDoBanco, onAbrir, dispensar, campo }: { c: Candidato; p: PropsDaFila; dataDoBanco: string; onAbrir: () => void; dispensar: React.ReactNode; campo: React.ReactNode }) {
  const e = extras(c, p);
  const SUG = "sis cursor-pointer text-muted-foreground/75";
  return (
    <>
      <td onClick={onAbrir} className={cn("corte whitespace-nowrap font-mono text-xs", SUG, CEL)}>
        <span className="flex items-start gap-1">
          <span className="inline-block w-5 shrink-0" />
          <span className="leading-tight">
            {c.data !== dataDoBanco ? `${ddmm(c.data)} → ${ddmm(dataDoBanco)}` : ddmm(c.data)}
            <span className="block font-sans text-[10px]">sugestão · {ROTULO_DO_TIPO[c.k]}</span>
          </span>
        </span>
      </td>
      <td onClick={onAbrir} className={cn("whitespace-nowrap text-right font-mono text-xs", SUG, CEL)}>
        {comSinal(c.valor)}
      </td>
      <td onClick={onAbrir} className={cn("text-xs", SUG, CEL)}>
        <span className="flex items-center gap-1.5">
          {dispensar}
          {campo}
        </span>
      </td>
      <td onClick={onAbrir} className={cn("text-xs", SUG, CEL)}>
        <TxtPassivo t={c.quem} />
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SUG, CEL)}>
        <TxtPassivo t={e.job} />
      </td>
      <CelulasDoCentro c={c} p={p} e={e} onAbrir={onAbrir} className={SUG} />
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SUG, CEL)}>
        {e.tri}
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SUG, CEL)}>
        {e.reg ?? <Traco />}
      </td>
    </>
  );
}

/**
 * O recebimento antes da NF pela linha do banco (decisão 262, D11; pendência
 * D16 da decisão 260). O mesmo registro da decisão 256 (a nota do envio
 * esperando nota, o job sem envio ou o BV), com a data, o valor e a conta da
 * linha; o banco grava e concilia a linha na mesma transação. O internacional
 * fica no Recebimento avulso, que pede a cotação, o IOF e a tarifa.
 */
function RecebidoAntesDaLinha({
  c,
  conta,
  plano,
  onFechar,
  onFeito,
}: {
  c: Comp;
  conta: { nome: string; banco: string };
  /** O plano de contas da tabela (o diálogo fica fora do provedor dela). */
  plano: PlanoDeContas | null;
  onFechar: () => void;
  onFeito: (mensagem: string) => void;
}) {
  const [alvos, setAlvos] = React.useState<AlvoDaConciliacao[] | null>(null);
  const [erroCarga, setErroCarga] = React.useState<string | null>(null);
  const [escolhido, setEscolhido] = React.useState<string | null>(null);
  const [tipoId, setTipoId] = React.useState<string | null>(null);
  const [subtipoId, setSubtipoId] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [gravando, setGravando] = React.useState(false);
  React.useEffect(() => {
    let vivo = true;
    carregarAlvosDoRecebimentoAntesNf()
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setAlvos(r.alvos);
        else setErroCarga(r.message);
      })
      .catch(() => vivo && setErroCarga("Não foi possível abrir os jobs. Tente de novo."));
    return () => {
      vivo = false;
    };
  }, []);

  const mov = c.r.mov;
  const valor = Math.abs(mov.valor);
  const escolha = alvos?.find((a) => a.chave === escolhido) ?? null;
  const limite = escolha ? Math.max(0, r2(escolha.saldo - somaDosRecebidos(escolha.recebidos))) : 0;
  const passa = !!escolha && valor > limite + 0.004;
  const tipos = plano?.tipos ?? [];
  const subtipos = (plano?.subtipos ?? []).filter((s) => s.tipo_id === tipoId);

  const gravar = async () => {
    setErro(null);
    if (!escolha) return setErro("Escolha o job ou o BV.");
    if (escolha.cambio) return setErro("Recebimento internacional: registre pelo Recebimento avulso, que pede a cotação, o IOF e a tarifa do câmbio.");
    if (passa) return setErro(`O valor da linha passa do saldo a faturar ${escolha.ehBv ? "do BV" : escolha.jobId ? "do job" : "da nota"} (${moeda(limite)}).`);
    if (!tipoId || !subtipoId) return setErro("Selecione o centro de custo do recebimento.");
    setGravando(true);
    try {
      const r = await registrarRecebimentoAntesNfPelaLinha({
        linhaId: mov.id as string,
        envioNotaId: escolha.envioNotaId,
        itemBvId: escolha.itemBvId,
        jobId: escolha.jobId,
        tipoId,
        subtipoId,
      });
      if (!r.ok) return setErro(r.message);
      onFeito(r.mensagem ?? "Recebimento antes da NF registrado e conciliado com a linha.");
    } catch (e) {
      setErro(String((e as Error)?.message ?? e));
    } finally {
      setGravando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !gravando && onFechar()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-700" />
            Recebimento antes da NF
          </DialogTitle>
          <DialogDescription>
            O cliente pagou antes de a nota sair. A data, o valor e a conta vêm desta linha do banco: escolha o job (ou o BV) e o centro de custo. A linha
            fica conciliada com o recebimento.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
          <span className="text-muted-foreground">Data</span>
          <span className="font-mono">
            {ddmm(mov.data)}/{mov.data.slice(0, 4)}
          </span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-bold text-emerald-700">{moeda(valor)}</span>
          <span className="text-muted-foreground">Conta</span>
          <span>
            {conta.nome}
            {conta.banco ? ` · ${conta.banco}` : ""}
          </span>
          <span className="text-muted-foreground">No banco</span>
          <span className="truncate font-mono text-[12px]" title={mov.historico}>
            {mov.historico}
          </span>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold">
            Job ou BV <span className="text-california-red">*</span>
          </label>
          {alvos === null && !erroCarga ? (
            <div className="flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lendo os jobs que esperam nota…
            </div>
          ) : (
            <Combobox
              items={(alvos ?? []).map((a) => ({ value: a.chave, label: a.rotulo, descricao: a.descricao, busca: a.busca }))}
              value={escolhido}
              onChange={(v) => {
                setEscolhido(v ?? null);
                setErro(null);
              }}
              placeholder="Selecione o job ou o BV"
              buscaPlaceholder="Escreva o código, o nome ou o cliente"
              className={COMBOBOX_COMO_SELECT}
            />
          )}
          {escolha && (
            <p className={cn("text-[12px]", passa || escolha.cambio ? "font-semibold text-california-red" : "text-muted-foreground")}>
              {escolha.cambio
                ? "Recebimento internacional: o câmbio pede a cotação, o IOF e a tarifa, que esta linha não tem. Registre pelo Recebimento avulso."
                : passa
                  ? `O valor da linha (${moeda(valor)}) passa do saldo a faturar ${escolha.ehBv ? "do BV" : escolha.jobId ? "do job" : "da nota"} (${moeda(limite)}).`
                  : escolha.jobId
                    ? `Sem envio: o recebimento fica preso ao job, e o Novo faturamento associa à nota. Falta faturar ${moeda(limite)}.`
                    : escolha.ehBv
                      ? `BV de ${escolha.contraparte}: ${moeda(limite)} a faturar.`
                      : `Vai para a ${escolha.notaRotulo} do envio do GP, com saldo de ${moeda(limite)}. Na emissão da nota, entra como a parcela 1, já recebida.`}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold">
            Centro de custo do recebimento <span className="text-california-red">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Combobox
              items={tipos.map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nome}` }))}
              value={tipoId}
              onChange={(v) => {
                setTipoId(v ?? null);
                setSubtipoId(null);
                setErro(null);
              }}
              placeholder="Tipo..."
              buscaPlaceholder="Buscar o tipo"
              className={COMBOBOX_COMO_SELECT}
            />
            <Combobox
              items={subtipos.map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nome}` }))}
              value={subtipoId}
              onChange={(v) => {
                setSubtipoId(v ?? null);
                setErro(null);
              }}
              placeholder={tipoId ? "Subtipo..." : "Escolha o tipo primeiro"}
              buscaPlaceholder="Buscar o subtipo"
              disabled={!tipoId}
              className={COMBOBOX_COMO_SELECT}
            />
          </div>
        </div>
        {(erro || erroCarga) && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{erro ?? erroCarga}</span>
          </div>
        )}
        <DialogFooter>
          <button type="button" onClick={onFechar} disabled={gravando} className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={gravar}
            disabled={gravando || !escolha}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-california-red px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {gravando && <Loader2 className="h-4 w-4 animate-spin" />}
            Registrar e conciliar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A Ação da linha: "Usar" a sugestão (opção A); "Completar" a linha que pede a
 *  baixa completa. A acertada não tem botão: vai no "Conciliar tudo". */
function AcaoDaLinha({ c, onUsar, pedeABaixa, motivo, onCompletar, onConciliarUma, ocupado }: { c: Comp; onUsar: () => void; pedeABaixa: boolean; motivo: string | null; onCompletar: () => void; onConciliarUma: () => void; ocupado: boolean }) {
  if (!c.editada && c.sug && opcao() === "a")
    return (
      <button
        type="button"
       
        disabled={ocupado}
        onClick={onUsar}
        title="Põe a sugestão do sistema nesta linha. Nada é gravado até o “Conciliar tudo o que foi acertado”."
        aria-label="Usar a sugestão"
        className={cn(CONTORNO, BOTAO_DA_ACAO, "disabled:opacity-50")}
      >
        <Check className="h-3 w-3" />
        Usar
      </button>
    );
  if (c.editada && (c.estado === "bate" || c.estado === "ajuste")) {
    if (pedeABaixa)
      return (
        <button
          type="button"
         
          disabled={ocupado}
          onClick={onCompletar}
          title={`${motivo ?? "Esta linha pede a baixa completa."} Abre a baixa preenchida e concilia só esta linha.`}
          aria-label="Completar a baixa"
          className={cn(CONTORNO, BOTAO_DA_ACAO, "disabled:opacity-50")}
        >
          <Pencil className="h-3 w-3" />
          Completar
        </button>
      );
  }
  if (semStatus() && c.situacao === "pronto")
    return (
      <button
        type="button"
       
        disabled={ocupado}
        onClick={onConciliarUma}
        title="Acertada: concilia só esta linha, agora. As outras acertadas continuam para o “Conciliar tudo o que foi acertado”."
        aria-label="Conciliar esta linha"
        className={cn(VERDE, BOTAO_DA_ACAO, "disabled:opacity-50")}
      >
        <CheckCheck className="h-3 w-3" />
        Conciliar
      </button>
    );
  return <span className={cn("inline-block", BOTAO_DA_ACAO)} />;
}

function LinhaDoBanco({
  c,
  p,
  aberta,
  alternar,
  candidatos,
  tomados,
  onRetirar,
  onAdicionar,
  onTrocar,
  onAjuste,
  onDesfazerEdicao,
  onConciliar,
  onConciliarUma,
  gravando,
  onUsar,
  onDispensar,
  onRecebidoAntes,
  pedeABaixa,
  motivoDoCompletar,
  onCentro,
}: {
  c: Comp;
  p: PropsDaFila;
  aberta: boolean;
  alternar: () => void;
  candidatos: Candidato[];
  tomados: Map<string, string>;
  onRetirar: (id: string) => void;
  onAdicionar: (id: string) => void;
  onTrocar: (de: string, para: string) => void;
  onAjuste: (a: Ajuste | null) => void;
  onDesfazerEdicao: () => void;
  /** A baixa completa, só desta linha (o "Completar"). */
  onConciliar: () => void;
  /** Sem a coluna Status: concilia só esta linha acertada (o "Conciliar" da Ação). */
  onConciliarUma: () => void;
  /** Uma linha está sendo gravada pelo "Conciliar" da Ação. */
  gravando: boolean;
  onUsar: () => void;
  /** A linha fica vazia, sem a sugestão (o ⋯ a traz de volta). */
  onDispensar: () => void;
  /** O "Recebimento antes da NF" do ⋯ da linha de entrada (decisão 262, D11). */
  onRecebidoAntes: () => void;
  /** Acertada, mas não vai no "Conciliar tudo": pede a baixa completa (centro de custo, retenção, mútuo). */
  pedeABaixa: boolean;
  /** Por que pede (a dica do "Completar"). */
  motivoDoCompletar: string | null;
  /** O centro de custo trocado na linha. */
  onCentro: (itemId: string, centro: CentroEscolhido) => void;
}) {
  const r = c.r;
  const n = c.itens.length;
  // O lançamento com a lista de troca aberta (clicar em qualquer célula dele abre).
  const [trocando, setTrocando] = React.useState<string | null>(null);
  const resumida = !aberta && n > 1;
  const linhasDoSistema = c.especial ? 1 : resumida ? 1 : Math.max(n, aberta ? 0 : 1);
  const comRodape = aberta && !c.especial;
  // A sugestão ainda não usada ocupa uma linha só, como as outras.
  const sug = !c.editada ? c.sug : null;
  const span = sug ? 1 : linhasDoSistema + (comRodape ? 1 : 0) || 1;
  const toggle = (
    <button type="button" onClick={alternar} aria-expanded={aberta} title={aberta ? "Recolher os lançamentos desta linha" : "Abrir os lançamentos desta linha: retirar, adicionar ou trocar"} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
      {aberta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </button>
  );
  const possiveis = ajustesPossiveis(c);
  // Para a linha sem lançamento: o que existe com o mesmo valor a até 7 dias.
  const noDiaIguais = c.iguaisNoDia;
  const emOutraData = c.emOutraData;
  const quem = [...new Set(c.itens.map((i) => i.quem).filter(Boolean))];
  const motivo = c.estado === "vazio" ? "Adicione o lançamento do sistema que esta linha do banco paga, ou lance um novo." : `A soma do sistema é ${moeda(Math.abs(c.soma))} e o banco tem ${moeda(Math.abs(r.mov.valor))}: adicione, retire ou ajuste.`;
  const menu: AcaoDescrita[] = [
    // 16/11/2026 (Tiago): sem o texto embaixo do nome; o nome se explica.
    { rotulo: "Lançar avulso", icone: FilePlus2, onClick: () => p.acoes.lancarAvulso(r) },
    // Decisão 262, D11: o recebimento antes da NF direto da linha de entrada.
    ...(r.mov.valor > 0 ? [{ rotulo: "Recebimento antes da NF", icone: HandCoins, onClick: onRecebidoAntes }] : []),
    { rotulo: "Criar uma regra para este histórico", icone: Wand2, onClick: () => p.acoes.criarRegra(r) },
    ...(c.editada ? [{ rotulo: "Desfazer o acerto desta linha", dica: "A linha volta a ficar sem lançamento, com a sugestão do sistema.", icone: RotateCcw, onClick: onDesfazerEdicao }] : []),
    { rotulo: "Ignorar esta linha", icone: CircleSlash, onClick: () => p.acoes.ignorar(r), perigo: true },
  ];

  const celulasDoBanco = (
    <>
      <td rowSpan={span} className={cn("whitespace-nowrap align-top font-mono text-xs", CEL)}>
        {ddmm(r.mov.data)}
      </td>
      <td rowSpan={span} className={cn("align-top font-mono text-[11px]", CEL)}>
        <Txt t={r.mov.historico} />
      </td>
      <CelulasDeValor v={r.mov.valor} rowSpan={span} />
      <CelulaDoSaldo id={r.mov.id} rowSpan={span} />
    </>
  );
  const celulasDoFim = (
    <>
      {!semStatus() && (
      <td rowSpan={span} className={cn("align-top", CEL)}>
        <Situacao c={c} ajustes={ajusteNoStatus() && (c.estado === "difere" || c.estado === "ajuste") && possiveis.length ? { possiveis, onAjuste } : null} />
      </td>
      )}
      <td rowSpan={span} className={cn("align-top", CEL)}>
        <span className="flex items-center justify-end gap-1">
          <AcaoDaLinha c={c} onUsar={onUsar} pedeABaixa={pedeABaixa} motivo={motivoDoCompletar} onCompletar={onConciliar} onConciliarUma={onConciliarUma} ocupado={p.pending || gravando} />
          <Menu itens={menu} ocupado={p.pending} />
        </span>
      </td>
    </>
  );

  const rodape = comRodape && (
    <tr className="border-b border-border">
      <td colSpan={doSistema()} className="corte px-3 py-2">
        <span className="flex flex-wrap items-center gap-2 pl-6">
          <Adicionar c={c} p={p} candidatos={candidatos} tomados={tomados} onAdicionar={onAdicionar} onLancar={() => p.acoes.lancarAvulso(r)} />
          {(c.estado === "difere" || c.estado === "ajuste") && possiveis.length > 0 && !ajusteNoStatus() && (
            <EscolhaDoAjuste c={c} possiveis={possiveis} onAjuste={onAjuste} modo="botoes" />
          )}
          {n === 1 && c.itens[0].k === "titulo" && c.itens[0].t.origem === "pp" && r.mov.valor < 0 && Math.abs(r.mov.valor) < Math.abs(c.soma) && (
            <span className="text-[11px] text-muted-foreground">
              Se a diferença for retenção na fonte, ela precisa estar na aprovação da PP.
            </span>
          )}
          {c.estado === "difere" && !possiveis.length && n > 0 && <span className="text-[11px] text-amber-800">{Math.abs(r.mov.valor) > Math.abs(c.soma) ? "Falta lançamento: adicione o que completa." : "Sobra lançamento: retire o que não é desta linha."}</span>}
        </span>
      </td>
    </tr>
  );

  // A sugestão do sistema, ainda fora da linha: numa linha só, da altura das outras.
  if (sug) {
    const lancar = () => p.acoes.lancarAvulso(r);
    // Opção B: a linha vem vazia, como a de hoje sem lançamento; a sugestão é a primeira da lista.
    if (opcao() === "b")
      return (
        <tbody data-comp="">
          <tr className="border-b border-border">
            {celulasDoBanco}
            <td colSpan={doSistema()} className="corte px-3 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <Adicionar c={c} p={p} candidatos={candidatos} tomados={tomados} onAdicionar={onAdicionar} onLancar={lancar} sugestao={sug} onUsarSugestao={onUsar} />
                <span className="text-[11px] text-muted-foreground">
                  Sugestão do sistema: a primeira da lista.
                </span>
              </span>
            </td>
            {celulasDoFim}
          </tr>
        </tbody>
      );
    // Opção A: a sugestão na própria linha, apagada, com o "Usar".
    const um = !sug.especial && sug.itens.length === 1 ? sug.itens[0] : null;
    const APAGADA = "text-muted-foreground/75";
    const dispensar = <BotaoDispensar onClick={onDispensar} />;
    return (
      <tbody data-comp="">
        <tr className="border-b border-border hover:bg-muted/30">
          {celulasDoBanco}
          {um ? (
            <CelulasDaSugestao
              c={um}
              p={p}
              dataDoBanco={r.mov.data}
              onAbrir={() => setTrocando(um.id)}
              dispensar={dispensar}
              campo={
                <Adicionar
                  c={c}
                  p={p}
                  candidatos={candidatos}
                  tomados={tomados}
                  trocando={um}
                  daSugestao
                  aberto={trocando === um.id}
                  setAberto={(o) => setTrocando(o ? um.id : null)}
                  onAdicionar={onAdicionar}
                  onRetirar={onDispensar}
                  onLancar={lancar}
                />
              }
            />
          ) : (
            <>
              <td className={cn("corte whitespace-nowrap font-mono text-xs", CEL, APAGADA)}>
                <span className="flex items-start gap-1">
                  <span className="inline-block w-5 shrink-0" />
                  <span className="leading-tight">
                    {sug.especial || new Set(sug.itens.map((i) => i.data)).size === 1 ? ddmm(sug.itens[0]?.data ?? r.mov.data) : "várias"}
                    <span className="block font-sans text-[10px]">
                      sugestão · {sug.especial ? (sug.especial.k === "par" ? "sem baixa" : "a lançar") : [...new Set(sug.itens.map((i) => ROTULO_DO_TIPO[i.k]))].join(" + ")}
                    </span>
                  </span>
                </span>
              </td>
              <td className={cn("whitespace-nowrap text-right font-mono text-xs", CEL, APAGADA)}>
                {comSinal(sug.especial ? r.mov.valor : r2(sug.itens.reduce((t, i) => t + i.valor, 0)))}
              </td>
              <td className={cn("text-xs", CEL, APAGADA)} colSpan={sug.especial ? 7 : 1}>
                <span className="flex items-center gap-1.5">
                  {dispensar}
                  {sug.especial ? (
                    <Txt t={sug.especial.texto} />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block min-w-0 truncate underline decoration-dotted underline-offset-2">{sug.itens.length} lançamentos</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="start" className="max-w-[560px]">
                        {sug.itens.map((i) => (
                          <span key={i.id} className="block">
                            {ddmm(i.data)} · {i.descricao} · <span className="font-mono">{moeda(Math.abs(i.valor))}</span>
                          </span>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </td>
              {!sug.especial && (
                <>
                  <td className={cn("text-xs", CEL, APAGADA)}>
                    <TxtPassivo t={[...new Set(sug.itens.map((i) => i.quem).filter(Boolean))].join(", ") || null} />
                  </td>
                  <td className={cn(CEL, APAGADA)} colSpan={5}>
                    <Traco />
                  </td>
                </>
              )}
            </>
          )}
          {celulasDoFim}
        </tr>
      </tbody>
    );
  }

  // O que o sistema resolve sem lançamento existente (tarifa pela regra, PIX que voltou, mútuo).
  if (c.especial)
    return (
      <tbody data-comp="">
        <tr className="border-b border-border hover:bg-muted/30">
          {celulasDoBanco}
          <td className={cn("corte whitespace-nowrap font-mono text-xs", CEL)}>
            <span className="flex items-start gap-1">
              <span className="inline-block w-5 shrink-0" />
              <span className="leading-tight">
                {ddmm(r.mov.data)}
                <span className="block font-sans text-[10px] text-muted-foreground">{c.especial.k === "regra" ? "a lançar" : c.especial.k === "mutuo" ? "a lançar" : "sem baixa"}</span>
              </span>
            </span>
          </td>
          <CelulasDeValor v={r.mov.valor} />
          <td className={cn("text-xs", CEL)} colSpan={7}>
            <Txt t={c.especial.texto} />
          </td>
          {celulasDoFim}
        </tr>
      </tbody>
    );

  return (
    <tbody data-comp="">
      {resumida ? (
        <tr className="border-b border-border hover:bg-muted/30">
          {celulasDoBanco}
          <td onClick={alternar} className={cn("corte sis cursor-pointer whitespace-nowrap font-mono text-xs", CEL)}>
            <span className="flex items-start gap-1">
              <span onClick={(ev) => ev.stopPropagation()}>{toggle}</span>
              <span className="leading-tight">
                {[...new Set(c.itens.map((i) => i.data))].length === 1 ? ddmm(c.itens[0].data) : "várias"}
                <span className="block font-sans text-[10px] text-muted-foreground">{[...new Set(c.itens.map((i) => ROTULO_DO_TIPO[i.k]))].join(" + ")}</span>
              </span>
            </span>
          </td>
          <CelulasDeValor v={c.soma} onClick={alternar} className="sis cursor-pointer" />
          <td onClick={alternar} className={cn("sis cursor-pointer text-xs", CEL)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="block w-full truncate text-left font-semibold underline decoration-dotted underline-offset-2">
                  {n} lançamentos
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[560px]">
                {c.itens.map((i) => (
                  <span key={i.id} className="block">
                    {ddmm(i.data)} · {i.descricao} · <span className="font-mono">{moeda(Math.abs(i.valor))}</span>
                  </span>
                ))}
                <span className="mt-1 block text-muted-foreground">Clique para abrir e mexer em cada um.</span>
              </TooltipContent>
            </Tooltip>
          </td>
          <td onClick={alternar} className={cn("sis cursor-pointer text-xs", CEL)}>
            <TxtPassivo t={quem.length === 1 ? quem[0] : quem.length ? `${quem.length} fornecedores: ${quem.join(", ")}` : null} />
          </td>
          <td onClick={alternar} className={cn("sis cursor-pointer", CEL)} colSpan={5}>
            <Traco />
          </td>
          {celulasDoFim}
        </tr>
      ) : n === 0 ? (
        // Sem lançamento: só o rodapé, com o adicionar.
        <tr className="border-b border-border">
          {celulasDoBanco}
          <td colSpan={doSistema()} className="corte px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <Adicionar c={c} p={p} candidatos={candidatos} tomados={tomados} onAdicionar={onAdicionar} onLancar={() => p.acoes.lancarAvulso(r)} />
              <span className={cn("text-[11px]", noDiaIguais || emOutraData ? "font-semibold text-amber-800" : "text-muted-foreground")}>
                {noDiaIguais
                  ? noDiaIguais === 1
                    ? `Há 1 lançamento de ${moeda(Math.abs(r.mov.valor))} no dia: confira se é o desta linha.`
                    : `Há ${noDiaIguais} lançamentos de ${moeda(Math.abs(r.mov.valor))} no dia: escolha o desta linha.`
                  : emOutraData
                    ? `Nada no dia. Há ${emOutraData} com esse valor em ${emOutraData === 1 ? "outra data" : "outras datas"}.`
                    : "Nenhum lançamento do sistema neste dia com esse valor."}
              </span>
            </span>
          </td>
          {celulasDoFim}
        </tr>
      ) : (
        c.itens.map((i, k) => (
          <tr key={i.id} className={cn("hover:bg-muted/30", k === n - 1 && !comRodape ? "border-b border-border" : "border-b border-border/40")}>
            {k === 0 && celulasDoBanco}
            <CelulasDoItem
              c={i}
              p={p}
              dataDoBanco={r.mov.data}
              centro={c.centros[i.id] ?? null}
              onCentro={(centro) => onCentro(i.id, centro)}
              onRetirar={() => onRetirar(i.id)}
              onAbrir={() => setTrocando(i.id)}
              primeira={k === 0}
              toggle={toggle}
              campo={
                <Adicionar
                  c={c}
                  p={p}
                  candidatos={candidatos}
                  tomados={tomados}
                  trocando={i}
                  aberto={trocando === i.id}
                  setAberto={(o) => setTrocando(o ? i.id : null)}
                  onAdicionar={(id) => onTrocar(i.id, id)}
                  onRetirar={() => onRetirar(i.id)}
                  onLancar={() => p.acoes.lancarAvulso(r)}
                />
              }
            />
            {k === 0 && celulasDoFim}
          </tr>
        ))
      )}
      {n > 0 && rodape}
    </tbody>
  );
}

// ---------------------------------------------------------------------------
// Adicionar um lançamento à linha (a busca, no próprio lugar)
// ---------------------------------------------------------------------------

function Adicionar({
  c,
  candidatos,
  tomados,
  onAdicionar,
  onLancar,
  trocando,
  onRetirar,
  aberto: abertoDeFora,
  setAberto: setAbertoDeFora,
  p,
  daSugestao,
  sugestao,
  onUsarSugestao,
}: {
  c: Comp;
  candidatos: Candidato[];
  tomados: Map<string, string>;
  onAdicionar: (id: string) => void;
  onLancar: () => void;
  /** O lançamento que está sendo trocado: o gatilho é o próprio campo dele. */
  trocando?: Candidato;
  onRetirar?: () => void;
  /** Aberto por fora: a linha inteira do lançamento abre a lista. */
  aberto?: boolean;
  setAberto?: (o: boolean) => void;
  p: PropsDaFila;
  /** O "trocando" é a sugestão apagada (opção A): ainda não está na linha. */
  daSugestao?: boolean;
  /** Opção B: a sugestão do sistema, a primeira da lista. */
  sugestao?: Sugestao | null;
  onUsarSugestao?: () => void;
}) {
  const [abertoLocal, setAbertoLocal] = React.useState(false);
  const aberto = abertoDeFora ?? abertoLocal;
  const setAberto = setAbertoDeFora ?? setAbertoLocal;
  // Um pop-up por vez: abrir a lista fecha o Tipo e o Subtipo abertos, e vice-versa.
  const meuPopup = React.useId();
  const popupDaVez = usePopupAtivo();
  React.useEffect(() => {
    if (aberto) abrirPopup(meuPopup);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fechada por outro pop-up: o foco não volta para cá (senão o Tipo ou o Subtipo que acabou de abrir fecha).
  const fechadaPorOutro = React.useRef(false);
  React.useEffect(() => {
    if (aberto && popupDaVez && popupDaVez !== meuPopup) {
      fechadaPorOutro.current = true;
      setAberto(false);
    }
  }, [popupDaVez]); // eslint-disable-line react-hooks/exhaustive-deps
  const [texto, setTexto] = React.useState("");
  const [janela, setJanela] = React.useState(7);
  const campo = React.useRef<HTMLInputElement>(null);
  // A lista abre embaixo do lado do sistema inteiro (da coluna Data à Reg) e usa
  // as mesmas larguras das colunas da tabela: cada campo cai embaixo do seu.
  const gatilho = React.useRef<HTMLButtonElement>(null);
  const colunasDoSistema = () => [...(gatilho.current?.closest("table")?.querySelectorAll("thead th") ?? [])].slice(sistemaDe(), sistemaAte()) as HTMLElement[];
  const ancora = React.useRef({
    getBoundingClientRect: () => {
      const ths = colunasDoSistema();
      const tr = gatilho.current?.closest("tr")?.getBoundingClientRect() ?? gatilho.current?.getBoundingClientRect();
      if (!ths.length || !tr) return gatilho.current?.getBoundingClientRect() ?? new DOMRect();
      const a = ths[0].getBoundingClientRect();
      const b = ths[ths.length - 1].getBoundingClientRect();
      return new DOMRect(a.left, tr.top, b.right - a.left, tr.height);
    },
  });
  const [larguras, setLarguras] = React.useState<number[]>(() => (emColunas() ? LARGURAS_DC.slice(5, 15) : [104, 114, 196, 118, 90, 46, 116, 40, 44]));
  React.useLayoutEffect(() => {
    if (!aberto) return;
    const ws = colunasDoSistema().map((th) => th.offsetWidth);
    if (ws.length === doSistema() && ws.every((w) => w > 0)) setLarguras(ws);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  const grade = { gridTemplateColumns: larguras.map((w) => `${w}px`).join(" ") };
  // O valor na lista: uma célula (com sinal) ou as duas da opção em colunas.
  const valorNaGrade = (v: number, cls?: string) =>
    emColunas() ? (
      <>
        <span className={cn("whitespace-nowrap text-right font-mono !px-2", cls)}>{v < 0 ? semSinal(v) : null}</span>
        <span className={cn("whitespace-nowrap text-right font-mono !px-2", cls)}>{v > 0 ? semSinal(v) : null}</span>
      </>
    ) : (
      <span className={cn("whitespace-nowrap text-right font-mono", cls)}>{comSinal(v)}</span>
    );
  const mov = c.r.mov;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const naLinha = new Set(c.itens.map((i) => i.id));
  // Na troca, a conta é a da linha sem o lançamento que sai.
  const outros = trocando ? c.itens.filter((i) => i.id !== trocando.id) : c.itens;
  // A sugestão ainda não está na linha: a conta não muda sem ela.
  const falta = trocando && !daSugestao ? r2(c.falta + trocando.valor) : c.falta;
  const daLista = new Set([...(sugestao?.itens.map((i) => i.id) ?? []), ...(trocando ? [trocando.id] : [])]);
  const temPlanilha = outros.some((i) => i.k === "planilha");
  const temOutros = outros.some((i) => i.k !== "planilha");
  const lista = React.useMemo(() => {
    const q = norm(texto.trim());
    const fornecedores = new Set((trocando ? [trocando, ...outros] : outros).map((i) => i.quem).filter(Boolean));
    return candidatos
      .filter((x) => !naLinha.has(x.id) && !daLista.has(x.id) && Math.sign(x.valor) === Math.sign(mov.valor) && Math.abs(diasEntre(mov.data, x.data)) <= janela)
      .filter((x) => (temPlanilha ? x.k === "planilha" : temOutros ? x.k !== "planilha" : true))
      .filter((x) => !q || norm(`${x.descricao} ${x.quem ?? ""} ${moeda(Math.abs(x.valor))}`).includes(q))
      .map((x) => ({ x, fecha: cents(x.valor) === cents(falta) && Math.sign(x.valor) === Math.sign(falta), mesmo: !!x.quem && fornecedores.has(x.quem), dias: Math.abs(diasEntre(mov.data, x.data)) }))
      .sort((a, b) => Number(b.fecha) - Number(a.fecha) || a.dias - b.dias || Number(b.mesmo) - Number(a.mesmo) || Math.abs(b.x.valor) - Math.abs(a.x.valor))
      .slice(0, 40);
  }, [candidatos, texto, janela, c.itens, falta, mov, trocando?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Primeiro o que fecha a conta, depois o que é do mesmo fornecedor; o resto, pelo dia.
  const queFecha = lista.filter((i) => i.fecha);
  const doMesmo = lista.filter((i) => !i.fecha && i.mesmo);
  const doDia = lista.filter((i) => !i.fecha && !i.mesmo && i.dias === 0);
  const deFora = lista.filter((i) => !i.fecha && !i.mesmo && i.dias !== 0);
  const titulo = (t: string) => <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t}</div>;
  // Cada célula com o mesmo recuo das células da tabela.
  const GRADE = "grid items-center [&>span]:min-w-0 [&>span]:px-3";
  const linha = ({ x, fecha }: (typeof lista)[number], aoEscolher?: () => void, selo?: React.ReactNode) => {
    const e = extras(x, p);
    return (
      <button
        key={x.id}
        type="button"
        onClick={() => {
          if (aoEscolher) aoEscolher();
          else onAdicionar(x.id);
          setAberto(false);
          setTexto("");
        }}
        style={grade}
        className={cn(GRADE, "w-full border-b border-border/40 py-1.5 text-left text-xs hover:bg-muted")}
      >
        <span className="leading-tight">
          <span className="font-mono font-semibold">{ddmm(x.data)}</span>
          <span className="block text-[10px] text-muted-foreground">{ROTULO_DO_TIPO[x.k]}</span>
        </span>
        {valorNaGrade(x.valor, x.valor < 0 ? "text-california-red" : "text-emerald-700")}
        <span>
          <TxtPassivo
            acima
            t={x.descricao}
            dica={[fecha ? "Com este lançamento, a soma fecha com o banco." : null, tomados.has(x.id) ? "Está em outra linha do banco: se usar aqui, sai de lá." : null].filter(Boolean).join(" ") || undefined}
          >
            {fecha && <span className="mr-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-800">fecha a conta</span>}
            {selo}
            {x.descricao}
          </TxtPassivo>
        </span>
        <span>
          <TxtPassivo acima t={x.quem} />
        </span>
        <span className="font-mono text-[11px]">
          <TxtPassivo acima t={e.job} />
        </span>
        <span className="font-mono text-[11px]">{e.tipo ?? "—"}</span>
        <span className="text-[11px]">
          <TxtPassivo acima t={e.sub} />
        </span>
        <span className="font-mono text-[11px]">{e.tri}</span>
        <span className="font-mono text-[11px]">{e.reg ?? "—"}</span>
      </button>
    );
  };
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      {trocando ? (
        <Tooltip open={aberto ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                ref={gatilho}
                aria-label={`Trocar o lançamento: ${trocando.descricao}`}
                onClick={(ev) => ev.stopPropagation()}
                className={cn("flex min-w-0 flex-1 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left hover:border-border hover:bg-white", aberto ? "border-california-red/50 bg-white" : "border-transparent")}
              >
                <span className="min-w-0 flex-1 truncate">{trocando.descricao}</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-[560px]">
            {trocando.descricao}
            <span className="mt-1 block text-muted-foreground">Clique para trocar por outro lançamento.</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>
          <button ref={gatilho} type="button" className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2 text-[11px] font-semibold hover:bg-muted">
            <Plus className="h-3 w-3" />
            Adicionar lançamento
          </button>
        </PopoverTrigger>
      )}
      <PopoverAnchor virtualRef={ancora as never} />
      <PopoverContent
        align="start"
        sideOffset={2}
        style={{ width: larguras.reduce((t, w) => t + w, 0) + 2 }}
        className="overflow-hidden p-0"
        onClick={(ev) => ev.stopPropagation()}
        // O foco vai para a busca sem rolar a página (no visualizador, o foco comum pulava para o topo).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          campo.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(e) => {
          if (fechadaPorOutro.current) e.preventDefault();
          fechadaPorOutro.current = false;
        }}
      >
        {trocando && (
          <div className="flex items-center gap-2 bg-muted/60 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1">
              <TxtPassivo acima t={trocando.descricao}>
                {daSugestao ? "Trocar a sugestão" : "Trocar"} <strong>{trocando.descricao}</strong> por:
              </TxtPassivo>
            </span>
            {onRetirar && (
              <button
                type="button"
                onClick={() => {
                  setAberto(false);
                  onRetirar();
                }}
                className="inline-flex shrink-0 items-center gap-1 font-semibold text-california-red hover:underline"
              >
                <X className="h-3.5 w-3.5" />
                {daSugestao ? "Dispensar a sugestão" : "Só retirar da linha"}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <input ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Fornecedor, descrição ou valor" className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-3 text-xs" />
          </span>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {[7, 30].map((j) => (
              <button key={j} type="button" onClick={() => setJanela(j)} aria-pressed={janela === j} className={cn("h-8 px-2.5 text-[11px] font-semibold", janela === j ? "bg-foreground text-white" : "bg-white hover:bg-muted")}>
                ± {j} dias
              </button>
            ))}
          </div>
        </div>
        <div style={grade} className={cn(GRADE, "border-y border-border bg-muted/40 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground")}>
          <span>Data</span>
          {emColunas() ? (
            <>
              <span className="!px-2 text-right">Débito</span>
              <span className="!px-2 text-right">Crédito</span>
            </>
          ) : (
            <span className="text-right">Valor</span>
          )}
          <span>No sistema · Descrição</span>
          <span>Fornecedor</span>
          <span>Job</span>
          <span>Tipo</span>
          <span>Subtipo</span>
          <span>TRI</span>
          <span>Reg</span>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {sugestao && onUsarSugestao && (
            <div className="bg-emerald-50/40">
              {titulo("Sugestão do sistema")}
              {(() => {
                const usarSug = () => {
                  onUsarSugestao();
                  setAberto(false);
                  setTexto("");
                };
                const selo = sugestao.daPlanilha ? (
                  <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground" title={`A planilha tem este pagamento como ${sugestao.daPlanilha}, que está em aberto no sistema: no lugar da linha da planilha vem o título.`}>
                    no lugar da planilha
                  </span>
                ) : null;
                const soma = r2(sugestao.itens.reduce((t, i) => t + i.valor, 0));
                if (!sugestao.especial && sugestao.itens.length === 1) {
                  const x = sugestao.itens[0];
                  return linha({ x, fecha: cents(x.valor) === cents(falta), mesmo: false, dias: Math.abs(diasEntre(mov.data, x.data)) }, usarSug, selo);
                }
                const datas = new Set(sugestao.itens.map((i) => i.data));
                const quem = [...new Set(sugestao.itens.map((i) => i.quem).filter(Boolean))].join(", ");
                return (
                  <button type="button" onClick={usarSug} style={grade} className={cn(GRADE, "w-full border-b border-border/40 py-1.5 text-left text-xs hover:bg-muted")}>
                    <span className="leading-tight">
                      <span className="font-mono font-semibold">{sugestao.especial || datas.size === 1 ? ddmm(sugestao.itens[0]?.data ?? mov.data) : "várias"}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {sugestao.especial ? (sugestao.especial.k === "par" ? "sem baixa" : "a lançar") : [...new Set(sugestao.itens.map((i) => ROTULO_DO_TIPO[i.k]))].join(" + ")}
                      </span>
                    </span>
                    {valorNaGrade(sugestao.especial ? mov.valor : soma, mov.valor < 0 ? "text-california-red" : "text-emerald-700")}
                    <span style={sugestao.especial ? { gridColumn: emColunas() ? "4 / -1" : "3 / -1" } : undefined}>
                      <TxtPassivo acima t={sugestao.especial ? sugestao.especial.texto : sugestao.itens.map((i) => i.descricao).join(" + ")}>
                        {sugestao.especial ? sugestao.especial.texto : `${sugestao.itens.length} lançamentos: ${sugestao.itens.map((i) => i.descricao).join(" + ")}`}
                      </TxtPassivo>
                    </span>
                    {!sugestao.especial && (
                      <>
                        <span>
                          <TxtPassivo acima t={quem || null} />
                        </span>
                        <span className="font-mono text-[11px]">—</span>
                        <span className="font-mono text-[11px]">—</span>
                        <span className="font-mono text-[11px]">—</span>
                        <span className="font-mono text-[11px]">—</span>
                        <span className="font-mono text-[11px]">—</span>
                      </>
                    )}
                  </button>
                );
              })()}
            </div>
          )}
          {queFecha.length > 0 && titulo(sugestao ? "Outros que fecham a conta" : "Fecha a conta")}
          {queFecha.map((i) => linha(i))}
          {doMesmo.length > 0 && titulo("Do mesmo fornecedor")}
          {doMesmo.map((i) => linha(i))}
          {doDia.length > 0 && titulo(`No dia ${ddmm(mov.data)}`)}
          {doDia.map((i) => linha(i))}
          {deFora.length > 0 && titulo("Em outras datas · passam a ter a data do banco")}
          {deFora.map((i) => linha(i))}
          {!lista.length && !sugestao && <div className="px-3 py-5 text-center text-xs text-muted-foreground">Nada no sistema em ± {janela} dias com esse texto.</div>}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            {trocando ? "Para fechar a conta, o novo lançamento precisa ter" : "Falta fechar"}: <strong className="font-mono text-foreground">{moeda(Math.abs(falta))}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              onLancar();
            }}
            className="inline-flex items-center gap-1.5 font-semibold text-foreground underline underline-offset-2"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Não está no sistema: lançar avulso
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Só no sistema e Conciliados
// ---------------------------------------------------------------------------

function LinhaSoNoSistema({ c, p, linhas, onEditarData, onAssociar }: { c: Candidato; p: PropsDaFila; linhas: Comp[]; /** Nulo: a data deste lançamento não muda por aqui. */ onEditarData: (() => void) | null; onAssociar: (alvo: Comp) => void }) {
  const [aberto, setAberto] = React.useState(false);
  const e = extras(c, p);
  const l = c.k === "titulo" ? p.contexto.linhaPorChave.get(c.t.id) : undefined;
  const venc = l?.vencimento && l.vencimento !== c.data ? l.vencimento : null;
  // A previsão com a data ajustada pela tela mostra a da planilha embaixo.
  const daPlanilha = c.k === "planilha" && c.h.dataDaPlanilha && c.h.dataDaPlanilha !== c.data ? c.h.dataDaPlanilha : null;
  const alvos = linhas.filter((x) => Math.sign(x.r.mov.valor) === Math.sign(c.valor));
  const menu: AcaoDescrita[] =
    c.k === "baixa" && c.l.cancelamento ? [{ rotulo: "Cancelar baixa", dica: "O banco não mostra este pagamento: cancela a baixa e o título volta a ficar em aberto.", icone: Undo2, onClick: () => p.acoes.cancelarBaixa(c.l), perigo: true }] : [];
  return (
    <tbody data-comp="">
      <tr className={cn("border-b border-border hover:bg-muted/30", c.k === "baixa" && "bg-red-50/30")}>
        <td colSpan={sistemaDe()} className={cn("px-3 py-2 text-[11px] italic text-muted-foreground", semStatus() && c.k === "baixa" && "font-semibold not-italic text-california-red")}>
          {/* Sem a coluna Status, o lado do banco (vazio) diz o que o lançamento é. */}
          {semStatus() ? (c.k === "baixa" ? "Baixado, sem linha no banco" : c.k === "titulo" ? "Título em aberto" : "Previsão da planilha") : "sem linha no banco"}
        </td>
        <td className={cn("corte whitespace-nowrap font-mono text-xs", CEL)}>
          <span className="inline-flex items-start gap-1.5">
            <button type="button" onClick={onEditarData ?? undefined} disabled={!onEditarData} title={!onEditarData ? "A data deste lançamento ainda não muda por aqui: mude na tela dele." : c.k === "baixa" ? "Editar a data da baixa" : c.k === "planilha" ? "Editar a data da previsão" : "Editar data prevista de pagamento"} aria-label="Editar a data" className="rounded p-0.5 text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-muted hover:text-california-red">
              <Pencil className="h-3 w-3" />
            </button>
            <span className="leading-tight">
              {ddmm(c.data)}
              {venc && <span className="block font-sans text-[10px] text-amber-700">venc. {ddmm(venc)}</span>}
              {daPlanilha && <span className="block font-sans text-[10px] text-amber-700">planilha {ddmm(daPlanilha)}</span>}
            </span>
          </span>
        </td>
        <CelulasDeValor v={c.valor} />
        <td className={cn("text-xs", CEL)}>
          <Txt t={c.descricao} />
        </td>
        <td className={cn("text-xs", CEL)}>
        <Txt t={c.quem} />
      </td>
        <td className={cn("truncate font-mono text-[11px]", CEL)}>{e.job ?? <Traco />}</td>
        <CelulasDoCentro c={c} p={p} e={e} />
        <td className={cn("font-mono text-[11px]", CEL)}>{e.tri}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{e.reg ?? <Traco />}</td>
        {!semStatus() && (
        <td className={CEL}>
          {revisados() ? (
            <span className={cn("block text-xs font-semibold leading-tight", soNoSistema()[c.k].cor)} title={soNoSistema()[c.k].significa}>
              {soNoSistema()[c.k].nome}
              <span className="block text-[10px] font-normal leading-tight">{soNoSistema()[c.k].detalhe}</span>
            </span>
          ) : (
            <span
              className={cn("text-xs font-semibold", c.k === "baixa" ? "text-california-red" : "text-muted-foreground")}
              title={c.k === "baixa" ? "Baixa já lançada no sistema neste dia, sem linha no banco. Até resolver, o dia não fecha." : c.k === "titulo" ? "Título previsto para este dia, ainda em aberto. Não impede o fechamento." : "Previsão da planilha para este dia. Não impede o fechamento."}
            >
              {c.k === "baixa" ? "Sem linha" : c.k === "titulo" ? "Em aberto" : "Planilha"}
            </span>
          )}
        </td>
        )}
        <td className={CEL}>
          <span className="flex items-center justify-end gap-1">
            <Popover open={aberto} onOpenChange={setAberto}>
              <PopoverTrigger asChild>
                <button type="button" title="Leva este lançamento para uma linha do banco deste dia." aria-label="Associar" className={cn(CONTORNO, BOTAO_DA_ACAO)}>
                  <Link2 className="h-3 w-3" />
                  Associar
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[470px] p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
                <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{revisados() ? "Linhas do banco ainda sem acerto" : "Linhas do banco a definir ou faltando"}</div>
                {alvos.map((x) => (
                  <button
                    key={x.r.mov.id}
                    type="button"
                    onClick={() => {
                      setAberto(false);
                      onAssociar(x);
                    }}
                    className="grid w-full grid-cols-[50px_1fr_112px_132px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span className="font-mono font-semibold">{ddmm(x.r.mov.data)}</span>
                    <span className="truncate font-mono text-[11px]" title={x.r.mov.historico}>
                      {x.r.mov.historico}
                    </span>
                    <span className="text-right font-mono">{comSinal(x.r.mov.valor)}</span>
                    <span className="text-right text-[11px] text-amber-800">
                      {x.estado === "vazio"
                        ? reduzidos()
                          ? motivoDaPendencia(x)
                          : revisados()
                          ? STATUS_DA_LINHA[statusDaLinha(x)].nome.toLowerCase()
                          : x.situacao === "sem"
                            ? "faltando"
                            : "a definir"
                        : `${Math.abs(x.r.mov.valor) > Math.abs(x.soma) ? "falta" : "sobra"} ${moeda(Math.abs(x.falta))}`}
                    </span>
                  </button>
                ))}
                {!alvos.length && <div className="px-2 py-4 text-center text-xs text-muted-foreground">{revisados() ? "Todas as linhas do banco deste dia já estão acertadas." : "Nenhuma linha do banco deste dia está a definir ou faltando."}</div>}
              </PopoverContent>
            </Popover>
            <Menu itens={menu} ocupado={p.pending} />
          </span>
        </td>
      </tr>
    </tbody>
  );
}

function LinhaConciliada({ r, p }: { r: ResultadoDaLinha; p: PropsDaFila }) {
  const item: Item = { k: "linha", id: r.mov.id, data: r.mov.data, tipo: "conciliado", r };
  const t = celulasDoItem(item, { contexto: p.contexto, banco: p.banco });
  const ignorada = r.resolvido?.estado === "ignorado";
  return (
    <tbody data-comp="">
      <tr className="border-b border-border text-muted-foreground hover:bg-muted/30">
        <td className={cn("whitespace-nowrap font-mono text-xs", CEL)}>{ddmm(r.mov.data)}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>
          <Txt t={r.mov.historico} />
        </td>
        <CelulasDeValor v={r.mov.valor} cor={false} />
        <CelulaDoSaldo id={r.mov.id} apagada />
        <td className={cn("corte whitespace-nowrap font-mono text-xs", CEL)}>{ignorada ? <Traco /> : ddmm(r.mov.data)}</td>
        <CelulasDeValor v={r.mov.valor} cor={false} conteudo={ignorada ? <Traco /> : undefined} />
        <td className={cn("text-xs", CEL)}>
          {ignorada && semStatus() ? <span className="italic">Linha ignorada</span> : <Txt t={t.sistema} />}
        </td>
        <td className={cn("text-xs", CEL)}>
          <Txt t={t.quem} />
        </td>
        <td className={cn("truncate font-mono text-[11px]", CEL)}>{t.job ?? <Traco />}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{t.tipo ?? <Traco />}</td>
        <td className={cn("text-[11px]", CEL)}>{ignorada ? <Traco /> : <Txt t={subtipoDaConciliada(r, p)} />}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{t.tri}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{t.reg ?? <Traco />}</td>
        {!semStatus() && (
        <td className={CEL}>
          <span className="inline-flex items-center gap-1 text-xs font-semibold">
            <CheckCheck className="h-3.5 w-3.5" />
            {ignorada ? "Ignorada" : "Conciliada"}
          </span>
        </td>
        )}
        <td className={CEL}>
          <span className="flex items-center justify-end gap-1">
            <button type="button" disabled={p.pending} onClick={() => p.acoes.desfazer(r)} title="Desfaz a conciliação: a linha e os lançamentos voltam para a conferência." aria-label="Desfazer" className={cn(CONTORNO, BOTAO_DA_ACAO)}>
              <Undo2 className="h-3 w-3" />
              Desfazer
            </button>
            <span className="inline-block h-7 w-7 shrink-0" />
          </span>
        </td>
      </tr>
    </tbody>
  );
}

/** O texto cortado com o texto inteiro ao passar o mouse, sem tomar o clique
 *  (a célula inteira é clicável). */
function TxtPassivo({
  t,
  className,
  children,
  dica,
  acima,
}: {
  t: string | null | undefined;
  className?: string;
  /** O que aparece na célula, quando não é só o texto (o texto com selos). */
  children?: React.ReactNode;
  /** O que a dica diz além do texto inteiro. */
  dica?: React.ReactNode;
  /** A dica acima de um pop-up aberto (a lista de escolha). */
  acima?: boolean;
}) {
  if (!t) return <Traco />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("block w-full truncate", className)}>{children ?? t}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className={cn("max-w-[560px]", acima && "z-[80]")}>
        {t}
        {dica && <span className="mt-1 block text-muted-foreground">{dica}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** O ⋯ da linha: sempre os mesmos itens (a vaga fica, mesmo vazia). */
function Menu({ itens, ocupado }: { itens: AcaoDescrita[]; ocupado: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  if (!itens.length) return <span className="inline-block h-7 w-7 shrink-0" />;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Mais ações" title="Mais ações" disabled={ocupado} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
        {itens.map((a) => {
          const Icone = a.icone;
          return (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => {
                setAberto(false);
                a.onClick?.();
              }}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-muted", a.perigo && "text-california-red")}
            >
              <Icone className={cn("h-4 w-4 shrink-0", a.dica && "mt-0.5 self-start", a.perigo ? "text-california-red" : "text-muted-foreground")} />
              {a.dica ? (
                <span className="min-w-0">
                  <span className="block">{a.rotulo}</span>
                  <span className="block text-[11px] font-normal leading-snug text-muted-foreground">{a.dica}</span>
                </span>
              ) : (
                a.rotulo
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
