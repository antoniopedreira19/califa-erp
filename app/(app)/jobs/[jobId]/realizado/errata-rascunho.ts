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

/** Campos do bloco Orçado que a errata abre para edição. */
export type CampoErrata = "unitario" | "quantidade" | "diasMeses";

export interface EdicaoLinha {
  unitario: string;
  quantidade: string;
  diasMeses: string;
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
    tipo: i.tipo_custo,
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
    }>;
    novas: Array<{
      grupo_id: string;
      item: string;
      tipo_custo: TipoCusto;
      linha_vermelha: boolean;
      valor_unitario: number;
      quantidade: number;
      dias_meses: number;
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
        return {
          ...i,
          tipo_custo: e.tipo,
          valor_unitario_orcado: unit,
          quantidade_orcada: qtd,
          dias_meses_orcado: dm,
          total_orcado: unit * qtd * dm,
        };
      });

    const criadas: ItemPlanilhaJob[] = novas.map((n, indice) => {
      const unit = n.vermelha ? 0 : numeroDe(n.unitario, 0);
      const qtd = n.vermelha ? 1 : numeroDe(n.quantidade, 0);
      const dm = n.vermelha ? 1 : numeroDe(n.diasMeses, 0);
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
        // O planejado da linha nova nasce zerado e é preenchido depois,
        // pelo fluxo normal do planejado. Na vermelha ele fica zerado.
        valor_unitario_planejado: 0,
        quantidade_planejada: 0,
        dias_meses_planejado: 0,
        total_planejado: 0,
        bv_liquido_planejado: null,
        em_save: false,
        save_consumido: 0,
      };
    });

    return [...vivos, ...criadas];
  }, [ativo, itensSalvos, edicoes, novas, removidas]);

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
        });
        continue;
      }
      const de = Number(base.total_orcado ?? 0);
      const para = Number(i.total_orcado ?? 0);
      // O tipo de custo muda o faturamento sem mexer no total orçado — por
      // isso ele conta como mudança mesmo com os dois totais iguais.
      if (de === para && base.tipo_custo === i.tipo_custo) continue;
      lista.push({
        chave: i.id,
        acao: "alterada",
        vermelha: i.linha_vermelha,
        item: i.item,
        totalDe: de,
        totalPara: para,
        delta: para - de,
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
            Number(base.total_orcado ?? 0) !== Number(i.total_orcado ?? 0) ||
            base.tipo_custo !== i.tipo_custo
          );
        })
        .map((i) => ({
          job_item_orcado_id: i.orcado_id,
          valor_unitario: Number(i.valor_unitario_orcado ?? 0),
          quantidade: Number(i.quantidade_orcada ?? 0),
          dias_meses: Number(i.dias_meses_orcado ?? 0),
          tipo_custo: i.tipo_custo,
        }));

      return {
        descricao,
        alteracoes,
        novas: novas.map((n) => ({
          grupo_id: n.grupoId,
          item: n.item.trim(),
          tipo_custo: n.tipo,
          linha_vermelha: n.vermelha,
          valor_unitario: n.vermelha ? 0 : numeroDe(n.unitario, 0),
          quantidade: n.vermelha ? 1 : numeroDe(n.quantidade, 0),
          dias_meses: n.vermelha ? 1 : numeroDe(n.diasMeses, 0),
        })),
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
