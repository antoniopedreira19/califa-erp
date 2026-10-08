"use client";

/**
 * Um documento na tela "lado a lado": o PDF da PP, a nota do fornecedor, o
 * comprovante. Nasceu na tela da PP do Contas a Pagar (`pp-tela.tsx`) e saiu
 * de lá em 08/10/2026 para a conferência da produção usar a mesma peça
 * (decisão 153, entrega 3): mesmo cabeçalho, mesmos botões, mesmo jeito de
 * abrir o PDF.
 */

import * as React from "react";
import { Download, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Abre o documento SEM a coluna de miniaturas, que come um terço de um
 * painel que já é um terço da tela. Quem quiser as miniaturas as traz de
 * volta pelo ☰ do próprio visualizador.
 *
 * ⚠️ Só vale no carregamento: trocar o `#` de um `<iframe>` que já abriu
 * não reabre o visualizador. Para conferir, recarregue a página — testar
 * mudando o `src` de um PDF aberto faz o parâmetro parecer ignorado.
 */
export function enderecoParaVisualizar(url: string): string {
  return url.includes("#") ? url : `${url}#navpanes=0&pagemode=none`;
}

/**
 * Baixa com o nome que a produção enviou. `<a download>` é ignorado em
 * arquivo de outro domínio — e URL assinada do Storage sempre é —, então
 * o link abriria o PDF por cima da tela. Servir um `blob:` local devolve
 * o atributo, e com ele o nome original.
 */
export async function baixarArquivo(url: string, nome: string): Promise<void> {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const blob = await resposta.blob();
  const enderecoLocal = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = enderecoLocal;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(enderecoLocal), 60_000);
}

export function PainelDocumento({
  icone,
  titulo,
  legenda,
  extra,
  oculto,
  url,
  nomeArquivo,
  expandido,
  onExpandir,
  onErro,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  legenda: string;
  extra?: React.ReactNode;
  oculto: boolean;
  url: string | null;
  nomeArquivo: string;
  expandido: boolean;
  onExpandir: () => void;
  onErro: (mensagem: string) => void;
  children: React.ReactNode;
}) {
  const [baixando, setBaixando] = React.useState(false);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white",
        oculto && "hidden",
      )}
    >
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        {icone}
        <span className="text-xs font-bold">{titulo}</span>
        {extra}
        <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground">
          {legenda}
        </span>

        {/* Zoom, impressão e busca são do visualizador do navegador, dentro
            do `<iframe>`. O que ele não dá é sair do lado a lado, salvar com
            o nome certo e abrir numa aba inteira — vai aqui. */}
        <div className="flex flex-none items-center gap-0.5 border-l border-border pl-2">
          <button
            type="button"
            onClick={onExpandir}
            title={expandido ? "Voltar ao lado a lado" : "Ver só este documento"}
            aria-label={expandido ? "Voltar ao lado a lado" : "Ver só este documento"}
            aria-pressed={expandido}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-california-red"
          >
            {expandido ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          {url && (
            <>
              <button
                type="button"
                disabled={baixando}
                onClick={async () => {
                  setBaixando(true);
                  try {
                    await baixarArquivo(url, nomeArquivo);
                  } catch {
                    onErro("Não foi possível baixar o arquivo. Tente de novo.");
                  } finally {
                    setBaixando(false);
                  }
                }}
                title={baixando ? "Baixando..." : "Baixar o arquivo"}
                aria-label="Baixar o arquivo"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-california-red disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title="Abrir em outra aba"
                aria-label="Abrir em outra aba"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-california-red"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** O documento em si: imagem centrada, ou o PDF no visualizador do navegador. */
export function VisualizadorDeArquivo({
  url,
  nome,
  imagem,
}: {
  url: string;
  nome: string;
  imagem: boolean;
}) {
  if (imagem) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-3">
        {/* URL assinada ou `blob:`: `next/image` exigiria domínio configurado
            e não agregaria nada. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={nome} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <iframe src={enderecoParaVisualizar(url)} title={nome} className="h-full w-full border-0" />
  );
}

export function VazioDoPainel({ texto }: { texto: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/40 p-6 text-center">
      <p className="text-xs text-muted-foreground">{texto}</p>
    </div>
  );
}
