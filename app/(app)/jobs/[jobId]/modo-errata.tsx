"use client";

/**
 * Quem está no modo errata, para quem está fora da aba saber.
 *
 * O rodapé do job é UMA barra com três estados — job aberto, errata em
 * edição, abertura em revisão. Só que os dois primeiros nascem em lugares
 * diferentes da árvore: a barra de ações é irmã das abas (as ações são do
 * job, não da aba), e a errata mora dentro da Planilha Interna, que é uma
 * aba. Sem este sinal as duas barras ficam grudadas no pé da janela ao
 * mesmo tempo, uma por cima da outra.
 *
 * ⚠️ É um store de módulo, e não um contexto de React, de propósito. Um
 * provider teria que embrulhar as abas E a barra em `page.tsx`, o que
 * significa reindentar ~150 linhas de um arquivo que a outra frente de
 * desenvolvimento também edita — conflito de merge garantido por uma
 * mudança que é só de espaço em branco. O store não pede nada da página.
 *
 * Só existe uma tela de job por vez na aplicação, então o singleton não
 * cruza jobs. Quem liga é responsável por desligar ao desmontar, e
 * `JobRealizadoSection` faz isso no cleanup do efeito.
 *
 * É minúsculo de propósito: só o liga/desliga. O rascunho da errata
 * continua inteiro em `JobRealizadoSection` — subir o rascunho até aqui
 * faria a página re-renderizar a cada tecla digitada numa célula.
 */

import * as React from "react";

let ativo = false;
const inscritos = new Set<() => void>();

function inscrever(aoMudar: () => void): () => void {
  inscritos.add(aoMudar);
  return () => {
    inscritos.delete(aoMudar);
  };
}

function ler(): boolean {
  return ativo;
}

/** No servidor o modo nunca está ligado — ele só existe depois de alguém
 *  clicar. Sem este snapshot próprio o React acusa erro de hidratação. */
function lerNoServidor(): boolean {
  return false;
}

export function definirModoErrata(novo: boolean): void {
  if (ativo === novo) return;
  ativo = novo;
  for (const aoMudar of inscritos) aoMudar();
}

export function useModoErrataAtivo(): boolean {
  return React.useSyncExternalStore(inscrever, ler, lerNoServidor);
}
