"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Sparkles,
  ChevronDown,
  ArrowRight,
  Check,
  FilePlus,
  FileCheck,
  HandCoins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

/**
 * Pill "Novidades" no hero do dashboard /freelancers. Agrupa 5 tipos de
 * notificação de atenção pra admin/rh/financeiro. Dismissal é compartilhado
 * entre todos os users do tenant via tabela `notificacoes_dismissed` + Realtime.
 *
 * Chaves de dismiss (prefixadas pelo módulo):
 *   freelas:novo:<freelancer_id>
 *   freelas:aditivo:<contrato_id>
 *   freelas:preenchimento:<contrato_id>
 *   freelas:distrato-solicitado:<contrato_id>
 *   freelas:solicitacao-concluida:<solicitacao_id>
 */

export interface NovoCadastroItem {
  id: string;
  nome_social: string;
  created_at: string;
  origem: "manual" | "form_publico";
}

export interface AditivoItem {
  contrato_id: string;
  freelancer_id: string;
  freelancer_nome: string;
  nome_job: string;
  cargo: string | null;
  created_at: string;
}

export interface PreenchimentoItem {
  contrato_id: string;
  freelancer_id: string;
  freelancer_nome: string;
  nome_job: string;
  cargo: string | null;
  alterado_em: string;
  alterado_por_nome: string | null;
}

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
}

interface Props {
  tenantId: string;
  novos: NovoCadastroItem[];
  aditivos: AditivoItem[];
  preenchimentos: PreenchimentoItem[];
  distratos: DistratoSolicitadoItem[];
  concluidas: SolicitacaoConcluidaItem[];
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
  novos,
  aditivos,
  preenchimentos,
  distratos,
  concluidas,
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

  const novosVisiveis = novos.filter((n) => !vistos.has(`freelas:novo:${n.id}`));
  const aditivosVisiveis = aditivos.filter(
    (a) => !vistos.has(`freelas:aditivo:${a.contrato_id}`),
  );
  const preenchimentosVisiveis = preenchimentos.filter(
    (p) => !vistos.has(`freelas:preenchimento:${p.contrato_id}`),
  );
  const distratosVisiveis = distratos.filter(
    (s) => !vistos.has(`freelas:distrato-solicitado:${s.contrato_id}`),
  );
  const concluidasVisiveis = concluidas.filter(
    (s) => !vistos.has(`freelas:solicitacao-concluida:${s.solicitacao_id}`),
  );

  const total =
    novosVisiveis.length +
    aditivosVisiveis.length +
    preenchimentosVisiveis.length +
    distratosVisiveis.length +
    concluidasVisiveis.length;

  if (total === 0) return null;

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
        <Sparkles className="h-3.5 w-3.5 text-california-red" />
        <span>Novidades</span>
        <span className="tabular-nums rounded-full bg-california-red px-1.5 py-0.5 text-[10px] leading-none text-white">
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
            className="fixed z-50 w-[320px] rounded-xl border border-border bg-white shadow-elevated overflow-hidden"
          >
            <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
              {preenchimentosVisiveis.length > 0 && (
                <Secao
                  titulo="Contratos preenchidos"
                  descricao="Freelas que estavam aguardando ganharam contrato"
                  cor="emerald"
                  icon={FileCheck}
                >
                  {preenchimentosVisiveis.map((p) => (
                    <Linha
                      key={p.contrato_id}
                      href={`/freelancers/${p.freelancer_id}`}
                      corDestaque="text-emerald-700"
                      corHoverCheck="hover:bg-emerald-50 hover:text-emerald-700"
                      nomePrincipal={p.freelancer_nome}
                      destaque={p.nome_job}
                      cargo={p.cargo}
                      quando={p.alterado_em}
                      por={p.alterado_por_nome}
                      onFechar={() => setAberto(false)}
                      onDismiss={() =>
                        marcarVisto(`freelas:preenchimento:${p.contrato_id}`)
                      }
                    />
                  ))}
                </Secao>
              )}

              {novosVisiveis.length > 0 && (
                <div>
                  <Cabecalho cor="muted" titulo="Novos cadastros">
                    {novosVisiveis.length}{" "}
                    {novosVisiveis.length === 1 ? "freelancer" : "freelancers"}{" "}
                    pendente{novosVisiveis.length === 1 ? "" : "s"}
                  </Cabecalho>
                  <ul>
                    {novosVisiveis.map((n) => (
                      <li
                        key={n.id}
                        className="flex items-stretch hover:bg-muted/40 transition-colors group"
                      >
                        <Link
                          href={`/freelancers/${n.id}`}
                          prefetch={false}
                          onClick={() => setAberto(false)}
                          className="flex items-center justify-between gap-3 flex-1 min-w-0 pl-4 pr-2 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {n.nome_social}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                              <span>{diasAtras(n.created_at)}</span>
                              <span className="text-muted-foreground/40">·</span>
                              <span
                                className={cn(
                                  "font-semibold",
                                  n.origem === "form_publico"
                                    ? "text-california-red"
                                    : "text-muted-foreground",
                                )}
                              >
                                {n.origem === "form_publico"
                                  ? "formulário"
                                  : "manual"}
                              </span>
                            </p>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-california-red shrink-0" />
                        </Link>
                        <BotaoCheck
                          onClick={() => marcarVisto(`freelas:novo:${n.id}`)}
                          aria={`Marcar ${n.nome_social} como visto`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {aditivosVisiveis.length > 0 && (
                <Secao
                  titulo="Aditivos"
                  descricao="Novos contratos em freelas existentes · aguardando PDF"
                  cor="sky"
                  icon={FilePlus}
                >
                  {aditivosVisiveis.map((a) => (
                    <Linha
                      key={a.contrato_id}
                      href={`/freelancers/${a.freelancer_id}`}
                      corDestaque="text-sky-700"
                      corHoverCheck="hover:bg-sky-50 hover:text-sky-700"
                      nomePrincipal={a.freelancer_nome}
                      destaque={a.nome_job}
                      cargo={a.cargo}
                      quando={a.created_at}
                      por={null}
                      onFechar={() => setAberto(false)}
                      onDismiss={() =>
                        marcarVisto(`freelas:aditivo:${a.contrato_id}`)
                      }
                    />
                  ))}
                </Secao>
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

              {concluidasVisiveis.length > 0 && (
                <Secao
                  titulo="Solicitações concluídas"
                  descricao="Contrato criado · falta anexar PDF"
                  cor="sky"
                  icon={FileCheck}
                >
                  {concluidasVisiveis.map((s) => (
                    <Linha
                      key={s.solicitacao_id}
                      href={
                        s.freelancer_id ? `/freelancers/${s.freelancer_id}` : null
                      }
                      corDestaque="text-sky-700"
                      corHoverCheck="hover:bg-sky-50 hover:text-sky-700"
                      nomePrincipal={s.freelancer_nome}
                      destaque={s.nome_job}
                      cargo={s.cargo}
                      quando={s.atualizado_em}
                      por={s.solicitante_nome}
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
  cor: "emerald" | "sky" | "amber";
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const bg = {
    emerald: "bg-emerald-50/60",
    sky: "bg-sky-50/60",
    amber: "bg-amber-50/60",
  }[cor];
  const text = {
    emerald: "text-emerald-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
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
