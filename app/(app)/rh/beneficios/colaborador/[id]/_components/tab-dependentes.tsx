"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DependenteComPlanos,
  VinculoDoColaborador,
} from "@/lib/queries/beneficios";
import { coresBeneficio } from "@/lib/beneficios/cores";
import {
  desativarDependente,
  incluirDepEmPlano,
  removerDepDePlano,
} from "@/lib/actions/beneficios/dependentes";

const formatarData = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

const formatarCpf = (c: string) => {
  const d = c.replace(/\D/g, "");
  if (d.length !== 11) return c;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

export function TabDependentes({
  dependentes,
  vinculosAtivos,
}: {
  dependentes: DependenteComPlanos[];
  vinculosAtivos: VinculoDoColaborador[];
}) {
  const ativos = dependentes.filter(
    (d) => d.ativo && d.data_fim === null,
  );
  const inativos = dependentes.filter(
    (d) => !d.ativo || d.data_fim !== null,
  );

  return (
    <div className="space-y-5">
      {ativos.length === 0 && inativos.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          Nenhum dependente cadastrado. Clique em “Novo Dependente” no topo.
        </div>
      )}

      {ativos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ativos ({ativos.length})
          </h3>
          <div className="space-y-2">
            {ativos.map((d) => (
              <LinhaDependente
                key={d.id}
                dependente={d}
                vinculosAtivos={vinculosAtivos}
              />
            ))}
          </div>
        </section>
      )}

      {inativos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Inativos
          </h3>
          <div className="space-y-2">
            {inativos.map((d) => (
              <LinhaDependente
                key={d.id}
                dependente={d}
                vinculosAtivos={vinculosAtivos}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LinhaDependente({
  dependente,
  vinculosAtivos,
}: {
  dependente: DependenteComPlanos;
  vinculosAtivos: VinculoDoColaborador[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mostrarIncluir, setMostrarIncluir] = useState(false);
  const [vinculoSelecionado, setVinculoSelecionado] = useState<string>("");
  const ativo = dependente.ativo && dependente.data_fim === null;

  const vinculosDisponiveis = vinculosAtivos.filter(
    (v) =>
      !dependente.planos_incluidos.some((p) => p.vinculo_id === v.id),
  );

  function incluir() {
    if (!vinculoSelecionado) return;
    start(async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const res = await incluirDepEmPlano({
        vinculoId: vinculoSelecionado,
        dependenteId: dependente.id,
        dataInicio: hoje,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setMostrarIncluir(false);
      setVinculoSelecionado("");
      router.refresh();
    });
  }

  function remover(linkId: string, nome: string) {
    if (!confirm(`Remover ${dependente.nome} de ${nome}?`)) return;
    start(async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const res = await removerDepDePlano({ linkId, dataFim: hoje });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
    });
  }

  function desativar() {
    if (
      !confirm(
        `Desativar ${dependente.nome}? Essa ação remove de todos os planos ativos.`,
      )
    )
      return;
    start(async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      await Promise.all(
        dependente.planos_incluidos.map((p) =>
          removerDepDePlano({ linkId: p.link_id, dataFim: hoje }),
        ),
      );
      const res = await desativarDependente({
        dependenteId: dependente.id,
        dataFim: hoje,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className={`rounded-xl border p-4 shadow-soft ${
        ativo ? "border-border bg-card" : "border-border/60 bg-muted/20 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground">
            {dependente.nome}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              · {dependente.parentesco}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            CPF {formatarCpf(dependente.cpf)} · Nasc{" "}
            {formatarData(dependente.data_nascimento)}
          </div>
        </div>
        {ativo && (
          <button
            type="button"
            onClick={desativar}
            disabled={pending}
            className="text-xs font-medium text-red-600 hover:underline"
          >
            Desativar
          </button>
        )}
      </div>

      {ativo && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Incluído em:
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {dependente.planos_incluidos.length === 0 && (
              <span className="text-xs text-muted-foreground">Nenhum plano.</span>
            )}
            {dependente.planos_incluidos.map((p) => {
              const cores = coresBeneficio(p.beneficio_tipo);
              return (
                <span
                  key={p.link_id}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${cores.chip}`}
                >
                  {p.beneficio_nome}
                  <button
                    type="button"
                    onClick={() => remover(p.link_id, p.beneficio_nome)}
                    disabled={pending}
                    className="hover:text-red-700"
                    aria-label="Remover deste plano"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            {vinculosDisponiveis.length > 0 && !mostrarIncluir && (
              <button
                type="button"
                onClick={() => {
                  setVinculoSelecionado(vinculosDisponiveis[0]?.id ?? "");
                  setMostrarIncluir(true);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Incluir em plano
              </button>
            )}
            {mostrarIncluir && (
              <div className="flex items-center gap-1">
                <Select
                  value={vinculoSelecionado}
                  onValueChange={setVinculoSelecionado}
                >
                  <SelectTrigger className="h-7 w-[200px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {vinculosDisponiveis.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.beneficio_nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={incluir}
                  disabled={pending}
                  className="h-7 rounded-md bg-california-red px-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => setMostrarIncluir(false)}
                  disabled={pending}
                  className="h-7 rounded-md border border-border px-2 text-xs"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
