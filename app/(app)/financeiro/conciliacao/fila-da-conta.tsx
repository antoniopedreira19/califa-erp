"use client";

/**
 * A fila da Conciliação automática (decisão 234): as peças da "fila dividida"
 * — os tipos de linha, as ações descritas de cada uma e o topo (arquivo,
 * avisos, saldos). Nenhuma regra nova: os tipos saem das seções do motor
 * (`secoesDoBanco` + mútuos), e cada botão chama a mesma ação de
 * `AcoesDoBanco`. O texto longo de cada tipo e de cada botão fica na dica.
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCheck,
  CircleSlash,
  FileText,
  Handshake,
  Info,
  Layers,
  Link2,
  MoreHorizontal,
  Search,
  Undo2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { Dica } from "@/components/ui/dica";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dataBR } from "@/components/financeiro/planilha-de-titulos/planilha";
import { rotuloDoBanco } from "@/lib/conciliacao/ofx";
import { pixDeEmpresaDeFora } from "@/lib/financeiro/mutuo";
import type { GrupoDeIguais, TituloDoMotor } from "@/lib/conciliacao/motor";
import { BotaoLancar } from "./mutuo-na-linha";
import type { DadosDaAbaBanco, LancamentoSemLinha } from "./banco-dados";
import {
  textoDosSozinhos,
  type ConciliacaoDaConta,
  type MovimentoDaLinha,
  type ResultadoDaLinha,
  type SecoesDoBanco,
} from "./motor-da-conta";
import type { ResultadoDaImportacao } from "./actions-conciliacao";
import { acharAgrupamentos, type AgrupamentoAchado } from "./agrupar-lancamentos";
import { comCentro, CONTORNO, Pilula, VERDE, type AcoesDoBanco, type ContextoDasCelulas, type Cor } from "./banco-tabela";

export const moeda = formatBRL;
export const r2 = (n: number) => Math.round(n * 100) / 100;
const final4 = (s: string | null | undefined) => (s ? `••••${s.replace(/\D/g, "").slice(-4)}` : "—");

// ---------------------------------------------------------------------------
// O contrato com a aba
// ---------------------------------------------------------------------------

export interface PropsDaFila {
  banco: DadosDaAbaBanco;
  conciliacao: ConciliacaoDaConta;
  secoes: SecoesDoBanco;
  contexto: ContextoDasCelulas;
  acoes: AcoesDoBanco;
  /** "Conciliar as N" / "Baixar e conciliar os N": a mesma série da aba. */
  conciliarVarios: (rs: ResultadoDaLinha[]) => void;
  /** O botão "Importar extrato do banco (OFX)" do topo. */
  importar: React.ReactNode;
  /** Fechar a conciliação / Reabrir o período. */
  fechamento: React.ReactNode;
  /** Até que dia a conciliação está fechada (decisão 205); nulo, aberta. */
  fechadaAte: string | null;
  pending: boolean;
  resolvendoSozinho: boolean;
  avisos: {
    erroImportacao: string | null;
    falhaDoMotor: boolean;
    recusado: { arquivo: string; r: Exclude<ResultadoDaImportacao, { ok: true }> } | null;
    descartarRecusado: () => void;
  };
}

// ---------------------------------------------------------------------------
// Os tipos de linha (das seções do motor)
// ---------------------------------------------------------------------------

export type Tipo =
  | "divergencia"
  | "manual"
  | "pronto"
  | "conferir"
  | "varios"
  | "par"
  | "regra"
  | "historico"
  | "fora"
  | "mutuo"
  | "dividido"
  | "sem"
  | "soSistema"
  | "conciliado";

export const TIPOS: Record<Tipo, { rotulo: string; cor: Cor; texto: string; dica: string }> = {
  divergencia: {
    rotulo: "Divergência",
    cor: "red",
    texto: "text-california-red",
    dica: "O sistema já tem a baixa, com outro valor. Corrija para o valor do banco; se era outro pagamento, procure o título certo.",
  },
  manual: {
    rotulo: "Baixa à mão",
    cor: "sky",
    texto: "text-sky-700",
    dica: "A baixa já estava no sistema e o banco mostra o mesmo valor até 3 dias depois. Conciliar só liga as duas, com a data do banco. Na importação se conciliam sozinhas e ficam à vista.",
  },
  pronto: {
    rotulo: "Pronto",
    cor: "emerald",
    texto: "text-emerald-700",
    dica: "Título sem baixa com valor exato, forma e data batendo, ou a soma única do mesmo fornecedor ou cliente. Um clique dá a baixa com os dados do banco e concilia.",
  },
  conferir: {
    rotulo: "Conferir",
    cor: "amber",
    texto: "text-amber-700",
    dica: "Mais títulos que linhas com o mesmo valor, juros e multa, retenção ou centro de custo a escolher.",
  },
  varios: {
    rotulo: "Vários títulos",
    cor: "emerald",
    texto: "text-emerald-700",
    dica: "Uma linha do banco paga vários títulos: a remessa (um débito só) ou mais de uma soma do mesmo fornecedor ou cliente que bate.",
  },
  par: {
    rotulo: "Saiu e voltou",
    cor: "violet",
    texto: "text-violet-700",
    dica: "O banco devolveu o pagamento no mesmo dia. As duas linhas entram no extrato e o título continua a pagar.",
  },
  regra: {
    rotulo: "Regra",
    cor: "violet",
    texto: "text-violet-700",
    dica: "Tarifas e outros débitos do próprio banco, que nunca têm título. A regra do histórico diz o centro de custo.",
  },
  historico: {
    rotulo: "Histórico",
    cor: "violet",
    texto: "text-violet-700",
    dica: "Competência até o 3T que fica fora do sistema (decisão 211) ou previsão da planilha. Conciliar liga a linha do banco à da planilha, sem lançamento no sistema.",
  },
  fora: {
    rotulo: "Empresa de fora",
    cor: "sky",
    texto: "text-sky-700",
    dica: "PIX de quem tem cadastro de empresa de fora: nota de sócio ou devolução de mútuo. Escolha em Lançar.",
  },
  mutuo: {
    rotulo: "Mútuo",
    cor: "sky",
    texto: "text-sky-700",
    dica: "Dinheiro entre CNPJs do grupo. Lançar cria o mútuo e concilia.",
  },
  dividido: {
    rotulo: "Agrupar",
    cor: "emerald",
    texto: "text-emerald-700",
    dica: "Nenhum valor bate sozinho, mas a soma das baixas é igual à das linhas do banco: o mesmo pagamento, dividido de outro jeito.",
  },
  sem: {
    rotulo: "Sem correspondência",
    cor: "red",
    texto: "text-california-red",
    dica: "Nada no sistema tem esse valor. Lance como avulso (a linha já vem preenchida) ou procure um título.",
  },
  soSistema: {
    rotulo: "Só no sistema",
    cor: "red",
    texto: "text-california-red",
    dica: "Baixa feita à mão num dia que o extrato cobre por inteiro, sem linha no banco: paga em outra conta, com a data errada ou não paga. Corrija ou cancele; até lá, a conciliação não fecha.",
  },
  conciliado: {
    rotulo: "Conciliado",
    cor: "neutral",
    texto: "text-muted-foreground",
    dica: "Ligado a um lançamento do Extrato. Dá para desfazer até fechar a conciliação.",
  },
};

/** A ordem dos chips e das seções (a mesma da aba de hoje). */
export const ORDEM: Tipo[] = [
  "divergencia",
  "manual",
  "pronto",
  "conferir",
  "varios",
  "par",
  "regra",
  "historico",
  "fora",
  "mutuo",
  "dividido",
  "sem",
  "soSistema",
  "conciliado",
];

/** O tipo de cada linha do banco, lido das seções do motor. */
export function tiposDasLinhas(secoes: SecoesDoBanco): Map<string, Tipo> {
  const m = new Map<string, Tipo>();
  const por = (rs: ResultadoDaLinha[], t: Tipo) => rs.forEach((r) => m.set(r.mov.id, t));
  por(secoes.conciliados, "conciliado");
  por(secoes.divergencia, "divergencia");
  por(secoes.manual, "manual");
  por(secoes.alta, "pronto");
  por(secoes.conferir, "conferir");
  secoes.grupos.forEach((g) => (g.linhas as ResultadoDaLinha[]).forEach((r) => m.set(r.mov.id, "conferir")));
  por(secoes.soma, "varios");
  por(secoes.par, "par");
  por(secoes.regra, "regra");
  por(secoes.historico, "historico");
  por(secoes.empresaDeFora, "fora");
  por(secoes.mutuo, "mutuo");
  por(secoes.sem, "sem");
  return m;
}

/** Os itens de uma lista única: a linha do banco, o grupo de iguais e a
 *  baixa sem linha no banco. */
export type Item =
  | { k: "linha"; id: string; data: string; tipo: Tipo; r: ResultadoDaLinha }
  | { k: "grupo"; id: string; data: string; tipo: "conferir"; g: GrupoDeIguais<MovimentoDaLinha> }
  | { k: "semLinha"; id: string; data: string; tipo: "soSistema"; l: LancamentoSemLinha }
  | { k: "conjunto"; id: string; data: string; tipo: "dividido"; c: AgrupamentoAchado; rs: ResultadoDaLinha[]; ls: LancamentoSemLinha[] };

/** Os pagamentos que o banco fez em partes diferentes das baixas, achados
 *  sozinhos entre "Sem correspondência" e "Só no sistema"
 *  (agrupar-lancamentos.tsx). */
function agrupamentosDaConta(p: Pick<PropsDaFila, "secoes" | "conciliacao">): Array<Extract<Item, { k: "conjunto" }>> {
  const rPor = new Map(p.secoes.sem.map((r) => [r.mov.id, r]));
  const lPor = new Map(p.conciliacao.naoApareceu.map((l) => [l.id, l]));
  const cs = acharAgrupamentos(
    p.conciliacao.naoApareceu,
    p.secoes.sem.map((r) => ({ id: r.mov.id, data: r.mov.data, valor: r.mov.valor, historico: r.mov.historico })),
  );
  return cs.map((c) => ({
    k: "conjunto" as const,
    id: "c:" + c.id,
    data: [...c.linhas, ...c.baixas].map((x) => x.data).sort()[0],
    tipo: "dividido" as const,
    c,
    rs: c.linhas.map((l) => rPor.get(l.id) as ResultadoDaLinha),
    ls: c.baixas.map((b) => lPor.get(b.id) as LancamentoSemLinha),
  }));
}

/** O "Conciliar" do agrupamento (a ação do pop-up, direto) e o "Ajustar". */
export function acoesDoAgrupamento(c: AgrupamentoAchado, acoes: AcoesDoBanco): AcoesDescritas {
  return {
    principal: {
      rotulo: "Conciliar",
      dica: "Concilia as baixas com as linhas do banco deste pagamento, de uma vez.",
      icone: CheckCheck,
      verde: true,
      onClick: () =>
        acoes.conciliarAgrupamento(
          c.linhas.map((l) => l.id),
          c.baixas.flatMap((b) => b.ids),
          [...c.linhas, ...c.baixas].map((i) => i.data),
        ),
    },
    lancar: null,
    nota: null,
    secundarias: [
      {
        rotulo: "Ajustar o agrupamento",
        dica: "Abre o conjunto para marcar ou desmarcar baixas e linhas.",
        icone: Layers,
        onClick: () =>
          acoes.agrupar({
            baixas: c.baixas.map((b) => b.id),
            linhas: c.linhas.map((l) => l.id),
            ref: { data: c.baixas[0].data, valor: c.baixas[0].valor, nome: c.baixas[0].fornecedor },
          }),
      },
    ],
  };
}

/** A linha do banco que veio de cada seção, de mútuo devolvida com o mútuo. */
export function linhasComMutuo(secoes: SecoesDoBanco, resultados: ResultadoDaLinha[]): ResultadoDaLinha[] {
  const mutuos = new Map([...secoes.mutuo, ...secoes.empresaDeFora].map((r) => [r.mov.id, r]));
  return resultados.map((r) => mutuos.get(r.mov.id) ?? r);
}

export function itensDaConta(p: Pick<PropsDaFila, "secoes" | "conciliacao">): Item[] {
  const tipos = tiposDasLinhas(p.secoes);
  const nosGrupos = new Set(p.secoes.grupos.flatMap((g) => g.linhas.map((r) => r.mov.id as string)));
  const itens: Item[] = [];
  const conjuntos = agrupamentosDaConta(p);
  const noConjunto = new Set(conjuntos.flatMap((c) => [...c.c.linhas.map((l) => l.id), ...c.c.baixas.map((b) => "s:" + b.id)]));
  itens.push(...conjuntos);
  for (const r of linhasComMutuo(p.secoes, p.conciliacao.resultados)) {
    if (nosGrupos.has(r.mov.id) || noConjunto.has(r.mov.id)) continue;
    itens.push({ k: "linha", id: r.mov.id, data: r.mov.data, tipo: tipos.get(r.mov.id) ?? "sem", r });
  }
  for (const g of p.secoes.grupos) {
    const primeira = [...g.linhas].sort((a, b) => a.mov.ordem - b.mov.ordem)[0];
    itens.push({ k: "grupo", id: "g:" + g.chave, data: primeira.mov.data, tipo: "conferir", g });
  }
  for (const l of p.conciliacao.naoApareceu) if (!noConjunto.has("s:" + l.id)) itens.push({ k: "semLinha", id: "s:" + l.id, data: l.data, tipo: "soSistema", l });
  return itens.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------

/** O ⓘ com a explicação (a `Dica` das planilhas). */
export function InfoDica({ texto, className, largura = 320 }: { texto: React.ReactNode; className?: string; largura?: number }) {
  return (
    <Dica conteudo={texto} rotulo="Explicação" largura={largura} className={cn("inline-flex shrink-0 items-center text-muted-foreground/70 hover:text-foreground", className)}>
      <Info className="h-3.5 w-3.5" />
    </Dica>
  );
}

const COR_PARA_TEXTO: Record<Cor, string> = {
  emerald: "text-emerald-700",
  amber: "text-amber-700",
  violet: "text-violet-700",
  red: "text-california-red",
  sky: "text-sky-700",
  neutral: "text-muted-foreground",
};

export function PilulaDoTipo({ tipo, rotulo }: { tipo: Tipo; rotulo?: string }) {
  return <Pilula cor={COR_PARA_TEXTO[TIPOS[tipo].cor]}>{rotulo ?? TIPOS[tipo].rotulo}</Pilula>;
}

// ---------------------------------------------------------------------------
// O que o sistema achou, numa linha
// ---------------------------------------------------------------------------

export function resumoDoSistema(r: ResultadoDaLinha, contexto: ContextoDasCelulas): string {
  if (r.resolvido) return r.resolvido.texto;
  if (r.mutuo) {
    const m = r.mutuo;
    if (pixDeEmpresaDeFora(m)) return `PIX da ${m.parte.nome}`;
    return m.devolucao ? `Devolução de mútuo · ${m.parte.nome}` : `Mútuo com a ${m.parte.nome}`;
  }
  switch (r.estado) {
    case "historico": {
      const hs = r.historicos ?? [];
      const jobs = [...new Set(hs.map((h) => h.job ?? h.descricao ?? "sem job"))];
      return `${jobs[0] ?? "Planilha"}${jobs.length > 1 ? ` e mais ${jobs.length - 1}` : ""} · planilha`;
    }
    case "ja_lancado":
      return r.lancamento?.descricao ?? "Baixa feita à mão";
    case "divergencia": {
      const d = r.diferencaBaixa ?? 0;
      return `${r.lancamento?.descricao ?? "Baixa"} · ${moeda(Math.abs(d))} ${d > 0 ? "a mais" : "a menos"}`;
    }
    case "soma":
      return r.lote ? `${r.lote.descricao ?? r.lote.nome} · ${r.lote.titulos.length} títulos` : "Remessa";
    case "combinacao": {
      const ts = r.titulos ?? [];
      return `${ts.length} títulos · ${ts[0]?.contraparte ?? ""}`;
    }
    case "regra":
      return r.regra ? `${r.regra.centro.split(" · ").pop()} · regra` : "Regra";
    case "par":
      return `${r.mov.valor > 0 ? "Devolução do PIX" : "PIX que voltou"}${r.titulo ? ` · ${r.titulo.contraparte}` : ""}`;
    case "sem_par":
      return "Nada no sistema com esse valor";
  }
  if (r.titulo) {
    const l = contexto.linhaPorChave.get(r.titulo.id);
    return `${l?.descricao ?? r.titulo.ref} · ${r.titulo.contraparte}`;
  }
  return r.motivo ?? "—";
}

// ---------------------------------------------------------------------------
// As ações de uma linha: a principal e as do menu ⋯
// ---------------------------------------------------------------------------

export interface AcaoDescrita {
  rotulo: string;
  icone: LucideIcon;
  onClick?: () => void;
  href?: string;
  perigo?: boolean;
  /** O que o clique faz, na dica do botão (o rótulo é só o verbo). */
  dica?: string;
  /** Procurar/escolher outro título: vira a lupa visível, fora do ⋯. */
  lupa?: boolean;
}

export interface AcoesDescritas {
  /** O botão principal: verde (a ação certa) ou de contorno (conferir). */
  principal: (AcaoDescrita & { verde: boolean }) | null;
  /** O "Lançar" com a escolha (avulso, notas de sócio, mútuo, IOF). */
  lancar: { rotulo: string; verde: boolean } | null;
  /** Sem ação principal: o que a célula diz. */
  nota: string | null;
  secundarias: AcaoDescrita[];
}

/** As ações de uma linha do banco: a principal, o "Lançar" e as do ⋯. */
export function acoesDaLinha(r: ResultadoDaLinha, acoes: AcoesDoBanco, contexto: ContextoDasCelulas): AcoesDescritas {
  const procurar = (rotulo = "Procurar um título"): AcaoDescrita => ({ rotulo, icone: Search, onClick: () => acoes.procurar(r), lupa: true });
  const ignorar: AcaoDescrita = { rotulo: "Ignorar esta linha", icone: CircleSlash, onClick: () => acoes.ignorar(r), perigo: true };
  const vazio = { principal: null, lancar: null, nota: null, secundarias: [] };
  if (r.resolvido)
    return {
      ...vazio,
      nota: r.resolvido.estado === "ignorado" ? "Ignorado" : "Conciliado",
      secundarias: [{ rotulo: "Desfazer", icone: Undo2, onClick: () => acoes.desfazer(r) }],
    };
  if (r.mutuo && pixDeEmpresaDeFora(r.mutuo)) return { ...vazio, lancar: { rotulo: "Lançar", verde: true }, secundarias: [procurar(), ignorar] };
  if (r.mutuo)
    return {
      ...vazio,
      principal: { rotulo: "Conciliar", dica: "Lança o mútuo entre as duas empresas e concilia esta linha.", icone: Handshake, onClick: () => acoes.lancarMutuo(r), verde: true },
      secundarias: [procurar(), ignorar],
    };
  switch (r.estado) {
    case "ja_lancado":
      // A lupa também aqui: corrige quando a baixa à mão era de outro pagamento.
      return {
        ...vazio,
        principal: { rotulo: "Conciliar", dica: "Liga esta linha à baixa que já está no sistema, com a data do banco.", icone: Link2, onClick: () => acoes.ligar(r), verde: true },
        secundarias: [procurar("Era outro pagamento: procurar o título")],
      };
    case "divergencia": {
      const corrigivel = r.lancamento ? contexto.lancamentos.get(r.lancamento.id)?.corrigivel : false;
      return {
        ...vazio,
        principal: corrigivel ? { rotulo: "Revisar", dica: "Abre a correção da baixa para o valor do banco; ao confirmar, concilia.", icone: CheckCheck, onClick: () => acoes.corrigirBaixa(r), verde: false } : null,
        nota: corrigivel ? null : "corrija pela baixa",
        secundarias: [procurar("Era outro pagamento: procurar o título")],
      };
    }
    case "sugestao":
    case "diferenca":
      return {
        ...vazio,
        principal:
          r.confianca === "alta" && comCentro(r.titulo) && r.estado === "sugestao"
            ? { rotulo: "Conciliar", dica: "Dá a baixa no título com a data e o valor do banco e concilia.", icone: CheckCheck, onClick: () => acoes.baixarEConciliar(r), verde: true }
            : { rotulo: "Revisar", dica: "Abre a baixa já preenchida com os dados do banco para você conferir e confirmar.", icone: CheckCheck, onClick: () => acoes.conferir(r), verde: false },
        secundarias: [procurar("Escolher outro título")],
      };
    case "combinacao": {
      const n = r.titulos?.length ?? 0;
      const pronta = r.confianca === "alta" && (r.titulos ?? []).every((t) => comCentro(t));
      return {
        ...vazio,
        principal: pronta
          ? { rotulo: "Conciliar", dica: `Dá a baixa nos ${n} títulos que somam esta linha e concilia.`, icone: CheckCheck, onClick: () => acoes.conciliarCombinacao(r), verde: true }
          : { rotulo: "Revisar", dica: `Mostra as ${n} combinações de títulos que somam esta linha para você escolher.`, icone: CheckCheck, onClick: () => acoes.conferirCombinacao(r), verde: false },
        secundarias: [procurar("Escolher outros títulos")],
      };
    }
    case "soma":
      return { ...vazio, principal: { rotulo: "Conciliar", dica: `Dá a baixa nos ${r.lote?.titulos.length ?? 0} títulos da remessa e concilia.`, icone: CheckCheck, onClick: () => acoes.conciliarLote(r), verde: true } };
    case "par":
      return r.mov.valor > 0
        ? { ...vazio, principal: { rotulo: "Conciliar", dica: "Registra a saída e a devolução no extrato; o título continua a pagar.", icone: ArrowLeftRight, onClick: () => acoes.conciliarPar(r), verde: true } }
        : { ...vazio, nota: "junto com a devolução" };
    case "historico":
      return { ...vazio, principal: { rotulo: "Conciliar", dica: "Liga esta linha à linha do histórico da planilha, sem lançamento novo.", icone: Link2, onClick: () => acoes.conciliarHistorico([r]), verde: true }, secundarias: [procurar("Não é do histórico: procurar um título"), ignorar] };
    case "regra":
      return { ...vazio, principal: { rotulo: "Conciliar", dica: "Lança pela regra do histórico (centro de custo da regra) e concilia.", icone: Wand2, onClick: () => acoes.lancarRegra([r]), verde: true }, secundarias: [procurar("Não é tarifa: procurar um título"), ignorar] };
    default:
      return {
        ...vazio,
        lancar: { rotulo: "Lançar", verde: false },
        secundarias: [
          procurar(),
          {
            rotulo: "Agrupar lançamentos",
            dica: "Junta esta linha com as baixas do sistema que somam o mesmo valor.",
            icone: Layers,
            onClick: () =>
              acoes.agrupar({ baixas: [], linhas: [r.mov.id], ref: { data: r.mov.data, valor: r.mov.valor, nome: r.mov.historico } }),
          },
          { rotulo: "Criar uma regra para este histórico", icone: Wand2, onClick: () => acoes.criarRegra(r) },
          ignorar,
        ],
      };
  }
}

/** A baixa sem linha no banco. */
export function acoesDaBaixaSemLinha(l: LancamentoSemLinha, acoes: AcoesDoBanco): AcoesDescritas {
  return {
    principal: l.cancelamento ? { rotulo: "Cancelar baixa", dica: "O banco não mostra este pagamento: cancela a baixa e o título volta a ficar em aberto.", icone: Undo2, onClick: () => acoes.cancelarBaixa(l), verde: false, perigo: true } : null,
    lancar: null,
    nota: l.cancelamento ? null : "corrija no Extrato",
    secundarias: [
      // Sem "corrigir a conta ou a data": o sistema não edita a baixa, só a
      // cancela — e o "Cancelar baixa" já está na linha.
      {
        rotulo: "Agrupar lançamentos",
        dica: "Junta esta baixa com as linhas do banco que somam o mesmo valor.",
        icone: Layers,
        onClick: () => acoes.agrupar({ baixas: [l.id], linhas: [], ref: { data: l.data, valor: l.valor, nome: l.fornecedor ?? l.descricao } }),
      },
    ],
  };
}

const PERIGO = "inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-california-red/40 bg-white px-2 text-[11px] font-semibold text-california-red hover:bg-california-red/5 disabled:cursor-wait disabled:opacity-60";

/** O botão principal descrito (ou a nota, quando não há). */
export function BotaoPrincipal({ d, r, acoes, className }: { d: AcoesDescritas; r?: ResultadoDaLinha; acoes: AcoesDoBanco; className?: string }) {
  const off = acoes.ocupado;
  if (d.lancar && r)
    return (
      <span className={className}>
        <BotaoLancar
          r={r}
          classe={d.lancar.verde ? VERDE : CONTORNO}
          off={off}
          rotulo={d.lancar.rotulo}
          onAvulso={() => acoes.lancarAvulso(r)}
          onMutuo={() => acoes.lancarMutuo(r)}
          onIof={() => acoes.lancarIof(r)}
          onNotas={() => acoes.lancarNotas(r)}
        />
      </span>
    );
  if (d.principal) {
    const P = d.principal;
    const Icone = P.icone;
    return (
      <button type="button" disabled={off} onClick={P.onClick} title={P.dica} className={cn(P.perigo ? PERIGO : P.verde ? VERDE : CONTORNO, className)}>
        <Icone className="h-3 w-3" />
        {P.rotulo}
      </button>
    );
  }
  if (d.nota)
    return (
      <span className={cn("inline-flex h-7 w-full items-center justify-center gap-1 text-[11px] font-semibold", d.nota === "Conciliado" ? "text-emerald-700" : "text-muted-foreground", className)}>
        {d.nota === "Conciliado" && <CheckCheck className="h-3 w-3" />}
        {d.nota}
      </span>
    );
  return <span className={className} />;
}

/** O menu ⋯ com as ações secundárias (vazio: a vaga fica, sem botão). */
export function MenuMais({ itens: todos, acoes, extra }: { itens: AcaoDescrita[]; acoes: AcoesDoBanco; extra?: React.ReactNode }) {
  const [aberto, setAberto] = React.useState(false);
  // A lupa (escolher/procurar outro título) fica à vista, fora do ⋯. A vaga
  // existe sempre, para os botões alinharem.
  const lupa = todos.find((a) => a.lupa);
  const itens = todos.filter((a) => !a.lupa);
  const botaoLupa = lupa ? (
    <button
      type="button"
      title={lupa.rotulo}
      aria-label={lupa.rotulo}
      disabled={acoes.ocupado}
      onClick={(e) => {
        e.stopPropagation();
        lupa.onClick?.();
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
    >
      <Search className="h-3.5 w-3.5" />
    </button>
  ) : (
    <span className="inline-block h-7 w-7 shrink-0" />
  );
  if (!itens.length && !extra)
    return (
      <>
        {botaoLupa}
        <span className="inline-block h-7 w-7 shrink-0" />
      </>
    );
  return (
    <>
    {botaoLupa}
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Mais ações"
          title="Mais ações"
          disabled={acoes.ocupado}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[290px] p-1.5" onClick={(e) => e.stopPropagation()}>
        {extra}
        {itens.map((a) => {
          const Icone = a.icone;
          const classe = cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-muted",
            a.perigo && "text-california-red",
          );
          const corpo = (
            <>
              <Icone className={cn("h-4 w-4 shrink-0", a.dica && "mt-0.5 self-start", a.perigo ? "text-california-red" : "text-muted-foreground")} />
              {a.dica ? (
                <span className="min-w-0">
                  <span className="block">{a.rotulo}</span>
                  <span className="block text-[11px] font-normal leading-snug text-muted-foreground">{a.dica}</span>
                </span>
              ) : (
                a.rotulo
              )}
            </>
          );
          return a.href ? (
            <Link key={a.rotulo} href={a.href} prefetch={false} className={classe} onClick={() => setAberto(false)}>
              {corpo}
            </Link>
          ) : (
            <button
              key={a.rotulo}
              type="button"
              className={classe}
              onClick={() => {
                setAberto(false);
                a.onClick?.();
              }}
            >
              {corpo}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// O grupo de linhas iguais: a escolha de cada linha
// ---------------------------------------------------------------------------

export function useEscolhaDoGrupo(g: GrupoDeIguais<MovimentoDaLinha>) {
  const linhas = React.useMemo(() => [...g.linhas].sort((a, b) => a.mov.ordem - b.mov.ordem), [g.linhas]) as ResultadoDaLinha[];
  const [escolha, setEscolha] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(linhas.map((r) => [r.mov.id, (r.titulo as TituloDoMotor).id])),
  );
  const porId = new Map(g.titulos.map((t) => [t.id, t]));
  const escolhidos = linhas.map((r) => porId.get(escolha[r.mov.id]) as TituloDoMotor);
  const sobram = g.titulos.filter((t) => !Object.values(escolha).includes(t.id));
  const semCentro = escolhidos.filter((t) => !comCentro(t));
  const trocar = (linhaId: string, id: string) =>
    setEscolha((e) => {
      const outra = Object.keys(e).find((k) => k !== linhaId && e[k] === id);
      return outra ? { ...e, [linhaId]: id, [outra]: e[linhaId] } : { ...e, [linhaId]: id };
    });
  /** As trocas possíveis de uma linha, para o menu ⋯. */
  const trocasDe = (r: ResultadoDaLinha): AcaoDescrita[] =>
    g.titulos
      .filter((x) => x.id !== escolha[r.mov.id])
      .map((x) => {
        const deOutra = Object.entries(escolha).some(([k, id]) => k !== r.mov.id && id === x.id);
        return {
          rotulo: `Trocar por ${x.ref} · ${x.contraparte}${deOutra ? " (da outra linha)" : ""}`,
          icone: ArrowLeftRight,
          onClick: () => trocar(r.mov.id, x.id),
        };
      });
  const valor = moeda(Math.abs(linhas[0].mov.valor));
  const resumo = `${linhas.length} ${linhas.length === 1 ? "linha" : "linhas iguais"} de ${valor} · ${g.titulos.length} títulos`;
  return { linhas, escolha, porId, escolhidos, sobram, semCentro, trocar, trocasDe, resumo };
}

export function acoesDaLinhaDoGrupo(r: ResultadoDaLinha, t: TituloDoMotor, acoes: AcoesDoBanco, trocas: AcaoDescrita[]): AcoesDescritas {
  return {
    principal: comCentro(t)
      ? { rotulo: "Conciliar", dica: `Dá a baixa em ${t.ref} com os dados do banco e concilia.`, icone: CheckCheck, onClick: () => acoes.conciliarGrupo([r], [t]), verde: true }
      : { rotulo: "Revisar", dica: "Abre a baixa preenchida para escolher o centro de custo.", icone: CheckCheck, onClick: () => acoes.conferirTitulo(r, t), verde: false },
    lancar: null,
    nota: null,
    secundarias: [...trocas, { rotulo: "Procurar outro título", icone: Search, onClick: () => acoes.procurar(r), lupa: true }],
  };
}

// ---------------------------------------------------------------------------
// O topo: o arquivo, os avisos e os saldos
// ---------------------------------------------------------------------------

/** O botão de importar e o arquivo da última importação, numa linha só. */
export function LinhaDoArquivo({ banco, importar }: { banco: DadosDaAbaBanco; importar: React.ReactNode }) {
  const u = banco.ultima;
  const c = banco.conta;
  if (!u) return <>{importar}</>;
  const periodo = u.inicio && u.fim ? (u.inicio === u.fim ? dataBR(u.fim) : `${dataBR(u.inicio).slice(0, 5)} a ${dataBR(u.fim)}`) : "—";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {importar}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          {u.arquivo}
        </span>
        <span>
          {rotuloDoBanco(u.bancoId ?? "")} {final4(u.conta)}
        </span>
        <span>{periodo}</span>
        <span>
          {u.movimentos} mov. · <span className="font-semibold text-emerald-700">{u.novos} novos</span>
        </span>
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCheck className="h-3.5 w-3.5" />
          conta reconhecida
        </span>
        <InfoDica
          texto={
            <>
              Conta do extrato: {c.nome} · {c.banco}
              {c.agencia || c.numero ? ` · ${c.agencia ?? "—"} / ${c.numero ?? "—"}` : ""}. Reconhecida pelo arquivo (banco {u.bancoId || "—"}, conta{" "}
              {final4(u.conta)}).
              {u.saldoBanco !== null ? ` Saldo informado pelo banco: ${moeda(u.saldoBanco)}.` : ""}
              {u.movimentos - u.novos > 0 ? ` ${u.movimentos - u.novos} movimentos já tinham sido importados.` : ""}
            </>
          }
        />
      </div>
    </div>
  );
}

function ChipDeAviso({ tom, children, dica }: { tom: "verde" | "ambar" | "vermelho"; children: React.ReactNode; dica?: React.ReactNode }) {
  const t = {
    verde: "border-emerald-200 bg-emerald-50 text-emerald-900",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    vermelho: "border-red-200 bg-red-50 text-red-900",
  }[tom];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", t)}>
      {children}
      {dica && <InfoDica texto={dica} className="text-current opacity-70 hover:opacity-100" />}
    </span>
  );
}

/** Os avisos da importação numa linha de chips (some quando não há nenhum). */
export function LinhaDeAvisos(p: PropsDaFila) {
  const { banco, conciliacao, acoes, avisos } = p;
  const u = banco.ultima;
  const sozinhos = textoDosSozinhos(conciliacao.resultados);
  const linhasSozinhas = conciliacao.resultados.filter((r) => r.resolvido?.sozinho);
  const dia = u && u.fim && u.geradoDia === u.fim ? { dia: u.fim, hora: u.geradoHora } : null;
  const repetidos = u ? u.movimentos - u.novos : 0;
  const nadaNovo = u && repetidos > 0 && u.novos === 0;
  const temAlgum = sozinhos || dia || nadaNovo || !banco.conta.temNumero || avisos.erroImportacao || avisos.falhaDoMotor || avisos.recusado;
  if (!temAlgum) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {avisos.recusado && (
        <ChipDeAviso
          tom="ambar"
          dica={
            avisos.recusado.r.motivo === "outra_conta"
              ? `O extrato é conciliado na conta dele. Abra a conciliação da ${avisos.recusado.r.conta.nome} para importar ${avisos.recusado.arquivo}.`
              : "Nenhuma conta cadastrada tem esse número, ou falta agência e número no cadastro dela. Confira em Cadastros do Financeiro › Contas bancárias e importe de novo."
          }
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Arquivo recusado: {avisos.recusado.arquivo}
          {avisos.recusado.r.motivo === "outra_conta" ? (
            <Link href={`/financeiro/conciliacao?conta=${avisos.recusado.r.conta.id}&aba=banco`} prefetch={false} className="underline">
              Abrir a {avisos.recusado.r.conta.nome}
            </Link>
          ) : (
            <Link href="/financeiro/cadastros/contas-bancarias" prefetch={false} className="underline">
              Contas bancárias
            </Link>
          )}
          <button type="button" onClick={avisos.descartarRecusado} className="font-semibold opacity-70 hover:opacity-100" aria-label="Descartar o arquivo">
            ×
          </button>
        </ChipDeAviso>
      )}
      {avisos.erroImportacao && (
        <ChipDeAviso tom="vermelho">
          <AlertTriangle className="h-3.5 w-3.5" />
          {avisos.erroImportacao}
        </ChipDeAviso>
      )}
      {avisos.falhaDoMotor && (
        <ChipDeAviso tom="vermelho" dica="Não foi possível cruzar o extrato com os títulos agora: as linhas aparecem sem o que o sistema tem para cada uma. Recarregue a página; se continuar, avise o suporte.">
          <AlertTriangle className="h-3.5 w-3.5" />
          Sem cruzar com os títulos
        </ChipDeAviso>
      )}
      {!banco.conta.temNumero && (
        <ChipDeAviso tom="ambar" dica={`Para importar, a ${banco.conta.nome} precisa de agência e número no cadastro: é por eles que o sistema reconhece o arquivo.`}>
          <AlertTriangle className="h-3.5 w-3.5" />
          Conta sem agência e número
          <Link href="/financeiro/cadastros/contas-bancarias" prefetch={false} className="underline">
            Cadastrar
          </Link>
        </ChipDeAviso>
      )}
      {sozinhos && (
        <ChipDeAviso tom="verde" dica={<>{sozinhos.partes.join("; ")}. Tudo com Desfazer.</>}>
          <CheckCheck className="h-3.5 w-3.5" />
          {sozinhos.quantas === 1 ? "1 resolvida sozinha" : `${sozinhos.quantas} resolvidas sozinhas`}
          <DesfazerSozinhas linhas={linhasSozinhas} acoes={acoes} />
        </ChipDeAviso>
      )}
      {dia && (
        <ChipDeAviso
          tom="ambar"
          dica={`O arquivo foi gerado às ${dia.hora} desse dia. As linhas de hoje podem ser conciliadas, mas o dia só entra no fechamento com um extrato gerado depois dele. A baixa feita à mão hoje que ainda não está no banco não é divergência.`}
        >
          <Info className="h-3.5 w-3.5" />
          {dataBR(dia.dia).slice(0, 5)} em andamento
        </ChipDeAviso>
      )}
      {nadaNovo && (
        <ChipDeAviso
          tom="ambar"
          dica={`Os ${repetidos} movimentos já tinham sido importados. O Santander troca o código de cada movimento (FITID) a cada download, então o sistema reconhece o repetido pela data, pelo valor, pelo histórico e pela posição entre iguais.`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Nada novo neste arquivo
        </ChipDeAviso>
      )}
    </div>
  );
}

/** O "Desfazer" das resolvidas sozinhas: a lista, cada uma com o seu. */
function DesfazerSozinhas({ linhas, acoes }: { linhas: ResultadoDaLinha[]; acoes: AcoesDoBanco }) {
  const [aberto, setAberto] = React.useState(false);
  if (!linhas.length) return null;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2">
          <Undo2 className="h-3 w-3" />
          Desfazer
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-1.5">
        {linhas.map((r) => (
          <div key={r.mov.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/50">
            <span className="w-11 shrink-0 font-mono text-muted-foreground">{dataBR(r.mov.data).slice(0, 5)}</span>
            <span className="min-w-0 flex-1 truncate" title={r.resolvido?.texto}>
              {r.resolvido?.texto}
            </span>
            <span className={cn("shrink-0 font-mono", r.mov.valor < 0 ? "text-california-red" : "text-emerald-700")}>{moeda(Math.abs(r.mov.valor))}</span>
            <button
              type="button"
              disabled={acoes.ocupado}
              onClick={() => {
                setAberto(false);
                acoes.desfazer(r);
              }}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-white px-2 font-semibold hover:bg-muted"
            >
              <Undo2 className="h-3 w-3" />
              Desfazer
            </button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Bloco({ rotulo, valor, cor, dica }: { rotulo: string; valor: string; cor?: string; dica: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {rotulo}
        <InfoDica texto={dica} />
      </span>
      <span className={cn("font-mono text-base font-semibold", cor)}>{valor}</span>
    </div>
  );
}

/** Os saldos e o progresso numa faixa só, com Fechar/Reabrir. */
export function FaixaDoTopo(p: PropsDaFila) {
  const { banco, conciliacao } = p;
  const u = banco.ultima;
  const resultados = conciliacao.resultados;
  const resolvidos = resultados.filter((r) => r.resolvido).length;
  const pct = resultados.length ? Math.round((resolvidos / resultados.length) * 100) : 0;
  const saldoBanco = u?.saldoBanco ?? null;
  const saldoSistema = banco.saldoSistemaNoFim;
  const dif = saldoBanco === null || saldoSistema === null ? null : r2(saldoBanco - saldoSistema);
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-4 py-3">
      <Bloco rotulo="Saldo no banco" valor={saldoBanco === null ? "—" : moeda(saldoBanco)} dica={`Informado pelo arquivo, em ${dataBR(u?.saldoEm ?? u?.fim ?? "")}.`} />
      <Bloco rotulo="Saldo do sistema" valor={saldoSistema === null ? "—" : moeda(saldoSistema)} dica={`O Extrato desta conta no fim de ${u?.fim ? dataBR(u.fim) : "—"}.`} />
      <Bloco
        rotulo="Diferença"
        valor={dif === null ? "—" : dif === 0 ? "Bate ✓" : moeda(dif)}
        cor={dif === 0 ? "text-emerald-700" : "text-california-red"}
        dica={dif === null ? "O arquivo não informou o saldo." : dif === 0 ? "Banco e sistema contam a mesma história." : "Some quando cada linha do banco tiver o seu lançamento."}
      />
      <div className="flex min-w-[200px] flex-col gap-1.5">
        <span className="text-xs font-semibold">
          <span className="font-mono">{resolvidos}</span> de <span className="font-mono">{resultados.length}</span> conciliados
        </span>
        {/* O progresso é o do último extrato, e não o do filtro De/Até (decisão 239). */}
        {u?.inicio && u.fim && (
          <span className="text-[11px] text-muted-foreground">
            no extrato de {dataBR(u.inicio).slice(0, 5)} a {dataBR(u.fim)}
          </span>
        )}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {p.resolvendoSozinho ? (
          <span className="text-xs font-semibold text-emerald-700">Resolvendo sozinho…</span>
        ) : (
          p.pending && <span className="text-xs font-semibold text-muted-foreground">Trabalhando…</span>
        )}
        {p.fechamento}
      </div>
    </div>
  );
}

