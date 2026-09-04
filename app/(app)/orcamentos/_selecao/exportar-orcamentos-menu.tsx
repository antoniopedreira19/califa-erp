"use client";

import * as React from "react";
import { AlertTriangle, Download, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  estagioFunilBadgeClasses,
  estagioFunilLabel,
  type EstagioFunil,
} from "@/lib/calculos/funil";
import {
  BotaoMenu,
  CaixaMenu,
  LinhaOrcamento,
  useFecharMenu,
} from "./menu-orcamentos";

/** Um orçamento do projeto como o seletor de exportação o vê. */
export interface OrcamentoExportavel {
  id: string;
  codigo: string;
  nome: string;
  /** Versão que sai no arquivo: a aprovada, senão a mais recente.
   *  `null` = orçamento sem versão, que não tem o que exportar. */
  numeroVersao: number | null;
  estagio: EstagioFunil;
  /** O FATURAMENTO que a planilha vai mostrar — o lado `cliente` do
   *  fechamento (decisão 041): linhas em save incluídas, crédito
   *  consumido de outro job abatido. `null` sem versão. */
  valor: number | null;
}

interface Props {
  projetoId: string;
  orcamentos: OrcamentoExportavel[];
}

/**
 * "Exportar" da página do projeto e da visão agregada.
 *
 * Um arquivo `.xlsx` com uma planilha só: os orçamentos marcados em
 * sequência e um fechamento único — para o cliente, um orçamento
 * (decisão 041). Duas regras do seletor, as duas reconferidas na rota:
 *
 * - **Job aberto não sai.** A linha marcada fica em alerta, o rodapé
 *   trava e um aviso oferece desmarcar de uma vez.
 * - **Aprovado pede confirmação.** A planilha sai da versão aprovada
 *   vigente, e quem exporta confirma que é isso que quer.
 *
 * A seleção é só desta tela: a página do projeto e a visão agregada têm
 * cada uma a sua, e nada é salvo.
 */
export function ExportarOrcamentosMenu({ projetoId, orcamentos }: Props) {
  const exportaveis = React.useMemo(
    () => orcamentos.filter((o) => o.numeroVersao !== null),
    [orcamentos],
  );
  const [aberto, setAberto] = React.useState(false);
  const [confirmando, setConfirmando] = React.useState(false);
  const [selecionados, setSelecionados] = React.useState<string[]>(() =>
    exportaveis.map((o) => o.id),
  );
  const ancoraRef = React.useRef<HTMLDivElement>(null);

  const fechar = React.useCallback(() => {
    setAberto(false);
    setConfirmando(false);
  }, []);
  useFecharMenu(aberto, ancoraRef, fechar);

  const marcados = exportaveis.filter((o) => selecionados.includes(o.id));
  const abertos = marcados.filter((o) => o.estagio === "aberto");
  // Enviado para abertura também é orçamento aprovado — a versão que sai
  // é a aprovada, e a confirmação existe para isso.
  const aprovados = marcados.filter(
    (o) => o.estagio === "aprovado" || o.estagio === "enviado",
  );
  const soma = marcados.reduce((t, o) => t + (o.valor ?? 0), 0);
  const travado = abertos.length > 0;
  const semSelecao = marcados.length === 0;

  const href = `/api/orcamentos/${projetoId}/export?orcamentos=${marcados
    .map((o) => encodeURIComponent(o.id))
    .join(",")}`;

  function alternar(id: string) {
    setSelecionados((atuais) =>
      atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id],
    );
  }

  function baixar() {
    if (travado || semSelecao) return;
    // Navegar para a rota baixa o arquivo sem sair da página: a resposta
    // vem com `Content-Disposition: attachment`.
    window.location.assign(href);
    fechar();
  }

  function exportar() {
    if (travado || semSelecao) return;
    if (aprovados.length > 0) {
      setConfirmando(true);
      return;
    }
    baixar();
  }

  const rotuloDe = (o: OrcamentoExportavel) =>
    o.numeroVersao === null ? o.nome : `${o.nome} - v${o.numeroVersao}`;
  const nomes = (lista: OrcamentoExportavel[]) =>
    lista.map(rotuloDe).join(", ");

  return (
    <div ref={ancoraRef} className="relative flex-none">
      <BotaoMenu
        icone={<Download className="h-3.5 w-3.5" />}
        rotulo="Exportar"
        ativo={aberto}
        onClick={() => {
          setConfirmando(false);
          setAberto((v) => !v);
        }}
      />

      {aberto && (
        <CaixaMenu titulo="Exportar orçamentos">
          {confirmando ? (
            <div className="flex flex-col gap-2.5 px-3.5 pb-3 pt-3.5">
              <div className="flex gap-2.5">
                <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-amber-500/15 text-amber-800">
                  <AlertTriangle className="h-[15px] w-[15px]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-foreground">
                    Exportar orçamento aprovado?
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
                    {nomes(aprovados)}{" "}
                    {aprovados.length === 1 ? "está aprovado" : "estão aprovados"}{" "}
                    — a planilha sai da versão aprovada vigente. Confirme para
                    gerar o arquivo.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2.5 border-t border-border pt-2.5">
                <span className="font-mono text-[13px] font-bold text-foreground">
                  {formatBRL(soma)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmando(false)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={baixar}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Sim, exportar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="p-1.5">
                {orcamentos.length === 0 && (
                  <p className="px-2 py-3 text-[12px] text-muted-foreground">
                    Nenhum orçamento neste projeto ainda.
                  </p>
                )}
                {orcamentos.map((o) => {
                  const semVersao = o.numeroVersao === null;
                  const marcado = !semVersao && selecionados.includes(o.id);
                  return (
                    <LinhaOrcamento
                      key={o.id}
                      marcado={marcado}
                      alerta={marcado && o.estagio === "aberto"}
                      desabilitado={semVersao}
                      rotulo={rotuloDe(o)}
                      chip={estagioFunilLabel(o.estagio)}
                      chipClasses={estagioFunilBadgeClasses(o.estagio)}
                      direita={
                        semVersao ? "sem versão" : formatBRL(o.valor ?? 0)
                      }
                      onClick={() => alternar(o.id)}
                    />
                  );
                })}
                <p className="mx-1.5 mb-1 mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  Uma planilha só: os orçamentos marcados entram em sequência,
                  com um fechamento único — para o cliente, um orçamento. O
                  valor é o FATURAMENTO de cada um: linhas em save incluídas
                  e o que é pago com crédito de outro job já abatido.
                </p>
              </div>

              {travado && (
                <div className="mx-2 mb-2 flex gap-2 rounded-lg border border-california-red/25 bg-california-red/5 px-2.5 py-2">
                  <Lock className="mt-0.5 h-[13px] w-[13px] flex-none text-california-red" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11.5px] leading-relaxed text-[#a8323d] [text-wrap:pretty]">
                      {nomes(abertos)}{" "}
                      {abertos.length === 1
                        ? "já é um job aberto e não pode ser exportado."
                        : "já são jobs abertos e não podem ser exportados."}{" "}
                      Desmarque para liberar a exportação.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelecionados((atuais) =>
                          atuais.filter(
                            (id) =>
                              exportaveis.find((o) => o.id === id)?.estagio !==
                              "aberto",
                          ),
                        )
                      }
                      className="self-start text-[11.5px] font-semibold text-california-red underline"
                    >
                      {abertos.length === 1
                        ? "Desmarcar job aberto"
                        : "Desmarcar jobs abertos"}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-border bg-[#fafafa] px-3 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.07em] text-[#9a9a9a]">
                    Total selecionado · {marcados.length} de {exportaveis.length}
                  </span>
                  <span className="font-mono text-[15.5px] font-bold tracking-tight text-foreground">
                    {formatBRL(soma)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={exportar}
                  disabled={travado || semSelecao}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                    travado || semSelecao
                      ? "cursor-not-allowed bg-[#e2e2de] text-[#a3a39d]"
                      : "bg-california-red text-white hover:bg-california-red-hover",
                  )}
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar
                </button>
              </div>
            </>
          )}
        </CaixaMenu>
      )}
    </div>
  );
}
