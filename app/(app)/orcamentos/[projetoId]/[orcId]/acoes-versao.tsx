"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy, Download, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { nomeVersao } from "@/lib/nome-versao";
import { versaoStatusLabel, type VersaoOrcamentoStatus } from "@/lib/types";
import { deletarVersao, duplicarVersao } from "./versoes/actions";

interface Props {
  projetoId: string;
  orcamentoId: string;
  versaoId: string;
  numeroVersao: number;
  status: VersaoOrcamentoStatus;
  nomeJob: string;
  /** Número que a cópia vai receber — só para a confirmação dizer qual é. */
  proximoNumero: number;
  qtdGrupos: number;
  qtdItens: number;
  /** BVs ativos na versão — entram na confirmação do delete, porque somem
   *  junto com os itens e ninguém deveria descobrir isso depois. */
  qtdBvs: number;
  /** Quantas versões o orçamento tem. A última não é deletável. */
  totalVersoes: number;
  /** Orçamento que ainda aceita versão nova (nem job criado, nem cancelado). */
  podeCriarVersao: boolean;
  motivoBloqueio?: string;
}

type Popover = null | "exportar" | "duplicar";

/**
 * Exportar, Duplicar e Cancelar — as três ações que incidem sobre a ABA
 * selecionada, e não sobre o orçamento.
 *
 * Ficam no cabeçalho, ao lado do "Editar" do orçamento, como no handoff.
 * Como a distinção entre "esta versão" e "este orçamento" não cabe no
 * rótulo de um botão, exportar e duplicar confirmam num popover que diz o
 * nome da versão em que vão mexer. Cancelar usa o `ConfirmDialog` do
 * sistema: é destrutivo, e destrutivo aqui sempre teve o diálogo cheio.
 */
export function AcoesVersao({
  projetoId,
  orcamentoId,
  versaoId,
  numeroVersao,
  status,
  nomeJob,
  proximoNumero,
  qtdGrupos,
  qtdItens,
  qtdBvs,
  totalVersoes,
  podeCriarVersao,
  motivoBloqueio,
}: Props) {
  const router = useRouter();
  const [popover, setPopover] = React.useState<Popover>(null);
  const [confirmandoDeletar, setConfirmandoDeletar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const ancoraRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!popover) return;

    function onMouseDown(e: MouseEvent) {
      if (!ancoraRef.current?.contains(e.target as Node)) setPopover(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPopover(null);
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popover]);

  const rotulo = `v${numeroVersao}`;
  const titulo = nomeVersao(nomeJob, numeroVersao);
  const resumo = `${qtdGrupos} ${qtdGrupos === 1 ? "grupo" : "grupos"} · ${qtdItens} ${qtdItens === 1 ? "item" : "itens"}`;
  // O mesmo conteúdo, em frase — o "·" do resumo lê mal no meio do texto
  // do diálogo de exclusão.
  const conteudo = [
    `${qtdGrupos} ${qtdGrupos === 1 ? "grupo" : "grupos"}`,
    `${qtdItens} ${qtdItens === 1 ? "item" : "itens"}`,
    ...(qtdBvs > 0 ? [`${qtdBvs} ${qtdBvs === 1 ? "BV" : "BVs"}`] : []),
  ];
  const conteudoFrase =
    conteudo.slice(0, -1).join(", ") + " e " + conteudo[conteudo.length - 1];
  const exportHref = `/api/orcamentos/${projetoId}/${orcamentoId}/versoes/${versaoId}/export`;

  // Versão aprovada não mostra o botão — não é "desabilitado com motivo",
  // é uma ação que não existe ali (decisão do Tiago). Apagá-la esvaziaria
  // `orcamentos.versao_aprovada_id` em silêncio; o caminho é "Cancelar
  // aprovação" e só então deletar.
  const mostrarDeletar = status !== "aprovada";
  // A última fica visível e travada: some seria pior, porque o botão
  // apareceria e sumiria conforme se cria versão, sem explicar a regra.
  const ehUnicaVersao = totalVersoes <= 1;

  function handleDuplicar() {
    setErro(null);
    startTransition(async () => {
      // Sucesso redireciona no SERVIDOR para a versão nova, e aí o cliente
      // recebe `undefined` — testar `res.ok` direto quebra a tela.
      const res = await duplicarVersao(versaoId);
      if (res && !res.ok) setErro(res.message);
      // Fecha nos dois casos: o sucesso redireciona para a MESMA rota, só
      // trocando o `?v=`, e o popover ficaria aberto sobre a versão nova.
      setPopover(null);
    });
  }

  function handleDeletar() {
    setErro(null);
    startTransition(async () => {
      const res = await deletarVersao(versaoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmandoDeletar(false);
      // O `?v=` aponta para uma versão que não existe mais: sair dele deixa
      // a tela escolher a aba padrão em vez de tentar abrir um fantasma.
      router.push(`/orcamentos/${projetoId}/${orcamentoId}`);
      router.refresh();
    });
  }

  return (
    <>
      <div ref={ancoraRef} className="relative flex items-center gap-2">
        <BotaoAcao
          icone={<Download className="h-3.5 w-3.5" />}
          rotulo="Exportar"
          ativo={popover === "exportar"}
          onClick={() => setPopover((p) => (p === "exportar" ? null : "exportar"))}
        />
        <BotaoAcao
          icone={<Copy className="h-3.5 w-3.5" />}
          rotulo="Duplicar"
          ativo={popover === "duplicar"}
          desabilitado={!podeCriarVersao}
          motivo={motivoBloqueio}
          onClick={() => setPopover((p) => (p === "duplicar" ? null : "duplicar"))}
        />
        {mostrarDeletar && (
          <BotaoAcao
            icone={<Trash2 className="h-3.5 w-3.5" />}
            rotulo="Deletar versão"
            destrutivo
            desabilitado={ehUnicaVersao}
            motivo="O orçamento precisa de ao menos uma versão."
            onClick={() => setConfirmandoDeletar(true)}
          />
        )}

        {popover && (
          <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-[340px] rounded-2xl border border-border bg-card p-4 shadow-elevated">
            <div className="flex items-center gap-2">
              <span className="inline-flex min-w-8 items-center justify-center rounded-lg bg-california-red/10 px-1.5 py-1 font-mono text-[11.5px] font-bold text-california-red">
                {rotulo}
              </span>
              <p className="text-sm font-semibold text-foreground">
                {popover === "duplicar"
                  ? "Duplicar esta versão?"
                  : "Exportar esta versão?"}
              </p>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {popover === "duplicar"
                ? `A aba selecionada é ${titulo}. Uma nova versão (v${proximoNumero}) será criada com os mesmos grupos, itens, honorários e impostos.`
                : `A planilha será gerada a partir da aba selecionada — ${titulo} · ${versaoStatusLabel(status).toLowerCase()} · ${resumo}.`}
            </p>
            <div className="mt-3.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPopover(null)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancelar
              </button>
              {popover === "duplicar" ? (
                <button
                  type="button"
                  onClick={handleDuplicar}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending && (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  )}
                  Criar v{proximoNumero}
                </button>
              ) : (
                <a
                  href={exportHref}
                  onClick={() => setPopover(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar planilha
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {erro && (
        <span className="inline-flex items-center gap-1.5 text-xs text-california-red">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {erro}
        </span>
      )}

      <ConfirmDialog
        open={confirmandoDeletar}
        onOpenChange={(o) => setConfirmandoDeletar(o)}
        title={`Deletar ${rotulo}?`}
        description={
          <>
            <strong className="text-foreground">{titulo}</strong> será apagada
            do banco, junto com {conteudoFrase}.{" "}
            <strong className="text-foreground">Não há como desfazer.</strong>
          </>
        }
        confirmLabel="Deletar versão"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleDeletar}
      />
    </>
  );
}

function BotaoAcao({
  icone,
  rotulo,
  ativo,
  destrutivo,
  desabilitado,
  motivo,
  onClick,
}: {
  icone: React.ReactNode;
  rotulo: string;
  ativo?: boolean;
  destrutivo?: boolean;
  desabilitado?: boolean;
  motivo?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      title={desabilitado ? motivo : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        destrutivo
          ? "border-border text-muted-foreground hover:border-california-red/40 hover:text-california-red"
          : "border-border text-foreground hover:border-california-red/40 hover:text-california-red",
        ativo && "border-california-red/40 text-california-red",
      )}
    >
      {icone}
      {rotulo}
    </button>
  );
}
