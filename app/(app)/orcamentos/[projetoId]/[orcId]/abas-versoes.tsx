"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus,
  Plus,
  Upload,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { nomeVersao } from "@/lib/nome-versao";
import type { VersaoOrcamentoStatus } from "@/lib/types";
import { duplicarVersao } from "./versoes/actions";
import { NovaVersaoDrawer } from "./versoes/nova-versao-drawer";
import { ImportarPlanilhaDrawer } from "./versoes/importar-drawer";

export interface VersaoAba {
  id: string;
  numero_versao: number;
  status: VersaoOrcamentoStatus;
  itens_count: number;
  itens_total: number;
  percentual_honorarios: number;
  moeda: string;
}

interface Props {
  projetoId: string;
  orcamentoId: string;
  /** `orcamentos.nome` — o nome do job, que compõe o nome da versão. */
  nomeJob: string;
  /** Já ordenadas da mais nova para a mais antiga. */
  versoes: VersaoAba[];
  ativaId: string | null;
  podeCriarVersao: boolean;
  motivoBloqueio?: string;
  honorariosCliente: number;
  clienteNome: string | null;
}

type Menu = null | "raiz" | "copiar";

/**
 * As versões do orçamento como abas.
 *
 * Substituiu o card "Versões do orçamento", que era uma lista onde cada
 * linha levava a outra página. Comparar v4 com v5 custava duas navegações
 * e a volta pelo cabeçalho; em abas custa um clique, e a planilha da
 * versão fica na mesma tela do orçamento que a contém.
 *
 * A aba ativa vive na URL (`?v=<id>`), e não em estado de cliente: é o que
 * mantém o link de uma versão específica funcionando — os módulos de job e
 * financeiro apontam para a versão aprovada — e o que faz o recarregar da
 * página cair na mesma aba.
 *
 * O `+` à esquerda concentra as três portas de criação que antes eram dois
 * botões no cabeçalho do card mais o ícone de duplicar de cada linha.
 */
export function AbasVersoes({
  projetoId,
  orcamentoId,
  nomeJob,
  versoes,
  ativaId,
  podeCriarVersao,
  motivoBloqueio,
  honorariosCliente,
  clienteNome,
}: Props) {
  const [menu, setMenu] = React.useState<Menu>(null);
  const [novaAberta, setNovaAberta] = React.useState(false);
  const [importarAberto, setImportarAberto] = React.useState(false);
  const [duplicando, setDuplicando] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const ancoraRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menu) return;

    function onMouseDown(e: MouseEvent) {
      if (!ancoraRef.current?.contains(e.target as Node)) setMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  // As abas chegam ordenadas do maior número para o menor, então a mais
  // recente é SEMPRE a primeira da esquerda — e é ela que leva o selo. Não
  // há mais exceção a abrir: desde 21/08/2026 versão fora do jogo é
  // deletada, não marcada como cancelada (decisão 023).
  const maiorNumero = versoes.reduce(
    (maior, v) => Math.max(maior, v.numero_versao),
    0,
  );

  function copiar(versaoId: string) {
    setErro(null);
    setDuplicando(versaoId);
    startTransition(async () => {
      // Sucesso redireciona no SERVIDOR para a versão nova, e aí o cliente
      // recebe `undefined` — testar `res.ok` direto quebra a tela.
      const res = await duplicarVersao(versaoId);
      setDuplicando(null);
      if (res && !res.ok) {
        setErro(res.message);
        return;
      }
      setMenu(null);
    });
  }

  return (
    <div>
      <div className="flex items-end gap-0.5 border-b border-border">
        <div
          ref={ancoraRef}
          className="relative mr-1.5 flex-none border-r border-border pb-1.5 pr-2.5"
        >
          <button
            type="button"
            onClick={() => podeCriarVersao && setMenu((m) => (m ? null : "raiz"))}
            disabled={!podeCriarVersao}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            aria-label="Nova versão"
            title={podeCriarVersao ? "Nova versão" : motivoBloqueio}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              !podeCriarVersao
                ? "cursor-not-allowed text-muted-foreground/40"
                : menu
                  ? "bg-california-red/10 text-california-red"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Plus className="h-[17px] w-[17px]" />
          </button>

          {menu === "raiz" && (
            <div
              role="menu"
              className="absolute left-0 top-[calc(100%+0.25rem)] z-30 w-[340px] rounded-2xl border border-border bg-card p-1.5 text-left shadow-elevated"
            >
              <p className="px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Nova versão
              </p>
              <OpcaoMenu
                icone={<FilePlus className="h-4 w-4 text-california-red" />}
                titulo="Criar do zero"
                descricao="Versão vazia — grupos e itens são adicionados depois."
                onClick={() => {
                  setMenu(null);
                  setNovaAberta(true);
                }}
              />
              <OpcaoMenu
                icone={<Copy className="h-4 w-4 text-california-red" />}
                titulo="Copiar uma versão existente"
                descricao="Duplica grupos, itens, honorários e impostos."
                seta
                desabilitado={versoes.length === 0}
                onClick={() => setMenu("copiar")}
              />
              <div className="mx-2.5 my-1.5 h-px bg-border" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  setImportarAberto(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <Upload className="h-4 w-4 flex-none text-muted-foreground" />
                <span className="text-[13px] font-medium text-foreground">
                  Importar planilha (.xlsx)
                </span>
              </button>
            </div>
          )}

          {menu === "copiar" && (
            <div
              role="menu"
              className="absolute left-0 top-[calc(100%+0.25rem)] z-30 w-[340px] rounded-2xl border border-border bg-card p-1.5 text-left shadow-elevated"
            >
              <div className="flex items-center gap-1.5 px-2 pb-2 pt-1.5">
                <button
                  type="button"
                  onClick={() => setMenu("raiz")}
                  aria-label="Voltar"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Copiar de qual versão?
                </p>
              </div>
              <div className="flex max-h-[264px] flex-col overflow-y-auto">
                {versoes.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => copiar(v.id)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <span className="inline-flex min-w-8 flex-none items-center justify-center rounded-lg bg-california-red/10 px-1.5 py-1 font-mono text-[11.5px] font-bold text-california-red">
                      {duplicando === v.id ? (
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-california-red/30 border-t-california-red" />
                      ) : (
                        `v${v.numero_versao}`
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {nomeVersao(nomeJob, v.numero_versao)}
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {v.itens_count === 1 ? "1 item" : `${v.itens_count} itens`} ·{" "}
                        {formatCurrency(v.itens_total, v.moeda)} · honor.{" "}
                        {String(Number(v.percentual_honorarios)).replace(".", ",")}%
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* A barra de rolagem some: com muitas versões o gesto é arrastar,
            e uma barra horizontal aqui brigaria com a linha do rodapé das
            abas. */}
        <div className="-mb-px flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {versoes.map((v) => {
            const ativa = v.id === ativaId;
            return (
              <Link
                key={v.id}
                href={`/orcamentos/${projetoId}/${orcamentoId}?v=${v.id}`}
                prefetch={false}
                scroll={false}
                aria-current={ativa ? "page" : undefined}
                className={cn(
                  "inline-flex flex-none items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm leading-tight transition-colors",
                  ativa
                    ? "border-california-red font-semibold text-california-red"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="font-mono text-[12.5px] font-bold">
                  v{v.numero_versao}
                </span>
                {v.numero_versao === maiorNumero && (
                  <span className="inline-flex items-center rounded-full bg-california-red px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-white">
                    MAIS RECENTE
                  </span>
                )}
                {v.status === "aprovada" && (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-emerald-700">
                    APROVADA
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {erro && (
        <p className="mt-2 text-xs text-california-red">{erro}</p>
      )}

      {/* Os dois drawers ficam montados sem gatilho: quem os abre é o menu
          acima. Mantê-los aqui preserva os fluxos completos de criação e de
          importação, que já existiam no card antigo. */}
      <NovaVersaoDrawer
        orcamentoId={orcamentoId}
        honorariosCliente={honorariosCliente}
        clienteNome={clienteNome}
        aberto={novaAberta}
        onAbertoChange={setNovaAberta}
        semGatilho
      />
      <ImportarPlanilhaDrawer
        projetoId={projetoId}
        orcamentoId={orcamentoId}
        aberto={importarAberto}
        onAbertoChange={setImportarAberto}
        semGatilho
      />
    </div>
  );
}

function OpcaoMenu({
  icone,
  titulo,
  descricao,
  seta,
  desabilitado,
  onClick,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  seta?: boolean;
  desabilitado?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={desabilitado}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="mt-0.5 flex-none">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-foreground">
          {titulo}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {descricao}
        </span>
      </span>
      {seta && (
        <ChevronRight className="mt-0.5 h-[15px] w-[15px] flex-none text-muted-foreground" />
      )}
    </button>
  );
}
