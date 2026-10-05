"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, X } from "lucide-react";
import type { BeneficioCompleto } from "@/lib/queries/beneficios";
import {
  editarBeneficio,
  criarFaixa,
  editarFaixa,
  removerFaixa,
} from "@/lib/actions/beneficios/catalogo";

const formatarBrl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

export function DrawerCatalogoBeneficio({
  beneficio,
  beneficiosParaBase,
  onClose,
}: {
  beneficio: BeneficioCompleto;
  beneficiosParaBase: BeneficioCompleto[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [nome, setNome] = useState(beneficio.nome);
  const [operadora, setOperadora] = useState(beneficio.operadora);
  const [percEmp, setPercEmp] = useState(beneficio.percentual_empresa_titular);
  const [percDep, setPercDep] = useState(beneficio.percentual_colaborador_dependentes);
  const [valorFlat, setValorFlat] = useState<number | null>(
    beneficio.valor_flat !== null ? Number(beneficio.valor_flat) : null,
  );
  const [baseId, setBaseId] = useState<string | null>(beneficio.beneficio_base_id);
  const [codigo, setCodigo] = useState(beneficio.codigo_externo ?? "");
  const [ativo, setAtivo] = useState(beneficio.ativo);
  const [obs, setObs] = useState(beneficio.observacao ?? "");

  function salvar() {
    setErro(null);
    start(async () => {
      const res = await editarBeneficio({
        beneficioId: beneficio.id,
        nome,
        operadora,
        percentualEmpresaTitular: percEmp,
        percentualColaboradorDependentes: percDep,
        valorFlat: beneficio.modelo_preco === "flat" ? valorFlat : null,
        beneficioBaseId: baseId,
        codigoExterno: codigo || null,
        ativo,
        observacao: obs || null,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{beneficio.nome}</DialogTitle>
          <DialogDescription>
            {beneficio.operadora} · {beneficio.tipo === "saude" ? "Saúde" : "Dental"} ·{" "}
            {beneficio.modelo_preco === "flat" ? "Valor flat" : "Faixa etária"}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-2">
          {/* Dados básicos */}
          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dados básicos
            </h4>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Nome</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={200}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Operadora</label>
                <input
                  type="text"
                  value={operadora}
                  onChange={(e) => setOperadora(e.target.value)}
                  maxLength={200}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Código externo (operadora)
                </label>
                <input
                  type="text"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  maxLength={50}
                  placeholder="opcional"
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Ativo</label>
                <select
                  value={ativo ? "sim" : "nao"}
                  onChange={(e) => setAtivo(e.target.value === "sim")}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="sim">Ativo</option>
                  <option value="nao">Inativo</option>
                </select>
              </div>
            </div>
          </section>

          {/* Rateio */}
          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rateio padrão (modo rateado)
            </h4>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  % empresa (titular)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={percEmp}
                  onChange={(e) => setPercEmp(Number(e.target.value))}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Colaborador paga {100 - percEmp}% do titular.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  % colaborador (dependentes)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={percDep}
                  onChange={(e) => setPercDep(Number(e.target.value))}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Dependentes raramente são custeados pela empresa.
                </p>
              </div>
            </div>
          </section>

          {/* Modelo de preço */}
          {beneficio.modelo_preco === "flat" ? (
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Valor flat
              </h4>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Valor mensal por pessoa (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={valorFlat ?? ""}
                  onChange={(e) =>
                    setValorFlat(e.target.value ? Number(e.target.value) : null)
                  }
                  className="h-9 w-40 rounded-md border border-border bg-background px-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Cobrado por titular e por cada dependente incluído.
                </p>
              </div>
            </section>
          ) : (
            <>
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Benefício base (para modo upgrade)
                </h4>
                <select
                  value={baseId ?? ""}
                  onChange={(e) => setBaseId(e.target.value || null)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">— nenhum (este é um plano base) —</option>
                  {beneficiosParaBase.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nome}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Quando preenchido, este plano pode ser vinculado no modo &quot;integral empresa com upgrade&quot;
                  (empresa cobre o valor do base; colaborador paga a diferença).
                </p>
              </section>

              <TabelaFaixas
                beneficioId={beneficio.id}
                faixas={beneficio.faixas}
                pendingParent={pending}
              />
            </>
          )}

          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Observação
            </h4>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </section>

          {erro && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {erro}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pending}
            className="rounded-md bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabelaFaixas({
  beneficioId,
  faixas,
  pendingParent,
}: {
  beneficioId: string;
  faixas: BeneficioCompleto["faixas"];
  pendingParent: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  function remover(id: string, descricao: string) {
    if (!confirm(`Remover faixa ${descricao}?`)) return;
    start(async () => {
      const res = await removerFaixa({ faixaId: id });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Faixas de preço ({faixas.length})
        </h4>
        <button
          type="button"
          onClick={() => setNovoAberto(true)}
          disabled={pending || pendingParent}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          Nova faixa
        </button>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">De</th>
              <th className="px-3 py-2 text-left">Até</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {faixas.length === 0 && !novoAberto && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Nenhuma faixa cadastrada. Clique em &quot;Nova faixa&quot;.
                </td>
              </tr>
            )}
            {faixas.map((f) =>
              editandoId === f.id ? (
                <LinhaFaixaEdicao
                  key={f.id}
                  faixaId={f.id}
                  idadeMinInicial={f.idade_min}
                  idadeMaxInicial={f.idade_max}
                  valorInicial={Number(f.valor)}
                  onDone={() => setEditandoId(null)}
                />
              ) : (
                <tr key={f.id}>
                  <td className="px-3 py-2 tabular-nums">{f.idade_min}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {f.idade_max ?? "sem limite"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatarBrl(Number(f.valor))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditandoId(f.id)}
                      disabled={pending}
                      className="text-xs text-california-red hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        remover(f.id, `${f.idade_min}–${f.idade_max ?? "∞"}`)
                      }
                      disabled={pending}
                      className="ml-3 text-xs text-red-600 hover:underline"
                    >
                      <X className="inline h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ),
            )}
            {novoAberto && (
              <LinhaFaixaNova
                beneficioId={beneficioId}
                onDone={() => setNovoAberto(false)}
              />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LinhaFaixaEdicao({
  faixaId,
  idadeMinInicial,
  idadeMaxInicial,
  valorInicial,
  onDone,
}: {
  faixaId: string;
  idadeMinInicial: number;
  idadeMaxInicial: number | null;
  valorInicial: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idadeMin, setIdadeMin] = useState(idadeMinInicial);
  const [idadeMax, setIdadeMax] = useState<number | null>(idadeMaxInicial);
  const [semLimite, setSemLimite] = useState(idadeMaxInicial === null);
  const [valor, setValor] = useState(valorInicial);

  function salvar() {
    start(async () => {
      const res = await editarFaixa({
        faixaId,
        idadeMin,
        idadeMax: semLimite ? null : idadeMax,
        valor,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <tr className="bg-california-red/5">
      <td className="px-3 py-2">
        <input
          type="number"
          value={idadeMin}
          onChange={(e) => setIdadeMin(Number(e.target.value))}
          className="h-7 w-16 rounded border border-border bg-background px-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={semLimite}
            onChange={(e) => setSemLimite(e.target.checked)}
          />
          sem limite
        </label>
        {!semLimite && (
          <input
            type="number"
            value={idadeMax ?? ""}
            onChange={(e) =>
              setIdadeMax(e.target.value ? Number(e.target.value) : null)
            }
            className="mt-1 h-7 w-16 rounded border border-border bg-background px-1 text-sm"
          />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          step="0.01"
          value={valor}
          onChange={(e) => setValor(Number(e.target.value))}
          className="h-7 w-24 rounded border border-border bg-background px-1 text-right text-sm"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="text-xs font-medium text-california-red hover:underline"
        >
          OK
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="ml-2 text-xs text-muted-foreground hover:underline"
        >
          Cancelar
        </button>
      </td>
    </tr>
  );
}

function LinhaFaixaNova({
  beneficioId,
  onDone,
}: {
  beneficioId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idadeMin, setIdadeMin] = useState(0);
  const [idadeMax, setIdadeMax] = useState<number | null>(null);
  const [semLimite, setSemLimite] = useState(false);
  const [valor, setValor] = useState(0);

  function salvar() {
    if (valor <= 0) {
      alert("Informe um valor maior que zero.");
      return;
    }
    start(async () => {
      const res = await criarFaixa({
        beneficioId,
        idadeMin,
        idadeMax: semLimite ? null : idadeMax,
        valor,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <tr className="bg-emerald-50">
      <td className="px-3 py-2">
        <input
          type="number"
          value={idadeMin}
          onChange={(e) => setIdadeMin(Number(e.target.value))}
          className="h-7 w-16 rounded border border-border bg-background px-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={semLimite}
            onChange={(e) => setSemLimite(e.target.checked)}
          />
          sem limite
        </label>
        {!semLimite && (
          <input
            type="number"
            value={idadeMax ?? ""}
            onChange={(e) =>
              setIdadeMax(e.target.value ? Number(e.target.value) : null)
            }
            className="mt-1 h-7 w-16 rounded border border-border bg-background px-1 text-sm"
          />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          step="0.01"
          value={valor}
          onChange={(e) => setValor(Number(e.target.value))}
          className="h-7 w-24 rounded border border-border bg-background px-1 text-right text-sm"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="text-xs font-medium text-california-red hover:underline"
        >
          OK
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="ml-2 text-xs text-muted-foreground hover:underline"
        >
          Cancelar
        </button>
      </td>
    </tr>
  );
}
