"use client";

import * as React from "react";
import {
  RASTRO_VAZIO,
  destinoDoVoltar,
  esquecerPagina as esquecerNoRastro,
  marcarVoltar,
  nomeDaPagina,
  registrarNavegacao,
  type Marcas,
  type MarcaDaPagina,
  type Rastro,
} from "@/lib/voltar";

/**
 * O lado do navegador do botão Voltar (decisão 108): o rastro desta aba,
 * guardado no sessionStorage para sobreviver ao F5, as marcas que as
 * páginas deixam sobre si e a proteção de quem tem alteração não salva.
 * A regra está em `lib/voltar.ts`.
 *
 * sessionStorage é por aba: uma aba nova começa sem rastro, e o voltar
 * dela usa a reserva. Tudo aqui tolera o storage indisponível (janela
 * anônima, bloqueio) — o voltar só perde a memória e cai na reserva.
 */

const CHAVE_RASTRO = "califa:voltar:rastro";
const CHAVE_MARCAS = "califa:voltar:marcas";
const LIMITE_DE_MARCAS = 200;

let rastro: Rastro = RASTRO_VAZIO;
let marcas: Marcas = {};
let iniciado = false;
let popstatePendente = false;
/** Quando a página atual entrou no rastro como página nova. */
let chegadaDaAtual = 0;
/** Página que durou menos que isso até a próxima foi redirecionamento:
 *  ninguém lê uma tela e clica noutro link em menos de um segundo. */
const DURACAO_DE_REDIRECIONAMENTO_MS = 1000;
const ouvintes = new Set<() => void>();

function ler<T>(chave: string, padrao: T): T {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T) : padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave: string, valor: unknown) {
  try {
    window.sessionStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // Sem storage o rastro vive só na memória desta página.
  }
}

function avisar() {
  for (const ouvinte of ouvintes) ouvinte();
}

/** URL da página atual como o rastro a guarda: caminho + query. */
export function urlAtual(): string {
  return window.location.pathname + window.location.search;
}

/**
 * Começo do rastro, uma vez por carregamento do documento. F5 e o voltar do
 * navegador para dentro do ERP mantêm o rastro; qualquer outro carregamento
 * (aba nova, endereço digitado, login) começa do zero — senão uma aba nova,
 * que herda a cópia do sessionStorage, voltaria para páginas que ela nunca
 * mostrou.
 */
export function iniciarRastro() {
  if (iniciado) return;
  iniciado = true;
  const tipo = (
    performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
  )?.type;
  const mantem = tipo === "reload" || tipo === "back_forward";
  rastro = mantem ? ler(CHAVE_RASTRO, RASTRO_VAZIO) : RASTRO_VAZIO;
  marcas = ler(CHAVE_MARCAS, {});
  popstatePendente = tipo === "back_forward";
  window.addEventListener("popstate", () => {
    popstatePendente = true;
  });
}

export function registrarUrl(url: string) {
  const agora = Date.now();
  const proximo = registrarNavegacao(rastro, url, {
    popstate: popstatePendente,
    substituirAtual: agora - chegadaDaAtual < DURACAO_DE_REDIRECIONAMENTO_MS,
  });
  popstatePendente = false;
  if (proximo === rastro) return;
  if (proximo.entradas.length !== rastro.entradas.length || proximo.cursor !== rastro.cursor) {
    chegadaDaAtual = agora;
  }
  rastro = proximo;
  gravar(CHAVE_RASTRO, rastro);
  avisar();
}

export function marcarPagina(caminho: string, marca: MarcaDaPagina) {
  const anterior = marcas[caminho];
  if (anterior?.grupo === marca.grupo && anterior?.rotulo === marca.rotulo) return;
  const resto = { ...marcas };
  delete resto[caminho];
  // A mais recente vai para o fim; as mais antigas saem quando passa do limite.
  const entradas = Object.entries({ ...resto, [caminho]: marca }).slice(-LIMITE_DE_MARCAS);
  marcas = Object.fromEntries(entradas);
  gravar(CHAVE_MARCAS, marcas);
  avisar();
}

/** A página deixou de existir (o orçamento excluído, decisão 148): sai do
 *  rastro desta aba, com as subpáginas, e o voltar nunca leva a ela. */
export function esquecerPagina(caminho: string) {
  const proximo = esquecerNoRastro(rastro, caminho);
  if (proximo === rastro) return;
  rastro = proximo;
  gravar(CHAVE_RASTRO, rastro);
  avisar();
}

export function inscrever(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export interface Voltar {
  href: string;
  indice: number | null;
  /** "Voltar para Contas a Pagar" — o texto do balão e o nome acessível. */
  titulo: string;
}

export function calcularVoltar(reserva: string): Voltar {
  const destino = destinoDoVoltar(rastro, marcas, urlAtual(), reserva);
  return { ...destino, titulo: `Voltar para ${nomeDaPagina(destino.href, marcas)}` };
}

/** Chamado pelo botão logo antes de navegar para o destino. */
export function anotarVoltar(indice: number | null) {
  rastro = marcarVoltar(rastro, indice);
  gravar(CHAVE_RASTRO, rastro);
}

// ---------------------------------------------------------------------------
// Saída protegida: tela com alteração não salva (a visão agregada de
// Orçamentos, a errata do job) segura o voltar e as abas da faixa do projeto
// e pergunta antes. O `beforeunload` que essas telas já têm só pega fechar
// a aba e recarregar — navegação dentro do app passa direto por ele.
// ---------------------------------------------------------------------------

type AoTentarSair = (href: string) => void;
let protecao: AoTentarSair | null = null;

/**
 * Enquanto `ativa`, quem tentar sair pelo voltar ou pela faixa do projeto
 * cai em `aoTentarSair(href)`, e a tela decide: em geral, abre a própria
 * confirmação e, se a pessoa confirmar, navega para `href`.
 */
export function useProtegerSaida(ativa: boolean, aoTentarSair: AoTentarSair) {
  const ref = React.useRef(aoTentarSair);
  ref.current = aoTentarSair;
  React.useEffect(() => {
    if (!ativa) return;
    const minha: AoTentarSair = (href) => ref.current(href);
    protecao = minha;
    return () => {
      if (protecao === minha) protecao = null;
    };
  }, [ativa]);
}

/** `true` quando uma tela segurou a saída — aí quem chamou não navega. */
export function saidaSegurada(href: string): boolean {
  if (!protecao) return false;
  protecao(href);
  return true;
}
