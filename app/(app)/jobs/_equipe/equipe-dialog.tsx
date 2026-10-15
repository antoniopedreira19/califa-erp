"use client";

/**
 * O botão "Equipe" e o pop-up com os membros (decisão 174), no cabeçalho do
 * job (no lugar do antigo "Editar") e ao lado do nome do projeto na visão
 * agregada.
 *
 * No job: o GP e o Produtor Responsáveis em destaque — o produtor com a
 * chave "Envia PPs ao financeiro", que só o GP ou o administrador mexe — e o
 * resto da equipe do projeto agrupado por papel. Na visão agregada: os
 * responsáveis de cada job, com a chave de cada um, e a equipe inteira.
 * GPs e produtores põem e tiram gente; quem entrou sozinho tem cadeado.
 *
 * O GP ou o administrador troca o GP e o Produtor Responsáveis de job
 * aberto ("Trocar", decisão 175), sem errata e sem o financeiro. Grava no
 * mesmo "Salvar"; a troca do produtor desliga a chave; quem sai continua
 * na equipe pelo que já o punha nela (o orçamento, o projeto).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Lock,
  Send,
  Undo2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Combobox,
  COMBOBOX_COMO_SELECT,
  type ComboboxItem,
} from "@/components/ui/combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/types";
import type {
  EquipeDoProjeto,
  JobNaEquipe,
  MembroDaEquipe,
  MotivoNaEquipe,
  PessoaDaEquipe,
} from "@/lib/data/equipe-do-projeto";
import { salvarEquipeDoProjeto } from "./actions";

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function corDoPapel(papel: AppRole | null): string {
  switch (papel) {
    case "gerente_producao":
      return "bg-california-red/10 text-california-red";
    case "produtor":
      return "bg-sky-50 text-sky-700";
    case "freelancer":
      return "bg-amber-50 text-amber-700";
    case "administrador":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

const ROTULO_DO_PAPEL: Partial<Record<AppRole, string>> = {
  administrador: "Administrador",
  gerente_producao: "GP",
  produtor: "Produtor",
  freelancer: "Freelancer",
  financeiro: "Financeiro",
};

function iniciais(nome: string) {
  const partes = nome.split(" ").filter(Boolean);
  return (
    (partes[0]?.[0] ?? "") +
    (partes.length > 1 ? partes[partes.length - 1][0] : "")
  ).toUpperCase();
}

function Avatar({
  pessoa,
  tamanho = "sm",
  className,
}: {
  pessoa: PessoaDaEquipe;
  tamanho?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-2 border-white font-semibold",
        corDoPapel(pessoa.papel),
        tamanho === "sm" && "h-7 w-7 text-[10.5px]",
        tamanho === "md" && "h-9 w-9 text-xs",
        tamanho === "lg" && "h-11 w-11 text-sm",
        className,
      )}
    >
      {iniciais(pessoa.nome)}
    </span>
  );
}

/** A chave, no desenho das que o sistema já tem (urgência da PP). */
function Chave({
  ligada,
  onChange,
  pode,
  rotulo,
}: {
  ligada: boolean;
  onChange: (v: boolean) => void;
  pode: boolean;
  rotulo: string;
}) {
  const chave = (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      onClick={() => onChange(!ligada)}
      disabled={!pode}
      className={cn(
        "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        ligada ? "bg-california-red" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          ligada ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
  if (pode) return chave;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* O span segura a dica: botão desabilitado não recebe o ponteiro. */}
        <span className="inline-flex">{chave}</span>
      </TooltipTrigger>
      <TooltipContent>Só o GP ou o administrador muda.</TooltipContent>
    </Tooltip>
  );
}

function Cadeado() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground/50">
          <Lock className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Entra sozinho na equipe.</TooltipContent>
    </Tooltip>
  );
}

function textoDoMotivo(m: MotivoNaEquipe, jobAtual: string | null): string {
  const lista = (cs: string[]) => {
    const outros = jobAtual ? cs.filter((c) => c !== jobAtual) : cs;
    const base = outros.length ? outros : cs;
    return `${base[0]}${base.length > 1 ? ` +${base.length - 1}` : ""}`;
  };
  switch (m.tipo) {
    case "criador":
      return "Criou o projeto";
    case "gp_projeto":
      return "GP do projeto";
    case "gp_job":
    case "produtor_job":
      return `Responsável do ${lista(m.codigos)}`;
    case "produtor_orcamento":
      return m.codigos.length
        ? `Produtor do orçamento ${lista(m.codigos)}`
        : "Produtor de orçamento";
    default:
      return "Adicionado à equipe";
  }
}

// ---------------------------------------------------------------------------
// A equipe agrupada por papel
// ---------------------------------------------------------------------------

const GRUPOS: { titulo: string; papeis: Array<AppRole | null> }[] = [
  { titulo: "GPs", papeis: ["administrador", "gerente_producao"] },
  { titulo: "Produtores", papeis: ["produtor"] },
  { titulo: "Freelancers", papeis: ["freelancer"] },
];

function EquipePorPapel({
  membros,
  jobAtual,
  podeMudar,
  onTirar,
}: {
  membros: MembroDaEquipe[];
  jobAtual: string | null;
  podeMudar: boolean;
  onTirar: (id: string) => void;
}) {
  const nosGrupos = new Set(GRUPOS.flatMap((g) => g.papeis));
  const outros = membros.filter((m) => !nosGrupos.has(m.pessoa.papel));
  const grupos =
    outros.length > 0 ? [...GRUPOS, { titulo: "Outros", papeis: [] }] : GRUPOS;
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-4",
        grupos.length > 3 ? "md:grid-cols-4" : "md:grid-cols-3",
      )}
    >
      {grupos.map((g) => {
        const doGrupo =
          g.titulo === "Outros"
            ? outros
            : membros.filter((m) => g.papeis.includes(m.pessoa.papel));
        return (
          <div key={g.titulo} className="min-w-0">
            <p className="mb-1.5 flex items-baseline gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              {g.titulo}
              <span className="font-mono text-[10px] font-normal">
                {doGrupo.length}
              </span>
            </p>
            {doGrupo.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">—</p>
            ) : (
              <ul className="space-y-1">
                {doGrupo.map((m) => (
                  <li
                    key={m.pessoa.id}
                    className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-muted/40"
                  >
                    <Avatar pessoa={m.pessoa} tamanho="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {m.pessoa.nome}
                      </span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">
                        {textoDoMotivo(m.motivos[0], jobAtual)}
                      </span>
                    </span>
                    {m.automatico ? (
                      <Cadeado />
                    ) : podeMudar ? (
                      <button
                        type="button"
                        onClick={() => onTirar(m.pessoa.id)}
                        aria-label={`Tirar ${m.pessoa.nome} da equipe`}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O pop-up
// ---------------------------------------------------------------------------

function Responsavel({
  pessoa,
  rotulo,
  antes,
  onDesfazer,
  trocar,
  children,
}: {
  pessoa: PessoaDaEquipe | null;
  rotulo: string;
  /** Quem estava antes da troca ainda não salva. */
  antes: PessoaDaEquipe | null;
  onDesfazer: () => void;
  /** O "Trocar" (GP ou administrador, job aberto); sem ele, o cadeado. */
  trocar: React.ReactNode | null;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-white p-4 transition-colors",
        antes ? "border-california-red/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-3">
        {pessoa ? (
          <Avatar pessoa={pessoa} tamanho="lg" />
        ) : (
          <span className="h-11 w-11 shrink-0 rounded-full border border-dashed border-border" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {pessoa?.nome ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">{rotulo}</p>
          {/* Quebra em vez de cortar: o nome de quem sai é o que importa
              conferir antes de salvar. */}
          {antes && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              No lugar de{" "}
              <span className="font-medium text-foreground">{antes.nome}</span>
              {" · "}
              <button
                type="button"
                onClick={onDesfazer}
                className="inline-flex items-center gap-1 whitespace-nowrap align-baseline font-medium text-california-red hover:underline"
              >
                <Undo2 className="h-3 w-3 self-center" />
                Desfazer
              </button>
            </p>
          )}
        </div>
        {trocar ?? (pessoa && <Cadeado />)}
      </div>
      {children && (
        <div className="border-t border-border pt-3">{children}</div>
      )}
    </div>
  );
}

const GRADE_JOBS =
  "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_200px] items-center gap-4 px-4";

interface PropsDoPopup {
  equipe: EquipeDoProjeto;
  /** O job da página; nulo na visão agregada. */
  jobId: string | null;
  podeMudarMembros: boolean;
  podeMudarChave: boolean;
  /** GP ou administrador: troca o GP e o Produtor Responsáveis de job
   *  aberto (decisão 175). */
  podeTrocarResponsaveis: boolean;
}

type Papel = "gp" | "produtor";
type TrocasDoRascunho = Record<string, Partial<Record<Papel, string>>>;

/** O gatilho "Trocar": a lista abre no primeiro clique. */
function Trocar({
  rotulo,
  itens,
  cabecalho,
  onEscolher,
  compacto = false,
}: {
  rotulo: string;
  itens: ComboboxItem[];
  cabecalho: React.ReactNode;
  onEscolher: (id: string) => void;
  compacto?: boolean;
}) {
  return (
    <div className="shrink-0">
      <Combobox
        ariaLabel={rotulo}
        items={itens}
        value={null}
        onChange={(v) => v && onEscolher(v)}
        placeholder={compacto ? "" : "Trocar"}
        buscaPlaceholder="Escreva o nome"
        larguraLista="w-[320px]"
        alinharLista="end"
        cabecalhoLista={cabecalho}
        className={
          compacto
            ? "h-7 w-7 justify-center border-transparent px-0 text-muted-foreground hover:border-border hover:bg-accent [&>span:first-child]:hidden"
            : "h-8 w-auto gap-2 px-2.5 text-xs font-semibold [&>span:first-child]:text-foreground"
        }
      />
    </div>
  );
}

function ConteudoDaEquipe({
  equipe,
  jobId,
  podeMudarMembros,
  podeMudarChave,
  podeTrocarResponsaveis,
  onFechar,
}: PropsDoPopup & { onFechar: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [acrescimos, setAcrescimos] = React.useState<string[]>(
    equipe.acrescimos,
  );
  const [envia, setEnvia] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(equipe.jobs.map((j) => [j.id, j.produtorEnviaPP])),
  );
  const [trocas, setTrocas] = React.useState<TrocasDoRascunho>({});

  const pessoaPorId = React.useMemo(() => {
    const m = new Map<string, PessoaDaEquipe>();
    for (const p of equipe.candidatos) m.set(p.id, p);
    for (const mb of equipe.membros) m.set(mb.pessoa.id, mb.pessoa);
    return m;
  }, [equipe]);

  // A equipe como está no rascunho: os automáticos, os acréscimos que
  // ficaram e os que entraram agora.
  const membros = React.useMemo(() => {
    const fica = new Set(acrescimos);
    const lista: MembroDaEquipe[] = equipe.membros.filter(
      (m) => m.automatico || fica.has(m.pessoa.id),
    );
    const ja = new Set(lista.map((m) => m.pessoa.id));
    for (const id of acrescimos) {
      const p = pessoaPorId.get(id);
      if (p && !ja.has(id))
        lista.push({
          pessoa: p,
          motivos: [{ tipo: "acrescimo" }],
          automatico: false,
        });
    }
    return lista.sort((a, b) =>
      a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"),
    );
  }, [equipe.membros, acrescimos, pessoaPorId]);

  const naEquipe = new Set(membros.map((m) => m.pessoa.id));
  const candidatos = [...pessoaPorId.values()]
    .filter((p) => !naEquipe.has(p.id) && p.papel !== null)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const job = jobId ? (equipe.jobs.find((j) => j.id === jobId) ?? null) : null;
  const pessoa = (id: string | null) =>
    id ? (pessoaPorId.get(id) ?? null) : null;

  // ---- A troca dos responsáveis -------------------------------------------
  const gpDe = (j: JobNaEquipe) => trocas[j.id]?.gp ?? j.gpId;
  const produtorDe = (j: JobNaEquipe) => trocas[j.id]?.produtor ?? j.produtorId;
  const gpsDoProjeto = new Set(
    equipe.membros
      .filter((m) => m.motivos.some((x) => x.tipo === "gp_projeto"))
      .map((m) => m.pessoa.id),
  );
  const ordenar = (a: PessoaDaEquipe, b: PessoaDaEquipe) =>
    a.nome.localeCompare(b.nome, "pt-BR");

  function itensDeGp(atual: string | null): ComboboxItem[] {
    const podem = [...pessoaPorId.values()]
      .filter(
        (p) =>
          p.id !== atual &&
          (p.papel === "gerente_producao" || p.papel === "administrador"),
      )
      .sort(ordenar);
    // Qualquer GP ou administrador (decisão 175): quem não é GP do projeto
    // passa a ser ao salvar.
    const doProjeto = podem.filter((p) => gpsDoProjeto.has(p.id));
    const outros = podem.filter((p) => !gpsDoProjeto.has(p.id));
    return [
      ...doProjeto.map((p) => ({ value: p.id, label: p.nome, grupo: "GPs do projeto" })),
      ...outros.map((p) => ({
        value: p.id,
        label: p.papel === "administrador" ? `${p.nome} · Administrador` : p.nome,
        grupo: "Outros GPs",
      })),
    ];
  }

  function itensDeProdutor(atual: string | null): ComboboxItem[] {
    const podem = [...pessoaPorId.values()]
      .filter((p) => p.id !== atual && p.papel === "produtor")
      .sort(ordenar);
    return [
      ...podem
        .filter((p) => naEquipe.has(p.id))
        .map((p) => ({ value: p.id, label: p.nome, grupo: "Na equipe do projeto" })),
      ...podem
        .filter((p) => !naEquipe.has(p.id))
        .map((p) => ({ value: p.id, label: p.nome, grupo: "Outros produtores" })),
    ];
  }

  function trocar(j: JobNaEquipe, papel: Papel, para: string) {
    const original = papel === "gp" ? j.gpId : j.produtorId;
    setTrocas((t) => {
      const doJob = { ...(t[j.id] ?? {}) };
      if (para === original) delete doJob[papel];
      else doJob[papel] = para;
      return { ...t, [j.id]: doJob };
    });
    // A chave é da pessoa: o produtor novo começa sem enviar (174).
    if (papel === "produtor")
      setEnvia((e) => ({ ...e, [j.id]: para === original ? j.produtorEnviaPP : false }));
  }
  function desfazer(j: JobNaEquipe, papel: Papel) {
    trocar(j, papel, (papel === "gp" ? j.gpId : j.produtorId) ?? "");
  }

  const podeTrocarNo = (j: JobNaEquipe) => podeTrocarResponsaveis && j.aceitaTroca;

  const cabecalhoGp = (j: JobNaEquipe) => (
    <>Novo GP do {j.codigo}. Quem não é GP do projeto passa a ser.</>
  );
  const cabecalhoProdutor = (j: JobNaEquipe) => <>Novo Produtor Responsável do {j.codigo}.</>;

  /** As trocas que o "Salvar" vai gravar, com os nomes. */
  const trocasPedidas = equipe.jobs.flatMap((j) =>
    (["gp", "produtor"] as Papel[])
      .filter((p) => trocas[j.id]?.[p])
      .map((p) => ({
        job: j,
        papel: p,
        de: pessoa(p === "gp" ? j.gpId : j.produtorId),
        para: pessoa(trocas[j.id]![p]!),
      })),
  );

  const naGrade = job
    ? membros.filter(
        (m) => m.pessoa.id !== gpDe(job) && m.pessoa.id !== produtorDe(job),
      )
    : membros;
  const podeSalvar = podeMudarMembros || podeMudarChave || podeTrocarResponsaveis;

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const res = await salvarEquipeDoProjeto({
        projetoId: equipe.projetoId,
        acrescimos,
        chaves: Object.entries(envia).map(([id, liga]) => ({
          jobId: id,
          liga,
        })),
        trocas: trocasPedidas.map((t) => ({
          jobId: t.job.id,
          papel: t.papel,
          para: t.para!.id,
        })),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onFechar();
      router.refresh();
    });
  }

  return (
    <DialogContent className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
      <DialogHeader className="shrink-0 flex-row items-start gap-4 border-b border-border px-6 py-5 pr-14">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <DialogTitle className="text-xl">
            {job ? (
              <>
                Equipe · <span className="font-mono">{job.codigo}</span>
              </>
            ) : (
              "Equipe do projeto"
            )}
          </DialogTitle>
          <DialogDescription>
            {equipe.projetoCodigo} · {equipe.projetoNome} · {membros.length}{" "}
            {membros.length === 1 ? "pessoa" : "pessoas"}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {job ? (
          <section className="space-y-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              Responsáveis pelo job
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Responsavel
                pessoa={pessoa(gpDe(job))}
                rotulo="GP Responsável"
                antes={trocas[job.id]?.gp ? pessoa(job.gpId) : null}
                onDesfazer={() => desfazer(job, "gp")}
                trocar={
                  podeTrocarNo(job) ? (
                    <Trocar
                      rotulo="Trocar o GP Responsável"
                      itens={itensDeGp(gpDe(job))}
                      cabecalho={cabecalhoGp(job)}
                      onEscolher={(id) => trocar(job, "gp", id)}
                    />
                  ) : null
                }
              >
                <div className="flex items-center justify-between gap-2.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Send className="h-3.5 w-3.5 text-muted-foreground" />
                    Envia PPs ao financeiro
                  </span>
                  <span className="text-xs text-muted-foreground">Sempre</span>
                </div>
              </Responsavel>
              <Responsavel
                pessoa={pessoa(produtorDe(job))}
                rotulo="Produtor Responsável"
                antes={trocas[job.id]?.produtor ? pessoa(job.produtorId) : null}
                onDesfazer={() => desfazer(job, "produtor")}
                trocar={
                  podeTrocarNo(job) ? (
                    <Trocar
                      rotulo="Trocar o Produtor Responsável"
                      itens={itensDeProdutor(produtorDe(job))}
                      cabecalho={cabecalhoProdutor(job)}
                      onEscolher={(id) => trocar(job, "produtor", id)}
                    />
                  ) : null
                }
              >
                {produtorDe(job) ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Send className="h-3.5 w-3.5 text-muted-foreground" />
                        Envia PPs ao financeiro
                      </span>
                      <Chave
                        ligada={envia[job.id] ?? false}
                        onChange={(v) => setEnvia((e) => ({ ...e, [job.id]: v }))}
                        pode={podeMudarChave && !job.congelado}
                        rotulo="Envia PPs ao financeiro"
                      />
                    </div>
                    {trocas[job.id]?.produtor && job.produtorEnviaPP && !envia[job.id] && (
                      <p className="text-[11.5px] text-muted-foreground">
                        Volta desligada para o novo produtor.
                      </p>
                    )}
                  </div>
                ) : null}
              </Responsavel>
            </div>
          </section>
        ) : (
          equipe.jobs.length > 0 && (
            <section className="space-y-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                Responsáveis pelos jobs
              </p>
              <div className="overflow-hidden rounded-xl border border-border">
                <div
                  className={cn(
                    GRADE_JOBS,
                    "border-b border-border bg-muted/40 py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground",
                  )}
                >
                  <span>Job</span>
                  <span>GP Responsável</span>
                  <span>Produtor Responsável</span>
                  <span className="flex items-center gap-1.5">
                    <Send className="h-3 w-3" />
                    Envia PPs ao financeiro
                  </span>
                </div>
                {equipe.jobs.map((j) => {
                  const pode = podeTrocarNo(j);
                  return (
                    <div
                      key={j.id}
                      className={cn(
                        GRADE_JOBS,
                        "group border-b border-border/70 py-2.5 last:border-0",
                      )}
                    >
                      <span className="min-w-0 truncate text-sm">
                        <span className="font-mono text-[11.5px] font-semibold text-[#b3323c]">
                          {j.codigo}
                        </span>{" "}
                        <span className="font-medium text-foreground">
                          {j.nome}
                        </span>
                      </span>
                      <CelulaDoResponsavel
                        pessoa={pessoa(gpDe(j))}
                        antes={trocas[j.id]?.gp ? pessoa(j.gpId) : null}
                        onDesfazer={() => desfazer(j, "gp")}
                        trocar={
                          pode ? (
                            <Trocar
                              compacto
                              rotulo={`Trocar o GP do ${j.codigo}`}
                              itens={itensDeGp(gpDe(j))}
                              cabecalho={cabecalhoGp(j)}
                              onEscolher={(id) => trocar(j, "gp", id)}
                            />
                          ) : null
                        }
                      />
                      <CelulaDoResponsavel
                        pessoa={pessoa(produtorDe(j))}
                        antes={trocas[j.id]?.produtor ? pessoa(j.produtorId) : null}
                        onDesfazer={() => desfazer(j, "produtor")}
                        trocar={
                          pode ? (
                            <Trocar
                              compacto
                              rotulo={`Trocar o Produtor Responsável do ${j.codigo}`}
                              itens={itensDeProdutor(produtorDe(j))}
                              cabecalho={cabecalhoProdutor(j)}
                              onEscolher={(id) => trocar(j, "produtor", id)}
                            />
                          ) : null
                        }
                      />
                      <span>
                        {produtorDe(j) ? (
                          <Chave
                            ligada={envia[j.id] ?? false}
                            onChange={(v) =>
                              setEnvia((e) => ({ ...e, [j.id]: v }))
                            }
                            pode={podeMudarChave && !j.congelado}
                            rotulo={`Envia PPs ao financeiro · ${j.codigo}`}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              {job ? "Equipe do projeto" : "Equipe"}
            </p>
            {podeMudarMembros && (
              <div className="w-[300px] max-w-full">
                <Combobox
                  ariaLabel="Adicionar pessoa à equipe"
                  items={candidatos.map((p) => ({
                    value: p.id,
                    label:
                      p.papel && ROTULO_DO_PAPEL[p.papel]
                        ? `${p.nome} · ${ROTULO_DO_PAPEL[p.papel]}`
                        : p.nome,
                  }))}
                  value={null}
                  onChange={(v) =>
                    v && setAcrescimos((l) => (l.includes(v) ? l : [...l, v]))
                  }
                  placeholder="Adicionar pessoa"
                  buscaPlaceholder="Escreva o nome"
                  className={COMBOBOX_COMO_SELECT}
                />
              </div>
            )}
          </div>
          <EquipePorPapel
            membros={naGrade}
            jobAtual={job?.codigo ?? null}
            podeMudar={podeMudarMembros}
            onTirar={(id) => setAcrescimos((l) => l.filter((x) => x !== id))}
          />
        </section>

        {erro && (
          <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/30 px-6 py-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserPlus className="h-3.5 w-3.5" />
          {podeMudarMembros
            ? "GPs e produtores mudam a equipe."
            : "Só GPs e produtores mudam a equipe."}
        </span>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onFechar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {podeSalvar ? "Cancelar" : "Fechar"}
          </button>
          {podeSalvar && (
            <button
              type="button"
              onClick={salvar}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-california-red-hover hover:shadow-brand disabled:opacity-60"
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          )}
        </div>
      </div>

    </DialogContent>
  );
}

/** Uma célula de responsável na tabela da visão agregada. */
function CelulaDoResponsavel({
  pessoa,
  antes,
  onDesfazer,
  trocar,
}: {
  pessoa: PessoaDaEquipe | null;
  antes: PessoaDaEquipe | null;
  onDesfazer: () => void;
  trocar: React.ReactNode | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {pessoa && <Avatar pessoa={pessoa} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">
          {pessoa?.nome ?? "—"}
        </span>
        {antes && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="truncate">era {antes.nome}</span>
            <button
              type="button"
              onClick={onDesfazer}
              aria-label={`Desfazer: voltar para ${antes.nome}`}
              className="inline-flex shrink-0 items-center text-california-red hover:underline"
            >
              <Undo2 className="h-3 w-3" />
            </button>
          </span>
        )}
      </span>
      {trocar && (
        <span
          className={cn(
            "transition-opacity",
            antes ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {trocar}
        </span>
      )}
    </span>
  );
}

/** Os rostos da equipe, com o nome na dica. */
function Rostos({
  pessoas,
  max = 4,
}: {
  pessoas: PessoaDaEquipe[];
  max?: number;
}) {
  const vis = pessoas.slice(0, max);
  return (
    <span className="flex items-center">
      {vis.map((p, i) => (
        <span
          key={p.id}
          className={cn("relative", i > 0 && "-ml-1.5")}
          style={{ zIndex: vis.length - i }}
        >
          <Avatar pessoa={p} className="h-[26px] w-[26px] text-[9.5px]" />
        </span>
      ))}
      {pessoas.length > max && (
        <span className="-ml-1.5 inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full border-2 border-white bg-muted px-1 text-[9.5px] font-semibold text-muted-foreground">
          +{pessoas.length - max}
        </span>
      )}
    </span>
  );
}

/** O botão "Equipe" com os rostos — os responsáveis do job primeiro. */
export function BotaoEquipe(props: PropsDoPopup) {
  const { equipe, jobId } = props;
  const [aberto, setAberto] = React.useState(false);
  const job = jobId ? (equipe.jobs.find((j) => j.id === jobId) ?? null) : null;
  const primeiro = new Set(
    [job?.gpId, job?.produtorId].filter(Boolean) as string[],
  );
  // O GP e o produtor podem ser a mesma pessoa: um rosto só.
  const pessoas = [
    ...equipe.membros.filter((m) => m.pessoa.id === job?.gpId),
    ...equipe.membros.filter(
      (m) => m.pessoa.id === job?.produtorId && m.pessoa.id !== job?.gpId,
    ),
    ...equipe.membros.filter((m) => !primeiro.has(m.pessoa.id)),
  ].map((m) => m.pessoa);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-white py-1 pl-3 pr-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
      >
        <Users className="h-3.5 w-3.5" />
        Equipe
        <Rostos pessoas={pessoas} />
      </button>
      {/* Fora do botão: o clique no Cancelar subiria pela árvore do React
          até ele e reabriria o pop-up. */}
      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto && (
          <ConteudoDaEquipe {...props} onFechar={() => setAberto(false)} />
        )}
      </Dialog>
    </>
  );
}
