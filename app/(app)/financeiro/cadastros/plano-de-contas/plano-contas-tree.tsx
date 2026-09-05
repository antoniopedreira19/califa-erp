"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Power,
  PowerOff,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  PlanoContaTipo,
  PlanoContaSubtipo,
  NaturezaPadraoTipo,
} from "@/lib/types";
import { TipoDrawer } from "./tipo-drawer";
import { SubtipoDrawer } from "./subtipo-drawer";
import {
  inativarTipo,
  reativarTipo,
  inativarSubtipo,
  reativarSubtipo,
} from "./actions";

type StatusFiltro = "ativas" | "inativas" | "todas";

function NaturezaChip({ natureza }: { natureza: NaturezaPadraoTipo }) {
  if (natureza === "entrada") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Entrada
      </span>
    );
  }
  if (natureza === "saida") {
    return (
      <span className="inline-flex items-center rounded-full border border-california-red/20 bg-california-red/5 px-2 py-0.5 text-xs font-medium text-california-red">
        Saída
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Ambos
    </span>
  );
}

function StatusChip({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        ativo
          ? "bg-emerald-50 text-emerald-700"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ativo ? "bg-emerald-500" : "bg-muted-foreground"}`}
      />
      {ativo ? "Ativo" : "Inativo"}
    </span>
  );
}

function proximoCodigoTipo(tipos: PlanoContaTipo[]): string {
  const usados = new Set(tipos.map((t) => t.codigo));
  for (let i = 1; i <= 99; i++) {
    const c = String(i).padStart(2, "0");
    if (!usados.has(c)) return c;
  }
  return "99";
}

function proximosCodigosSubtipoPorTipo(
  tipos: PlanoContaTipo[],
  subtipos: PlanoContaSubtipo[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const t of tipos) {
    const usados = new Set(
      subtipos.filter((s) => s.tipo_id === t.id).map((s) => s.codigo),
    );
    let escolhido = "999";
    for (let i = 1; i <= 999; i++) {
      const c = String(i).padStart(3, "0");
      if (!usados.has(c)) {
        escolhido = c;
        break;
      }
    }
    map[t.id] = escolhido;
  }
  return map;
}

export function PlanoContasTree({
  tipos,
  subtipos,
  tiposComLancamento,
  subtiposComLancamento,
  canEdit,
}: {
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  tiposComLancamento: string[];
  subtiposComLancamento: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();

  const [expandidos, setExpandidos] = React.useState<Set<string>>(
    () => new Set(tipos.map((t) => t.id)),
  );

  const [editandoTipo, setEditandoTipo] =
    React.useState<PlanoContaTipo | null>(null);
  const [editandoSubtipo, setEditandoSubtipo] =
    React.useState<PlanoContaSubtipo | null>(null);
  const [criandoSubtipoDoTipoId, setCriandoSubtipoDoTipoId] = React.useState<
    string | null
  >(null);
  const [confirmandoTipo, setConfirmandoTipo] = React.useState<{
    tipo: PlanoContaTipo;
    acao: "inativar" | "reativar";
  } | null>(null);
  const [confirmandoSubtipo, setConfirmandoSubtipo] = React.useState<{
    subtipo: PlanoContaSubtipo;
    acao: "inativar" | "reativar";
  } | null>(null);

  const tiposComLancamentoSet = React.useMemo(
    () => new Set(tiposComLancamento),
    [tiposComLancamento],
  );
  const subtiposComLancamentoSet = React.useMemo(
    () => new Set(subtiposComLancamento),
    [subtiposComLancamento],
  );

  const proximoCodTipo = React.useMemo(
    () => proximoCodigoTipo(tipos),
    [tipos],
  );
  const proximosCodSubtipo = React.useMemo(
    () => proximosCodigosSubtipoPorTipo(tipos, subtipos),
    [tipos, subtipos],
  );

  // Subtipos agrupados por tipo
  const subtiposPorTipo = React.useMemo(() => {
    const map = new Map<string, PlanoContaSubtipo[]>();
    for (const s of subtipos) {
      if (!map.has(s.tipo_id)) map.set(s.tipo_id, []);
      map.get(s.tipo_id)!.push(s);
    }
    // Ordena por codigo dentro de cada tipo
    for (const arr of map.values()) {
      arr.sort((a, b) => a.codigo.localeCompare(b.codigo));
    }
    return map;
  }, [subtipos]);

  // Filtra tipos + subtipos por status e busca
  const filtrado = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return tipos
      .map((t) => {
        const filhosBrutos = subtiposPorTipo.get(t.id) ?? [];
        const filhosStatus = filhosBrutos.filter((s) => {
          if (status === "ativas") return s.ativo;
          if (status === "inativas") return !s.ativo;
          return true;
        });

        if (!q) {
          return { tipo: t, filhos: filhosStatus, matchTipo: false };
        }

        const codigoFull = (s: PlanoContaSubtipo) =>
          `${t.codigo}.${s.codigo}`;
        const filhosBusca = filhosStatus.filter(
          (s) =>
            s.nome.toLowerCase().includes(q) ||
            s.codigo.toLowerCase().includes(q) ||
            codigoFull(s).toLowerCase().includes(q),
        );

        const matchTipo =
          t.codigo.toLowerCase().includes(q) ||
          t.nome.toLowerCase().includes(q);

        return {
          tipo: t,
          filhos: matchTipo ? filhosStatus : filhosBusca,
          matchTipo,
        };
      })
      .filter(({ tipo, filhos, matchTipo }) => {
        const tipoPassaStatus =
          status === "ativas"
            ? tipo.ativo
            : status === "inativas"
              ? !tipo.ativo
              : true;

        if (!q) return tipoPassaStatus;
        // Com busca: mostra o tipo se ele mesmo bate OU se algum filho bate
        return (tipoPassaStatus && matchTipo) || filhos.length > 0;
      })
      .sort((a, b) => a.tipo.codigo.localeCompare(b.tipo.codigo));
  }, [tipos, subtiposPorTipo, busca, status]);

  // Quando há busca, força tipos com match a ficarem expandidos
  React.useEffect(() => {
    if (busca.trim().length === 0) return;
    setExpandidos(new Set(filtrado.map((f) => f.tipo.id)));
  }, [busca, filtrado]);

  function toggleExpand(tipoId: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(tipoId)) next.delete(tipoId);
      else next.add(tipoId);
      return next;
    });
  }

  function expandirTodos() {
    setExpandidos(new Set(tipos.map((t) => t.id)));
  }

  function colapsarTodos() {
    setExpandidos(new Set());
  }

  function handleConfirmTipo() {
    if (!confirmandoTipo) return;
    const { tipo, acao } = confirmandoTipo;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarTipo(tipo.id)
          : await reativarTipo(tipo.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmandoTipo(null);
      router.refresh();
    });
  }

  function handleConfirmSubtipo() {
    if (!confirmandoSubtipo) return;
    const { subtipo, acao } = confirmandoSubtipo;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarSubtipo(subtipo.id)
          : await reativarSubtipo(subtipo.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmandoSubtipo(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por código ou nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as StatusFiltro)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativas">Ativos</SelectItem>
              <SelectItem value="inativas">Inativos</SelectItem>
              <SelectItem value="todas">Todos</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={expandirTodos}
              className="rounded-md px-2 py-1 hover:bg-muted transition-colors"
            >
              Expandir tudo
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={colapsarTodos}
              className="rounded-md px-2 py-1 hover:bg-muted transition-colors"
            >
              Colapsar tudo
            </button>
          </div>
        </div>
        {canEdit && <TipoDrawer mode="criar" proximoCodigo={proximoCodTipo} />}
      </div>

      {/* Árvore */}
      {filtrado.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {tipos.length === 0
              ? "Nenhum tipo cadastrado ainda."
              : "Nenhum resultado para os filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {filtrado.map(({ tipo, filhos }, idx) => {
            const isOpen = expandidos.has(tipo.id);
            return (
              <div
                key={tipo.id}
                className={idx > 0 ? "border-t border-border" : ""}
              >
                {/* Linha do tipo */}
                <div
                  onClick={() => toggleExpand(tipo.id)}
                  className="group flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(tipo.id);
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    aria-label={isOpen ? "Colapsar" : "Expandir"}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <span className="inline-flex items-center rounded-md bg-california-red/5 border border-california-red/20 px-2 py-1 font-mono text-xs font-semibold tracking-wide text-california-red">
                    {tipo.codigo}
                  </span>
                  <span
                    className={`flex-1 text-sm font-semibold ${!tipo.ativo ? "text-muted-foreground line-through" : ""}`}
                    onClick={(e) => {
                      if (canEdit) {
                        e.stopPropagation();
                        setEditandoTipo(tipo);
                      }
                    }}
                    title={canEdit ? "Editar tipo" : undefined}
                  >
                    {tipo.nome}
                  </span>
                  <NaturezaChip natureza={tipo.natureza_padrao} />
                  <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                    {filhos.length} sub{filhos.length === 1 ? "" : "s"}
                  </span>
                  <StatusChip ativo={tipo.ativo} />
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit && tipo.ativo && (
                      <button
                        type="button"
                        onClick={() => setCriandoSubtipoDoTipoId(tipo.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title="Adicionar subtipo"
                      >
                        <Plus className="h-3 w-3" />
                        Subtipo
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmandoTipo({
                            tipo,
                            acao: tipo.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={tipo.ativo ? "Inativar" : "Reativar"}
                      >
                        {tipo.ativo ? (
                          <PowerOff className="h-3.5 w-3.5" />
                        ) : (
                          <Power className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Subtipos */}
                {isOpen && (
                  <div className="border-t border-border bg-muted/20">
                    {filhos.length === 0 ? (
                      <div className="py-4 pl-12 pr-4 text-xs text-muted-foreground italic">
                        Sem subtipos.
                      </div>
                    ) : (
                      filhos.map((s) => (
                        <div
                          key={s.id}
                          onClick={() => canEdit && setEditandoSubtipo(s)}
                          className={`flex items-center gap-3 pl-12 pr-3 py-2.5 border-t border-border/60 first:border-t-0 transition-colors hover:bg-muted/50 ${canEdit ? "cursor-pointer" : ""}`}
                        >
                          <span className="inline-flex items-center rounded border border-border bg-background px-2 py-0.5 font-mono text-xs tracking-wide text-muted-foreground">
                            {tipo.codigo}.{s.codigo}
                          </span>
                          <span
                            className={`flex-1 text-sm ${!s.ativo ? "text-muted-foreground line-through" : ""}`}
                          >
                            {s.nome}
                          </span>
                          <StatusChip ativo={s.ativo} />
                          <div
                            className="flex items-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmandoSubtipo({
                                    subtipo: s,
                                    acao: s.ativo ? "inativar" : "reativar",
                                  })
                                }
                                className="inline-flex items-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                title={s.ativo ? "Inativar" : "Reativar"}
                              >
                                {s.ativo ? (
                                  <PowerOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Power className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer edição de tipo */}
      {editandoTipo && (
        <TipoDrawer
          mode="editar"
          tipo={editandoTipo}
          codigoBloqueado={tiposComLancamentoSet.has(editandoTipo.id)}
          open={!!editandoTipo}
          onOpenChange={(next) => {
            if (!next) setEditandoTipo(null);
          }}
        />
      )}

      {/* Drawer criação de subtipo (a partir do botão + Subtipo dentro do tipo) */}
      {criandoSubtipoDoTipoId && (
        <SubtipoDrawer
          mode="criar"
          tipos={tipos}
          tipoIdInicial={criandoSubtipoDoTipoId}
          proximosCodigos={proximosCodSubtipo}
          open={!!criandoSubtipoDoTipoId}
          onOpenChange={(next) => {
            if (!next) setCriandoSubtipoDoTipoId(null);
          }}
        />
      )}

      {/* Drawer edição de subtipo */}
      {editandoSubtipo && (
        <SubtipoDrawer
          mode="editar"
          subtipo={editandoSubtipo}
          tipos={tipos}
          codigoBloqueado={subtiposComLancamentoSet.has(editandoSubtipo.id)}
          open={!!editandoSubtipo}
          onOpenChange={(next) => {
            if (!next) setEditandoSubtipo(null);
          }}
        />
      )}

      {/* Confirm tipo */}
      {confirmandoTipo && (
        <ConfirmDialog
          open={!!confirmandoTipo}
          onOpenChange={(next) => {
            if (!next) setConfirmandoTipo(null);
          }}
          title={
            confirmandoTipo.acao === "inativar"
              ? "Inativar tipo?"
              : "Reativar tipo?"
          }
          description={
            confirmandoTipo.acao === "inativar"
              ? `O tipo "${confirmandoTipo.tipo.codigo} — ${confirmandoTipo.tipo.nome}" ficará inativo e não poderá ser usado em novos lançamentos.`
              : `O tipo "${confirmandoTipo.tipo.codigo} — ${confirmandoTipo.tipo.nome}" voltará a ficar disponível.`
          }
          confirmLabel={
            confirmandoTipo.acao === "inativar" ? "Inativar" : "Reativar"
          }
          onConfirm={handleConfirmTipo}
          pending={pending}
        />
      )}

      {/* Confirm subtipo */}
      {confirmandoSubtipo && (
        <ConfirmDialog
          open={!!confirmandoSubtipo}
          onOpenChange={(next) => {
            if (!next) setConfirmandoSubtipo(null);
          }}
          title={
            confirmandoSubtipo.acao === "inativar"
              ? "Inativar subtipo?"
              : "Reativar subtipo?"
          }
          description={
            confirmandoSubtipo.acao === "inativar"
              ? `O subtipo "${confirmandoSubtipo.subtipo.nome}" ficará inativo e não poderá ser usado em novos lançamentos.`
              : `O subtipo "${confirmandoSubtipo.subtipo.nome}" voltará a ficar disponível.`
          }
          confirmLabel={
            confirmandoSubtipo.acao === "inativar" ? "Inativar" : "Reativar"
          }
          onConfirm={handleConfirmSubtipo}
          pending={pending}
        />
      )}
    </div>
  );
}
