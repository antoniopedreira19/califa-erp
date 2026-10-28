"use client";

/**
 * A barra da errata — o rodapé fixo que aparece com o modo ligado.
 *
 * Ela existe porque a edição agora acontece na planilha inteira, que é
 * alta: quem está corrigindo a última linha de um job de 40 itens não vê
 * o topo da tela. Os dois números que a errata move — faturamento previsto
 * e valor do job — precisam estar sempre à vista, junto do botão que grava.
 *
 * Do design `Planilha Interna - Alterar Orcado (Errata).dc.html` (projeto
 * Claude Design `69342d83`), 27/08/2026.
 */

import * as React from "react";
import { AlertCircle, FilePenLine, X, Undo2, Send } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

interface ParDeValores {
  antes: number;
  depois: number;
}

interface Props {
  resumo: string;
  temMudanca: boolean;
  faturamento: ParDeValores;
  valorJob: ParDeValores;
  moeda: string;
  onDescartar: () => void;
  /** Volta um passo do rascunho. O mesmo que Cmd+Z / Ctrl+Z. */
  onDesfazer: () => void;
  podeDesfazer: boolean;
  onConfirmar: () => void;
  /** Quem está na errata (decisão 159): o GP e o administrador REGISTRAM —
   *  enviam ao financeiro; o produtor PREPARA — deixa a errata pronta para
   *  um GP enviar. */
  modo: "registra" | "prepara";
  /** A errata aberta é uma errata pronta para envio: quem a preparou e
   *  quando. `null` na errata começada agora. */
  pronta: { autorNome: string; quando: string } | null;
  /** A errata só reorganiza a planilha (decisão 162): nenhum valor muda. Ela
   *  devolve o job ao mural como qualquer errata. */
  soOrganizacao: boolean;
  /** Decisão 226: a linha vermelha nova não é errata. "so": o rascunho só
   *  tem ela — o botão salva direto, sem pop-up; "junto": ela vai com uma
   *  errata e entra fora dela. */
  vermelhas: "nenhuma" | "so" | "junto";
  /** Salvando só a linha vermelha (que não passa pelo pop-up). */
  salvando: boolean;
  /** O erro de salvar só a linha vermelha. */
  erro: string | null;
}

/** Custo que sobe é laranja, custo que desce é verde — a mesma leitura do
 *  resto do produto. Zero fica neutro. */
function corDoDelta(delta: number): string {
  if (delta > 0) return "text-[#c2410c]";
  if (delta < 0) return "text-[#047857]";
  return "text-muted-foreground";
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (v === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

function Par({
  rotulo,
  par,
  moeda,
}: {
  rotulo: string;
  par: ParDeValores;
  moeda: string;
}) {
  // O delta é a diferença entre os DOIS VALORES QUE O JOB PASSA A TER, e
  // não entre os intermediários da conta: `jobs.faturamento_previsto` e
  // `jobs.valor_total` são gravados com duas casas, e é sobre eles que a
  // errata fica registrada. Subtrair os números crus fazia a barra mostrar
  // "R$ 20.504,54 → R$ 24.605,44 +R$ 4.100,91" — um delta que não fecha
  // com os dois valores ao lado dele, porque o gross-up caiu em meio
  // centavo. Arredondar antes de subtrair faz os três números sempre
  // fecharem, e é o mesmo que o card de Erratas já faz ao ler as colunas
  // gravadas (31/08/2026).
  const centavos = (n: number) => Math.round(n * 100);
  const delta = (centavos(par.depois) - centavos(par.antes)) / 100;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(par.antes, moeda)}
        </span>
        <span className="font-mono text-[13px] font-bold text-foreground">
          {formatCurrency(par.depois, moeda)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {comSinal(delta, moeda)}
        </span>
      </div>
    </div>
  );
}

export function ErrataBarra({
  resumo,
  temMudanca,
  faturamento,
  valorJob,
  moeda,
  onDescartar,
  onConfirmar,
  onDesfazer,
  podeDesfazer,
  modo,
  pronta,
  soOrganizacao,
  vermelhas,
  salvando,
  erro,
}: Props) {
  const prepara = modo === "prepara";
  // O título diz de onde a errata veio; o texto de apoio, o que o botão
  // principal faz — cada papel tem a sua consequência.
  const tituloDaErrata = pronta
    ? prepara
      ? "Errata pronta em edição"
      : "Errata pronta para envio"
    : "Errata em edição";
  const consequencia = soOrganizacao
    ? "Confirmar registra a errata e devolve o job ao mural de abertura. Nenhum valor muda: os itens só são reorganizados."
    : "Confirmar registra a errata, atualiza o faturamento previsto e devolve o job ao mural de abertura.";
  const apoioDaErrata = prepara
    ? "Deixar pronta salva a errata no job para um GP revisar e enviar ao financeiro. Até o envio, nada muda no job."
    : pronta
      ? `Preparada por ${pronta.autorNome} em ${pronta.quando}. ${consequencia}`
      : consequencia;
  // Decisão 226 (28/10/2026): enquanto nada é errata, a barra fica neutra —
  // a linha vermelha entra direto; o resto vira errata.
  const neutra = !pronta && !temMudanca;
  const titulo = neutra || vermelhas === "so" ? "Planilha em edição" : tituloDaErrata;
  const apoio = neutra
    ? prepara
      ? "Linha vermelha entra direto na planilha. Mudar valor, criar item, cancelar linha ou reorganizar fica pronto para um GP enviar."
      : "Linha vermelha entra direto na planilha. Mudar valor, criar item, cancelar linha ou reorganizar vira errata."
    : vermelhas === "so"
      ? "Salvar põe a linha na planilha na hora. Não é errata: o job não volta ao mural e a PP dela já pode ser gerada e enviada."
      : vermelhas === "junto"
        ? `${apoioDaErrata} ${prepara ? "A linha vermelha entra na hora, sem esperar o GP." : "A linha vermelha entra fora da errata."}`
        : apoioDaErrata;
  const rotuloDoBotao =
    neutra
      ? "Salvar"
      : vermelhas === "so"
        ? salvando
          ? "Salvando…"
          : resumo.startsWith("1 ")
            ? "Salvar linha vermelha"
            : "Salvar linhas vermelhas"
        : prepara
          ? pronta
            ? "Salvar errata pronta"
            : "Deixar pronta para envio"
          : "Confirmar errata";
  return (
    // `sticky` e não `fixed`: a barra pertence à planilha, e a sidebar do
    // app não pode ficar por baixo dela. Fica colada no pé da janela
    // enquanto a planilha rola, e some junto com ela.
    <div className="sticky bottom-0 z-30 -mx-1 mt-2 rounded-2xl border border-california-red/30 bg-card/95 px-4 py-3 shadow-elevated backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg bg-california-red/10 p-1.5">
            <FilePenLine className="h-4 w-4 text-california-red" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              {titulo} · {resumo}
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {apoio}
            </p>
            {erro && (
              <p role="alert" className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-california-red">
                <AlertCircle className="h-3.5 w-3.5 flex-none" />
                {erro}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <Par rotulo="Faturamento previsto" par={faturamento} moeda={moeda} />
          <Par rotulo="Valor do job" par={valorJob} moeda={moeda} />

          <div className="flex items-center gap-2">
            {/* Desfazer antes de Descartar: um volta um passo, o outro
                joga tudo fora. Sem ele, uma linha removida por engano só
                tinha a saída destrutiva — a errata inteira ia junto. */}
            <button
              type="button"
              onClick={onDesfazer}
              disabled={!podeDesfazer}
              title="Desfazer o último passo (Cmd+Z / Ctrl+Z)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Desfazer
            </button>
            {/* Na errata pronta, "Descartar" daria a entender que a errata
                pronta vai embora: aqui ele só sai do modo errata, e a
                pronta continua como estava. Descartar a pronta é pela faixa. */}
            <button
              type="button"
              onClick={onDescartar}
              title={
                pronta
                  ? "Sai da errata sem guardar o que mudou agora. A errata pronta continua como estava."
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              {pronta ? "Fechar" : "Descartar"}
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={!temMudanca || salvando}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {prepara && vermelhas !== "so" && !neutra ? (
                <Send className="h-3.5 w-3.5" />
              ) : (
                <FilePenLine className="h-3.5 w-3.5" />
              )}
              {rotuloDoBotao}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
