"use client";

// As regras e os membros do Comitê de Aprovações (decisão 223), como no
// protótipo aprovado: cada regra com a chave dela, os membros com o
// "Adicionar" e o administrador aprovando direto na tela. Nada grava até
// "Salvar regras".
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Plus, Trash2 } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, initials } from "@/lib/utils";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import { REGRAS_PADRAO_DO_COMITE, type RegrasDoComite } from "@/lib/calculos/limites-orcamento";
import { roleLabel, type AppRole } from "@/lib/types";
import { adicionarMembroDoComite, removerMembroDoComite, salvarRegrasDoComite } from "./actions";
import type { MembroDoComite, UsuarioParaComite } from "./tipos";

function Chave({ ligada, onChange, rotulo }: { ligada: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      onClick={() => onChange(!ligada)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors",
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
}

function Regra({
  titulo,
  descricao,
  ligada,
  onLigar,
  children,
}: {
  titulo: string;
  descricao: string;
  ligada: boolean;
  onLigar: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-4 border-b border-border/70 px-5 py-4 last:border-0", !ligada && "bg-muted/20")}>
      <div className="pt-0.5">
        <Chave ligada={ligada} onChange={onLigar} rotulo={titulo} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="mt-0.5 max-w-3xl text-[12.5px] leading-snug text-muted-foreground">{descricao}</p>
        {children && <div className={cn("mt-3", !ligada && "pointer-events-none opacity-50")}>{children}</div>}
      </div>
    </div>
  );
}

const numeroParaTexto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const textoParaNumero = (s: string) => {
  const limpo = s.replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
};

function CampoNumero({
  valor,
  onChange,
  prefixo,
  sufixo,
  largura,
  rotulo,
}: {
  valor: string;
  onChange: (v: string) => void;
  prefixo?: string;
  sufixo?: string;
  largura: string;
  rotulo: string;
}) {
  return (
    <span className="relative inline-flex items-center">
      {prefixo && <span className="pointer-events-none absolute left-3 text-sm text-muted-foreground">{prefixo}</span>}
      <input
        inputMode="decimal"
        aria-label={rotulo}
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ""))}
        className={cn(
          "h-10 rounded-lg border border-border bg-white text-right font-mono text-sm font-semibold focus:border-california-red focus:outline-none",
          largura,
          prefixo ? "pl-9 pr-3" : "pl-3",
          sufixo ? "pr-8" : "",
        )}
      />
      {sufixo && <span className="pointer-events-none absolute right-3 text-sm text-muted-foreground">{sufixo}</span>}
    </span>
  );
}

/** As regras como o formulário as edita: os números em texto. */
interface Rascunho {
  resultadoLigado: boolean;
  resultadoMinimo: string;
  planejadoLigado: boolean;
  ppLigado: boolean;
  linhasVermelhas: boolean;
  toleranciaLigada: boolean;
  toleranciaValor: string;
  toleranciaPct: string;
  adminDireto: boolean;
  membros: string[];
}

function rascunhoDe(r: RegrasDoComite, membros: string[]): Rascunho {
  return {
    resultadoLigado: r.resultadoLigado,
    resultadoMinimo: numeroParaTexto(r.resultadoMinimo),
    planejadoLigado: r.planejadoLigado,
    ppLigado: r.ppLigado,
    linhasVermelhas: r.linhasVermelhas,
    toleranciaLigada: r.toleranciaLigada,
    toleranciaValor: numeroParaTexto(r.toleranciaValor),
    toleranciaPct: numeroParaTexto(r.toleranciaPct),
    adminDireto: r.adminDireto,
    membros: [...membros].sort(),
  };
}

function papelDe(papel: string | null) {
  if (!papel) return "";
  try {
    return roleLabel(papel as AppRole);
  } catch {
    return "";
  }
}

export function Configuracoes({
  regras,
  membros,
  usuarios,
  ultimaAlteracao,
  souAdministrador,
}: {
  regras: RegrasDoComite;
  membros: MembroDoComite[];
  usuarios: UsuarioParaComite[];
  ultimaAlteracao: { por: string | null; em: string } | null;
  souAdministrador: boolean;
}) {
  const router = useRouter();
  const salvo = React.useMemo(() => rascunhoDe(regras, membros.map((m) => m.id)), [regras, membros]);
  const [c, setC] = React.useState<Rascunho>(salvo);
  React.useEffect(() => setC(salvo), [salvo]);
  const [novoMembro, setNovoMembro] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, startTransition] = React.useTransition();
  const mudou = JSON.stringify(c) !== JSON.stringify(salvo);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setC((a) => ({ ...a, [k]: v }));

  const nomes = new Map<string, { nome: string; papel: string | null }>([
    ...usuarios.map((u) => [u.id, { nome: u.nome, papel: null }] as const),
    ...membros.map((m) => [m.id, { nome: m.nome, papel: m.papel }] as const),
  ]);
  const listaDeMembros = c.membros
    .map((id) => ({ id, ...(nomes.get(id) ?? { nome: "—", papel: null }) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const foraDoComite = usuarios.filter((u) => !c.membros.includes(u.id));

  function salvar() {
    setErro(null);
    const r: RegrasDoComite = {
      resultadoLigado: c.resultadoLigado,
      resultadoMinimo: textoParaNumero(c.resultadoMinimo),
      planejadoLigado: c.planejadoLigado,
      ppLigado: c.ppLigado,
      linhasVermelhas: c.linhasVermelhas,
      toleranciaLigada: c.toleranciaLigada,
      toleranciaValor: textoParaNumero(c.toleranciaValor),
      toleranciaPct: textoParaNumero(c.toleranciaPct),
      adminDireto: c.adminDireto,
    };
    const entram = c.membros.filter((id) => !salvo.membros.includes(id));
    const saem = salvo.membros.filter((id) => !c.membros.includes(id));
    startTransition(async () => {
      const res = await salvarRegrasDoComite(r);
      if (!res.ok) return setErro(res.message);
      // Primeiro quem entra: tirar o último antes de entrar o novo
      // esbarraria no "ao menos um membro".
      for (const id of entram) {
        const m = await adicionarMembroDoComite(id);
        if (!m.ok) return setErro(m.message);
      }
      for (const id of saem) {
        const m = await removerMembroDoComite(id);
        if (!m.ok) return setErro(m.message);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
        <Info className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Quem esbarra numa regra ligada envia o pedido para cá — o “Aprovar versão” do GP e o “Gerar PP” viram
          “Solicitar aprovação”. Aprovado, a versão fica aprovada e a PP fica liberada para gerar; depois disso, só
          volta para cá se piorar.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <header className="border-b border-border px-5 py-3.5">
          <h2 className="text-base font-bold">Abertura de job</h2>
          <p className="text-[12.5px] text-muted-foreground">Conferidas ao aprovar a versão do orçamento. Basta uma.</p>
        </header>
        <Regra
          titulo="Resultado geral abaixo do mínimo"
          descricao="O Resultado geral do cabeçalho da versão. O serviço Interno fica fora."
          ligada={c.resultadoLigado}
          onLigar={(v) => set("resultadoLigado", v)}
        >
          <span className="flex items-center gap-2 text-sm">
            abaixo de
            <CampoNumero
              rotulo="Resultado geral mínimo"
              valor={c.resultadoMinimo}
              onChange={(v) => set("resultadoMinimo", v)}
              sufixo="%"
              largura="w-24"
            />
          </span>
        </Regra>
        <Regra
          titulo="Planejado acima do orçado"
          descricao="Qualquer item da versão com o planejado maior que o orçado."
          ligada={c.planejadoLigado}
          onLigar={(v) => set("planejadoLigado", v)}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <header className="border-b border-border px-5 py-3.5">
          <h2 className="text-base font-bold">PPs</h2>
          <p className="text-[12.5px] text-muted-foreground">Conferidas ao gerar ou editar a PP, em qualquer job.</p>
        </header>
        <Regra
          titulo="Realizado acima do orçado"
          descricao="O realizado do item, somado à PP nova, passa do orçado do item."
          ligada={c.ppLigado}
          onLigar={(v) => set("ppLigado", v)}
        />
        <Regra
          titulo="PPs em linhas vermelhas"
          descricao="A linha criada pela errata nasce com orçado zero, então toda PP nela passa do orçado. Ligada, a PP vem sempre para o Comitê; desligada, quem gera a PP segue sem o Comitê."
          ligada={c.linhasVermelhas}
          onLigar={(v) => set("linhasVermelhas", v)}
        />
        <Regra
          titulo="Tolerância para excesso pequeno"
          descricao="Abaixo dos dois limites, quem gera a PP segue sem o Comitê."
          ligada={c.toleranciaLigada}
          onLigar={(v) => set("toleranciaLigada", v)}
        >
          <span className="flex flex-wrap items-center gap-2 text-sm">
            até
            <CampoNumero
              rotulo="Tolerância em reais"
              valor={c.toleranciaValor}
              onChange={(v) => set("toleranciaValor", v)}
              prefixo="R$"
              largura="w-36"
            />
            e até
            <CampoNumero
              rotulo="Tolerância em percentual"
              valor={c.toleranciaPct}
              onChange={(v) => set("toleranciaPct", v)}
              sufixo="%"
              largura="w-24"
            />
            do orçado do item
          </span>
        </Regra>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold">Membros · {listaDeMembros.length}</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Quem está aqui vê o módulo e decide. Basta um membro.
              {souAdministrador ? "" : " O administrador também decide."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-72">
              <Combobox
                items={foraDoComite.map((u) => ({ value: u.id, label: u.nome }))}
                value={novoMembro}
                onChange={setNovoMembro}
                placeholder="Escolha um usuário"
                buscaPlaceholder="Buscar usuário"
                ariaLabel="Usuário para o Comitê"
                className="h-9"
              />
            </div>
            <button
              type="button"
              disabled={!novoMembro}
              onClick={() => {
                if (!novoMembro) return;
                set("membros", [...c.membros, novoMembro].sort());
                setNovoMembro(null);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-sm font-semibold hover:bg-accent disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </button>
          </div>
        </header>
        {listaDeMembros.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Nenhum membro ainda. Enquanto isso, só o administrador decide os pedidos.
          </p>
        ) : (
          <ul>
            {listaDeMembros.map((m) => (
              <li key={m.id} className="flex items-center gap-3 border-b border-border/70 px-5 py-2.5 last:border-0">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-california-red/10 text-[11px] font-bold text-california-red">
                  {initials(m.nome)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{m.nome}</span>
                  {papelDe(m.papel) && <span className="block text-[11.5px] text-muted-foreground">{papelDe(m.papel)}</span>}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Tirar ${m.nome} do Comitê`}
                      disabled={listaDeMembros.length === 1 && salvo.membros.length > 0}
                      onClick={() => set("membros", c.membros.filter((x) => x !== m.id))}
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-white p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {listaDeMembros.length === 1 && salvo.membros.length > 0
                      ? "O Comitê precisa de ao menos um membro"
                      : "Tirar do Comitê"}
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border/70" />
        <Regra
          titulo="O administrador também aprova direto na tela"
          descricao="Como hoje: o administrador aprova a versão ou gera a PP sem passar pelo Comitê. Desligada, tudo passa por aqui."
          ligada={c.adminDireto}
          onLigar={(v) => set("adminDireto", v)}
        />
      </section>

      <div
        className={cn(
          "sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3 shadow-elevated transition-colors",
          mudou || erro ? "border-california-red/40 bg-white" : "border-border bg-white/90",
        )}
      >
        <p className="text-sm text-muted-foreground">
          {erro ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-california-red">
              <AlertTriangle className="h-4 w-4" />
              {erro}
            </span>
          ) : mudou ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-california-red">
              <AlertTriangle className="h-4 w-4" />
              Alterações não salvas
            </span>
          ) : ultimaAlteracao ? (
            `Última alteração: ${ultimaAlteracao.por ?? "—"}, ${formatDataAsHoraBr(ultimaAlteracao.em)}.`
          ) : (
            "Regras padrão: as mesmas de antes do Comitê."
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setC({ ...rascunhoDe(REGRAS_PADRAO_DO_COMITE, c.membros) })}
            disabled={salvando}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Voltar ao padrão
          </button>
          <button
            type="button"
            disabled={!mudou || salvando}
            onClick={() => {
              setErro(null);
              setC(salvo);
            }}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
          >
            Descartar
          </button>
          <button
            type="button"
            disabled={!mudou || salvando}
            onClick={salvar}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            {salvando ? "Salvando…" : "Salvar regras"}
          </button>
        </div>
      </div>
    </div>
  );
}
