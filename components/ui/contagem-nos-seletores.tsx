"use client";

import * as React from "react";

/**
 * Quantas linhas cada empresa tem no filtro atual da tela, para o seletor de
 * empresas do cabeçalho (16/11/2026, pedido do Tiago no protótipo da lista de
 * PPs).
 *
 * O seletor mora no `PageHeader`, fora da lista que sabe contar: a lista
 * publica as contagens aqui, e o seletor lê. Sem o provider (todas as outras
 * telas), a leitura dá `null` e o seletor fica como sempre foi.
 *
 * As abas do Contas a Pagar ficam montadas, só escondidas: a lista de PPs não
 * sai da tela ao trocar de aba. Por isso quem diz se ela está à vista é a
 * barra de abas (`informarListaVisivel`), e o seletor só mostra o número
 * enquanto ela está.
 */
export interface ContagemPorEmpresa {
  /** O que o número conta, em palavras ("PPs em avaliação"). */
  legenda: string;
  porEmpresa: Record<string, number>;
}

interface Valor {
  contagem: ContagemPorEmpresa | null;
  visivel: boolean;
  publicar: (c: ContagemPorEmpresa | null) => void;
  informarListaVisivel: (visivel: boolean) => void;
}

const Contexto = React.createContext<Valor | null>(null);

export function ContagemNosSeletoresProvider({ children }: { children: React.ReactNode }) {
  const [contagem, setContagem] = React.useState<ContagemPorEmpresa | null>(null);
  const [visivel, setVisivel] = React.useState(false);
  const valor = React.useMemo<Valor>(
    () => ({ contagem, visivel, publicar: setContagem, informarListaVisivel: setVisivel }),
    [contagem, visivel],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Para o seletor de empresas: a contagem, só com a lista à vista. */
export function useContagemPorEmpresa(): ContagemPorEmpresa | null {
  const v = React.useContext(Contexto);
  return v && v.visivel ? v.contagem : null;
}

/** Para a lista: publica a contagem enquanto estiver montada. */
export function usePublicarContagemPorEmpresa(contagem: ContagemPorEmpresa) {
  const publicar = React.useContext(Contexto)?.publicar;
  React.useEffect(() => {
    publicar?.(contagem);
  }, [publicar, contagem]);
  React.useEffect(() => () => publicar?.(null), [publicar]);
}

/** Para a barra de abas: diz se a aba da lista que conta está à vista. */
export function useInformarListaVisivel(visivel: boolean) {
  const informar = React.useContext(Contexto)?.informarListaVisivel;
  React.useEffect(() => {
    informar?.(visivel);
  }, [informar, visivel]);
  React.useEffect(() => () => informar?.(false), [informar]);
}
