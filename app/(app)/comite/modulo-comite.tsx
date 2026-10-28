"use client";

// Comitê de Aprovações (decisão 223), caixa C do protótipo aprovado: duas
// abas de caixa (Aberturas de job e PPs), com a coluna Motivo, e a aba
// Configurações. A linha abre a planilha do caso num pop-up de tela cheia
// — a própria página do orçamento ou do job, no modo do Comitê, com a
// barra de decisão embaixo.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gavel, Search, X } from "lucide-react";
import { Dialog, DialogTitle, FullscreenContent } from "@/components/ui/dialog";
import {
  BarraDosFiltrosDeColuna,
  celulaTexto,
  celulaValor,
  semAcento,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import { cn, formatCurrency } from "@/lib/utils";
import { formatDataHoraListaBr } from "@/lib/formatar-data-hora";
import { formatarPercentualDoComite, type RegrasDoComite } from "@/lib/calculos/limites-orcamento";
import { roleLabel, type AppRole } from "@/lib/types";
import { Configuracoes } from "./configuracoes";
import {
  MENSAGEM_DECIDIDO,
  type CasoDePP,
  type CasoDeVersao,
  type CasoDoComite,
  type MembroDoComite,
  type UsuarioParaComite,
} from "./tipos";

export type Aba = "jobs" | "pps" | "config";
type Chip = "pendente" | "aprovado" | "devolvido" | "todos";

const brl = (n: number) => formatCurrency(n, "BRL");
const pct = (n: number | null) => (n === null ? "—" : formatarPercentualDoComite(n));


function papelDe(papel: string | null) {
  if (!papel) return "";
  try {
    return roleLabel(papel as AppRole);
  } catch {
    return "";
  }
}

function diasDesde(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function SituacaoDoCaso({ caso }: { caso: CasoDoComite }) {
  if (caso.situacao === "pendente") {
    const dias = diasDesde(caso.enviadoEm);
    const atraso = dias >= 2;
    return (
      <>
        <span className={cn("block text-[12.5px] font-semibold", atraso ? "text-amber-700" : "text-foreground")}>
          Aguardando
        </span>
        <span className={cn("block text-[11px]", atraso ? "text-amber-700" : "text-muted-foreground")}>
          {dias === 0 ? "desde hoje" : dias === 1 ? "há 1 dia" : `há ${dias} dias`}
        </span>
      </>
    );
  }
  const aprovado = caso.situacao === "aprovado";
  return (
    <>
      <span className={cn("block text-[12.5px] font-semibold", aprovado ? "text-emerald-700" : "text-california-red")}>
        {aprovado ? "Aprovado" : "Devolvido"}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground" title={caso.comentario || undefined}>
        {caso.decididoPor} · {formatDataHoraListaBr(caso.decididoEm).split(" · ")[0]}
      </span>
    </>
  );
}

function EnviadoPor({ caso }: { caso: CasoDoComite }) {
  const papel = papelDe(caso.enviadoPorPapel);
  return (
    <>
      <span className="block truncate text-[12.5px]">{caso.enviadoPor}</span>
      <span className="block text-[11px] text-muted-foreground">
        {papel ? `${papel} · ` : ""}
        {formatDataHoraListaBr(caso.enviadoEm)}
      </span>
    </>
  );
}

function Motivo({ caso }: { caso: CasoDoComite }) {
  return (
    <span title={caso.motivo} className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">
      {caso.motivo}
    </span>
  );
}

function SeloLinhaVermelha() {
  return (
    <span
      title="Linha criada pela errata, com orçado zero"
      className="inline-flex flex-none items-center rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-red-700"
    >
      Linha vermelha
    </span>
  );
}

const situacaoCelula = (c: CasoDoComite) =>
  celulaTexto(c.situacao === "pendente" ? "Aguardando" : c.situacao === "aprovado" ? "Aprovado" : "Devolvido");

const COLUNAS_JOBS: ColunaFiltravel<CasoDeVersao>[] = [
  { chave: "orcamento", rotulo: "Orçamento", tipo: "texto", celula: (c) => celulaTexto(c.orcamento) },
  { chave: "projeto", rotulo: "Projeto", tipo: "texto", celula: (c) => celulaTexto(c.projeto) },
  { chave: "empresa", rotulo: "Empresa", tipo: "texto", celula: (c) => celulaTexto(c.empresa) },
  { chave: "regional", rotulo: "Regional", tipo: "texto", celula: (c) => celulaTexto(c.regional) },
  { chave: "valor", rotulo: "Valor do job", tipo: "valor", faixa: true, alinhar: "right", celula: (c) => celulaValor(c.valorJob, brl) },
  {
    chave: "resultado",
    rotulo: "Resultado geral",
    tipo: "valor",
    alinhar: "right",
    celula: (c) => ({
      valor: String(Math.round((c.resultadoGeral ?? 0) * 10)),
      rotulo: pct(c.resultadoGeral),
      ordem: c.resultadoGeral ?? 0,
    }),
  },
  { chave: "motivo", rotulo: "Motivo", tipo: "texto", celula: (c) => celulaTexto(c.motivo) },
  { chave: "pedido", rotulo: "Enviado por", tipo: "texto", celula: (c) => celulaTexto(c.enviadoPor) },
  { chave: "situacao", rotulo: "Situação", tipo: "texto", celula: situacaoCelula },
];

const COLUNAS_PPS: ColunaFiltravel<CasoDePP>[] = [
  { chave: "job", rotulo: "Job", tipo: "texto", celula: (c) => celulaTexto(`${c.jobCodigo} ${c.jobNome}`, c.jobCodigo) },
  { chave: "projeto", rotulo: "Projeto", tipo: "texto", celula: (c) => celulaTexto(c.projeto) },
  { chave: "item", rotulo: "Item · Serviço", tipo: "texto", celula: (c) => celulaTexto(c.item) },
  { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", celula: (c) => celulaTexto(c.fornecedor) },
  { chave: "valor", rotulo: "Valor da PP", tipo: "valor", faixa: true, alinhar: "right", celula: (c) => celulaValor(c.valorPP, brl) },
  { chave: "orcado", rotulo: "Orçado do item", tipo: "valor", faixa: true, alinhar: "right", celula: (c) => celulaValor(c.orcadoItem, brl) },
  {
    chave: "acumulado",
    rotulo: "Realizado com a PP",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (c) => celulaValor(c.realizadoComAPP, brl),
  },
  { chave: "motivo", rotulo: "Motivo", tipo: "texto", celula: (c) => celulaTexto(c.motivo) },
  { chave: "pedido", rotulo: "Enviado por", tipo: "texto", celula: (c) => celulaTexto(c.enviadoPor) },
  { chave: "situacao", rotulo: "Situação", tipo: "texto", celula: situacaoCelula },
];

function Chips({
  chip,
  setChip,
  contagem,
  busca,
  setBusca,
  placeholder,
}: {
  chip: Chip;
  setChip: (c: Chip) => void;
  contagem: Record<Chip, number>;
  busca: string;
  setBusca: (s: string) => void;
  placeholder: string;
}) {
  const ROTULO: Record<Chip, string> = {
    pendente: "Para decidir",
    aprovado: "Aprovados",
    devolvido: "Devolvidos",
    todos: "Todos",
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(ROTULO) as Chip[]).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setChip(c)}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
            chip === c
              ? "border-california-red bg-california-red text-white"
              : "border-border bg-white text-muted-foreground hover:border-california-red/50",
          )}
        >
          {ROTULO[c]}
          <span className={cn("tabular-nums", chip === c ? "text-white/85" : "text-muted-foreground/70")}>{contagem[c]}</span>
        </button>
      ))}
      <div className="relative ml-auto w-80 max-w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
        />
      </div>
    </div>
  );
}

function textoDoCaso(c: CasoDoComite) {
  return semAcento(
    c.tipo === "versao"
      ? `${c.orcamento} ${c.projeto} ${c.cliente}`
      : `${c.jobCodigo} ${c.jobNome} ${c.projeto} ${c.cliente} ${c.item} ${c.servico} ${c.fornecedor}`,
  );
}

function useChipEBusca<T extends CasoDoComite>(casos: T[]) {
  const [chip, setChip] = React.useState<Chip>("pendente");
  const [busca, setBusca] = React.useState("");
  const contagem: Record<Chip, number> = {
    pendente: casos.filter((c) => c.situacao === "pendente").length,
    aprovado: casos.filter((c) => c.situacao === "aprovado").length,
    devolvido: casos.filter((c) => c.situacao === "devolvido").length,
    todos: casos.length,
  };
  const b = semAcento(busca.trim());
  const linhas = React.useMemo(
    () => casos.filter((c) => (chip === "todos" || c.situacao === chip) && (!b || textoDoCaso(c).includes(b))),
    [casos, chip, b],
  );
  return { chip, setChip, busca, setBusca, contagem, linhas };
}

const TH = "px-3 py-3 font-semibold";
const TD = "px-3 py-3";
const TABELA = "w-full table-fixed border-collapse text-[13px]";
const CABECA = "border-b border-border bg-muted/30 text-left text-[10.5px] uppercase tracking-wider text-muted-foreground";
const LINHA = "border-b border-border/70 align-top last:border-0 transition-colors cursor-pointer hover:bg-accent/40";

function Vazio({ texto, colunas }: { texto: string; colunas: number }) {
  return (
    <tr>
      <td colSpan={colunas} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {texto}
      </td>
    </tr>
  );
}

function CaixaJobs({ casos, onAbrir }: { casos: CasoDeVersao[]; onAbrir: (c: CasoDoComite) => void }) {
  const s = useChipEBusca(casos);
  const f = useFiltrosDeColuna(s.linhas, COLUNAS_JOBS, { guardarEm: "comite-jobs" });
  return (
    <div className="space-y-4">
      <Chips {...s} placeholder="Buscar por orçamento, projeto ou cliente" />
      {f.ativo && (
        <BarraDosFiltrosDeColuna visiveis={f.visiveis.length} total={f.total} singular="linha" plural="linhas" onLimpar={f.limpar} />
      )}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className={cn(TABELA, "min-w-[1100px]")}>
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[7%]" />
            <col className="w-[11%]" />
            <col className="w-[9%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
          </colgroup>
          <thead>
            <tr className={CABECA}>
              <th className={TH}>{f.titulo("orcamento")}</th>
              <th className={TH}>{f.titulo("projeto")}</th>
              <th className={TH}>{f.titulo("empresa")}</th>
              <th className={TH}>{f.titulo("regional")}</th>
              <th className={cn(TH, "text-right")}>{f.titulo("valor")}</th>
              <th className={cn(TH, "text-right")}>{f.titulo("resultado")}</th>
              <th className={TH}>{f.titulo("motivo")}</th>
              <th className={TH}>{f.titulo("pedido")}</th>
              <th className={TH}>{f.titulo("situacao")}</th>
            </tr>
          </thead>
          <tbody>
            {f.visiveis.length === 0 && <Vazio colunas={9} texto="Nenhuma abertura de job para decidir." />}
            {f.visiveis.map((c) => {
              const abaixo = c.resultadoGeral !== null && c.resultadoGeral < 20 - 1e-9;
              return (
                <tr key={c.id} className={LINHA} onClick={() => onAbrir(c)}>
                  <td className={TD}>
                    <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{c.orcamento}</span>
                    <span className="block text-[11px] text-muted-foreground">v{c.versao} · job a criar</span>
                  </td>
                  <td className={TD}>
                    <span className="line-clamp-2 text-[12.5px] leading-snug">{c.projeto}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{c.cliente}</span>
                  </td>
                  <td className={cn(TD, "text-[12.5px]")}>{c.empresa}</td>
                  <td className={cn(TD, "text-[12.5px]")}>{c.regional}</td>
                  <td className={cn(TD, "text-right font-mono text-[13px] font-semibold")}>{brl(c.valorJob)}</td>
                  <td className={cn(TD, "text-right")}>
                    <span className={cn("font-mono text-[13px] font-semibold", abaixo ? "text-california-red" : "text-emerald-700")}>
                      {pct(c.resultadoGeral)}
                    </span>
                    {c.itensAcima > 0 && (
                      <span className="block text-[11px] font-semibold text-red-600">
                        {c.itensAcima === 1 ? "1 item acima" : `${c.itensAcima} itens acima`}
                      </span>
                    )}
                    {c.comExcecao && (
                      <span className="block text-[11px] font-semibold text-amber-700">Exceção no fechamento</span>
                    )}
                  </td>
                  <td className={TD}>
                    <Motivo caso={c} />
                  </td>
                  <td className={TD}>
                    <EnviadoPor caso={c} />
                  </td>
                  <td className={TD}>
                    <SituacaoDoCaso caso={c} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CaixaPPs({ casos, onAbrir }: { casos: CasoDePP[]; onAbrir: (c: CasoDoComite) => void }) {
  const s = useChipEBusca(casos);
  const f = useFiltrosDeColuna(s.linhas, COLUNAS_PPS, { guardarEm: "comite-pps" });
  return (
    <div className="space-y-4">
      <Chips {...s} placeholder="Buscar por job, item ou fornecedor" />
      {f.ativo && (
        <BarraDosFiltrosDeColuna visiveis={f.visiveis.length} total={f.total} singular="linha" plural="linhas" onLimpar={f.limpar} />
      )}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className={cn(TABELA, "min-w-[1100px]")}>
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[13%]" />
            <col className="w-[9%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className={CABECA}>
              <th className={TH}>{f.titulo("job")}</th>
              <th className={TH}>{f.titulo("projeto")}</th>
              <th className={TH}>{f.titulo("item")}</th>
              <th className={TH}>{f.titulo("fornecedor")}</th>
              <th className={cn(TH, "text-right")}>{f.titulo("valor")}</th>
              <th className={cn(TH, "text-right")}>{f.titulo("orcado")}</th>
              <th className={cn(TH, "text-right")}>{f.titulo("acumulado")}</th>
              <th className={TH}>{f.titulo("motivo")}</th>
              <th className={TH}>{f.titulo("pedido")}</th>
              <th className={TH}>{f.titulo("situacao")}</th>
            </tr>
          </thead>
          <tbody>
            {f.visiveis.length === 0 && <Vazio colunas={10} texto="Nenhuma PP para decidir." />}
            {f.visiveis.map((c) => (
              <tr key={c.id} className={LINHA} onClick={() => onAbrir(c)}>
                <td className={TD}>
                  <span className="block font-mono text-[11.5px] font-semibold">{c.jobCodigo}</span>
                  <span className="line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{c.jobNome}</span>
                </td>
                <td className={TD}>
                  <span className="line-clamp-2 text-[12.5px] leading-snug">{c.projeto}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.cliente}</span>
                </td>
                <td className={TD}>
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="line-clamp-1 text-[13px] font-semibold leading-snug">{c.item}</span>
                    {c.linhaVermelha && <SeloLinhaVermelha />}
                  </span>
                  <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{c.servico}</span>
                </td>
                <td className={TD}>
                  <span className="line-clamp-2 text-[12.5px] leading-snug">{c.fornecedor}</span>
                </td>
                <td className={cn(TD, "text-right font-mono text-[13px] font-semibold")}>{brl(c.valorPP)}</td>
                <td className={cn(TD, "text-right")}>
                  <span className="block font-mono text-[13px]">{brl(c.orcadoItem)}</span>
                  <span className="block text-[11px] text-muted-foreground">plan. {brl(c.planejadoItem)}</span>
                </td>
                <td className={cn(TD, "text-right")}>
                  <span className="block font-mono text-[13px] font-semibold text-red-600">{brl(c.realizadoComAPP)}</span>
                  <span className="block text-[11px] font-semibold text-red-600">+{brl(c.excesso)} acima</span>
                </td>
                <td className={TD}>
                  <Motivo caso={c} />
                </td>
                <td className={TD}>
                  <EnviadoPor caso={c} />
                </td>
                <td className={TD}>
                  <SituacaoDoCaso caso={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AbaLink({
  aba,
  ativa,
  children,
  contador,
}: {
  aba: Aba;
  ativa: boolean;
  children: React.ReactNode;
  contador?: number;
}) {
  return (
    <Link
      href={`/comite?aba=${aba}`}
      prefetch={false}
      scroll={false}
      role="tab"
      aria-selected={ativa}
      className={cn(
        "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:text-california-red focus-visible:outline-none",
        ativa ? "border-california-red text-california-red" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {contador !== undefined && contador > 0 && (
        <span
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            ativa ? "bg-california-red text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {contador}
        </span>
      )}
    </Link>
  );
}

/** A planilha do caso, a página inteira no modo do Comitê, em tela cheia. */
function PlanilhaNoPopup({ caso, onFechar }: { caso: CasoDoComite; onFechar: () => void }) {
  const [carregou, setCarregou] = React.useState(false);
  const titulo =
    caso.tipo === "versao"
      ? `Abertura de job · ${caso.orcamento} · v${caso.versao}`
      : `PP · ${caso.jobCodigo} · ${caso.item}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <FullscreenContent className="bg-background">
        <div className="flex h-12 flex-none items-center justify-between gap-3 border-b border-border bg-white px-5">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Gavel className="h-4 w-4 flex-none text-california-red" />
            <span className="truncate">{titulo}</span>
          </DialogTitle>
          <button
            type="button"
            onClick={onFechar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
            Fechar
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {!carregou && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Abrindo a planilha…
            </p>
          )}
          {caso.href && (
            <iframe
              title={titulo}
              src={caso.href}
              onLoad={() => setCarregou(true)}
              className={cn("h-full w-full border-0", !carregou && "invisible")}
            />
          )}
        </div>
      </FullscreenContent>
    </Dialog>
  );
}

export function ModuloComite({
  aba,
  casos,
  regras,
  membros,
  usuarios,
  ultimaAlteracao,
  souAdministrador,
}: {
  aba: Aba;
  casos: CasoDoComite[];
  regras: RegrasDoComite;
  membros: MembroDoComite[];
  usuarios: UsuarioParaComite[];
  ultimaAlteracao: { por: string | null; em: string } | null;
  souAdministrador: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState<CasoDoComite | null>(null);
  const jobs = casos.filter((c): c is CasoDeVersao => c.tipo === "versao");
  const pps = casos.filter((c): c is CasoDePP => c.tipo === "pp");
  const pend = (l: CasoDoComite[]) => l.filter((c) => c.situacao === "pendente").length;

  // A página embutida avisa quando decide: o pop-up fecha e a caixa
  // atualiza.
  React.useEffect(() => {
    function aoReceber(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.tipo !== MENSAGEM_DECIDIDO) return;
      setAberto(null);
      router.refresh();
    }
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, [router]);

  return (
    <div className="space-y-6">
      <div className="mb-6 space-y-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-california-red">Comitê</p>
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-california-red/10 p-2">
              <Gavel className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Comitê de Aprovações</h1>
          </div>
          <p className="mt-2 max-w-2xl text-pretty text-sm text-muted-foreground">
            Aberturas de job e PPs que precisam da aprovação do Comitê, e as regras que decidem o que vem para cá.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Seções do Comitê" className="flex items-center gap-1 border-b border-border">
        <AbaLink aba="jobs" ativa={aba === "jobs"} contador={pend(jobs)}>
          Aberturas de job
        </AbaLink>
        <AbaLink aba="pps" ativa={aba === "pps"} contador={pend(pps)}>
          PPs
        </AbaLink>
        <AbaLink aba="config" ativa={aba === "config"}>
          Configurações
        </AbaLink>
      </div>

      {aba === "config" ? (
        <Configuracoes
          regras={regras}
          membros={membros}
          usuarios={usuarios}
          ultimaAlteracao={ultimaAlteracao}
          souAdministrador={souAdministrador}
        />
      ) : aba === "pps" ? (
        <CaixaPPs casos={pps} onAbrir={(c) => setAberto(c)} />
      ) : (
        <CaixaJobs casos={jobs} onAbrir={(c) => setAberto(c)} />
      )}

      {aberto && (
        <PlanilhaNoPopup
          caso={aberto}
          onFechar={() => {
            setAberto(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
