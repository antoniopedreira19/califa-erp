"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, FileSpreadsheet, Trash2, UploadCloud } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import type { EnvioDaPlanilha } from "@/lib/importacao/envio";
import { LIMITE_PLANILHA_ROTULO } from "@/lib/importacao/limites";
import type { PreviewResult } from "@/lib/importacao/tipos-da-importacao";
import { enviarPlanilha } from "./enviar-planilha";
import { descartarEnvioPlanilha } from "./envio-actions";
import { FormatoDaPlanilha } from "./formato-da-planilha";
import { TabelaDeAbas } from "./tabela-de-abas";
import { ResumoDaAba, type OrigemDoPlanejado } from "./resumo-da-aba";

/**
 * O modal de importação de planilha (decisão 110, 27/09/2026) — no lugar
 * do drawer lateral, que ficava apertado.
 *
 * O caminho:
 *  1. **Arquivo** — a área de envio e o desenho do formato (2A), com o
 *     botão de baixar a planilha modelo.
 *  2. **Enviando / Lendo** — o arquivo sobe direto para o Storage (até
 *     10 MB) e o servidor lê todas as abas.
 *  3. **Conferir** — a tabela de abas à esquerda (1C) e o resumo da aba
 *     escolhida à direita, com os totais na lista de grupos.
 *  4. **"Tem certeza?"** — só quando a gravação apaga alguma coisa (a
 *     versão tem itens): um pop-up por cima do modal diz o que sai e o que
 *     entra. Versão vazia grava direto.
 *  5. **Gravando** — o modal não fecha enquanto grava.
 *
 * Fechar sem gravar apaga o arquivo enviado. O próximo abrir recomeça do
 * arquivo.
 */

export interface GravacaoDaPlanilha {
  envio: EnvioDaPlanilha;
  aba: string;
  origem_planejado: OrigemDoPlanejado;
}

type Etapa = "arquivo" | "enviando" | "lendo" | "conferir" | "gravando";
type Leitura = Extract<PreviewResult, { ok: true }>;

const BTN_SEC =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent";
const BTN_PRI =
  "inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-california-red-hover hover:shadow-brand disabled:opacity-50";

/** A sugestão do planejado (decisão do Tiago, 14/09/2026): planilha só com
 *  o orçado sugere manter o da anterior; a que traz planejado, o dela. */
function origemSugerida(leitura: Leitura, aba: string): OrigemDoPlanejado {
  const p = leitura.previews[aba]?.planejado;
  return p && p.versao_anterior !== null && !p.planilha_tem_planejado ? "anterior" : "planilha";
}

export function ImportarPlanilhaDialog({
  open,
  onOpenChange,
  titulo,
  descricao,
  modeloPlanilha,
  interno,
  orcamentoId,
  ler,
  gravar,
  confirmarSubstituicao,
  rotuloGravar,
  textoGravando,
  mostrarHonorarios,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  descricao: React.ReactNode;
  modeloPlanilha: CategoriaModeloPlanilha;
  interno: boolean;
  /** O orçamento, quando já existe — o modelo mensal baixado usa os meses dele. */
  orcamentoId?: string;
  /** Lê o arquivo já enviado: a tabela de abas e o resumo de cada uma. */
  ler: (envio: EnvioDaPlanilha) => Promise<PreviewResult>;
  /** Grava a aba escolhida. Quem chama navega ou recarrega no sucesso. */
  gravar: (g: GravacaoDaPlanilha) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** O que a gravação apaga. Com grupos ou itens, pede o "Tem certeza?". */
  confirmarSubstituicao: { versao: string; grupos: number; itens: number; bvs: number } | null;
  rotuloGravar: string;
  textoGravando: string;
  mostrarHonorarios: boolean;
}) {
  const [etapa, setEtapa] = React.useState<Etapa>("arquivo");
  const [erro, setErro] = React.useState<string | null>(null);
  const [envio, setEnvio] = React.useState<EnvioDaPlanilha | null>(null);
  const [leitura, setLeitura] = React.useState<Leitura | null>(null);
  const [aba, setAba] = React.useState("");
  const [origem, setOrigem] = React.useState<OrigemDoPlanejado>("planilha");
  const [certeza, setCerteza] = React.useState(false);
  const [arrastando, setArrastando] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Cada abertura é um ciclo: resposta que chega depois de fechar é ignorada.
  const ciclo = React.useRef(0);
  const envioRef = React.useRef<EnvioDaPlanilha | null>(null);
  const gravou = React.useRef(false);

  function limpar() {
    ciclo.current += 1;
    if (envioRef.current && !gravou.current) {
      void descartarEnvioPlanilha(envioRef.current.path);
    }
    envioRef.current = null;
    gravou.current = false;
    setEtapa("arquivo");
    setErro(null);
    setEnvio(null);
    setLeitura(null);
    setAba("");
    setOrigem("planilha");
    setCerteza(false);
    setArrastando(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function mudarAberto(aberto: boolean) {
    if (!aberto && etapa === "gravando") return;
    if (!aberto) limpar();
    onOpenChange(aberto);
  }

  async function receberArquivo(file: File | undefined) {
    if (!file) return;
    const meu = ++ciclo.current;
    if (envioRef.current) void descartarEnvioPlanilha(envioRef.current.path);
    envioRef.current = null;
    setErro(null);
    setEtapa("enviando");

    const enviado = await enviarPlanilha(file);
    if (meu !== ciclo.current) return;
    if (!enviado.ok) {
      setErro(enviado.message);
      setEtapa("arquivo");
      return;
    }
    envioRef.current = enviado.envio;
    setEnvio(enviado.envio);
    setEtapa("lendo");

    const lida = await ler(enviado.envio);
    if (meu !== ciclo.current) return;
    if (!lida.ok) {
      void descartarEnvioPlanilha(enviado.envio.path);
      envioRef.current = null;
      setEnvio(null);
      setErro(lida.message);
      setEtapa("arquivo");
      return;
    }
    setLeitura(lida);
    setAba(lida.sugerida);
    setOrigem(origemSugerida(lida, lida.sugerida));
    setEtapa("conferir");
  }

  function escolherAba(nome: string) {
    if (!leitura || nome === aba) return;
    setAba(nome);
    setOrigem(origemSugerida(leitura, nome));
  }

  const apaga =
    confirmarSubstituicao !== null &&
    (confirmarSubstituicao.grupos > 0 || confirmarSubstituicao.itens > 0);

  async function executarGravacao() {
    if (!envio) return;
    setCerteza(false);
    setErro(null);
    setEtapa("gravando");
    const r = await gravar({ envio, aba, origem_planejado: origem });
    if (!r.ok) {
      setErro(r.message);
      setEtapa("conferir");
      return;
    }
    gravou.current = true;
    envioRef.current = null;
    limpar();
    onOpenChange(false);
  }

  const preview = leitura?.previews[aba] ?? null;
  const conferindo = etapa === "conferir" && leitura && preview;

  return (
    <Dialog open={open} onOpenChange={mudarAberto}>
      <DialogContent
        className={cn(
          "flex w-[min(1400px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0",
          conferindo ? "h-[min(915px,88vh)]" : "max-h-[88vh]",
        )}
        onEscapeKeyDown={(e) => etapa === "gravando" && e.preventDefault()}
        onPointerDownOutside={(e) => etapa === "gravando" && e.preventDefault()}
      >
        <DialogHeader className="space-y-1.5 border-b border-border p-6 pr-14">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        {etapa === "arquivo" && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            <label
              htmlFor="arquivo-da-planilha"
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastando(false);
                void receberArquivo(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed px-5 py-5 transition-colors",
                arrastando
                  ? "border-california-red/60 bg-california-red/5"
                  : "border-border bg-muted/20 hover:border-california-red/40 hover:bg-california-red/5",
              )}
            >
              <UploadCloud className="h-9 w-9 flex-none text-california-red/70" />
              <span className="flex-1">
                <span className="block font-semibold text-foreground">Escolher arquivo .xlsx</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  ou arraste o arquivo para cá · até {LIMITE_PLANILHA_ROTULO} · com várias abas, você
                  escolhe depois
                </span>
              </span>
              <span className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground">
                Procurar
              </span>
            </label>
            <input
              ref={inputRef}
              id="arquivo-da-planilha"
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                void receberArquivo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {erro && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
            <FormatoDaPlanilha modelo={modeloPlanilha} interno={interno} orcamentoId={orcamentoId} />
          </div>
        )}

        {(etapa === "enviando" || etapa === "lendo" || etapa === "gravando") && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-california-red/30 border-t-california-red" />
            <p className="text-sm text-muted-foreground">
              {etapa === "enviando"
                ? "Enviando o arquivo..."
                : etapa === "lendo"
                  ? "Lendo a planilha..."
                  : textoGravando}
            </p>
          </div>
        )}

        {conferindo && envio && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,34fr)_minmax(0,36fr)]">
            <div className="min-h-0 space-y-4 overflow-y-auto border-r border-border p-6">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
                <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-california-red" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground" title={envio.nome}>
                    {envio.nome}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {leitura.abas.length} {leitura.abas.length === 1 ? "aba" : "abas"} ·{" "}
                    {(envio.tamanho / 1024).toFixed(0)} KB
                  </p>
                </div>
              </div>
              <TabelaDeAbas abas={leitura.abas} selecionada={aba} onSelecionar={escolherAba} />
            </div>
            <div className="min-h-0 space-y-5 overflow-y-auto p-6">
              {erro && (
                <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}
              <ResumoDaAba
                preview={preview}
                origemPlanejado={origem}
                onOrigemPlanejado={setOrigem}
                interno={interno}
                mensal={modeloPlanilha === "mensal"}
                mostrarHonorarios={mostrarHonorarios}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={() => mudarAberto(false)}
            disabled={etapa === "gravando"}
            className={cn(BTN_SEC, "disabled:opacity-50")}
          >
            Cancelar
          </button>
          {conferindo && (
            <button
              type="button"
              onClick={() => (apaga ? setCerteza(true) : void executarGravacao())}
              className={BTN_PRI}
            >
              <CheckCircle2 className="h-4 w-4" />
              {rotuloGravar}
            </button>
          )}
        </div>

        {confirmarSubstituicao && preview && (
          <Dialog open={certeza} onOpenChange={setCerteza}>
            <DialogContent className="z-[60] max-w-[500px]" overlayClassName="z-[60]">
              <div className="flex items-start gap-4">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-california-red/10">
                  <AlertTriangle className="h-5 w-5 text-california-red" />
                </span>
                <div className="space-y-2">
                  <DialogTitle className="text-base leading-snug">
                    Substituir o conteúdo da {confirmarSubstituicao.versao}?
                  </DialogTitle>
                  <DialogDescription className="leading-relaxed">
                    {confirmacaoTexto(confirmarSubstituicao, preview.grupos.length, preview.grupos.reduce((s, g) => s + g.itens_count, 0), aba)}
                  </DialogDescription>
                  {confirmarSubstituicao.bvs > 0 && (
                    <p className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-[13px] text-california-red">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                      <span>
                        {confirmarSubstituicao.bvs === 1
                          ? "O BV lançado nesses itens também é apagado."
                          : `Os ${confirmarSubstituicao.bvs} BVs lançados nesses itens também são apagados.`}
                      </span>
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex justify-end gap-3">
                <button type="button" onClick={() => setCerteza(false)} className={BTN_SEC}>
                  Voltar
                </button>
                <button type="button" onClick={() => void executarGravacao()} className={BTN_PRI}>
                  <Trash2 className="h-4 w-4" />
                  Apagar e importar
                </button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function confirmacaoTexto(
  atual: { grupos: number; itens: number },
  gruposNovos: number,
  itensNovos: number,
  aba: string,
): string {
  return `Esta versão perde ${plural(atual.grupos, "grupo", "grupos")} e ${plural(atual.itens, "item", "itens")}, e recebe no lugar ${plural(gruposNovos, "grupo", "grupos")} e ${plural(itensNovos, "item", "itens")} da aba ${aba}. Não há como desfazer.`;
}
