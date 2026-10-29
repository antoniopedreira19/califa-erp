"use client";

/**
 * O rascunho do modo errata.
 *
 * Desde 27/08/2026 "Alterar orçado" não abre mais uma tabela paralela: ele
 * liga a edição na planilha que já está na tela. Isso muda quem é a fonte
 * dos números enquanto se edita — e é aqui que essa fonte mora.
 *
 * A ideia central é uma só: o rascunho devolve uma lista de
 * `ItemPlanilhaJob` como se ele já tivesse sido gravado. Quem consome a
 * planilha — a tabela, o card de Totais, a barra do rodapé, o pop-up — lê
 * essa lista e não precisa saber que existe um modo de edição. Sem isso,
 * cada um desses lugares teria a própria conta do "com errata", e eles
 * divergiriam no primeiro centavo.
 *
 * O texto digitado é guardado como TEXTO, não como número. Guardar número
 * faz "1," virar 1 e o cursor pular para trás no meio da digitação.
 *
 * Desde 07/10/2026 (decisão 151) a linha "removida" passa a ser CANCELADA —
 * fica na planilha. Desde 15/10/2026 (volta atrás da 151) a errata volta a
 * abrir o PLANEJADO, na linha nova e na existente, e a cancelada fica com o
 * orçado E o planejado zerados.
 *
 * Desde 08/10/2026 (decisão 159) o rascunho também abre a errata PRONTA
 * PARA ENVIO: o produtor a deixa pronta, e quem a abre de novo (ele, ou o
 * GP que vai enviar) continua dela — `ligar(conteudo)`.
 *
 * Desde 09/10/2026 (decisão 162) a errata também ORGANIZA a planilha: o
 * item muda de lugar pela alça (como no orçamento, decisão 104) e pode
 * trocar de agrupamento; o agrupamento se renomeia e nasce; o que ficar
 * vazio sai na confirmação. Nada disso mexe em valor, e tudo fica no
 * rascunho até a errata ser confirmada, com o mesmo Desfazer. Os
 * agrupamentos são os do JOB (`jobs_grupos`): a versão aprovada continua
 * como o cliente aprovou. A regra mora em `lib/calculos/organizacao-errata`.
 */

import * as React from "react";
import type {
  ConteudoErrata,
  EstruturaDaErrata,
  ItemPlanilhaJob,
  MudancaDeEstrutura,
  TipoCusto,
  VersaoOrcamentoGrupo,
} from "@/lib/types";
import { moverNaLista } from "@/lib/calculos/ordem-itens";
import {
  erroDoNomeDoGrupo,
  gruposQueSaem as calcularGruposQueSaem,
  mudancasDeEstrutura,
  resumoDaEstrutura,
  type Organizacao,
} from "@/lib/calculos/organizacao-errata";

/** O agrupamento como a errata o deixa. */
/** Mês de verdade da versão (uuid); o mês novo da errata tem outra chave. */
const UUID_DO_MES = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrupoDaErrata extends VersaoOrcamentoGrupo {
  /** O nome gravado no job; `null` no agrupamento criado nesta errata. */
  nomeSalvo: string | null;
}

export type { MudancaDeEstrutura };

const PREFIXO_GRUPO_NOVO = "grupo-novo:";

/** Campos das células da errata, os três do Orçado e os três do Planejado.
 *  O planejado abre na errata desde 15/10/2026 (volta atrás da decisão
 *  151) e no "Editar orçado" do financeiro com o job na fila da abertura
 *  (14/10/2026). */
export type CampoErrata =
  | "unitario"
  | "quantidade"
  | "diasMeses"
  | "planUnitario"
  | "planQuantidade"
  | "planDiasMeses";

export interface EdicaoLinha {
  unitario: string;
  quantidade: string;
  diasMeses: string;
  /** O PLANEJADO da linha. Vale onde `planejadoLiberado` diz que sim. */
  planUnitario: string;
  planQuantidade: string;
  planDiasMeses: string;
  tipo: TipoCusto;
}

export interface LinhaNovaRascunho extends EdicaoLinha {
  /** `nova:1`, `nova:2`… Serve de `id` na tabela até a linha existir. */
  chave: string;
  grupoId: string;
  item: string;
  /** Só recebe realizado, por PP. Orçado e planejado ficam zerados. */
  vermelha: boolean;
}

/** Uma linha que a errata mexeu, como o pop-up de confirmação a mostra. */
export interface MudancaErrata {
  chave: string;
  /** `cancelada` desde a decisão 151: a linha fica com o orçado zerado. */
  acao: "alterada" | "nova" | "cancelada";
  vermelha: boolean;
  item: string;
  totalDe: number;
  totalPara: number;
  delta: number;
  /** Total PLANEJADO da linha, antes e depois. Iguais desde a decisão
   *  150 (a errata não muda o planejado); ficam para o histórico. */
  planejadoDe: number;
  planejadoPara: number;
}

/** O planejado da linha mudou — R$ Unit., QT ou D/M (15/10/2026). */
function planejadoMudou(base: ItemPlanilhaJob, i: ItemPlanilhaJob): boolean {
  return (
    Number(base.valor_unitario_planejado ?? 0) !== Number(i.valor_unitario_planejado ?? 0) ||
    Number(base.quantidade_planejada ?? 0) !== Number(i.quantidade_planejada ?? 0) ||
    Number(base.dias_meses_planejado ?? 0) !== Number(i.dias_meses_planejado ?? 0)
  );
}

export function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

export function paraEdicao(v: number): string {
  return String(v).replace(".", ",");
}

function numeroDe(texto: string, seVazio: number): number {
  const n = parseNumero(texto);
  return n === null || n < 0 ? seVazio : n;
}

function edicaoDoItem(i: ItemPlanilhaJob): EdicaoLinha {
  return {
    unitario: paraEdicao(Number(i.valor_unitario_orcado ?? 0)),
    quantidade: paraEdicao(Number(i.quantidade_orcada ?? 1)),
    diasMeses: paraEdicao(Number(i.dias_meses_orcado ?? 1)),
    planUnitario: paraEdicao(Number(i.valor_unitario_planejado ?? 0)),
    planQuantidade: paraEdicao(Number(i.quantidade_planejada ?? 0)),
    planDiasMeses: paraEdicao(Number(i.dias_meses_planejado ?? 0)),
    tipo: i.tipo_custo,
  };
}


export interface RascunhoErrata {
  ativo: boolean;
  /** Job de serviço Interno (decisão 105): tipo sempre F · Interno e o
   *  planejado igual ao orçado — a tabela não abre nenhum dos dois. */
  interno: boolean;
  /** Liga o modo errata. Com `conteudo`, abre a errata pronta para envio
   *  (decisão 159) já aplicada na planilha: quem abre continua dela. */
  ligar: (conteudo?: ConteudoErrata | null) => void;
  /** Sai do modo errata e joga fora tudo que foi digitado. */
  descartar: () => void;
  /** Volta um passo do rascunho. Cada ação estrutural (linha nova, linha
   *  cancelada, troca de tipo) é um passo; a digitação num mesmo campo é
   *  um passo só, e não um por tecla. */
  desfazer: () => void;
  /** Há passo para voltar — o botão e o atalho ficam desligados sem isto. */
  podeDesfazer: boolean;
  edicaoDe: (chave: string) => EdicaoLinha | undefined;
  /** O PLANEJADO desta linha aceita digitação? Na linha nova e na que já
   *  existia, desde 15/10/2026 (volta atrás da decisão 151); não na
   *  vermelha, na em save, na cancelada nem no Interno, em que ele segue o
   *  orçado. O "Editar orçado" do financeiro fecha o planejado depois da
   *  abertura (`job-realizado-section`). */
  planejadoLiberado: (chave: string) => boolean;
  /** Por que o planejado NÃO abre — o `title` da célula. `null` quando ele
   *  abre, ou quando a célula nem mostra número (linha vermelha). */
  motivoPlanejadoTravado: (chave: string) => string | null;
  editarCampo: (chave: string, campo: CampoErrata, valor: string) => void;
  editarTipo: (chave: string, tipo: TipoCusto) => void;
  editarNome: (chave: string, nome: string) => void;
  /** Devolve a chave da linha nova (`nova:N`), para a tela selecioná-la
   *  e abrir a descrição na hora. */
  adicionar: (grupoId: string, vermelha: boolean) => string;
  /** Linha nova desta errata: sai do rascunho. Linha que já existia: é
   *  CANCELADA (decisão 151) — fica com o orçado zerado e o planejado. */
  remover: (chave: string) => void;
  /** Desfaz o cancelamento feito NESTA errata. */
  reativar: (chave: string) => void;
  /** A linha está cancelada neste rascunho (ainda não gravada). */
  estaCancelada: (chave: string) => boolean;
  /** É uma linha criada agora, ainda sem id no banco. */
  ehNova: (chave: string) => boolean;
  /** A planilha como ela ficaria se a errata fosse confirmada agora. */
  itens: ItemPlanilhaJob[];
  mudancas: MudancaErrata[];
  temMudanca: boolean;
  /** "2 linhas alteradas · 1 linha nova" */
  resumo: string;
  /** Toda linha nova precisa de nome antes de a errata poder ser gravada. */
  faltaNomear: boolean;
  /** Decisão 226: as linhas vermelhas novas em agrupamento que já existe —
   *  elas não são errata e entram direto. Pela chave do rascunho. */
  vermelhasForaDaErrata: string[];
  /** Só há linha vermelha nova no rascunho: salvar não é errata. */
  soVermelhas: boolean;
  /** Os agrupamentos novos só de linhas vermelhas, que nascem junto com elas
   *  fora da errata (revisão de 29/10/2026). */
  gruposForaDaErrata: string[];
  /** A chave do rascunho da N-ésima linha nova do pedido (`nova:N`). */
  chaveDaNovaDoPedido: (chavePedido: string) => string | null;
  /** O que vai à action: o conteúdo da errata (o mesmo que a errata
   *  pronta guarda) e a descrição. */
  payload: (descricao: string) => ConteudoErrata & { descricao: string };

  // ---- Organização da planilha (09/10/2026) --------------------------
  /** Os agrupamentos como a errata os deixa, na ordem da tela. Sem errata,
   *  os do job. */
  grupos: GrupoDaErrata[];
  /** Muda o item de lugar — `indice` conta entre os itens do grupo de
   *  destino SEM ele, como a linha de inserção do arrasto mede. */
  moverItem: (chave: string, grupoId: string, indice: number) => void;
  /** Devolve o erro, ou `null` quando renomeou. */
  renomearGrupo: (grupoId: string, nome: string) => string | null;
  /** Cria o agrupamento no fim da ordem (do mês, no mensal). */
  criarGrupo: (
    nome: string,
    mesId: string | null,
  ) => { ok: true; id: string } | { ok: false; erro: string };
  /** Os agrupamentos que saem quando a errata for confirmada: os que
   *  ficaram vazios nela (e o novo deixado vazio, que não chega a nascer). */
  gruposQueSaem: string[];
  ehGrupoNovo: (grupoId: string) => boolean;
  estrutura: MudancaDeEstrutura[];
}

export function useRascunhoErrata(
  itensSalvos: ItemPlanilhaJob[],
  /** Job de serviço Interno (decisão 105): linha nova nasce F · Interno e o
   *  planejado acompanha o orçado, como o banco vai gravar. */
  interno: boolean,
  /** Os agrupamentos do job, na ordem. */
  gruposSalvos: VersaoOrcamentoGrupo[],
): RascunhoErrata {
  const [ativo, setAtivo] = React.useState(false);
  const [edicoes, setEdicoes] = React.useState<Record<string, EdicaoLinha>>({});
  const [novas, setNovas] = React.useState<LinhaNovaRascunho[]>([]);
  // Linhas que já existiam e que esta errata cancela (decisão 151).
  const [canceladas, setCanceladas] = React.useState<string[]>([]);
  // A organização: os agrupamentos do rascunho (renomeados, novos, sem os
  // removidos), a sequência dos itens na tela e o grupo de quem mudou de
  // grupo. `sequencia` nula = a ordem salva; item que não está nela (linha
  // nova criada depois de um movimento) vai para o fim do grupo dele.
  const gruposIniciais = React.useMemo<GrupoDaErrata[]>(
    () => gruposSalvos.map((g) => ({ ...g, nomeSalvo: g.nome })),
    [gruposSalvos],
  );
  const [grupos, setGrupos] = React.useState<GrupoDaErrata[]>(gruposIniciais);
  const [sequencia, setSequencia] = React.useState<string[] | null>(null);
  const [grupoDoItem, setGrupoDoItem] = React.useState<Record<string, string>>({});
  const seqGrupoRef = React.useRef(0);
  // ⚠️ Ref, e não state. A chave da linha nova só precisa ser única — ela
  // não é lida na renderização, é gravada dentro da própria linha. Como
  // state ela virou bug: `setNovas` era chamado DENTRO do updater de
  // `setSeq`, e em StrictMode o React roda todo updater duas vezes para
  // provar que ele é puro. Um clique em "Linha vermelha" criava duas.
  const seqRef = React.useRef(0);

  // ---- Desfazer ----------------------------------------------------
  // Pilha de fotos do rascunho, tirada ANTES de cada mudança. Vinte
  // passos é bem mais do que uma errata costuma ter e não pesa: cada foto
  // é um punhado de strings.
  //
  // A digitação COALESCE: só tira foto quando o alvo (linha + campo) muda.
  // Sem isso o Cmd+Z voltaria uma tecla por vez, e o que o usuário quer
  // desfazer é "a alteração daquela célula", não "o último caractere".
  type Foto = {
    edicoes: Record<string, EdicaoLinha>;
    novas: LinhaNovaRascunho[];
    canceladas: string[];
    grupos: GrupoDaErrata[];
    sequencia: string[] | null;
    grupoDoItem: Record<string, string>;
  };
  const [historico, setHistorico] = React.useState<Foto[]>([]);
  const alvoRef = React.useRef<string | null>(null);
  const atualRef = React.useRef<Foto>({ edicoes, novas, canceladas, grupos, sequencia, grupoDoItem });
  atualRef.current = { edicoes, novas, canceladas, grupos, sequencia, grupoDoItem };

  const fotografar = React.useCallback((alvo: string | null) => {
    // `alvo` null = ação estrutural, sempre vira passo.
    if (alvo !== null && alvo === alvoRef.current) return;
    alvoRef.current = alvo;
    const a = atualRef.current;
    setHistorico((h) => [
      ...h.slice(-19),
      {
        edicoes: { ...a.edicoes },
        novas: [...a.novas],
        canceladas: [...a.canceladas],
        grupos: [...a.grupos],
        sequencia: a.sequencia ? [...a.sequencia] : null,
        grupoDoItem: { ...a.grupoDoItem },
      },
    ]);
  }, []);

  const desfazer = React.useCallback(() => {
    setHistorico((h) => {
      if (h.length === 0) return h;
      const anterior = h[h.length - 1];
      setEdicoes(anterior.edicoes);
      setNovas(anterior.novas);
      setCanceladas(anterior.canceladas);
      setGrupos(anterior.grupos);
      setSequencia(anterior.sequencia);
      setGrupoDoItem(anterior.grupoDoItem);
      // O próximo caractere digitado volta a valer como passo novo.
      alvoRef.current = null;
      return h.slice(0, -1);
    });
  }, []);

  const zerar = React.useCallback(() => {
    setEdicoes({});
    setNovas([]);
    setCanceladas([]);
    setGrupos(gruposIniciais);
    setSequencia(null);
    setGrupoDoItem({});
    setHistorico([]);
    alvoRef.current = null;
    seqRef.current = 0;
    seqGrupoRef.current = 0;
  }, [gruposIniciais]);

  // Fora da errata os agrupamentos acompanham o que vem gravado.
  React.useEffect(() => {
    if (!ativo) setGrupos(gruposIniciais);
  }, [ativo, gruposIniciais]);

  const ligar = React.useCallback((conteudo?: ConteudoErrata | null) => {
    // Semeia TODAS as linhas de uma vez. Semear sob demanda deixaria o
    // input sem valor inicial no primeiro caractere digitado.
    const inicial: Record<string, EdicaoLinha> = {};
    for (const i of itensSalvos) inicial[i.id] = edicaoDoItem(i);
    // A errata pronta para envio (decisão 159) entra por cima do salvo: a
    // linha corrigida volta com os números dela, a nova volta como linha
    // nova do rascunho e a cancelada, cancelada. Linha que sumiu do job ou
    // foi cancelada desde então fica de fora — o servidor confere tudo de
    // novo no envio.
    const porOrcadoId = new Map(itensSalvos.map((i) => [i.orcado_id, i]));
    for (const a of conteudo?.alteracoes ?? []) {
      const salvo = porOrcadoId.get(a.job_item_orcado_id);
      if (!salvo || salvo.cancelada_em || !inicial[salvo.id]) continue;
      inicial[salvo.id] = {
        ...inicial[salvo.id],
        unitario: paraEdicao(a.valor_unitario),
        quantidade: paraEdicao(a.quantidade),
        diasMeses: paraEdicao(a.dias_meses),
        // O planejado da pronta volta também (15/10/2026); a pronta de
        // antes guardava o salvo, então fica igual.
        planUnitario: paraEdicao(a.valor_unitario_planejado ?? Number(salvo.valor_unitario_planejado ?? 0)),
        planQuantidade: paraEdicao(a.quantidade_planejada ?? Number(salvo.quantidade_planejada ?? 0)),
        planDiasMeses: paraEdicao(a.dias_meses_planejado ?? Number(salvo.dias_meses_planejado ?? 0)),
        // No Interno o tipo não muda (decisão 105).
        tipo: interno ? salvo.tipo_custo : a.tipo_custo,
      };
    }
    let seq = 0;
    const novasDaPronta: LinhaNovaRascunho[] = (conteudo?.novas ?? []).map((n) => {
      seq += 1;
      return {
        chave: `nova:${seq}`,
        grupoId: n.grupo_id,
        item: n.item,
        vermelha: n.linha_vermelha,
        unitario: paraEdicao(n.valor_unitario),
        quantidade: paraEdicao(n.quantidade),
        diasMeses: paraEdicao(n.dias_meses),
        // O planejado da linha nova (15/10/2026); o `?? 0` cobre pronta
        // gravada sem ele.
        planUnitario: paraEdicao(n.valor_unitario_planejado ?? 0),
        planQuantidade: paraEdicao(n.quantidade_planejada ?? 1),
        planDiasMeses: paraEdicao(n.dias_meses_planejado ?? 1),
        tipo: n.tipo_custo,
      };
    });
    const ativas = new Set(itensSalvos.filter((i) => !i.cancelada_em).map((i) => i.id));
    // A organização da errata pronta: renomeados e removidos que ainda
    // existem, os novos com as chaves de volta (`grupo-novo:1`…) e a
    // sequência dos itens. Grupo que sumiu do job desde então fica de fora
    // e o item volta ao dele — o servidor confere de novo no envio.
    const est = conteudo?.estrutura ?? null;
    const renomes = new Map((est?.grupos_renomeados ?? []).map((r) => [r.grupo_id, r.nome]));
    const base = gruposIniciais[0];
    const gruposDaPronta: GrupoDaErrata[] = [
      ...gruposIniciais
        .map((g) => (renomes.has(g.id) ? { ...g, nome: renomes.get(g.id)! } : g)),
      ...(est?.grupos_novos ?? []).map((n, k): GrupoDaErrata => ({
        ...(base as GrupoDaErrata),
        id: n.chave,
        nome: n.nome,
        ordem: 10_000 + k,
        mes_id: n.mes_id,
        meio: null,
        forma_compra: null,
        formato: null,
        nomeSalvo: null,
      })),
    ];
    const idsDosGrupos = new Set(gruposDaPronta.map((g) => g.id));
    const grupoDaPronta: Record<string, string> = {};
    for (const o of est?.ordem ?? []) {
      if (idsDosGrupos.has(o.grupo)) grupoDaPronta[o.item] = o.grupo;
    }
    setEdicoes(inicial);
    setNovas(novasDaPronta);
    setCanceladas((conteudo?.cancelamentos ?? []).filter((id) => ativas.has(id)));
    setGrupos(gruposDaPronta);
    setSequencia(est?.ordem ? est.ordem.map((o) => o.item) : null);
    setGrupoDoItem(grupoDaPronta);
    setHistorico([]);
    alvoRef.current = null;
    seqRef.current = seq;
    seqGrupoRef.current = est?.grupos_novos.length ?? 0;
    setAtivo(true);
  }, [itensSalvos, interno, gruposIniciais]);

  const descartar = React.useCallback(() => {
    setAtivo(false);
    zerar();
  }, [zerar]);

  const salvosPorId = React.useMemo(
    () => new Map(itensSalvos.map((i) => [i.id, i])),
    [itensSalvos],
  );

  const editarCampo = React.useCallback(
    (chave: string, campo: CampoErrata, valor: string) => {
      fotografar(`${chave}:${campo}`);
      setNovas((lista) =>
        lista.map((n) => (n.chave === chave ? { ...n, [campo]: valor } : n)),
      );
      setEdicoes((mapa) =>
        mapa[chave] ? { ...mapa, [chave]: { ...mapa[chave], [campo]: valor } } : mapa,
      );
    },
    [fotografar],
  );

  const editarTipo = React.useCallback((chave: string, tipo: TipoCusto) => {
    // No Interno o tipo não muda (decisão 105).
    if (interno) return;
    fotografar(null);
    setNovas((lista) =>
      lista.map((n) => (n.chave === chave ? { ...n, tipo } : n)),
    );
    setEdicoes((mapa) =>
      mapa[chave] ? { ...mapa, [chave]: { ...mapa[chave], tipo } } : mapa,
    );
  }, [fotografar, interno]);

  const editarNome = React.useCallback((chave: string, nome: string) => {
    fotografar(`${chave}:nome`);
    setNovas((lista) =>
      lista.map((n) => (n.chave === chave ? { ...n, item: nome } : n)),
    );
  }, [fotografar]);

  const adicionar = React.useCallback((grupoId: string, vermelha: boolean): string => {
    fotografar(null);
    seqRef.current += 1;
    const chave = `nova:${seqRef.current}`;
    setNovas((lista) => [
      ...lista,
      {
        chave,
        grupoId,
        item: "",
        vermelha,
        // A vermelha nasce e permanece zerada: o banco cobra isso em
        // `chk_jio_linha_vermelha_zerada`.
        unitario: "0",
        quantidade: "1",
        diasMeses: "1",
        // O planejado nasce com a mesma forma do orçado: quem digita o
        // unitário dos dois já tem QT e D/M em 1.
        planUnitario: "0",
        planQuantidade: vermelha ? "0" : "1",
        planDiasMeses: vermelha ? "0" : "1",
        tipo: interno ? "FI" : "B",
      },
    ]);
    return chave;
  }, [fotografar, interno]);

  const remover = React.useCallback((chave: string) => {
    fotografar(null);
    if (chave.startsWith("nova:")) {
      setNovas((lista) => lista.filter((n) => n.chave !== chave));
      return;
    }
    // Linha que já existia não sai da planilha: é cancelada (decisão 151).
    setCanceladas((lista) =>
      lista.includes(chave) ? lista : [...lista, chave],
    );
  }, [fotografar]);

  const reativar = React.useCallback((chave: string) => {
    fotografar(null);
    setCanceladas((lista) => lista.filter((c) => c !== chave));
  }, [fotografar]);

  const estaCancelada = React.useCallback(
    (chave: string) => canceladas.includes(chave),
    [canceladas],
  );

  const edicaoDe = React.useCallback(
    (chave: string): EdicaoLinha | undefined => {
      const nova = novas.find((n) => n.chave === chave);
      if (nova) return nova;
      return edicoes[chave];
    },
    [novas, edicoes],
  );

  const ehNova = React.useCallback(
    (chave: string) => chave.startsWith("nova:"),
    [],
  );

  /** Por que o planejado da linha não abre — o `title` da célula. Desde a
   *  decisão 151 (07/10/2026) ele nunca abre na errata: o planejado do job
   *  é o da abertura. `null` só na linha vermelha, que nem mostra número. */
  const travaDoPlanejado = React.useCallback(
    (chave: string): string | null => {
      if (interno) return "No serviço Interno o planejado é igual ao orçado.";
      if (canceladas.includes(chave)) return "Linha cancelada nesta errata: o orçado e o planejado vão a zero.";
      const nova = novas.find((n) => n.chave === chave);
      if (nova) return null;
      const salvo = salvosPorId.get(chave);
      if (!salvo) return "Linha fora da errata.";
      if (salvo.linha_vermelha) return null;
      if (salvo.em_save) return "Linha em save não tem planejado.";
      if (salvo.cancelada_em) return "Linha cancelada por errata não se corrige.";
      return null;
    },
    [novas, salvosPorId, interno, canceladas],
  );

  const planejadoLiberado = React.useCallback(
    (chave: string) => {
      if (interno || canceladas.includes(chave)) return false;
      const nova = novas.find((n) => n.chave === chave);
      if (nova) return !nova.vermelha;
      const salvo = salvosPorId.get(chave);
      return (
        !!salvo && !salvo.linha_vermelha && salvo.em_save !== true && !salvo.cancelada_em
      );
    },
    [interno, canceladas, novas, salvosPorId],
  );

  /** A planilha como ela ficaria depois de confirmar. */
  const itens = React.useMemo<ItemPlanilhaJob[]>(() => {
    if (!ativo) return itensSalvos;

    // O instante do cancelamento no rascunho: a tabela só precisa saber
    // que a linha está cancelada; a data de verdade é a do banco.
    const agora = new Date().toISOString();
    const vivos = itensSalvos
      .map((i): ItemPlanilhaJob =>
        canceladas.includes(i.id)
          ? // Cancelada nesta errata (decisão 151): orçado e, desde
            // 15/10/2026, planejado zerados — o mesmo que
            // `registrar_errata_do_job` vai gravar.
            {
              ...i,
              valor_unitario_orcado: 0,
              total_orcado: 0,
              valor_unitario_planejado: 0,
              total_planejado: 0,
              cancelada_em: agora,
            }
          : i,
      )
      .map((i) => {
        // Linha cancelada (agora ou numa errata anterior) não se corrige.
        if (i.cancelada_em) return i;
        const e = edicoes[i.id];
        if (!e) return i;
        // Linha vermelha já gravada não tem orçado para mexer.
        if (i.linha_vermelha) return { ...i, tipo_custo: e.tipo };
        const unit = numeroDe(e.unitario, 0);
        const qtd = numeroDe(e.quantidade, 0);
        const dm = numeroDe(e.diasMeses, 0);
        // O planejado digitado onde ele abre (15/10/2026); onde não abre,
        // o salvo. No Interno ele acompanha o orçado, como o trigger do
        // banco grava (decisão 105).
        const plan = interno
          ? { u: unit, q: qtd, d: dm }
          : planejadoLiberado(i.id)
            ? {
                u: numeroDe(e.planUnitario, 0),
                q: numeroDe(e.planQuantidade, 0),
                d: numeroDe(e.planDiasMeses, 0),
              }
            : {
                u: Number(i.valor_unitario_planejado ?? 0),
                q: Number(i.quantidade_planejada ?? 0),
                d: Number(i.dias_meses_planejado ?? 0),
              };
        return {
          ...i,
          tipo_custo: e.tipo,
          valor_unitario_orcado: unit,
          quantidade_orcada: qtd,
          dias_meses_orcado: dm,
          total_orcado: unit * qtd * dm,
          valor_unitario_planejado: plan.u,
          quantidade_planejada: plan.q,
          dias_meses_planejado: plan.d,
          total_planejado: plan.u * plan.q * plan.d,
        };
      });

    const criadas: ItemPlanilhaJob[] = novas.map((n, indice) => {
      const unit = n.vermelha ? 0 : numeroDe(n.unitario, 0);
      const qtd = n.vermelha ? 1 : numeroDe(n.quantidade, 0);
      const dm = n.vermelha ? 1 : numeroDe(n.diasMeses, 0);
      // O planejado da linha nova é o digitado (15/10/2026, volta atrás da
      // decisão 151); a vermelha fica toda em zero, e no Interno o
      // planejado acompanha o orçado (decisão 105).
      const plan = n.vermelha
        ? { u: 0, q: 0, d: 0 }
        : interno
          ? { u: unit, q: qtd, d: dm }
          : {
              u: numeroDe(n.planUnitario, 0),
              q: numeroDe(n.planQuantidade, 0),
              d: numeroDe(n.planDiasMeses, 0),
            };
      return {
        id: n.chave,
        orcado_id: n.chave,
        item_versao_id: null,
        linha_vermelha: n.vermelha,
        grupo_id: n.grupoId,
        // Depois de todas as salvas do grupo — a ordem real é decidida no
        // servidor, aqui só importa cair no fim da lista.
        ordem: 10_000 + indice,
        item: n.item,
        tipo_custo: n.tipo,
        categoria_id: null,
        valor_unitario_orcado: unit,
        quantidade_orcada: qtd,
        dias_meses_orcado: dm,
        total_orcado: unit * qtd * dm,
        valor_unitario_planejado: plan.u,
        quantidade_planejada: plan.q,
        dias_meses_planejado: plan.d,
        total_planejado: plan.u * plan.q * plan.d,
        bv_liquido_planejado: null,
        em_save: false,
        save_consumido: 0,
        cancelada_em: null,
        // Linha criada por errata não existia na abertura (decisão 151).
        orcado_abertura: 0,
        save_depois_da_abertura: false,
      };
    });

    // A organização: quem mudou de grupo vai para o novo (se ele ainda
    // existe no rascunho), e a lista sai na sequência da tela. A tela
    // agrupa mantendo a ordem desta lista, então ordenar aqui basta.
    const idsDosGrupos = new Set(grupos.map((g) => g.id));
    const todas = [...vivos, ...criadas].map((i) => {
      const g = grupoDoItem[i.id];
      return g && g !== i.grupo_id && idsDosGrupos.has(g) ? { ...i, grupo_id: g } : i;
    });
    if (!sequencia) return todas;
    const posicao = new Map(sequencia.map((chave, k) => [chave, k]));
    return todas
      .map((i, k) => ({ i, k }))
      .sort(
        (a, b) =>
          (posicao.get(a.i.id) ?? Number.MAX_SAFE_INTEGER) -
            (posicao.get(b.i.id) ?? Number.MAX_SAFE_INTEGER) || a.k - b.k,
      )
      .map(({ i }, k) => ({ ...i, ordem: k + 1 }));
  }, [ativo, itensSalvos, edicoes, novas, canceladas, interno, grupos, grupoDoItem, sequencia, planejadoLiberado]);

  // A lista mais recente, para as ações de organização lerem sem esperar
  // o próximo render.
  const itensRef = React.useRef(itens);
  itensRef.current = itens;

  /** Os agrupamentos com os itens, como a tela os mostra. */
  const naTela = React.useCallback(
    () =>
      atualRef.current.grupos.map((g) => ({
        id: g.id,
        itens: itensRef.current.filter((i) => i.grupo_id === g.id).map((i) => ({ id: i.id })),
      })),
    [],
  );

  const moverItem = React.useCallback(
    (chave: string, grupoId: string, indice: number) => {
      const movido = moverNaLista(naTela(), chave, grupoId, indice);
      if (!movido) return;
      fotografar(null);
      setSequencia(movido.flatMap((g) => g.itens.map((i) => i.id)));
      setGrupoDoItem((m) => ({ ...m, [chave]: grupoId }));
    },
    [naTela, fotografar],
  );

  /** Os agrupamentos de pé, no formato da regra comum. */
  const comoOrganizacao = React.useCallback(
    (lista: GrupoDaErrata[]) =>
      lista.map((g) => ({ id: g.id, nome: g.nome, mesId: g.mes_id ?? null })),
    [],
  );

  const renomearGrupo = React.useCallback(
    (grupoId: string, nome: string): string | null => {
      const lista = atualRef.current.grupos;
      const grupo = lista.find((g) => g.id === grupoId);
      if (!grupo) return "Grupo não encontrado.";
      if (nome.trim() === grupo.nome) return null;
      const erro = erroDoNomeDoGrupo(nome, grupo.mes_id ?? null, comoOrganizacao(lista), grupoId);
      if (erro) return erro;
      fotografar(null);
      setGrupos((atual) => atual.map((g) => (g.id === grupoId ? { ...g, nome: nome.trim() } : g)));
      return null;
    },
    [comoOrganizacao, fotografar],
  );

  const criarGrupo = React.useCallback(
    (nome: string, mesId: string | null): { ok: true; id: string } | { ok: false; erro: string } => {
      const lista = atualRef.current.grupos;
      const erro = erroDoNomeDoGrupo(nome, mesId, comoOrganizacao(lista), null);
      if (erro) return { ok: false, erro };
      fotografar(null);
      seqGrupoRef.current += 1;
      const id = `${PREFIXO_GRUPO_NOVO}${seqGrupoRef.current}`;
      const base = lista[0] ?? gruposIniciais[0];
      setGrupos((atual) => [
        ...atual,
        {
          ...(base as GrupoDaErrata),
          id,
          nome: nome.trim(),
          ordem: Math.max(0, ...atual.map((g) => g.ordem)) + 1,
          mes_id: mesId,
          meio: null,
          forma_compra: null,
          formato: null,
          nomeSalvo: null,
        },
      ]);
      return { ok: true, id };
    },
    [comoOrganizacao, fotografar, gruposIniciais],
  );

  const ehGrupoNovo = React.useCallback(
    (grupoId: string) => grupoId.startsWith(PREFIXO_GRUPO_NOVO),
    [],
  );

  /** A planilha antes e depois, no formato da regra comum: é ela que diz
   *  o que mudou na organização e quem sai na confirmação. */
  const antesDepois = React.useMemo(() => {
    const antes: Organizacao = {
      grupos: gruposIniciais.map((g) => ({ id: g.id, nome: g.nome, mesId: g.mes_id ?? null })),
      linhas: itensSalvos.map((i) => ({ id: i.id, grupoId: i.grupo_id, item: i.item })),
    };
    const depois: Organizacao = {
      grupos: grupos.map((g) => ({ id: g.id, nome: g.nome, mesId: g.mes_id ?? null })),
      linhas: itens.map((i) => ({ id: i.id, grupoId: i.grupo_id, item: i.item })),
    };
    return { antes, depois };
  }, [gruposIniciais, itensSalvos, grupos, itens]);

  const gruposQueSaem = React.useMemo(
    () => (ativo ? calcularGruposQueSaem(antesDepois.antes, antesDepois.depois) : []),
    [ativo, antesDepois],
  );

  const estrutura = React.useMemo<MudancaDeEstrutura[]>(
    () =>
      ativo
        ? mudancasDeEstrutura(
            antesDepois.antes,
            antesDepois.depois,
            new Map(novas.map((n) => [n.chave, n.grupoId])),
          )
        : [],
    [ativo, antesDepois, novas],
  );

  const mudancas = React.useMemo<MudancaErrata[]>(() => {
    if (!ativo) return [];
    const lista: MudancaErrata[] = [];
    const porId = new Map(itensSalvos.map((i) => [i.id, i]));

    for (const i of itens) {
      // A cancelada entra pelo laço de baixo; a que já estava cancelada
      // não muda.
      if (i.cancelada_em) continue;
      const base = porId.get(i.id);
      if (!base) {
        const total = Number(i.total_orcado ?? 0);
        lista.push({
          chave: i.id,
          acao: "nova",
          vermelha: i.linha_vermelha,
          item: i.item.trim() || "(sem descrição)",
          totalDe: 0,
          totalPara: total,
          delta: total,
          planejadoDe: 0,
          planejadoPara: Number(i.total_planejado ?? 0),
        });
        continue;
      }
      const de = Number(base.total_orcado ?? 0);
      const para = Number(i.total_orcado ?? 0);
      const planDe = Number(base.total_planejado ?? 0);
      const planPara = Number(i.total_planejado ?? 0);
      // O tipo de custo muda o faturamento sem mexer no total orçado — por
      // isso ele conta como mudança mesmo com os dois totais iguais. QT ×
      // D/M trocados com o mesmo total orçado já são mudança de unitário,
      // QT ou D/M. Desde 15/10/2026 o planejado também conta.
      const orcadoMudou =
        Number(base.valor_unitario_orcado ?? 0) !== Number(i.valor_unitario_orcado ?? 0) ||
        Number(base.quantidade_orcada ?? 0) !== Number(i.quantidade_orcada ?? 0) ||
        Number(base.dias_meses_orcado ?? 0) !== Number(i.dias_meses_orcado ?? 0);
      if (!orcadoMudou && !planejadoMudou(base, i) && base.tipo_custo === i.tipo_custo) continue;
      lista.push({
        chave: i.id,
        acao: "alterada",
        vermelha: i.linha_vermelha,
        item: i.item,
        totalDe: de,
        totalPara: para,
        delta: para - de,
        planejadoDe: planDe,
        planejadoPara: planPara,
      });
    }

    for (const id of canceladas) {
      const base = porId.get(id);
      if (!base) continue;
      const de = Number(base.total_orcado ?? 0);
      // O orçado e o planejado vão a zero (15/10/2026).
      lista.push({
        chave: id,
        acao: "cancelada",
        vermelha: base.linha_vermelha,
        item: base.item,
        totalDe: de,
        totalPara: 0,
        delta: -de,
        planejadoDe: Number(base.total_planejado ?? 0),
        planejadoPara: 0,
      });
    }

    return lista;
  }, [ativo, itens, itensSalvos, canceladas]);

  const resumo = React.useMemo(() => {
    const conta = (a: MudancaErrata["acao"]) =>
      mudancas.filter((m) => m.acao === a).length;
    const partes: string[] = [];
    const alt = conta("alterada");
    const nov = conta("nova");
    const can = conta("cancelada");
    if (alt) partes.push(`${alt} ${alt === 1 ? "linha alterada" : "linhas alteradas"}`);
    // Decisão 226: a linha vermelha conta à parte — ela não é errata.
    const verm = mudancas.filter((m) => m.acao === "nova" && m.vermelha).length;
    if (nov - verm) partes.push(`${nov - verm} ${nov - verm === 1 ? "linha nova" : "linhas novas"}`);
    if (verm) partes.push(`${verm} ${verm === 1 ? "linha vermelha" : "linhas vermelhas"}`);
    if (can) partes.push(`${can} ${can === 1 ? "linha cancelada" : "linhas canceladas"}`);
    // A organização vem depois dos valores (decisão 162).
    partes.push(...resumoDaEstrutura(estrutura));
    return partes.length > 0 ? partes.join(" · ") : "nenhuma alteração ainda";
  }, [mudancas, estrutura]);

  const faltaNomear = novas.some((n) => n.item.trim() === "");

  // Decisão 226: a vermelha nova sai da errata. Num agrupamento que já
  // existe, sempre; num agrupamento novo desta errata, só quando ele é
  // composto APENAS por linhas vermelhas novas — aí ele nasce junto com
  // elas (revisão de 29/10/2026). O agrupamento novo de um mês novo
  // (decisão 219) fica na errata.
  const gruposForaDaErrata = React.useMemo(() => {
    const vermelhas = new Set(novas.filter((n) => n.vermelha).map((n) => n.chave));
    const saem = new Set(gruposQueSaem);
    return grupos
      .filter((g) => {
        if (g.nomeSalvo !== null || saem.has(g.id)) return false;
        if (g.mes_id !== null && !UUID_DO_MES.test(g.mes_id)) return false;
        const doGrupo = itens.filter((i) => i.grupo_id === g.id);
        return doGrupo.length > 0 && doGrupo.every((i) => vermelhas.has(i.id));
      })
      .map((g) => g.id);
  }, [novas, grupos, gruposQueSaem, itens]);
  const vermelhasForaDaErrata = React.useMemo(() => {
    const grupoDe = new Map(itens.map((i) => [i.id, i.grupo_id]));
    return novas
      .filter((n) => {
        if (!n.vermelha) return false;
        const g = grupoDe.get(n.chave) ?? n.grupoId;
        return !g.startsWith(PREFIXO_GRUPO_NOVO) || gruposForaDaErrata.includes(g);
      })
      .map((n) => n.chave);
  }, [novas, itens, gruposForaDaErrata]);
  const soVermelhas =
    mudancas.length > 0 &&
    mudancas.every((m) => m.acao === "nova" && vermelhasForaDaErrata.includes(m.chave)) &&
    estrutura.every((m) => m.tipo === "grupo_novo" && gruposForaDaErrata.includes(m.chave));
  const chaveDaNovaDoPedido = React.useCallback(
    (chavePedido: string) => {
      const k = /^nova:(\d+)$/.exec(chavePedido);
      return k ? (novas[Number(k[1]) - 1]?.chave ?? null) : null;
    },
    [novas],
  );

  /** A organização no formato gravado. As chaves provisórias são
   *  renumeradas pela posição na lista (`nova:1`, `grupo-novo:1`…), que é
   *  como `ligar` as remonta ao reabrir a errata pronta. */
  const estruturaDoPayload = React.useCallback((): EstruturaDaErrata | null => {
    if (estrutura.length === 0) return null;
    const chaveDaNova = new Map(novas.map((n, k) => [n.chave, `nova:${k + 1}`]));
    const saem = new Set(gruposQueSaem);
    // O grupo novo deixado vazio não chega a nascer: fica fora da lista.
    const novosGrupos = grupos.filter((g) => g.nomeSalvo === null && !saem.has(g.id));
    const chaveDoGrupo = new Map(novosGrupos.map((g, k) => [g.id, `${PREFIXO_GRUPO_NOVO}${k + 1}`]));
    const mexeuNaOrdem = estrutura.some((m) => m.tipo === "item_movido" || m.tipo === "ordem");
    return {
      grupos_novos: novosGrupos.map((g) => ({
        chave: chaveDoGrupo.get(g.id)!,
        nome: g.nome,
        mes_id: g.mes_id ?? null,
      })),
      grupos_renomeados: grupos
        .filter((g) => g.nomeSalvo !== null && g.nome !== g.nomeSalvo)
        .map((g) => ({ grupo_id: g.id, nome: g.nome })),
      ordem: mexeuNaOrdem
        ? itens.map((i) => ({
            item: chaveDaNova.get(i.id) ?? i.id,
            grupo: chaveDoGrupo.get(i.grupo_id) ?? i.grupo_id,
          }))
        : null,
    };
  }, [estrutura, novas, grupos, gruposQueSaem, itens]);

  const payload = React.useCallback(
    (descricao: string) => {
      const porId = new Map(itensSalvos.map((i) => [i.id, i]));
      const alteracoes = itens
        .filter((i) => porId.has(i.id))
        // A cancelada vai em `cancelamentos`, não como correção.
        .filter((i) => !i.cancelada_em)
        .filter((i) => {
          const base = porId.get(i.id)!;
          return (
            Number(base.valor_unitario_orcado ?? 0) !== Number(i.valor_unitario_orcado ?? 0) ||
            Number(base.quantidade_orcada ?? 0) !== Number(i.quantidade_orcada ?? 0) ||
            Number(base.dias_meses_orcado ?? 0) !== Number(i.dias_meses_orcado ?? 0) ||
            base.tipo_custo !== i.tipo_custo ||
            planejadoMudou(base, i)
          );
        })
        .map((i) => ({
          job_item_orcado_id: i.orcado_id,
          valor_unitario: Number(i.valor_unitario_orcado ?? 0),
          quantidade: Number(i.quantidade_orcada ?? 0),
          dias_meses: Number(i.dias_meses_orcado ?? 0),
          tipo_custo: i.tipo_custo,
          // O planejado como a errata o deixa (15/10/2026). O servidor
          // confere de novo: vermelha e save ficam em zero, e no Interno ele
          // segue o orçado.
          valor_unitario_planejado: Number(i.valor_unitario_planejado ?? 0),
          quantidade_planejada: Number(i.quantidade_planejada ?? 0),
          dias_meses_planejado: Number(i.dias_meses_planejado ?? 0),
        }));

      const criadasPorChave = new Map(
        itens.filter((i) => !porId.has(i.id)).map((i) => [i.id, i]),
      );

      return {
        descricao,
        alteracoes,
        novas: novas.map((n) => {
          const criada = criadasPorChave.get(n.chave);
          const saem = new Set(gruposQueSaem);
          const novosGrupos = grupos.filter((g) => g.nomeSalvo === null && !saem.has(g.id));
          const posDoGrupo = novosGrupos.findIndex((g) => g.id === (criada?.grupo_id ?? n.grupoId));
          return {
            // O grupo onde a linha FICOU (ela pode ter mudado de lugar); o
            // grupo novo vai pela chave renumerada.
            grupo_id:
              posDoGrupo >= 0
                ? `${PREFIXO_GRUPO_NOVO}${posDoGrupo + 1}`
                : (criada?.grupo_id ?? n.grupoId),
            item: n.item.trim(),
            tipo_custo: n.tipo,
            linha_vermelha: n.vermelha,
            valor_unitario: n.vermelha ? 0 : numeroDe(n.unitario, 0),
            quantidade: n.vermelha ? 1 : numeroDe(n.quantidade, 0),
            dias_meses: n.vermelha ? 1 : numeroDe(n.diasMeses, 0),
            valor_unitario_planejado: Number(criada?.valor_unitario_planejado ?? 0),
            quantidade_planejada: Number(criada?.quantidade_planejada ?? 0),
            dias_meses_planejado: Number(criada?.dias_meses_planejado ?? 0),
          };
        }),
        cancelamentos: canceladas,
        estrutura: estruturaDoPayload(),
      };
    },
    [itens, itensSalvos, novas, canceladas, estruturaDoPayload, grupos, gruposQueSaem],
  );

  return {
    ativo,
    interno,
    ligar,
    descartar,
    desfazer,
    podeDesfazer: historico.length > 0,
    edicaoDe,
    planejadoLiberado,
    motivoPlanejadoTravado: travaDoPlanejado,
    editarCampo,
    editarTipo,
    editarNome,
    adicionar,
    remover,
    reativar,
    estaCancelada,
    ehNova,
    itens,
    mudancas,
    temMudanca: mudancas.length > 0 || estrutura.length > 0,
    resumo,
    faltaNomear,
    vermelhasForaDaErrata,
    soVermelhas,
    gruposForaDaErrata,
    chaveDaNovaDoPedido,
    payload,
    grupos,
    moverItem,
    renomearGrupo,
    criarGrupo,
    gruposQueSaem,
    ehGrupoNovo,
    estrutura,
  };
}
