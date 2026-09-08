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
 */

import * as React from "react";
import type { ItemPlanilhaJob, TipoCusto } from "@/lib/types";

/** Campos que a errata abre para edição: os três do bloco Orçado e, desde
 *  07/09/2026 (decisão 054), os três do bloco Planejado. */
export type CampoErrata =
  | "unitario"
  | "quantidade"
  | "diasMeses"
  | "planUnitario"
  | "planQuantidade"
  | "planDiasMeses";

export const CAMPOS_ORCADO: readonly CampoErrata[] = [
  "unitario",
  "quantidade",
  "diasMeses",
];

export interface EdicaoLinha {
  unitario: string;
  quantidade: string;
  diasMeses: string;
  /** O PLANEJADO da linha. Só vale quando `planejadoLiberado` — fora
   *  disso a linha fica com o planejado salvo, e o texto aqui é ignorado. */
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
  acao: "alterada" | "nova" | "removida";
  vermelha: boolean;
  item: string;
  totalDe: number;
  totalPara: number;
  delta: number;
  /** Total PLANEJADO da linha, antes e depois. O pop-up mostra o par
   *  quando ele difere — a errata passou a mexer no planejado em
   *  07/09/2026 (decisão 054). */
  planejadoDe: number;
  planejadoPara: number;
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

/** O orçado digitado difere do que está salvo? É a chave da regra do
 *  planejado (decisão 054): sem mudança no orçado, o planejado não abre. */
function orcadoDifere(e: EdicaoLinha, salvo: ItemPlanilhaJob): boolean {
  return (
    numeroDe(e.unitario, 0) !== Number(salvo.valor_unitario_orcado ?? 0) ||
    numeroDe(e.quantidade, 0) !== Number(salvo.quantidade_orcada ?? 0) ||
    numeroDe(e.diasMeses, 0) !== Number(salvo.dias_meses_orcado ?? 0)
  );
}

/** Devolve o texto do planejado ao valor salvo. Usado quando o orçado da
 *  linha volta ao original: o planejado que tinha sido digitado perde a
 *  razão de existir, e deixá-lo guardado faria ele reaparecer do nada na
 *  próxima correção do orçado. */
function planejadoSalvo(e: EdicaoLinha, salvo: ItemPlanilhaJob): EdicaoLinha {
  return {
    ...e,
    planUnitario: paraEdicao(Number(salvo.valor_unitario_planejado ?? 0)),
    planQuantidade: paraEdicao(Number(salvo.quantidade_planejada ?? 0)),
    planDiasMeses: paraEdicao(Number(salvo.dias_meses_planejado ?? 0)),
  };
}

export interface RascunhoErrata {
  ativo: boolean;
  ligar: () => void;
  /** Sai do modo errata e joga fora tudo que foi digitado. */
  descartar: () => void;
  /** Volta um passo do rascunho. Cada ação estrutural (linha nova, linha
   *  removida, troca de tipo) é um passo; a digitação num mesmo campo é
   *  um passo só, e não um por tecla. */
  desfazer: () => void;
  /** Há passo para voltar — o botão e o atalho ficam desligados sem isto. */
  podeDesfazer: boolean;
  edicaoDe: (chave: string) => EdicaoLinha | undefined;
  /** O PLANEJADO desta linha aceita digitação? Regra do Tiago (07/09/2026,
   *  decisão 054): só quando o ORÇADO dela também mudou — linha nova, ou
   *  linha existente com R$ Unit., QT ou D/M do orçado diferentes do
   *  salvo. Nunca em linha vermelha, em save, nem em `A`/`D`, onde o
   *  planejado espelha o orçado por trigger. */
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
  remover: (chave: string) => void;
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
  payload: (descricao: string) => {
    descricao: string;
    alteracoes: Array<{
      job_item_orcado_id: string;
      valor_unitario: number;
      quantidade: number;
      dias_meses: number;
      tipo_custo: TipoCusto;
      valor_unitario_planejado: number;
      quantidade_planejada: number;
      dias_meses_planejado: number;
    }>;
    novas: Array<{
      grupo_id: string;
      item: string;
      tipo_custo: TipoCusto;
      linha_vermelha: boolean;
      valor_unitario: number;
      quantidade: number;
      dias_meses: number;
      valor_unitario_planejado: number;
      quantidade_planejada: number;
      dias_meses_planejado: number;
    }>;
    remocoes: string[];
  };
}

export function useRascunhoErrata(
  itensSalvos: ItemPlanilhaJob[],
): RascunhoErrata {
  const [ativo, setAtivo] = React.useState(false);
  const [edicoes, setEdicoes] = React.useState<Record<string, EdicaoLinha>>({});
  const [novas, setNovas] = React.useState<LinhaNovaRascunho[]>([]);
  const [removidas, setRemovidas] = React.useState<string[]>([]);
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
  const [historico, setHistorico] = React.useState<
    { edicoes: Record<string, EdicaoLinha>; novas: LinhaNovaRascunho[]; removidas: string[] }[]
  >([]);
  const alvoRef = React.useRef<string | null>(null);
  const atualRef = React.useRef({ edicoes, novas, removidas });
  atualRef.current = { edicoes, novas, removidas };

  const fotografar = React.useCallback((alvo: string | null) => {
    // `alvo` null = ação estrutural, sempre vira passo.
    if (alvo !== null && alvo === alvoRef.current) return;
    alvoRef.current = alvo;
    const { edicoes: e, novas: n, removidas: r } = atualRef.current;
    setHistorico((h) => [...h.slice(-19), { edicoes: { ...e }, novas: [...n], removidas: [...r] }]);
  }, []);

  const desfazer = React.useCallback(() => {
    setHistorico((h) => {
      if (h.length === 0) return h;
      const anterior = h[h.length - 1];
      setEdicoes(anterior.edicoes);
      setNovas(anterior.novas);
      setRemovidas(anterior.removidas);
      // O próximo caractere digitado volta a valer como passo novo.
      alvoRef.current = null;
      return h.slice(0, -1);
    });
  }, []);

  const zerar = React.useCallback(() => {
    setEdicoes({});
    setNovas([]);
    setRemovidas([]);
    setHistorico([]);
    alvoRef.current = null;
    seqRef.current = 0;
  }, []);

  const ligar = React.useCallback(() => {
    // Semeia TODAS as linhas de uma vez. Semear sob demanda deixaria o
    // input sem valor inicial no primeiro caractere digitado.
    const inicial: Record<string, EdicaoLinha> = {};
    for (const i of itensSalvos) inicial[i.id] = edicaoDoItem(i);
    setEdicoes(inicial);
    setNovas([]);
    setRemovidas([]);
    setHistorico([]);
    alvoRef.current = null;
    seqRef.current = 0;
    setAtivo(true);
  }, [itensSalvos]);

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
      setEdicoes((mapa) => {
        if (!mapa[chave]) return mapa;
        let proxima: EdicaoLinha = { ...mapa[chave], [campo]: valor };
        // Orçado de volta ao salvo ⇒ o planejado digitado cai junto. É a
        // regra da decisão 054 aplicada no sentido inverso: sem mudança
        // no orçado não há mudança no planejado.
        const salvo = salvosPorId.get(chave);
        if (salvo && CAMPOS_ORCADO.includes(campo) && !orcadoDifere(proxima, salvo)) {
          proxima = planejadoSalvo(proxima, salvo);
        }
        return { ...mapa, [chave]: proxima };
      });
    },
    [fotografar, salvosPorId],
  );

  const editarTipo = React.useCallback((chave: string, tipo: TipoCusto) => {
    fotografar(null);
    setNovas((lista) =>
      lista.map((n) => (n.chave === chave ? { ...n, tipo } : n)),
    );
    setEdicoes((mapa) =>
      mapa[chave] ? { ...mapa, [chave]: { ...mapa[chave], tipo } } : mapa,
    );
  }, [fotografar]);

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
        tipo: "B",
      },
    ]);
    return chave;
  }, [fotografar]);

  const remover = React.useCallback((chave: string) => {
    fotografar(null);
    if (chave.startsWith("nova:")) {
      setNovas((lista) => lista.filter((n) => n.chave !== chave));
      return;
    }
    setRemovidas((lista) =>
      lista.includes(chave) ? lista : [...lista, chave],
    );
  }, [fotografar]);

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

  /** A regra do planejado num lugar só — a tabela e a conta dos itens
   *  leem daqui. Devolve o motivo da trava, ou null quando ele abre. */
  const travaDoPlanejado = React.useCallback(
    (chave: string): string | null => {
      const nova = novas.find((n) => n.chave === chave);
      if (nova) return null;
      const salvo = salvosPorId.get(chave);
      const e = edicoes[chave];
      if (!salvo || !e) return "Linha fora da errata.";
      if (salvo.linha_vermelha) return null;
      if (salvo.em_save) return "Linha em save não tem planejado.";
      if (!orcadoDifere(e, salvo)) {
        return "O planejado só abre depois de corrigir o orçado desta linha.";
      }
      return null;
    },
    [novas, salvosPorId, edicoes],
  );

  const planejadoLiberado = React.useCallback(
    (chave: string): boolean => {
      if (travaDoPlanejado(chave) !== null) return false;
      const nova = novas.find((n) => n.chave === chave);
      if (nova) return !nova.vermelha;
      return !salvosPorId.get(chave)?.linha_vermelha;
    },
    [travaDoPlanejado, novas, salvosPorId],
  );

  /** A planilha como ela ficaria depois de confirmar. */
  const itens = React.useMemo<ItemPlanilhaJob[]>(() => {
    if (!ativo) return itensSalvos;

    const vivos = itensSalvos
      .filter((i) => !removidas.includes(i.id))
      .map((i) => {
        const e = edicoes[i.id];
        if (!e) return i;
        // Linha vermelha já gravada não tem orçado para mexer.
        if (i.linha_vermelha) return { ...i, tipo_custo: e.tipo };
        const unit = numeroDe(e.unitario, 0);
        const qtd = numeroDe(e.quantidade, 0);
        const dm = numeroDe(e.diasMeses, 0);
        // O planejado segue a mesma regra que o banco vai aplicar:
        // liberado, é o que foi digitado; nos demais casos fica como está
        // salvo. O espelho de `A`/`D` saiu em 08/09/2026 (decisão 062).
        const plan = i.em_save
          ? { u: 0, q: 0, d: 0 }
          : travaDoPlanejado(i.id) === null
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
      // A linha nova tem orçado novo por definição, então o planejado dela
      // abre junto (decisão 054). Só a vermelha fica zerada — o espelho de
      // `A`/`D` saiu em 08/09/2026 (decisão 062).
      const plan = n.vermelha
        ? { u: 0, q: 0, d: 0 }
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
      };
    });

    return [...vivos, ...criadas];
  }, [ativo, itensSalvos, edicoes, novas, removidas, travaDoPlanejado]);

  const mudancas = React.useMemo<MudancaErrata[]>(() => {
    if (!ativo) return [];
    const lista: MudancaErrata[] = [];
    const porId = new Map(itensSalvos.map((i) => [i.id, i]));

    for (const i of itens) {
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
      // isso ele conta como mudança mesmo com os dois totais iguais. O
      // planejado sozinho não muda nada aqui: ele só abre com o orçado
      // alterado (decisão 054), e QT × D/M trocados com o mesmo total
      // orçado já são mudança de unitário, QT ou D/M.
      const orcadoMudou =
        Number(base.valor_unitario_orcado ?? 0) !== Number(i.valor_unitario_orcado ?? 0) ||
        Number(base.quantidade_orcada ?? 0) !== Number(i.quantidade_orcada ?? 0) ||
        Number(base.dias_meses_orcado ?? 0) !== Number(i.dias_meses_orcado ?? 0);
      if (!orcadoMudou && base.tipo_custo === i.tipo_custo) continue;
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

    for (const id of removidas) {
      const base = porId.get(id);
      if (!base) continue;
      const de = Number(base.total_orcado ?? 0);
      lista.push({
        chave: id,
        acao: "removida",
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
  }, [ativo, itens, itensSalvos, removidas]);

  const resumo = React.useMemo(() => {
    const conta = (a: MudancaErrata["acao"]) =>
      mudancas.filter((m) => m.acao === a).length;
    const partes: string[] = [];
    const alt = conta("alterada");
    const nov = conta("nova");
    const rem = conta("removida");
    if (alt) partes.push(`${alt} ${alt === 1 ? "linha alterada" : "linhas alteradas"}`);
    if (nov) partes.push(`${nov} ${nov === 1 ? "linha nova" : "linhas novas"}`);
    if (rem) partes.push(`${rem} ${rem === 1 ? "linha removida" : "linhas removidas"}`);
    return partes.length > 0 ? partes.join(" · ") : "nenhuma alteração ainda";
  }, [mudancas]);

  const faltaNomear = novas.some((n) => n.item.trim() === "");

  const payload = React.useCallback(
    (descricao: string) => {
      const porId = new Map(itensSalvos.map((i) => [i.id, i]));
      const alteracoes = itens
        .filter((i) => porId.has(i.id))
        .filter((i) => {
          const base = porId.get(i.id)!;
          return (
            Number(base.valor_unitario_orcado ?? 0) !== Number(i.valor_unitario_orcado ?? 0) ||
            Number(base.quantidade_orcada ?? 0) !== Number(i.quantidade_orcada ?? 0) ||
            Number(base.dias_meses_orcado ?? 0) !== Number(i.dias_meses_orcado ?? 0) ||
            base.tipo_custo !== i.tipo_custo
          );
        })
        .map((i) => ({
          job_item_orcado_id: i.orcado_id,
          valor_unitario: Number(i.valor_unitario_orcado ?? 0),
          quantidade: Number(i.quantidade_orcada ?? 0),
          dias_meses: Number(i.dias_meses_orcado ?? 0),
          tipo_custo: i.tipo_custo,
          // Já passou pela regra da 054 em `itens`: é o digitado quando o
          // planejado abriu, e o salvo quando não abriu.
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
          return {
            grupo_id: n.grupoId,
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
        remocoes: removidas,
      };
    },
    [itens, itensSalvos, novas, removidas],
  );

  return {
    ativo,
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
    ehNova,
    itens,
    mudancas,
    temMudanca: mudancas.length > 0,
    resumo,
    faltaNomear,
    payload,
  };
}
