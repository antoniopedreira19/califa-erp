"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Sparkles,
  ChevronDown,
  ArrowRight,
  Check,
  FileCheck,
  HandCoins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarCargo } from "@/lib/formatar-cargo";
import { createClient } from "@/lib/supabase/client";

/**
 * Pill "Novidades" no hero do dashboard /freelancers. Agrupa 5 tipos de
 * notificação de atenção pra admin/rh/financeiro. Dismissal é compartilhado
 * entre todos os users do tenant via tabela `notificacoes_dismissed` + Realtime.
 *
 * Chaves de dismiss (prefixadas pelo módulo):
 *   freelas:distrato-solicitado:<contrato_id>
 *   freelas:distrato-aguardando-assinatura:<contrato_id>
 *   freelas:solicitacao-concluida:<solicitacao_id>
 */

export interface DistratoSolicitadoItem {
  contrato_id: string;
  freelancer_id: string;
  freelancer_nome: string;
  nome_job: string;
  cargo: string | null;
  solicitado_em: string;
  solicitado_por_nome: string | null;
  data_proposta: string | null;
}

export interface SolicitacaoConcluidaItem {
  solicitacao_id: string;
  freelancer_id: string | null;
  freelancer_nome: string;
  nome_job: string;
  cargo: string | null;
  solicitante_nome: string | null;
  atualizado_em: string;
  status: "aprovada" | "cadastrada" | "finalizada";
  tipo_contrato: "mensal" | "periodo" | "diarias" | null;
  dispensa_minuta: boolean;
}

interface Props {
  tenantId: string;
  distratos: DistratoSolicitadoItem[];
  distratosAguardandoAssinatura: DistratoSolicitadoItem[];
  contratacoes: SolicitacaoConcluidaItem[];
  renovacoes: SolicitacaoConcluidaItem[];
  dismissedIds: string[];
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });


function diasAtras(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return rtf.format(-dias, "day");
}

export function NovidadesPill({
  tenantId,
  distratos,
  distratosAguardandoAssinatura,
  contratacoes,
  renovacoes,
  dismissedIds,
}: Props) {
  const [aberto, setAberto] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const supabase = React.useMemo(() => createClient(), []);
  const [vistos, setVistos] = React.useState<Set<string>>(
    () => new Set(dismissedIds),
  );

  React.useEffect(() => {
    setVistos(new Set(dismissedIds));
  }, [dismissedIds]);

  // Realtime: escuta INSERTs em notificacoes_dismissed e adiciona ao set.
  React.useEffect(() => {
    const channel = supabase
      .channel("notificacoes_dismissed_changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notificacoes_dismissed" },
        (payload) => {
          const id = (payload.new as { notification_id?: string })?.notification_id;
          if (!id) return;
          setVistos((atual) => {
            if (atual.has(id)) return atual;
            const novo = new Set(atual);
            novo.add(id);
            return novo;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const btnRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);

  async function marcarVisto(id: string) {
    // Otimista: some imediatamente.
    setVistos((atual) => {
      if (atual.has(id)) return atual;
      const novo = new Set(atual);
      novo.add(id);
      return novo;
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("notificacoes_dismissed")
      .insert({
        notification_id: id,
        tenant_id: tenantId,
        dismissed_by: user?.id ?? null,
      });
    if (error && error.code !== "23505") {
      console.error("Erro ao marcar como visto:", error.message);
      setVistos((atual) => {
        const novo = new Set(atual);
        novo.delete(id);
        return novo;
      });
    }
  }

  function atualizarPos() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: r.left });
  }

  React.useEffect(() => {
    if (!aberto) return;
    atualizarPos();
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setAberto(false);
    }
    function onScrollOrResize() {
      atualizarPos();
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [aberto]);

  const distratosVisiveis = distratos.filter(
    (s) => !vistos.has(`freelas:distrato-solicitado:${s.contrato_id}`),
  );
  const distratosAguardandoVisiveis = distratosAguardandoAssinatura.filter(
    (s) => !vistos.has(`freelas:distrato-aguardando-assinatura:${s.contrato_id}`),
  );
  const contratacoesVisiveis = contratacoes.filter(
    (s) => !vistos.has(`freelas:solicitacao-concluida:${s.solicitacao_id}`),
  );
  const renovacoesVisiveis = renovacoes.filter(
    (s) => !vistos.has(`freelas:solicitacao-concluida:${s.solicitacao_id}`),
  );

  const total =
    distratosVisiveis.length +
    distratosAguardandoVisiveis.length +
    contratacoesVisiveis.length +
    renovacoesVisiveis.length;

  const semNovidades = total === 0;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
          "bg-white/10 backdrop-blur border-white/15 text-white hover:bg-white/15",
          aberto && "bg-white/15",
        )}
      >
        <Sparkles
          className={cn(
            "h-3.5 w-3.5",
            semNovidades ? "text-white/40" : "text-california-red",
          )}
        />
        <span>Novidades</span>
        <span
          className={cn(
            "tabular-nums rounded-full px-1.5 py-0.5 text-[10px] leading-none",
            semNovidades
              ? "bg-white/15 text-white/60"
              : "bg-california-red text-white",
          )}
        >
          {total}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            aberto && "rotate-180",
          )}
        />
      </button>

      {aberto &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-[420px] rounded-xl border border-border bg-white shadow-elevated overflow-hidden"
          >
            <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
              {semNovidades && (
                <div className="px-4 py-8 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 mb-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">
                    Nenhuma novidade
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Distratos e contratos que precisam de atenção vão aparecer
                    aqui.
                  </p>
                </div>
              )}

              {distratosVisiveis.length > 0 && (
                <Secao
                  titulo="Solicitações de distrato"
                  descricao="GPs pediram encerramento antecipado · gerar minuta"
                  cor="amber"
                  icon={HandCoins}
                >
                  {distratosVisiveis.map((s) => (
                    <Linha
                      key={s.contrato_id}
                      href={`/freelancers/${s.freelancer_id}`}
                      corDestaque="text-amber-700"
                      corHoverCheck="hover:bg-amber-50 hover:text-amber-700"
                      nomePrincipal={s.freelancer_nome}
                      destaque={s.nome_job}
                      cargo={s.cargo}
                      quando={s.solicitado_em}
                      por={s.solicitado_por_nome}
                      extra={
                        s.data_proposta
                          ? `Nova data: ${new Date(
                              s.data_proposta + "T00:00:00",
                            ).toLocaleDateString("pt-BR")}`
                          : null
                      }
                      onFechar={() => setAberto(false)}
                      onDismiss={() =>
                        marcarVisto(
                          `freelas:distrato-solicitado:${s.contrato_id}`,
                        )
                      }
                    />
                  ))}
                </Secao>
              )}

              {distratosAguardandoVisiveis.length > 0 && (
                <Secao
                  titulo="Distratos aguardando assinatura"
                  descricao="Minuta pronta · falta anexar PDF assinado do freela"
                  cor="amber"
                  icon={FileCheck}
                >
                  {distratosAguardandoVisiveis.map((s) => (
                    <Linha
                      key={s.contrato_id}
                      href={`/freelancers/${s.freelancer_id}`}
                      corDestaque="text-amber-700"
                      corHoverCheck="hover:bg-amber-50 hover:text-amber-700"
                      nomePrincipal={s.freelancer_nome}
                      destaque={s.nome_job}
                      cargo={s.cargo}
                      quando={s.solicitado_em}
                      por={s.solicitado_por_nome}
                      extra={
                        s.data_proposta
                          ? `Proposta: encerrar em ${new Date(
                              s.data_proposta + "T00:00:00",
                            ).toLocaleDateString("pt-BR")}`
                          : null
                      }
                      onFechar={() => setAberto(false)}
                      onDismiss={() =>
                        marcarVisto(
                          `freelas:distrato-aguardando-assinatura:${s.contrato_id}`,
                        )
                      }
                    />
                  ))}
                </Secao>
              )}

              {contratacoesVisiveis.length > 0 && (
                <Secao
                  titulo="Novas contratações"
                  descricao="Freela preencheu o formulário"
                  cor="sky"
                  icon={FileCheck}
                >
                  {contratacoesVisiveis.map((s) => (
                    <LinhaSolicitacao
                      key={s.solicitacao_id}
                      sol={s}
                      corDestaque="text-sky-700"
                      corHoverCheck="hover:bg-sky-50 hover:text-sky-700"
                      chipTipoCor="bg-sky-100 text-sky-800"
                      onFechar={() => setAberto(false)}
                      onDismiss={() =>
                        marcarVisto(
                          `freelas:solicitacao-concluida:${s.solicitacao_id}`,
                        )
                      }
                    />
                  ))}
                </Secao>
              )}

              {renovacoesVisiveis.length > 0 && (
                <Secao
                  titulo="Renovações aprovadas"
                  descricao="Freela que já existia · novo contrato criado"
                  cor="violet"
                  icon={FileCheck}
                >
                  {renovacoesVisiveis.map((s) => (
                    <LinhaSolicitacao
                      key={s.solicitacao_id}
                      sol={s}
                      corDestaque="text-violet-700"
                      corHoverCheck="hover:bg-violet-50 hover:text-violet-700"
                      chipTipoCor="bg-violet-100 text-violet-800"
                      onFechar={() => setAberto(false)}
                      onDismiss={() =>
                        marcarVisto(
                          `freelas:solicitacao-concluida:${s.solicitacao_id}`,
                        )
                      }
                    />
                  ))}
                </Secao>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Cabecalho({
  cor,
  titulo,
  children,
}: {
  cor: "muted" | "emerald" | "sky" | "amber";
  titulo: string;
  children: React.ReactNode;
}) {
  const bg = {
    muted: "bg-muted/30",
    emerald: "bg-emerald-50/60",
    sky: "bg-sky-50/60",
    amber: "bg-amber-50/60",
  }[cor];
  const text = {
    muted: "text-muted-foreground",
    emerald: "text-emerald-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
  }[cor];
  return (
    <div className={cn("px-4 py-2.5 border-t border-border", bg)}>
      <p
        className={cn(
          "text-[11px] font-bold uppercase tracking-[0.1em]",
          text,
        )}
      >
        {titulo}
      </p>
      <p className="text-[10px] text-muted-foreground/80 mt-0.5">{children}</p>
    </div>
  );
}

function Secao({
  titulo,
  descricao,
  cor,
  icon: Icon,
  children,
}: {
  titulo: string;
  descricao: string;
  cor: "emerald" | "sky" | "amber" | "violet";
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const bg = {
    emerald: "bg-emerald-50/60",
    sky: "bg-sky-50/60",
    amber: "bg-amber-50/60",
    violet: "bg-violet-50/60",
  }[cor];
  const text = {
    emerald: "text-emerald-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
    violet: "text-violet-700",
  }[cor];
  return (
    <div>
      <div className={cn("px-4 py-2.5 border-t border-border first:border-0", bg)}>
        <p
          className={cn(
            "text-[11px] font-bold uppercase tracking-[0.1em] flex items-center gap-1.5",
            text,
          )}
        >
          <Icon className="h-3 w-3" />
          {titulo}
        </p>
        <p className="text-[10px] text-muted-foreground/80 mt-0.5">
          {descricao}
        </p>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function Linha({
  href,
  corDestaque,
  corHoverCheck,
  nomePrincipal,
  destaque,
  cargo,
  quando,
  por,
  extra,
  onFechar,
  onDismiss,
}: {
  href: string | null;
  corDestaque: string;
  corHoverCheck: string;
  nomePrincipal: string;
  destaque: string;
  cargo: string | null;
  quando: string;
  por: string | null;
  extra?: string | null;
  onFechar: () => void;
  onDismiss: () => void;
}) {
  const conteudo = (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-foreground truncate">
        {nomePrincipal}
      </p>
      <p className={cn("text-[10px] font-semibold mt-0.5 truncate", corDestaque)}>
        {destaque}
        {cargo && (
          <>
            <span className="text-muted-foreground/40 font-normal">
              {" · "}
            </span>
            <span className="text-muted-foreground font-normal">{cargo}</span>
          </>
        )}
      </p>
      <p className="text-[10px] text-muted-foreground/80 mt-0.5">
        {diasAtras(quando)}
        {por && (
          <>
            <span className="text-muted-foreground/40 mx-1">·</span>
            por <span className="font-semibold">{por}</span>
          </>
        )}
      </p>
      {extra && (
        <p className="text-[10px] text-muted-foreground/80 mt-0.5">
          {extra}
        </p>
      )}
    </div>
  );

  return (
    <li className="flex items-stretch hover:bg-muted/40 transition-colors group">
      {href ? (
        <Link
          href={href}
          prefetch={false}
          onClick={onFechar}
          className="flex items-center justify-between gap-3 flex-1 min-w-0 pl-4 pr-2 py-2.5"
        >
          {conteudo}
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-california-red shrink-0" />
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-1 min-w-0 pl-4 pr-2 py-2.5">
          {conteudo}
        </div>
      )}
      <BotaoCheck onClick={onDismiss} aria={`Marcar ${nomePrincipal} como visto`} corHover={corHoverCheck} />
    </li>
  );
}

const TIPO_CONTRATO_LABEL = {
  mensal: "Mensal",
  diarias: "Diária",
  periodo: "Período",
} as const;

/** Linha específica das seções "Novas contratações" e "Renovações aprovadas".
 *  Mostra o nome + job + chip de tipo + destaque pra dispensa + label de ação
 *  pendente (gerar minuta / nada). */
function LinhaSolicitacao({
  sol,
  corDestaque,
  corHoverCheck,
  chipTipoCor,
  onFechar,
  onDismiss,
}: {
  sol: SolicitacaoConcluidaItem;
  corDestaque: string;
  corHoverCheck: string;
  chipTipoCor: string;
  onFechar: () => void;
  onDismiss: () => void;
}) {
  const href = sol.freelancer_id ? `/freelancers/${sol.freelancer_id}` : null;
  const tipoLabel = sol.tipo_contrato
    ? TIPO_CONTRATO_LABEL[sol.tipo_contrato]
    : null;
  // Gera minuta:
  //   - Renovação em 'aprovada' = contrato criado, aguarda minuta
  //   - Contratação em 'cadastrada' = freela preencheu, aguarda minuta
  // Em 'finalizada' a minuta já foi gerada (ou é dispensa).
  const precisaGerarMinuta =
    sol.status === "aprovada" || sol.status === "cadastrada";
  const conteudo = (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <p className="text-xs font-semibold text-foreground truncate">
          {sol.freelancer_nome}
        </p>
        {tipoLabel && (
          <span
            className={cn(
              "text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0",
              chipTipoCor,
            )}
          >
            {tipoLabel}
          </span>
        )}
      </div>
      <p
        className={cn("text-[10px] font-semibold mt-0.5 truncate", corDestaque)}
      >
        {sol.nome_job}
        {sol.cargo && (
          <>
            <span className="text-muted-foreground/40 font-normal">
              {" · "}
            </span>
            <span className="text-muted-foreground font-normal">
              {formatarCargo(sol.cargo)}
            </span>
          </>
        )}
      </p>
      <p className="text-[10px] text-muted-foreground/80 mt-0.5">
        {diasAtras(sol.atualizado_em)}
        {sol.solicitante_nome && (
          <>
            <span className="text-muted-foreground/40 mx-1">·</span>
            por <span className="font-semibold">{sol.solicitante_nome}</span>
          </>
        )}
      </p>
      {sol.dispensa_minuta ? (
        <p className="text-[10px] font-semibold text-emerald-700 mt-1">
          ✓ Diária curta · dispensa minuta
        </p>
      ) : precisaGerarMinuta ? (
        <p className="text-[10px] font-semibold text-amber-700 mt-1">
          → Gerar minuta
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Minuta pronta · nada a fazer
        </p>
      )}
    </div>
  );

  return (
    <li className="flex items-stretch hover:bg-muted/40 transition-colors group">
      {href ? (
        <Link
          href={href}
          prefetch={false}
          onClick={onFechar}
          className="flex items-center justify-between gap-3 flex-1 min-w-0 pl-4 pr-2 py-2.5"
        >
          {conteudo}
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-california-red shrink-0" />
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-1 min-w-0 pl-4 pr-2 py-2.5">
          {conteudo}
        </div>
      )}
      <BotaoCheck
        onClick={onDismiss}
        aria={`Marcar ${sol.freelancer_nome} como visto`}
        corHover={corHoverCheck}
      />
    </li>
  );
}

function BotaoCheck({
  onClick,
  aria,
  corHover,
}: {
  onClick: () => void;
  aria: string;
  corHover?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Marcar como visto"
      aria-label={aria}
      className={cn(
        "flex items-center justify-center w-10 border-l border-border text-muted-foreground transition-colors",
        corHover ?? "hover:bg-emerald-50 hover:text-emerald-700",
      )}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  );
}
