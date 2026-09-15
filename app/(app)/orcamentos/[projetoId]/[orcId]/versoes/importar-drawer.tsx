"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import {
  previewImportacao,
  confirmarImportacao,
  sobrescreverVersaoComPlanilha,
  type PreviewResult,
} from "./importar-actions";

/** O que a importação faz com o conteúdo.
 *
 *  `nova-versao` é a porta da tela do ORÇAMENTO: cria uma v+1 com a
 *  planilha, sem tocar no que existe. `sobrescrever` é a porta da tela da
 *  VERSÃO: troca o conteúdo da versão aberta, apagando grupos, itens e os
 *  BVs deles. Atende o caso "importei a planilha errada, quero a certa no
 *  mesmo lugar" (decisão do time, 13/08/2026).
 *
 *  As duas dividem este componente porque a parte cara — enviar o
 *  arquivo, conferir o preview, ler os avisos — é idêntica. O que muda é
 *  o destino e, em `sobrescrever`, um passo a mais de confirmação. */
export type ModoImportacao = "nova-versao" | "sobrescrever";

interface Props {
  projetoId: string;
  orcamentoId: string;
  /** Modelo do orçamento (decisão 072). Muda as instruções da tela; o
   *  servidor recusa planilha do outro modelo. Obrigatório. */
  modeloPlanilha: CategoriaModeloPlanilha;
  disabled?: boolean;
  disabledReason?: string;
  modo?: ModoImportacao;
  /** Obrigatório em `sobrescrever`: a versão que vai receber a planilha. */
  versaoId?: string;
  /** O que existe hoje na versão, para a confirmação dizer o tamanho do
   *  estrago em número, não em advérbio. */
  conteudoAtual?: { grupos: number; itens: number; bvs: number };
  /** Controle externo. O menu "+" das abas do orçamento abre este drawer
   *  sem ter um gatilho próprio para clicar. */
  aberto?: boolean;
  onAbertoChange?: (aberto: boolean) => void;
  /** Esconde o botão-gatilho: quem abre é quem controla. */
  semGatilho?: boolean;
}

type Preview = Extract<PreviewResult, { ok: true }>["preview"];

type Stage = "select" | "loading" | "preview" | "saving";

export function ImportarPlanilhaDrawer({
  projetoId,
  orcamentoId,
  modeloPlanilha,
  disabled,
  disabledReason,
  modo = "nova-versao",
  versaoId,
  conteudoAtual,
  aberto,
  onAbertoChange,
  semGatilho,
}: Props) {
  const sobrescreve = modo === "sobrescrever";
  const internacional = modeloPlanilha === "internacional";
  // Fee e Always On (decisão 078): um bloco por mês na planilha.
  const mensal = modeloPlanilha === "mensal";
  const router = useRouter();
  const [openInterno, setOpenInterno] = React.useState(false);
  const open = aberto ?? openInterno;
  const setOpen = onAbertoChange ?? setOpenInterno;
  const [stage, setStage] = React.useState<Stage>("select");
  const [erro, setErro] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  // Em `sobrescrever`, confirmar o preview não grava: abre o aviso do que
  // será apagado. Ninguém perde uma planilha por um clique só.
  const [confirmandoTroca, setConfirmandoTroca] = React.useState(false);
  // De onde vem o planejado da versão (decisão do Tiago, 14/09/2026).
  // Sugerido pelo arquivo quando o preview chega; quem importa confirma.
  const [origemPlanejado, setOrigemPlanejado] = React.useState<
    "anterior" | "planilha"
  >("planilha");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setStage("select");
    setErro(null);
    setPreview(null);
    setArquivo(null);
    setConfirmandoTroca(false);
    setOrigemPlanejado("planilha");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivo(file);
    setErro(null);
    setStage("loading");

    const fd = new FormData();
    fd.set("arquivo", file);
    // No sobrescrever, o planejado anterior é o da própria versão.
    if (sobrescreve && versaoId) fd.set("versao_id", versaoId);
    const res = await previewImportacao(orcamentoId, fd);

    if (!res.ok) {
      setErro(res.message);
      setStage("select");
      return;
    }

    setPreview(res.preview);
    // Planilha só com o orçado sugere manter o planejado da anterior; a
    // que traz planejado sugere o dela.
    setOrigemPlanejado(
      res.preview.planejado.versao_anterior !== null &&
        !res.preview.planejado.planilha_tem_planejado
        ? "anterior"
        : "planilha",
    );
    setStage("preview");
  }

  async function handleConfirm() {
    if (!arquivo) return;
    // Sobrescrever apaga dado: o botão do preview só abre o aviso.
    if (sobrescreve && !confirmandoTroca) {
      setConfirmandoTroca(true);
      return;
    }
    setStage("saving");
    setErro(null);

    const fd = new FormData();
    fd.set("arquivo", arquivo);
    fd.set("origem_planejado", origemPlanejado);
    const res =
      sobrescreve && versaoId
        ? await sobrescreverVersaoComPlanilha(versaoId, fd)
        : await confirmarImportacao(orcamentoId, fd);

    if (!res.ok) {
      setErro(res.message);
      setConfirmandoTroca(false);
      setStage("preview");
      return;
    }

    setOpen(false);
    reset();
    // Sobrescrevendo já estamos na versão certa — só recarregar. Criando,
    // é preciso ir até a versão nova.
    if (!sobrescreve) {
      router.push(`/orcamentos/${projetoId}/${res.orcamento_id}?v=${res.versao_id}`);
    }
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      {!semGatilho && (
        <DialogTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground shadow-sm hover:border-california-red/40 hover:text-california-red transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="h-3.5 w-3.5" />
            Importar planilha
          </button>
        </DialogTrigger>
      )}
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>
            {sobrescreve
              ? "Importar planilha nesta versão"
              : "Importar planilha de orçamento"}
          </DialogTitle>
          <DialogDescription>
            {internacional
              ? "Envie o arquivo .xlsx no modelo internacional (SHEET · ITEM · TT USD · BRL · QT · D/M · TT BRL). "
              : mensal
                ? <>Envie a planilha exportada deste orçamento ou a planilha interna da agência, com um bloco por mês.{" "}</>
                : <>Envie o arquivo .xlsx no formato padrão da agência (aba &ldquo;Padrão&rdquo;).{" "}</>}
            {sobrescreve
              ? "O conteúdo atual da versão será substituído pelo da planilha."
              : "Uma nova versão é criada em rascunho com os grupos e itens da planilha."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {stage === "select" && (
              <div className="space-y-4">
                <label
                  htmlFor="arquivo"
                  className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-muted/20 px-6 py-12 text-center cursor-pointer hover:border-california-red/40 hover:bg-california-red/5 transition-colors"
                >
                  <FileSpreadsheet className="h-10 w-10 text-california-red/70" />
                  <div>
                    <p className="font-semibold text-foreground">
                      Escolher arquivo .xlsx
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {internacional
                        ? "Até 5 MB · planilha internacional"
                        : mensal
                          ? "Até 5 MB · um bloco por mês"
                          : <>Até 5 MB · aba &ldquo;Padrão&rdquo; da planilha da agência</>}
                    </p>
                  </div>
                </label>
                <input
                  ref={inputRef}
                  id="arquivo"
                  type="file"
                  accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleFileChange}
                />

                {mensal && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-900 space-y-1.5">
                    <p className="font-medium">Orçamento de Fee ou Always On</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>
                        Um <b>bloco por mês</b>, com o título do mês:
                        &ldquo;OUTUBRO DE 2026&rdquo; na planilha exportada ou
                        &ldquo;OUTUBRO - …&rdquo; na planilha interna. Os grupos
                        do bloco entram naquele mês.
                      </li>
                      <li>
                        Os meses <b>não mudam pela planilha</b>: mês do trimestre que
                        o orçamento não tem, ou mês do orçamento sem bloco, recusa a
                        importação. Crie ou apague meses em &ldquo;Editar meses&rdquo;.
                      </li>
                      <li>Blocos de meses fora do trimestre do orçamento ficam de fora, com aviso.</li>
                      <li>
                        Na planilha interna, R$, QT, DIAS e o planejado são achados
                        pelo cabeçalho, e o fechamento de cada mês é ignorado.
                      </li>
                    </ul>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5">
                  <p className="font-medium text-foreground">Como o parser lê:</p>
                  {internacional ? (
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>
                        <b>Grupo</b>: coluna A · SHEET, repetida em cada item ou numa
                        linha de grupo.
                      </li>
                      <li>
                        <b>Item</b>: coluna B com o nome do item.
                      </li>
                      <li>
                        Colunas D · BRL (unitário), E · QT, F · D/M. TT USD e TT BRL
                        são calculados e não são lidos.
                      </li>
                      <li>
                        A planilha não tem tipo de custo: todo item entra como{" "}
                        <b>B · Bi-trib.</b> — ajuste na tela depois.
                      </li>
                      <li>
                        Item sem BRL entra com <b>R$ 0,00</b>; QT e D/M vazios ou zerados
                        entram como 1, com aviso.
                      </li>
                      <li>
                        Bloco <b>PLANEJADO</b> entra pelas colunas H · R$, I · QT, J · D/M.
                      </li>
                      <li>
                        O fechamento (TOTAL, FEE, INT TAXES…) e o câmbio do rodapé são
                        ignorados: câmbio e parâmetros são os da versão.
                      </li>
                    </ul>
                  ) : (
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>
                      <b>Grupo</b>: coluna A · CATEGORIA, repetida em cada item. É ela
                      que define o agrupamento.
                    </li>
                    <li>
                      <b>Item</b>: coluna B com o nome do item.
                    </li>
                    <li>
                      Colunas C · R$, D · QT, E · D/M, G · tipo de custo.
                    </li>
                    <li>
                      Item sem R$ entra com <b>R$ 0,00</b>; QT e D/M vazios ou zerados
                      entram como 1, com aviso.
                    </li>
                    <li>
                      Tipo fora de <b>A, AR, B, C, D, F, FI</b> deixa a linha de fora, com aviso.
                    </li>
                    <li>
                      Bloco <b>PLANEJADO</b> entra pelas colunas H · R$, I · QT, J · D/M.
                    </li>
                    <li>
                      Bloco <b>REALIZADO</b> e linhas de subtotal/total/imposto/faturamento
                      são ignorados. De <b>HONORÁRIOS</b> sai só o percentual (coluna E).
                    </li>
                  </ul>
                  )}
                </div>

                {erro && (
                  <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{erro}</span>
                  </div>
                )}
              </div>
            )}

            {stage === "loading" && (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <span className="h-8 w-8 rounded-full border-2 border-california-red/30 border-t-california-red animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Lendo a planilha...
                </p>
              </div>
            )}

            {stage === "preview" && preview && confirmandoTroca && (
              <AvisoDeSubstituicao
                atual={conteudoAtual}
                itensNovos={preview.linhas_importadas}
                planejadoDaVersao={
                  preview.planejado.versao_anterior !== null &&
                  origemPlanejado === "anterior"
                }
              />
            )}

            {stage === "preview" && preview && !confirmandoTroca && (
              <PreviewPanel
                preview={preview}
                arquivoNome={arquivo?.name ?? ""}
                origemPlanejado={origemPlanejado}
                onOrigemPlanejado={setOrigemPlanejado}
                mensal={mensal}
              />
            )}

            {stage === "saving" && (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <span className="h-8 w-8 rounded-full border-2 border-california-red/30 border-t-california-red animate-spin" />
                <p className="text-sm text-muted-foreground">
                  {sobrescreve
                    ? "Substituindo o conteúdo da versão..."
                    : "Criando a versão e gravando os itens..."}
                </p>
              </div>
            )}

            {stage === "preview" && erro && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            {stage === "preview" && confirmandoTroca && (
              <button
                type="button"
                onClick={() => setConfirmandoTroca(false)}
                className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
              >
                Voltar ao resumo
              </button>
            )}
            {stage === "preview" && (
              <button
                type="button"
                onClick={handleConfirm}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
              >
                {confirmandoTroca ? (
                  <Trash2 className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {sobrescreve
                  ? confirmandoTroca
                    ? "Apagar e importar"
                    : "Substituir conteúdo da versão"
                  : "Criar versão importada"}
              </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Dialog>
  );
}

/** O passo que fica entre o preview e a escrita, só em `sobrescrever`.
 *
 *  A regra do time é que ninguém perca planilha por engano, então este
 *  painel diz em NÚMERO o que vai embora — inclusive os BVs, que são a
 *  parte que o usuário não vê na planilha e nunca lembraria sozinho. */
function AvisoDeSubstituicao({
  atual,
  itensNovos,
  planejadoDaVersao,
}: {
  atual?: { grupos: number; itens: number; bvs: number };
  itensNovos: number;
  /** A escolha foi manter o planejado desta versão nas linhas casadas. */
  planejadoDaVersao: boolean;
}) {
  const grupos = atual?.grupos ?? 0;
  const itens = atual?.itens ?? 0;
  const bvs = atual?.bvs ?? 0;
  const vazia = grupos === 0 && itens === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-california-red/30 bg-california-red/5 px-5 py-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-california-red" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-california-red">
            {vazia
              ? "Esta versão está vazia — nada será apagado."
              : "Isto apaga tudo o que já está nesta versão."}
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {vazia
              ? "A planilha entra direto, sem substituir nada."
              : "A planilha enviada substitui o conteúdo atual por completo. Não há como desfazer."}
          </p>
        </div>
      </div>

      {!vazia && (
        <dl className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          <LinhaDoEstrago rotulo="Grupos" valor={grupos} />
          <LinhaDoEstrago rotulo="Itens" valor={itens} />
          <LinhaDoEstrago
            rotulo="BVs lançados nesses itens"
            valor={bvs}
            detalhe={
              bvs > 0
                ? "O BV pertence ao item: sem o item, ele deixa de existir."
                : undefined
            }
          />
        </dl>
      )}

      <p className="text-[13px] text-muted-foreground">
        No lugar entram{" "}
        <strong className="text-foreground">{itensNovos} itens</strong> da
        planilha. Alíquota, honorários, moeda e câmbio da versão{" "}
        <strong className="text-foreground">não mudam</strong>.
      </p>
      <p className="text-[13px] text-muted-foreground">
        {planejadoDaVersao
          ? "O planejado desta versão continua nas linhas casadas; as demais entram zeradas."
          : "O planejado vem da planilha."}
      </p>
    </div>
  );
}

function OpcaoPlanejado({
  marcado,
  onEscolher,
  titulo,
  detalhe,
}: {
  marcado: boolean;
  onEscolher: () => void;
  titulo: string;
  detalhe: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        marcado
          ? "border-california-red/40 bg-california-red/5"
          : "border-border hover:bg-accent",
      )}
    >
      <input
        type="radio"
        name="origem-planejado"
        checked={marcado}
        onChange={onEscolher}
        className="mt-0.5 accent-california-red"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{detalhe}</span>
      </span>
    </label>
  );
}

function LinhaDoEstrago({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: number;
  detalhe?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-3">
      <div>
        <dt className="text-sm font-medium text-foreground">{rotulo}</dt>
        {detalhe && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{detalhe}</p>
        )}
      </div>
      <dd
        className={cn(
          "font-mono text-sm font-bold",
          valor > 0 ? "text-california-red" : "text-muted-foreground",
        )}
      >
        {valor > 0 ? `− ${valor}` : "0"}
      </dd>
    </div>
  );
}

function PreviewPanel({
  preview,
  arquivoNome,
  origemPlanejado,
  onOrigemPlanejado,
  mensal,
}: {
  preview: Preview;
  arquivoNome: string;
  origemPlanejado: "anterior" | "planilha";
  onOrigemPlanejado: (origem: "anterior" | "planilha") => void;
  /** Fee e Always On (decisão 078): o planejado da planilha interna não
   *  mora nas colunas fixas — o texto da opção diz de onde ele vem. */
  mensal: boolean;
}) {
  const p = preview.planejado;
  const perguntar = p.versao_anterior !== null;
  const herdando = perguntar && origemPlanejado === "anterior";
  const planejadoDoGrupo = (g: Preview["grupos"][number]) =>
    herdando ? g.total_planejado_herdado : g.total_planejado;
  const totalOrcadoGeral = preview.grupos.reduce((s, g) => s + g.total_bruto, 0);
  const totalPlanejadoGeral = preview.grupos.reduce(
    (s, g) => s + planejadoDoGrupo(g),
    0,
  );
  const semPar = p.total_itens - p.casadas;
  const totalItens = preview.grupos.reduce((s, g) => s + g.itens_count, 0);
  const temPlanejado = totalPlanejadoGeral > 0;
  const rentabilidadeGeral = totalOrcadoGeral - totalPlanejadoGeral;
  const ajustes = preview.warnings.filter((w) => w.severidade === "ajuste");
  const ignoradas = preview.warnings.filter((w) => w.severidade === "ignorada");

  return (
    <div className="space-y-5">
      {/* Cabeçalho do arquivo */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <FileSpreadsheet className="h-5 w-5 text-california-red shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <TruncateTooltip
            as="p"
            text={arquivoNome}
            className="font-medium text-foreground"
          />
          <p className="text-xs text-muted-foreground">
            Aba lida: <b className="text-foreground">{preview.aba}</b> ·{" "}
            {(preview.arquivo_tamanho / 1024).toFixed(0)} KB
          </p>
        </div>
      </div>

      {perguntar && (
        <fieldset className="space-y-2 rounded-xl border border-border p-4">
          <legend className="px-1 text-xs font-semibold text-foreground">
            Planejado
          </legend>
          <OpcaoPlanejado
            marcado={origemPlanejado === "anterior"}
            onEscolher={() => onOrigemPlanejado("anterior")}
            titulo={`Manter o planejado da v${p.versao_anterior}`}
            detalhe={`${p.casadas} de ${p.total_itens} ${
              p.total_itens === 1 ? "linha casada" : "linhas casadas"
            } com a v${p.versao_anterior}${
              p.por_descricao > 0
                ? ` (${p.por_descricao} pela descrição, sem o id da exportação)`
                : ""
            }.${
              semPar > 0
                ? ` ${semPar === 1 ? "A outra entra zerada" : `As outras ${semPar} entram zeradas`}.`
                : ""
            }`}
          />
          <OpcaoPlanejado
            marcado={origemPlanejado === "planilha"}
            onEscolher={() => onOrigemPlanejado("planilha")}
            titulo="Usar o planejado da planilha"
            detalhe={
              p.planilha_tem_planejado
                ? mensal
                  ? "Os valores do bloco PLANEJADO da planilha — na planilha interna, pelas colunas do cabeçalho."
                  : "Os valores das colunas H · R$, I · QT e J · D/M."
                : "A planilha só tem o orçado: o planejado de todas as linhas fica zerado."
            }
          />
        </fieldset>
      )}

      {/* Contagens */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Grupos" value={preview.grupos.length} />
        <Stat label="Itens" value={totalItens} />
      </div>
      <div className={`grid gap-3 ${temPlanejado ? "grid-cols-3" : "grid-cols-1"}`}>
        <Stat
          label="Total orçado"
          value={formatCurrency(totalOrcadoGeral, "BRL")}
          mono
        />
        {temPlanejado && (
          <>
            <Stat
              label="Total planejado"
              value={formatCurrency(totalPlanejadoGeral, "BRL")}
              mono
            />
            <Stat
              label="Rentabilidade"
              value={formatCurrency(rentabilidadeGeral, "BRL")}
              mono
              valueClassName={
                rentabilidadeGeral >= 0
                  ? "text-emerald-700"
                  : "text-california-red"
              }
            />
          </>
        )}
      </div>

      {preview.percentual_honorarios !== null &&
      preview.percentual_honorarios !== preview.percentual_honorarios_cliente ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          A planilha traz{" "}
          <b>{preview.percentual_honorarios.toString().replace(".", ",")}%</b>{" "}
          de honorários, mas a versão vai nascer com{" "}
          <b>
            {preview.percentual_honorarios_cliente
              .toString()
              .replace(".", ",")}
            %
          </b>{" "}
          — o percentual do cadastro de {preview.cliente_nome}. Para usar
          outro, um administrador altera pelo &quot;Editar&quot; da versão
          depois de criada.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          Honorários da versão:{" "}
          <b className="text-foreground">
            {preview.percentual_honorarios_cliente.toString().replace(".", ",")}
            %
          </b>{" "}
          — do cadastro de {preview.cliente_nome}.
        </div>
      )}

      {/* Grupos */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-muted/40 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          Grupos que serão criados
        </div>
        <ul className="divide-y divide-border">
          {preview.grupos.map((g) => {
            const planejadoGrupo = planejadoDoGrupo(g);
            const rentab = g.total_bruto - planejadoGrupo;
            const grupoTemPlan = planejadoGrupo > 0;
            return (
              <li
                key={`${g.ordem}-${g.nome}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <TruncateTooltip
                  as="span"
                  text={g.nome}
                  className="font-medium text-foreground flex-1 min-w-0"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {g.itens_count} {g.itens_count === 1 ? "item" : "itens"}
                </span>
                <span
                  className="font-mono text-xs whitespace-nowrap"
                  title="Total orçado"
                >
                  {formatCurrency(g.total_bruto, "BRL")}
                </span>
                {grupoTemPlan ? (
                  <>
                    <span
                      className="font-mono text-xs whitespace-nowrap text-blue-800"
                      title="Total planejado"
                    >
                      {formatCurrency(planejadoGrupo, "BRL")}
                    </span>
                    <span
                      className={
                        "font-mono text-xs whitespace-nowrap font-semibold " +
                        (rentab >= 0 ? "text-emerald-700" : "text-california-red")
                      }
                      title="Rentabilidade (orçado − planejado)"
                    >
                      {formatCurrency(rentab, "BRL")}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground/60 w-20 text-right">
                      —
                    </span>
                    <span className="text-xs text-muted-foreground/60 w-20 text-right">
                      —
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Warnings */}
      {(ajustes.length > 0 || ignoradas.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {ajustes.length} {ajustes.length === 1 ? "ajuste" : "ajustes"}
            {ignoradas.length > 0 && (
              <>
                {" · "}
                {ignoradas.length}{" "}
                {ignoradas.length === 1 ? "linha ignorada" : "linhas ignoradas"}
              </>
            )}
          </div>
          <ul className="divide-y divide-amber-200/70 max-h-52 overflow-y-auto">
            {[...ajustes, ...ignoradas].slice(0, 40).map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-2 px-4 py-2 text-xs text-amber-900"
              >
                <Badge
                  className={
                    w.severidade === "ignorada"
                      ? "bg-amber-200 text-amber-900 border-amber-300"
                      : "bg-amber-100 text-amber-800 border-amber-200"
                  }
                >
                  L{w.linha}
                  {w.coluna ? `·${w.coluna}` : ""}
                </Badge>
                <span className="flex-1">{w.motivo}</span>
              </li>
            ))}
            {ajustes.length + ignoradas.length > 40 && (
              <li className="px-4 py-2 text-xs text-amber-800/70">
                + {ajustes.length + ignoradas.length - 40} outros avisos
                omitidos.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono = false,
  valueClassName,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold ${mono ? "font-mono" : ""} ${
          valueClassName ?? "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
