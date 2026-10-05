"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Loader2, HeartPulse, Smile, X, UserPlus } from "lucide-react";
import {
  carregarDadosDrawerColaborador,
  type DrawerColaboradorPayload,
} from "@/lib/actions/beneficios/carregar-drawer";
import {
  encerrarVinculo,
  mudarModoCusteio,
} from "@/lib/actions/beneficios/vinculos";
import {
  desativarDependente,
  incluirDepEmPlano,
  removerDepDePlano,
} from "@/lib/actions/beneficios/dependentes";
import type { BeneficioModoCusteio } from "@/lib/types";
import { FormVinculo } from "./form-vinculo";
import { FormDependente } from "./form-dependente";

const formatarBrl = (n: number | null | undefined) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
};

const formatarData = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

const formatarCpf = (c: string) => {
  const d = c.replace(/\D/g, "");
  if (d.length !== 11) return c;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const MODO_LABEL: Record<BeneficioModoCusteio, string> = {
  rateado: "Rateado 60/40",
  integral_empresa: "Integral empresa",
  integral_empresa_com_upgrade: "Integral + upgrade",
};

const TIPO_LABEL: Record<string, string> = {
  pj: "PJ",
  mei: "MEI",
  clt_recibo: "CLT + Recibo",
  clt: "CLT",
  estagio: "Estagiário",
  socio: "Sócio",
};

type AbaInterna = "vinculos" | "dependentes" | "breakdown";

type BeneficioOpcao = {
  id: string;
  nome: string;
  tipo: "saude" | "dental";
  beneficio_base_id: string | null;
};

export function DrawerColaboradorBeneficios({
  colaboradorId,
  ano,
  mes,
  onClose,
  beneficios,
}: {
  colaboradorId: string;
  ano: number;
  mes: number;
  onClose: () => void;
  beneficios: BeneficioOpcao[];
}) {
  const router = useRouter();
  const [aba, setAba] = useState<AbaInterna>("vinculos");
  const [dados, setDados] = useState<DrawerColaboradorPayload | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [showFormVinculo, setShowFormVinculo] = useState(false);
  const [showFormDependente, setShowFormDependente] = useState(false);

  async function recarregar() {
    setCarregando(true);
    const res = await carregarDadosDrawerColaborador(colaboradorId, ano, mes);
    if (!res.ok) {
      setErro(res.message);
      setCarregando(false);
      return;
    }
    setErro(null);
    setDados(res.data);
    setCarregando(false);
  }

  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colaboradorId, ano, mes]);

  return (
    <>
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {dados?.colaborador.nome ?? "Carregando…"}
            </DialogTitle>
            <DialogDescription>
              {dados ? (
                <>
                  {TIPO_LABEL[dados.colaborador.tipo_contratacao] ??
                    dados.colaborador.tipo_contratacao}{" "}
                  · {dados.colaborador.funcao} · Admissão{" "}
                  {formatarData(dados.colaborador.data_admissao)} · Competência{" "}
                  {String(mes).padStart(2, "0")}/{ano}
                </>
              ) : (
                "Carregando dados…"
              )}
            </DialogDescription>
          </DialogHeader>

          {carregando && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {erro && !carregando && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {erro}
            </div>
          )}

          {dados && !carregando && (
            <>
              {(!dados.colaborador.cpf || !dados.colaborador.data_nascimento) && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Este colaborador precisa de CPF e data de nascimento preenchidos
                  antes de vincular um benefício. Edite o cadastro em{" "}
                  <a
                    href={`/rh/colaboradores/${dados.colaborador.id}`}
                    className="underline"
                  >
                    Colaboradores
                  </a>
                  .
                </div>
              )}

              <div className="border-b border-border">
                <nav className="flex gap-6">
                  {(
                    [
                      { k: "vinculos", l: "Vínculos" },
                      { k: "dependentes", l: "Dependentes" },
                      { k: "breakdown", l: "Breakdown da competência" },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.k}
                      type="button"
                      onClick={() => setAba(t.k)}
                      className={`px-1 pb-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                        aba === t.k
                          ? "border-california-red text-california-red"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.l}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="max-h-[55vh] overflow-y-auto">
                {aba === "vinculos" && (
                  <AbaVinculos
                    vinculos={dados.vinculos}
                    onNovoVinculo={() => setShowFormVinculo(true)}
                    onMudanca={recarregar}
                  />
                )}
                {aba === "dependentes" && (
                  <AbaDependentes
                    dependentes={dados.dependentes}
                    vinculosAtivos={dados.vinculos.filter((v) => v.data_fim === null)}
                    onNovoDependente={() => setShowFormDependente(true)}
                    onMudanca={recarregar}
                  />
                )}
                {aba === "breakdown" && (
                  <AbaBreakdown breakdown={dados.breakdown} />
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <FormVinculo
        open={showFormVinculo}
        onOpenChange={(o) => {
          setShowFormVinculo(o);
          if (!o) {
            void recarregar();
            router.refresh();
          }
        }}
        colaboradorId={colaboradorId}
        beneficios={beneficios}
      />

      <FormDependente
        open={showFormDependente}
        onOpenChange={(o) => {
          setShowFormDependente(o);
          if (!o) {
            void recarregar();
            router.refresh();
          }
        }}
        colaboradorId={colaboradorId}
      />
    </>
  );
}

// =========================================================================
// Aba Vínculos
// =========================================================================

function AbaVinculos({
  vinculos,
  onNovoVinculo,
  onMudanca,
}: {
  vinculos: DrawerColaboradorPayload["vinculos"];
  onNovoVinculo: () => void;
  onMudanca: () => void;
}) {
  const ativos = vinculos.filter((v) => v.data_fim === null);
  const encerrados = vinculos.filter((v) => v.data_fim !== null);

  return (
    <div className="space-y-4 py-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNovoVinculo}
          className="inline-flex items-center gap-1 rounded-md bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90"
        >
          <Plus className="h-4 w-4" />
          Novo vínculo
        </button>
      </div>

      {ativos.length === 0 && encerrados.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Nenhum vínculo cadastrado. Clique em &quot;Novo vínculo&quot; acima.
        </p>
      )}

      {ativos.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ativos
          </h4>
          <div className="space-y-2">
            {ativos.map((v) => (
              <LinhaVinculo key={v.id} vinculo={v} ativo onMudanca={onMudanca} />
            ))}
          </div>
        </div>
      )}

      {encerrados.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Encerrados / anteriores
          </h4>
          <div className="space-y-2">
            {encerrados.map((v) => (
              <LinhaVinculo key={v.id} vinculo={v} ativo={false} onMudanca={onMudanca} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaVinculo({
  vinculo,
  ativo,
  onMudanca,
}: {
  vinculo: DrawerColaboradorPayload["vinculos"][number];
  ativo: boolean;
  onMudanca: () => void;
}) {
  const [pending, start] = useTransition();
  const [mostrarMudar, setMostrarMudar] = useState(false);
  const [novoModo, setNovoModo] = useState<BeneficioModoCusteio>(vinculo.modo_custeio);
  const Icon = vinculo.beneficio_tipo === "saude" ? HeartPulse : Smile;

  function encerrar() {
    if (!confirm(`Encerrar vínculo com ${vinculo.beneficio_nome} na data de hoje?`)) {
      return;
    }
    start(async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const res = await encerrarVinculo({ vinculoId: vinculo.id, dataFim: hoje });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      onMudanca();
    });
  }

  function mudar() {
    if (novoModo === vinculo.modo_custeio) {
      setMostrarMudar(false);
      return;
    }
    start(async () => {
      const res = await mudarModoCusteio({ vinculoId: vinculo.id, novoModo });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setMostrarMudar(false);
      onMudanca();
    });
  }

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        ativo ? "border-border bg-card" : "border-border/60 bg-muted/20 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${vinculo.beneficio_tipo === "saude" ? "text-rose-600" : "text-sky-600"}`} />
          <div className="min-w-0">
            <div className="font-medium text-foreground">{vinculo.beneficio_nome}</div>
            <div className="text-xs text-muted-foreground">
              {MODO_LABEL[vinculo.modo_custeio]} · desde {formatarData(vinculo.data_inicio)}
              {vinculo.data_fim && (
                <> · até {formatarData(vinculo.data_fim)}</>
              )}
            </div>
            {vinculo.observacao && (
              <div className="mt-1 text-xs italic text-muted-foreground">
                {vinculo.observacao}
              </div>
            )}
          </div>
        </div>
        {ativo && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setMostrarMudar((v) => !v)}
              disabled={pending}
              className="text-xs text-california-red hover:underline"
            >
              Mudar modo
            </button>
            <button
              type="button"
              onClick={encerrar}
              disabled={pending}
              className="text-xs text-red-600 hover:underline"
            >
              Encerrar
            </button>
          </div>
        )}
      </div>
      {mostrarMudar && ativo && (
        <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground">
              Novo modo
            </label>
            <select
              value={novoModo}
              onChange={(e) => setNovoModo(e.target.value as BeneficioModoCusteio)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="rateado">Rateado 60/40</option>
              <option value="integral_empresa">Integral empresa</option>
              <option value="integral_empresa_com_upgrade">Integral + upgrade</option>
            </select>
          </div>
          <button
            type="button"
            onClick={mudar}
            disabled={pending}
            className="h-9 rounded-md bg-california-red px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "..." : "Aplicar"}
          </button>
          <button
            type="button"
            onClick={() => setMostrarMudar(false)}
            disabled={pending}
            className="h-9 rounded-md border border-border px-3 text-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Aba Dependentes
// =========================================================================

function AbaDependentes({
  dependentes,
  vinculosAtivos,
  onNovoDependente,
  onMudanca,
}: {
  dependentes: DrawerColaboradorPayload["dependentes"];
  vinculosAtivos: DrawerColaboradorPayload["vinculos"];
  onNovoDependente: () => void;
  onMudanca: () => void;
}) {
  const ativos = dependentes.filter((d) => d.ativo && d.data_fim === null);
  const inativos = dependentes.filter((d) => !d.ativo || d.data_fim !== null);

  return (
    <div className="space-y-4 py-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNovoDependente}
          className="inline-flex items-center gap-1 rounded-md bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90"
        >
          <UserPlus className="h-4 w-4" />
          Novo dependente
        </button>
      </div>

      {ativos.length === 0 && inativos.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Nenhum dependente cadastrado.
        </p>
      )}

      {ativos.map((d) => (
        <LinhaDependente
          key={d.id}
          dependente={d}
          vinculosAtivos={vinculosAtivos}
          onMudanca={onMudanca}
        />
      ))}

      {inativos.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Inativos
          </h4>
          {inativos.map((d) => (
            <LinhaDependente
              key={d.id}
              dependente={d}
              vinculosAtivos={vinculosAtivos}
              onMudanca={onMudanca}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaDependente({
  dependente,
  vinculosAtivos,
  onMudanca,
}: {
  dependente: DrawerColaboradorPayload["dependentes"][number];
  vinculosAtivos: DrawerColaboradorPayload["vinculos"];
  onMudanca: () => void;
}) {
  const [pending, start] = useTransition();
  const [mostrarIncluir, setMostrarIncluir] = useState(false);
  const [vinculoSelecionado, setVinculoSelecionado] = useState<string>(
    vinculosAtivos[0]?.id ?? "",
  );
  const ativo = dependente.ativo && dependente.data_fim === null;

  const vinculosDisponiveis = vinculosAtivos.filter(
    (v) => !dependente.planos_incluidos.some((p) => p.vinculo_id === v.id),
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
      onMudanca();
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
      onMudanca();
    });
  }

  function desativar() {
    if (!confirm(`Desativar ${dependente.nome}? Essa ação remove de todos os planos ativos.`))
      return;
    start(async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      // Primeiro remove de todos os planos ativos
      for (const p of dependente.planos_incluidos) {
        await removerDepDePlano({ linkId: p.link_id, dataFim: hoje });
      }
      const res = await desativarDependente({
        dependenteId: dependente.id,
        dataFim: hoje,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      onMudanca();
    });
  }

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
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
          <div className="text-xs text-muted-foreground">
            CPF {formatarCpf(dependente.cpf)} · Nasc {formatarData(dependente.data_nascimento)}
          </div>
        </div>
        {ativo && (
          <button
            type="button"
            onClick={desativar}
            disabled={pending}
            className="text-xs text-red-600 hover:underline"
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
            {dependente.planos_incluidos.map((p) => (
              <span
                key={p.link_id}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                  p.beneficio_tipo === "saude"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-sky-200 bg-sky-50 text-sky-700"
                }`}
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
            ))}
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
                <select
                  value={vinculoSelecionado}
                  onChange={(e) => setVinculoSelecionado(e.target.value)}
                  className="h-7 rounded-md border border-border bg-background px-1 text-xs"
                >
                  {vinculosDisponiveis.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.beneficio_nome}
                    </option>
                  ))}
                </select>
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

// =========================================================================
// Aba Breakdown
// =========================================================================

function AbaBreakdown({
  breakdown,
}: {
  breakdown: DrawerColaboradorPayload["breakdown"];
}) {
  if (breakdown.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Nenhum vínculo ativo nesta competência.
      </div>
    );
  }

  const semFaixa = breakdown.some(
    (l) =>
      l.valor_integral_titular === null ||
      l.valor_integral_titular === undefined ||
      !Number.isFinite(Number(l.valor_integral_titular)),
  );
  const totalEmpresa = breakdown.reduce((s, l) => {
    const v = Number(l.valor_empresa_titular);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  const totalColaborador = breakdown.reduce((s, l) => {
    const v = Number(l.valor_desconto_folha_total);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);

  return (
    <div className="space-y-3 py-4">
      {semFaixa && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Alguma linha abaixo não encontrou faixa de preço cadastrada para a idade.
          Confira o catálogo do benefício em questão.
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Benefício</th>
              <th className="px-3 py-2 text-center">Idade</th>
              <th className="px-3 py-2 text-right">Integral titular</th>
              <th className="px-3 py-2 text-right">Empresa</th>
              <th className="px-3 py-2 text-right">Colab titular</th>
              <th className="px-3 py-2 text-center">Deps</th>
              <th className="px-3 py-2 text-right">Deps total</th>
              <th className="px-3 py-2 text-right">Desc folha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {breakdown.map((l) => {
              const semFaixaLinha =
                l.valor_integral_titular === null ||
                l.valor_integral_titular === undefined ||
                !Number.isFinite(Number(l.valor_integral_titular));
              return (
                <tr key={l.vinculo_id} className={semFaixaLinha ? "bg-amber-50/50" : ""}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.beneficio_nome}</div>
                    <div className="text-xs text-muted-foreground">
                      {MODO_LABEL[l.modo_custeio]}
                    </div>
                    {semFaixaLinha && (
                      <div className="mt-0.5 text-xs text-amber-700">
                        Faixa de preço não cadastrada para esta idade.
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {l.idade_titular}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatarBrl(l.valor_integral_titular)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                    {formatarBrl(l.valor_empresa_titular)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                    {formatarBrl(l.valor_colaborador_titular)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {l.qtde_dependentes}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                    {formatarBrl(l.valor_dependentes_total)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-800">
                    {formatarBrl(l.valor_desconto_folha_total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-muted/40 text-xs font-semibold">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right">
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                {formatarBrl(totalEmpresa)}
              </td>
              <td colSpan={3} />
              <td className="px-3 py-2 text-right tabular-nums text-amber-800">
                {formatarBrl(totalColaborador)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
