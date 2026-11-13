"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Sparkles,
  ChevronDown,
  FileText,
  CheckCircle2,
  DollarSign,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

/**
 * Pill "Novidades" no hero do Dashboard de Férias.
 * Inspirado no /freelancers/_components/novidades-pill — mesmo padrão
 * técnico (createPortal, posicionamento fixed recalculado, click fora,
 * realtime via Supabase channel, persistência em notificacoes_dismissed).
 *
 * Mostra 3 tipos de evento (últimos 7 dias):
 *   - Colaborador solicitou férias (link: /rh/ferias?tab=solicitacoes)
 *   - Colaborador anexou NF (link: /rh/ferias/<colab_id>)
 *   - Financeiro pagou as férias (link: /rh/ferias/<colab_id>)
 *
 * Cada item tem botão de "marcar como visto" que persiste em
 * notificacoes_dismissed com prefixo "ferias:".
 */

export type NovidadeSolicitacao = {
  lancamento_id: string;
  colaborador_nome: string;
  dias: number;
  data_inicio: string;
  criado_em: string;
};

export type NovidadeNfAnexada = {
  anexo_id: string;
  colaborador_id: string;
  colaborador_nome: string;
  tipo: "ferias_usufruto" | "ferias_abono";
  arquivo_nome: string;
  anexado_em: string;
};

export type NovidadeFeriasPagas = {
  folha_id: string;
  colaborador_id: string;
  colaborador_nome: string;
  tipo: "usufruto" | "abono";
  valor: number;
  pago_em: string;
};

type Props = {
  tenantId: string;
  solicitacoes: NovidadeSolicitacao[];
  nfsAnexadas: NovidadeNfAnexada[];
  feriasPagas: NovidadeFeriasPagas[];
  dismissedIds: string[];
};

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
function diasAtras(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return rtf.format(-dias, "day");
}

function keySolicitacao(id: string) {
  return `ferias:solicitacao-feita:${id}`;
}
function keyNf(id: string) {
  return `ferias:nf-anexada:${id}`;
}
function keyPaga(id: string) {
  return `ferias:ferias-pagas:${id}`;
}

export function PillNovidadesFerias({
  tenantId,
  solicitacoes,
  nfsAnexadas,
  feriasPagas,
  dismissedIds,
}: Props) {
  const [aberto, setAberto] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(
    null,
  );
  const supabase = React.useMemo(() => createClient(), []);
  const [vistos, setVistos] = React.useState<Set<string>>(
    () => new Set(dismissedIds),
  );
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setVistos(new Set(dismissedIds));
  }, [dismissedIds]);

  // Realtime: escuta INSERTs em notificacoes_dismissed e sincroniza.
  React.useEffect(() => {
    const channel = supabase
      .channel("ferias_notificacoes_dismissed_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notificacoes_dismissed",
        },
        (payload) => {
          const id = (payload.new as { notification_id?: string })
            ?.notification_id;
          if (!id || !id.startsWith("ferias:")) return;
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

  async function marcarVisto(id: string) {
    setVistos((atual) => {
      if (atual.has(id)) return atual;
      const novo = new Set(atual);
      novo.add(id);
      return novo;
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("notificacoes_dismissed").insert({
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
    // Alinha pela direita do botão (420px de popover).
    const left = Math.max(12, r.right - 420);
    setPos({ top: r.bottom + 8, left });
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

  const solicitacoesVisiveis = solicitacoes.filter(
    (s) => !vistos.has(keySolicitacao(s.lancamento_id)),
  );
  const nfsVisiveis = nfsAnexadas.filter((n) => !vistos.has(keyNf(n.anexo_id)));
  const feriasPagasVisiveis = feriasPagas.filter(
    (f) => !vistos.has(keyPaga(f.folha_id)),
  );

  const total =
    solicitacoesVisiveis.length +
    nfsVisiveis.length +
    feriasPagasVisiveis.length;
  const semNovidades = total === 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
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
            <div className="max-h-[480px] overflow-y-auto divide-y divide-border">
              {semNovidades && (
                <div className="px-4 py-8 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 mb-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">
                    Nenhuma novidade
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Quando houver solicitações, NFs anexadas ou pagamentos
                    recentes, aparecerá aqui.
                  </p>
                </div>
              )}

              {solicitacoesVisiveis.length > 0 && (
                <SecaoNovidade titulo="Solicitações feitas">
                  {solicitacoesVisiveis.map((s) => (
                    <ItemSolicitacao
                      key={s.lancamento_id}
                      item={s}
                      onMarcarVisto={() =>
                        marcarVisto(keySolicitacao(s.lancamento_id))
                      }
                      onIr={() => setAberto(false)}
                    />
                  ))}
                </SecaoNovidade>
              )}

              {nfsVisiveis.length > 0 && (
                <SecaoNovidade titulo="NFs anexadas pelo colaborador">
                  {nfsVisiveis.map((n) => (
                    <ItemNf
                      key={n.anexo_id}
                      item={n}
                      onMarcarVisto={() => marcarVisto(keyNf(n.anexo_id))}
                      onIr={() => setAberto(false)}
                    />
                  ))}
                </SecaoNovidade>
              )}

              {feriasPagasVisiveis.length > 0 && (
                <SecaoNovidade titulo="Férias pagas pelo financeiro">
                  {feriasPagasVisiveis.map((f) => (
                    <ItemPaga
                      key={f.folha_id}
                      item={f}
                      onMarcarVisto={() => marcarVisto(keyPaga(f.folha_id))}
                      onIr={() => setAberto(false)}
                    />
                  ))}
                </SecaoNovidade>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ----------------------- Seções ----------------------- */

function SecaoNovidade({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-4 py-2 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

/* ----------------------- Item: solicitação ----------------------- */

function ItemSolicitacao({
  item,
  onMarcarVisto,
  onIr,
}: {
  item: NovidadeSolicitacao;
  onMarcarVisto: () => void;
  onIr: () => void;
}) {
  const inicio = new Date(item.data_inicio + "T00:00:00").toLocaleDateString(
    "pt-BR",
  );
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-2.5">
        <div className="h-7 w-7 shrink-0 rounded-full bg-amber-100 flex items-center justify-center">
          <FileText className="h-3.5 w-3.5 text-amber-700" />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href="/rh/ferias?tab=solicitacoes"
            prefetch={false}
            onClick={onIr}
            className="block text-sm font-medium text-foreground hover:text-california-red truncate"
          >
            {item.colaborador_nome}
          </Link>
          <p className="text-xs text-muted-foreground mt-0.5">
            solicitou {item.dias} dia{item.dias === 1 ? "" : "s"} a partir de{" "}
            {inicio}
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            {diasAtras(item.criado_em)}
          </p>
        </div>
        <BotaoMarcarVisto onClick={onMarcarVisto} />
      </div>
    </li>
  );
}

/* ----------------------- Item: NF anexada ----------------------- */

function ItemNf({
  item,
  onMarcarVisto,
  onIr,
}: {
  item: NovidadeNfAnexada;
  onMarcarVisto: () => void;
  onIr: () => void;
}) {
  const label = item.tipo === "ferias_abono" ? "abono" : "usufruto";
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-2.5">
        <div className="h-7 w-7 shrink-0 rounded-full bg-sky-100 flex items-center justify-center">
          <CheckCircle2 className="h-3.5 w-3.5 text-sky-700" />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/rh/ferias/${item.colaborador_id}`}
            prefetch={false}
            onClick={onIr}
            className="block text-sm font-medium text-foreground hover:text-california-red truncate"
          >
            {item.colaborador_nome}
          </Link>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            anexou NF ({label}) · {item.arquivo_nome}
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            {diasAtras(item.anexado_em)}
          </p>
        </div>
        <BotaoMarcarVisto onClick={onMarcarVisto} />
      </div>
    </li>
  );
}

/* ----------------------- Item: férias pagas ----------------------- */

function ItemPaga({
  item,
  onMarcarVisto,
  onIr,
}: {
  item: NovidadeFeriasPagas;
  onMarcarVisto: () => void;
  onIr: () => void;
}) {
  const label = item.tipo === "abono" ? "abono" : "férias";
  const valorFmt = Number(item.valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-2.5">
        <div className="h-7 w-7 shrink-0 rounded-full bg-emerald-100 flex items-center justify-center">
          <DollarSign className="h-3.5 w-3.5 text-emerald-700" />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/rh/ferias/${item.colaborador_id}`}
            prefetch={false}
            onClick={onIr}
            className="block text-sm font-medium text-foreground hover:text-california-red truncate"
          >
            {item.colaborador_nome}
          </Link>
          <p className="text-xs text-muted-foreground mt-0.5">
            {label} pagas · {valorFmt}
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            {diasAtras(item.pago_em)}
          </p>
        </div>
        <BotaoMarcarVisto onClick={onMarcarVisto} />
      </div>
    </li>
  );
}

/* ----------------------- Botão marcar visto ----------------------- */

function BotaoMarcarVisto({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Marcar como visto"
      className="h-6 w-6 shrink-0 rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center"
      title="Marcar como visto"
    >
      <Check className="h-3 w-3" />
    </button>
  );
}
