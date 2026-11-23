"use client";
// A aba Recorrências do Contas a Pagar (decisão 272): uma lista só, com as
// colunas do cadastro na ordem das outras abas (Código, Valor, …, Status e as
// ações). A coluna "Próximo título" mostra o primeiro título que ainda não
// fechou e o status dele (Aguardando conta, A pagar, Atrasado, Sem extrato,
// A conciliar, Pago); uma segunda linha de filtros filtra por esse status.
// A conciliação não se faz aqui: o "A conciliar" se resolve na Conciliação.
// Detalhes e formulário abrem num pop-up centralizado, no lugar da página.
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, Eye, Pencil, Plus, Repeat, Search, Upload, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import {
  ANTECEDENCIA,
  ROTULO_DO_ESTADO,
  brl,
  dia,
  dicaDoEstado,
  somarDias,
  tituloEmFoco,
  vencimentoResumo,
  type Estado,
  type Recorrencia,
  type TituloDaRecorrencia,
} from "./recorrencias/dados";
import { FormularioDaRecorrencia, type ListasDoFormulario } from "./recorrencias/formulario";
import { CabecalhoDosDetalhes, CorpoDosDetalhes, SeloSituacao, regionalResumo } from "./recorrencias/detalhes";
import { AnexarDocumento } from "./recorrencias/documento";
import { DialogoDeDesativar, type Desativar } from "./recorrencias/desativar";
import { LancarConta, Selo } from "./recorrencias/lancar-conta";

interface Props {
  recs: Recorrencia[];
  /** Hoje em Brasília, vindo do servidor. */
  hoje: string;
  tenantId: string;
  /** `?rec=<id>`: abre os detalhes dessa recorrência (o link antigo da página). */
  abrir?: string | null;
  erro?: string | null;
  empresas: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  fornecedores: Array<{ id: string; nome: string; cpf_cnpj?: string | null }>;
  clientes: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  cartoes: CartaoOption[];
}

type Status = "ativas" | "pausadas" | "encerradas" | "todas";
type Agrupar = "nada" | "subtipo" | "empresa";
type Painel = { modo: "detalhes"; id: string } | { modo: "criar" } | { modo: "editar"; id: string; daDetalhes: boolean };

/** Valor por mês (quinzenal conta duas vezes; anual, um doze avos). */
function porMes(r: Recorrencia): number {
  return r.frequencia === "quinzenal" ? r.valor * 2 : r.frequencia === "anual" ? r.valor / 12 : r.valor;
}

/** O que a coluna "Próximo título" mostra: o título em foco ou a próxima previsão. */
function proximoDa(r: Recorrencia): { data: string; estado: Estado; titulo: TituloDaRecorrencia | null } | null {
  const t = tituloEmFoco(r);
  if (t) return { data: t.vencimento, estado: t.estado, titulo: t };
  if (r.previstas[0]) return { data: r.previstas[0], estado: "previsto", titulo: null };
  return null;
}

const COLUNAS: ColunaFiltravel<Recorrencia>[] = [
  { chave: "codigo", rotulo: "Código", tipo: "texto", celula: (r) => celulaTexto(r.codigo) },
  { chave: "valor", rotulo: "Valor", tipo: "valor", faixa: true, alinhar: "right", celula: (r) => celulaValor(r.valor, brl) },
  { chave: "descricao", rotulo: "Descrição", tipo: "texto", celula: (r) => celulaTexto(r.descricao) },
  { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", rotuloSemGrupo: "Sem fornecedor", celula: (r) => celulaTexto(r.fornecedor_nome) },
  {
    chave: "empresa",
    rotulo: "Empresa · Regional",
    tipo: "texto",
    celula: (r) => ({ ...celulaTexto(`${r.empresa_nome} · ${r.rateio.length > 1 ? "TD" : regionalResumo(r)}`), grupo: r.empresa_nome }),
  },
  { chave: "plano", rotulo: "Plano de contas", tipo: "texto", celula: (r) => ({ ...celulaTexto(r.subtipo_nome), grupo: `${r.tipo_codigo} · ${r.tipo_nome}` }) },
  { chave: "vencimento", rotulo: "Vencimento", tipo: "texto", celula: (r) => celulaTexto(vencimentoResumo(r)) },
  { chave: "proximo", rotulo: "Próximo título", tipo: "data", celula: (r) => celulaData(proximoDa(r)?.data ?? null) },
  {
    chave: "documentos",
    rotulo: "Documentos",
    tipo: "texto",
    celula: (r) => celulaTexto(r.pendentes > 0 ? "Pendente" : r.titulos.some((t) => t.pago) ? "Em dia" : "Sem pagamento"),
  },
  {
    chave: "situacao",
    rotulo: "Status",
    tipo: "texto",
    celula: (r) => ({
      ...celulaTexto(r.situacao === "ativa" ? "Ativa" : r.situacao === "pausada" ? "Pausada" : "Encerrada"),
      ordemNaLista: ["ativa", "pausada", "encerrada"].indexOf(r.situacao),
    }),
  },
];

// A planilha é `table-fixed` (o conteúdo das telas tem 1.616 px na janela de
// 1.838, decisão 085). Ordem das PPs e dos Desembolsos: Código, Valor, …,
// Status e as ações no fim.
const LARGURAS = [120, 140, 200, 160, 150, 175, 105, 150, 120, 115, 125];
const ESTADOS_DO_TITULO: Estado[] = ["aguardando", "a_pagar", "atrasado", "sem_extrato", "a_conciliar", "pago", "previsto"];

export function RecorrentesList(props: Props) {
  const { recs, hoje } = props;
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<Status>("ativas");
  const [semDocumento, setSemDocumento] = React.useState(false);
  const [semFornecedor, setSemFornecedor] = React.useState(false);
  const [filtroTitulo, setFiltroTitulo] = React.useState<Estado | "todos">("todos");
  const [agrupar, setAgrupar] = React.useState<Agrupar>("nada");
  const [painel, setPainel] = React.useState<Painel | null>(() => (props.abrir ? { modo: "detalhes", id: props.abrir } : null));
  const [anexando, setAnexando] = React.useState<string | null>(null);
  const [lancando, setLancando] = React.useState<string | null>(null);
  const [desativando, setDesativando] = React.useState<Desativar | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const feito = (mensagem: string) => {
    setAviso(mensagem);
    router.refresh();
  };

  const passaStatus = (r: Recorrencia) =>
    status === "todas" ||
    (status === "ativas" && r.situacao === "ativa") ||
    (status === "pausadas" && r.situacao === "pausada") ||
    (status === "encerradas" && r.situacao === "encerrada");
  const contaTitulo = Object.fromEntries(
    ESTADOS_DO_TITULO.map((e) => [e, recs.filter((r) => passaStatus(r) && proximoDa(r)?.estado === e).length]),
  ) as Record<Estado, number>;
  const conta = {
    ativas: recs.filter((r) => r.situacao === "ativa").length,
    pausadas: recs.filter((r) => r.situacao === "pausada").length,
    encerradas: recs.filter((r) => r.situacao === "encerrada").length,
    todas: recs.length,
    semDocumento: recs.filter((r) => r.pendentes > 0).length,
    semFornecedor: recs.filter((r) => !r.fornecedor_id && r.situacao !== "encerrada").length,
  };

  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return recs.filter((r) => {
      if (!passaStatus(r)) return false;
      if (semDocumento && r.pendentes === 0) return false;
      if (semFornecedor && r.fornecedor_id) return false;
      if (filtroTitulo !== "todos" && proximoDa(r)?.estado !== filtroTitulo) return false;
      if (!q) return true;
      return [r.codigo, r.descricao, r.fornecedor_nome ?? ""].some((x) => x.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, busca, status, semDocumento, semFornecedor, filtroTitulo]);
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "contas-a-pagar-recorrencias" });
  const visiveis = colunas.visiveis;

  const grupos = React.useMemo(() => {
    if (agrupar === "nada") return [{ nome: "", linhas: visiveis }];
    const m = new Map<string, Recorrencia[]>();
    for (const r of visiveis) {
      const k = agrupar === "subtipo" ? `${r.tipo_codigo} · ${r.subtipo_nome}` : r.empresa_nome;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([nome, linhas]) => ({ nome, linhas }));
  }, [visiveis, agrupar]);

  // O resumo (sobre tudo da empresa escolhida, não sobre os filtros).
  const ativas = recs.filter((r) => r.situacao === "ativa");
  const abertos = recs.flatMap((r) => r.titulos.filter((t) => !t.pago));
  const atrasados = abertos.filter((t) => t.estado === "atrasado");
  const ate7 = somarDias(hoje, 7);
  const prox7 = abertos.filter((t) => t.vencimento >= hoje && t.vencimento <= ate7);
  const pagosSemDoc = recs.flatMap((r) => r.titulos.filter((t) => t.semDocumento));

  const recDoPainel = painel && painel.modo !== "criar" ? recs.find((r) => r.id === painel.id) ?? null : null;
  const posicao = recDoPainel ? { i: visiveis.findIndex((r) => r.id === recDoPainel.id), n: visiveis.length } : null;
  const doTitulo = (id: string | null) => {
    if (!id) return { rec: null, titulo: null };
    const rec = recs.find((r) => r.titulos.some((t) => t.id === id)) ?? null;
    return { rec, titulo: rec?.titulos.find((t) => t.id === id) ?? null };
  };
  const anexo = doTitulo(anexando);
  const lancamento = doTitulo(lancando);

  const listas: ListasDoFormulario = {
    empresas: props.empresas,
    tipos: props.tipos,
    subtipos: props.subtipos,
    fornecedores: props.fornecedores,
    clientes: props.clientes,
    regionais: props.regionais,
    cartoes: props.cartoes,
  };

  function chip(ativo: boolean, onClick: () => void, texto: string, n: number, tom: "padrao" | "perigo" | "aviso" = "padrao") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
          ativo
            ? tom === "aviso"
              ? "border-amber-500 bg-amber-500 text-white"
              : "border-california-red bg-california-red text-white"
            : tom === "perigo"
              ? "border-california-red/40 bg-white text-california-red hover:border-california-red"
              : tom === "aviso"
                ? "border-amber-300 bg-white text-amber-700 hover:border-amber-500"
                : "border-border bg-white text-muted-foreground hover:border-california-red/50",
        )}
      >
        {texto}
        <span className={cn("rounded-full px-1.5 text-[10px]", ativo ? "bg-white/25" : "bg-muted")}>{n}</span>
      </button>
    );
  }

  const fechar = () => {
    setPainel(null);
    setAnexando(null);
    setDesativando(null);
  };
  const irPara = (i: number) => {
    const r = visiveis[i];
    if (r) setPainel({ modo: "detalhes", id: r.id });
  };

  const conteudoDoPainel = (() => {
    if (!painel) return null;
    if (painel.modo === "criar")
      return (
        <>
          <div className="border-b border-border px-6 py-4 pr-14">
            <DialogTitle className="text-lg">Nova recorrência</DialogTitle>
            <DialogDescription className="mt-1">
              Uma conta que se repete. O título de cada vencimento nasce {ANTECEDENCIA} dias antes, já aprovado, em Títulos a Pagar.
            </DialogDescription>
          </div>
          <FormularioDaRecorrencia
            key="criar"
            modo="criar"
            listas={listas}
            hoje={hoje}
            onCancelar={fechar}
            onSalvo={(id, msg) => {
              feito(msg);
              setStatus("ativas");
              setPainel(id ? { modo: "detalhes", id } : null);
            }}
          />
        </>
      );
    if (!recDoPainel)
      return (
        <div className="p-6">
          <DialogTitle>Recorrência</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">Esta recorrência não está na lista (outra empresa no filtro, ou foi excluída).</p>
        </div>
      );
    if (painel.modo === "editar")
      return (
        <>
          <div className="border-b border-border px-6 py-4 pr-14">
            {painel.daDetalhes && (
              <button
                type="button"
                onClick={() => setPainel({ modo: "detalhes", id: recDoPainel.id })}
                className="mb-1 text-xs font-medium text-muted-foreground hover:text-california-red"
              >
                ‹ Voltar aos detalhes
              </button>
            )}
            <DialogTitle className="text-lg">
              Editar <span className="font-mono text-california-red">{recDoPainel.codigo}</span>
            </DialogTitle>
            <DialogDescription className="mt-1">Vale para os próximos títulos. O título já gerado e em aberto pode acompanhar (abaixo).</DialogDescription>
          </div>
          <FormularioDaRecorrencia
            key={`editar-${recDoPainel.id}`}
            modo="editar"
            rec={recDoPainel}
            listas={listas}
            hoje={hoje}
            onCancelar={() => (painel.daDetalhes ? setPainel({ modo: "detalhes", id: recDoPainel.id }) : fechar())}
            onSalvo={(id, msg) => {
              feito(msg);
              setPainel({ modo: "detalhes", id });
            }}
          />
        </>
      );
    return (
      <>
        <DialogTitle className="sr-only">{recDoPainel.codigo}</DialogTitle>
        <DialogDescription className="sr-only">{recDoPainel.descricao}</DialogDescription>
        <CabecalhoDosDetalhes
          rec={recDoPainel}
          posicao={posicao && posicao.i >= 0 ? posicao : null}
          onAnterior={posicao && posicao.i > 0 ? () => irPara(posicao.i - 1) : undefined}
          onProxima={posicao && posicao.i >= 0 && posicao.i < posicao.n - 1 ? () => irPara(posicao.i + 1) : undefined}
          onEditar={() => setPainel({ modo: "editar", id: recDoPainel.id, daDetalhes: true })}
          onDesativar={setDesativando}
        />
        <CorpoDosDetalhes
          rec={recDoPainel}
          onAnexar={(t) => setAnexando(t.id)}
          onLancar={(t) => setLancando(t.id)}
          onMudou={() => router.refresh()}
        />
      </>
    );
  })();

  return (
    <div className="space-y-4">
      {props.erro && (
        <div className="flex items-center gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-sm text-california-red">
          <AlertTriangle className="h-4 w-4" /> Parte das recorrências não carregou: {props.erro}
        </div>
      )}

      {/* Barra: status, pendências, busca, agrupar e Nova recorrência */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {chip(status === "ativas", () => setStatus("ativas"), "Ativas", conta.ativas)}
          {chip(status === "pausadas", () => setStatus("pausadas"), "Pausadas", conta.pausadas)}
          {chip(status === "encerradas", () => setStatus("encerradas"), "Encerradas", conta.encerradas)}
          {chip(status === "todas", () => setStatus("todas"), "Todas", conta.todas)}
          <span className="mx-1 h-5 w-px bg-border" />
          {chip(semDocumento, () => setSemDocumento((v) => !v), "Pago sem documento", conta.semDocumento, "perigo")}
          {chip(semFornecedor, () => setSemFornecedor((v) => !v), "Sem fornecedor", conta.semFornecedor, "aviso")}
        </div>
        <div className="relative ml-auto w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Código, descrição ou fornecedor"
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        <div className="w-48">
          <Select value={agrupar} onValueChange={(v) => setAgrupar(v as Agrupar)}>
            <SelectTrigger className="h-9" aria-label="Agrupar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nada">Sem agrupar</SelectItem>
              <SelectItem value="subtipo">Agrupar por subtipo</SelectItem>
              <SelectItem value="empresa">Agrupar por empresa</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <button
          type="button"
          onClick={() => setPainel({ modo: "criar" })}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
        >
          <Plus className="h-4 w-4" />
          Nova recorrência
        </button>
      </div>

      {/* O status do próximo título: a 2ª linha de filtros, como o "Status" da aba Títulos a Pagar. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Próximo título</span>
        {chip(filtroTitulo === "todos", () => setFiltroTitulo("todos"), "Todos", recs.filter(passaStatus).length)}
        {ESTADOS_DO_TITULO.filter((e) => contaTitulo[e] > 0 || filtroTitulo === e).map((e) => (
          <React.Fragment key={e}>
            {chip(
              filtroTitulo === e,
              () => setFiltroTitulo(filtroTitulo === e ? "todos" : e),
              ROTULO_DO_ESTADO[e],
              contaTitulo[e],
              e === "atrasado" ? "perigo" : e === "aguardando" ? "aviso" : "padrao",
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Faixa de resumo, no formato da aba Títulos a Pagar. */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <ItemDoResumo
          icone={<Repeat className="h-3.5 w-3.5 text-california-red" />}
          rotulo={`Ativas por mês · ${ativas.length}`}
          valor={brl(ativas.reduce((t, r) => t + porMes(r), 0))}
        />
        <div className="h-5 w-px bg-border" />
        <ItemDoResumo
          icone={<Wallet className="h-3.5 w-3.5 text-muted-foreground" />}
          rotulo={`Em aberto · ${abertos.length}`}
          valor={brl(abertos.reduce((t, x) => t + x.valor, 0))}
          extra={
            atrasados.length > 0 ? (
              <span className="text-xs font-semibold text-california-red">
                {atrasados.length} atrasado{atrasados.length > 1 ? "s" : ""}
              </span>
            ) : null
          }
        />
        <div className="h-5 w-px bg-border" />
        <ItemDoResumo
          icone={<CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />}
          rotulo={`Vencendo até ${dia(ate7)}`}
          valor={brl(prox7.reduce((t, x) => t + x.valor, 0))}
        />
        <div className="h-5 w-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setSemDocumento(true);
            setStatus("todas");
          }}
          className={cn("flex items-center gap-2.5 rounded-md px-1 transition-colors", pagosSemDoc.length ? "hover:bg-california-red/5" : "")}
        >
          <AlertTriangle className={cn("h-3.5 w-3.5", pagosSemDoc.length ? "text-california-red" : "text-muted-foreground")} />
          <span className={cn("whitespace-nowrap text-xs", pagosSemDoc.length ? "font-semibold text-california-red" : "text-muted-foreground")}>
            Pagos sem documento
          </span>
          <span className={cn("font-mono text-sm font-bold tabular-nums", pagosSemDoc.length && "text-california-red")}>{pagosSemDoc.length}</span>
          {pagosSemDoc.length > 0 && (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {brl(pagosSemDoc.reduce((t, x) => t + x.valor, 0))} · clique para ver
            </span>
          )}
        </button>
      </div>

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="recorrência"
          plural="recorrências"
          onLimpar={colunas.limpar}
        />
      )}

      {doTopo.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">{recs.length === 0 ? "Nenhuma recorrência cadastrada ainda." : "Nenhuma recorrência com esses filtros."}</p>
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[1560px] table-fixed text-sm">
            <colgroup>
              {LARGURAS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("valor")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("descricao")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("fornecedor")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("empresa")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("plano")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("vencimento")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("proximo")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("documentos")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("situacao")}</th>
                <th className="px-4 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma recorrência com esse filtro.
                  </td>
                </tr>
              )}
              {grupos.map((grupo) => (
                <React.Fragment key={grupo.nome || "todas"}>
                  {grupo.nome && (
                    <tr className="border-b border-border bg-muted/30">
                      <td colSpan={11} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {grupo.nome} · {grupo.linhas.length} · {brl(grupo.linhas.reduce((t, r) => t + r.valor, 0))}
                      </td>
                    </tr>
                  )}
                  {grupo.linhas.map((r) => {
                    const prox = proximoDa(r);
                    const lancar = prox?.titulo && prox.titulo.estimado && !prox.titulo.travado ? prox.titulo : null;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setPainel({ modo: "detalhes", id: r.id })}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 font-mono text-xs font-bold text-california-red">{r.codigo}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{brl(r.valor)}</td>
                        <td className="px-4 py-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="line-clamp-2 font-medium">{r.descricao}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm">{r.descricao}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.fornecedor_nome ? <span className="line-clamp-2">{r.fornecedor_nome}</span> : <span className="text-amber-700">Sem fornecedor</span>}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="truncate">{r.empresa_nome}</div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="truncate text-muted-foreground">{r.rateio.length > 1 ? "Todas (TD)" : regionalResumo(r)}</div>
                            </TooltipTrigger>
                            <TooltipContent>{regionalResumo(r)}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="truncate">{r.subtipo_nome}</div>
                          <div className="truncate text-muted-foreground">
                            {r.tipo_codigo} · {r.tipo_nome}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">{vencimentoResumo(r)}</td>
                        <td className="px-4 py-3 text-xs">
                          {prox ? (
                            <div className="flex flex-col items-start gap-1">
                              <span className="font-mono">{dia(prox.data)}</span>
                              <Selo
                                e={prox.estado}
                                dica={
                                  prox.titulo
                                    ? dicaDoEstado(prox.titulo)
                                    : `Ainda é previsão: vira título em ${dia(somarDias(prox.data, -ANTECEDENCIA))}.`
                                }
                              />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.pendentes > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-california-red/30 bg-california-red/5 px-1.5 py-0.5 text-[11px] font-semibold text-california-red">
                              <AlertTriangle className="h-3 w-3" />
                              {r.pendentes} pendente{r.pendentes > 1 ? "s" : ""}
                            </span>
                          ) : r.titulos.some((t) => t.pago) ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Em dia
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <SeloSituacao rec={r} empilhado />
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => setPainel({ modo: "detalhes", id: r.id })}
                                  className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-california-red/50 hover:text-california-red"
                                  aria-label="Ver detalhes"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Ver detalhes e títulos</TooltipContent>
                            </Tooltip>
                            {lancar && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => setLancando(lancar.id)}
                                    className="rounded-md border border-amber-300 bg-amber-50 p-1.5 text-amber-700 hover:border-amber-500"
                                    aria-label="Lançar a conta"
                                  >
                                    <Upload className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Lançar a conta de {dia(lancar.vencimento)}</TooltipContent>
                              </Tooltip>
                            )}
                            {r.situacao === "ativa" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => setPainel({ modo: "editar", id: r.id, daDetalhes: false })}
                                    className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-california-red/50 hover:text-california-red"
                                    aria-label="Editar"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Editar</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalhes e formulário: o mesmo pop-up */}
      <Dialog open={Boolean(painel)} onOpenChange={(o) => !o && fechar()}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="flex max-h-[90vh] w-[1180px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0">
          {conteudoDoPainel}
        </DialogContent>
      </Dialog>

      <AnexarDocumento
        titulo={anexo.titulo}
        descricao={anexo.rec?.descricao ?? ""}
        tenantId={props.tenantId}
        onFechar={() => setAnexando(null)}
        onAnexado={(msg) => {
          setAnexando(null);
          feito(msg);
        }}
      />
      {lancamento.titulo && (
        <LancarConta
          rec={lancamento.rec}
          titulo={lancamento.titulo}
          tenantId={props.tenantId}
          onFechar={() => setLancando(null)}
          onLancada={(msg) => {
            setLancando(null);
            feito(msg);
          }}
        />
      )}
      <DialogoDeDesativar
        rec={recDoPainel}
        qual={desativando}
        onFechar={(msg) => {
          setDesativando(null);
          if (msg) feito(msg);
        }}
      />

      {aviso && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-foreground px-4 py-2.5 text-sm text-background shadow-lg" role="status">
          {aviso}
        </div>
      )}
    </div>
  );
}

/** O item da faixa de resumo, o mesmo `ResumoItem` da aba Títulos a Pagar. */
function ItemDoResumo({ icone, rotulo, valor, extra }: { icone: React.ReactNode; rotulo: string; valor: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {icone}
      <span className="whitespace-nowrap text-xs text-muted-foreground">{rotulo}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{valor}</span>
      {extra}
    </div>
  );
}
