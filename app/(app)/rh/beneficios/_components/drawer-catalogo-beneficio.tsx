"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Infinity, HeartPulse, Smile } from "lucide-react";
import type { BeneficioCompleto } from "@/lib/queries/beneficios";
import { coresBeneficio } from "@/lib/beneficios/cores";
import {
  editarBeneficio,
  criarFaixa,
  editarFaixa,
  removerFaixa,
} from "@/lib/actions/beneficios/catalogo";

const SEM_BASE = "__sem_base__";

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

  const cores = coresBeneficio(beneficio.tipo);
  const Icon = beneficio.tipo === "saude" ? HeartPulse : Smile;

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
          <div className="flex items-start gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${cores.bgSuave} ${cores.icon}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle>{beneficio.nome}</DialogTitle>
              <DialogDescription>
                {beneficio.operadora} ·{" "}
                {beneficio.tipo === "saude" ? "Saúde" : "Dental"} ·{" "}
                {beneficio.modelo_preco === "flat"
                  ? "Valor único por pessoa"
                  : "Preço por faixa etária"}
              </DialogDescription>
            </div>
            <StatusSelect ativo={ativo} onChange={setAtivo} />
          </div>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-6 overflow-y-auto pr-1">
          {/* Dados básicos */}
          <Secao titulo="Dados básicos">
            <div className="grid gap-3 md:grid-cols-2">
              <Campo label="Nome do plano">
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={200}
                  className={ESTILO_INPUT}
                />
              </Campo>
              <Campo label="Operadora">
                <input
                  type="text"
                  value={operadora}
                  onChange={(e) => setOperadora(e.target.value)}
                  maxLength={200}
                  className={ESTILO_INPUT}
                />
              </Campo>
              <Campo label="Código externo da operadora">
                <input
                  type="text"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  maxLength={50}
                  placeholder="opcional"
                  className={ESTILO_INPUT}
                />
              </Campo>
            </div>
          </Secao>

          {/* Rateio */}
          <Secao
            titulo="Rateio padrão"
            hint="Valores aplicados quando o modo de custeio do vínculo é “rateado”."
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Campo label={`Empresa paga ${percEmp}% do titular`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={percEmp}
                  onChange={(e) => setPercEmp(Number(e.target.value))}
                  className="w-full accent-california-red"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Colaborador paga {100 - percEmp}% do titular.
                </p>
              </Campo>
              <Campo label={`Colaborador paga ${percDep}% dos dependentes`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={percDep}
                  onChange={(e) => setPercDep(Number(e.target.value))}
                  className="w-full accent-california-red"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Dependentes raramente são custeados pela empresa.
                </p>
              </Campo>
            </div>
          </Secao>

          {/* Modelo de preço */}
          {beneficio.modelo_preco === "flat" ? (
            <Secao titulo="Valor único">
              <Campo label="Valor mensal por pessoa (R$)">
                <input
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={valorFlat ?? ""}
                  onChange={(e) =>
                    setValorFlat(e.target.value ? Number(e.target.value) : null)
                  }
                  className={`${ESTILO_INPUT} w-40`}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Cobrado por titular e por cada dependente incluído.
                </p>
              </Campo>
            </Secao>
          ) : (
            <>
              <Secao
                titulo="Plano base"
                hint="Usado quando o colaborador tem acordo de “integral + upgrade”: empresa cobre o valor do base e colaborador paga a diferença."
              >
                <Select
                  value={baseId ?? SEM_BASE}
                  onValueChange={(v) => setBaseId(v === SEM_BASE ? null : v)}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_BASE}>
                      Nenhum — este plano é a base
                    </SelectItem>
                    {beneficiosParaBase.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Secao>

              <Secao titulo="Faixas de preço" count={beneficio.faixas.length}>
                <TabelaFaixasInline
                  beneficioId={beneficio.id}
                  faixas={beneficio.faixas}
                  pendingParent={pending}
                />
              </Secao>
            </>
          )}

          <Secao titulo="Observação (opcional)">
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              maxLength={500}
              className={`${ESTILO_INPUT} w-full resize-none py-2`}
              placeholder="Notas internas do catálogo"
            />
          </Secao>

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

const ESTILO_INPUT =
  "h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20";

function Secao({
  titulo,
  hint,
  count,
  children,
}: {
  titulo: string;
  hint?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
          {count !== undefined && (
            <span className="ml-1.5 text-muted-foreground/70">({count})</span>
          )}
        </h4>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="w-full">{children}</div>
    </div>
  );
}

function StatusSelect({
  ativo,
  onChange,
}: {
  ativo: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Select
      value={ativo ? "ativo" : "inativo"}
      onValueChange={(v) => onChange(v === "ativo")}
    >
      <SelectTrigger className="h-8 w-[110px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ativo">Ativo</SelectItem>
        <SelectItem value="inativo">Inativo</SelectItem>
      </SelectContent>
    </Select>
  );
}

// =========================================================================
// Tabela de faixas inline: edição direta sem botões "Editar / OK / Cancelar"
// =========================================================================

function TabelaFaixasInline({
  beneficioId,
  faixas,
  pendingParent,
}: {
  beneficioId: string;
  faixas: BeneficioCompleto["faixas"];
  pendingParent: boolean;
}) {
  const [novaAberta, setNovaAberta] = useState(false);

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-[90px] px-3 py-2 text-left">De</th>
              <th className="w-[90px] px-3 py-2 text-left">Até</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="w-[48px] px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {faixas.length === 0 && !novaAberta && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  Nenhuma faixa cadastrada. Clique em “+ Nova faixa” abaixo.
                </td>
              </tr>
            )}
            {faixas.map((f) => (
              <LinhaFaixa key={f.id} faixa={f} />
            ))}
            {novaAberta && (
              <LinhaNovaFaixa
                beneficioId={beneficioId}
                onDone={() => setNovaAberta(false)}
              />
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => setNovaAberta(true)}
          disabled={novaAberta || pendingParent}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-california-red/40 hover:text-foreground disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          Nova faixa
        </button>
      </div>
    </div>
  );
}

/**
 * Linha de faixa com edição inline direta:
 * - Click em qualquer célula entra em modo edição
 * - Blur dos 3 inputs ou Enter → salva
 * - Esc → reverte
 * Zero botões "Editar / OK / Cancelar".
 */
function LinhaFaixa({ faixa }: { faixa: BeneficioCompleto["faixas"][number] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idadeMin, setIdadeMin] = useState(faixa.idade_min);
  const [idadeMax, setIdadeMax] = useState<number | null>(faixa.idade_max);
  const [valor, setValor] = useState(Number(faixa.valor));

  const originalRef = useRef({
    idadeMin: faixa.idade_min,
    idadeMax: faixa.idade_max,
    valor: Number(faixa.valor),
  });

  // Mantém estado local em sincronia caso a prop mude (ex: router.refresh)
  useEffect(() => {
    setIdadeMin(faixa.idade_min);
    setIdadeMax(faixa.idade_max);
    setValor(Number(faixa.valor));
    originalRef.current = {
      idadeMin: faixa.idade_min,
      idadeMax: faixa.idade_max,
      valor: Number(faixa.valor),
    };
  }, [faixa.idade_min, faixa.idade_max, faixa.valor]);

  function salvarSeMudou() {
    const o = originalRef.current;
    if (
      idadeMin === o.idadeMin &&
      idadeMax === o.idadeMax &&
      valor === o.valor
    ) {
      return;
    }
    if (valor <= 0) {
      alert("Valor precisa ser maior que zero.");
      setValor(o.valor);
      return;
    }
    start(async () => {
      const res = await editarFaixa({
        faixaId: faixa.id,
        idadeMin,
        idadeMax,
        valor,
      });
      if (!res.ok) {
        alert(res.message);
        setIdadeMin(o.idadeMin);
        setIdadeMax(o.idadeMax);
        setValor(o.valor);
        return;
      }
      router.refresh();
    });
  }

  function remover() {
    if (
      !confirm(
        `Remover faixa ${idadeMin}–${idadeMax ?? "sem limite"} (${formatarBrl(valor)})?`,
      )
    ) {
      return;
    }
    start(async () => {
      const res = await removerFaixa({ faixaId: faixa.id });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr className="group">
      <td className="px-3 py-1.5">
        <input
          type="number"
          min={0}
          max={120}
          value={idadeMin}
          onChange={(e) => setIdadeMin(Number(e.target.value))}
          onBlur={salvarSeMudou}
          disabled={pending}
          className="h-8 w-16 rounded border border-transparent bg-transparent px-2 text-sm tabular-nums hover:border-border focus:border-california-red/40 focus:outline-none focus:ring-2 focus:ring-california-red/15"
        />
      </td>
      <td className="px-3 py-1.5">
        {idadeMax === null ? (
          <button
            type="button"
            onClick={() => setIdadeMax(60)}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1 rounded border border-transparent px-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
            title="Click para definir idade máxima"
          >
            <Infinity className="h-3.5 w-3.5" />
            <span className="text-xs">sem limite</span>
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={120}
              value={idadeMax}
              onChange={(e) => setIdadeMax(Number(e.target.value))}
              onBlur={salvarSeMudou}
              disabled={pending}
              className="h-8 w-16 rounded border border-transparent bg-transparent px-2 text-sm tabular-nums hover:border-border focus:border-california-red/40 focus:outline-none focus:ring-2 focus:ring-california-red/15"
            />
            <button
              type="button"
              onClick={() => {
                setIdadeMax(null);
                start(async () => {
                  const res = await editarFaixa({
                    faixaId: faixa.id,
                    idadeMin,
                    idadeMax: null,
                    valor,
                  });
                  if (!res.ok) alert(res.message);
                  else router.refresh();
                });
              }}
              disabled={pending}
              className="opacity-0 transition-opacity hover:text-california-red group-hover:opacity-100"
              title="Marcar como sem limite"
            >
              <Infinity className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex items-center">
          <span className="text-xs text-muted-foreground">R$</span>
          <input
            type="number"
            step="0.01"
            min={0.01}
            value={valor}
            onChange={(e) => setValor(Number(e.target.value))}
            onBlur={salvarSeMudou}
            disabled={pending}
            className="h-8 w-28 rounded border border-transparent bg-transparent px-2 text-right text-sm tabular-nums hover:border-border focus:border-california-red/40 focus:outline-none focus:ring-2 focus:ring-california-red/15"
          />
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        <button
          type="button"
          onClick={remover}
          disabled={pending}
          className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-30"
          title="Remover faixa"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function LinhaNovaFaixa({
  beneficioId,
  onDone,
}: {
  beneficioId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idadeMin, setIdadeMin] = useState<number | "">("");
  const [idadeMax, setIdadeMax] = useState<number | null>(null);
  const [semLimite, setSemLimite] = useState(false);
  const [valor, setValor] = useState<number | "">("");

  const inputMinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputMinRef.current?.focus();
  }, []);

  function salvar() {
    if (idadeMin === "" || valor === "" || valor <= 0) {
      alert("Preencha a idade inicial e um valor maior que zero.");
      return;
    }
    start(async () => {
      const res = await criarFaixa({
        beneficioId,
        idadeMin: Number(idadeMin),
        idadeMax: semLimite ? null : idadeMax,
        valor: Number(valor),
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
    <tr className="bg-emerald-50/40">
      <td className="px-3 py-1.5">
        <input
          ref={inputMinRef}
          type="number"
          min={0}
          max={120}
          placeholder="0"
          value={idadeMin}
          onChange={(e) =>
            setIdadeMin(e.target.value === "" ? "" : Number(e.target.value))
          }
          disabled={pending}
          className="h-8 w-16 rounded border border-border bg-background px-2 text-sm tabular-nums focus:border-california-red/40 focus:outline-none focus:ring-2 focus:ring-california-red/15"
        />
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={120}
            placeholder="∞"
            value={semLimite ? "" : (idadeMax ?? "")}
            onChange={(e) =>
              setIdadeMax(e.target.value === "" ? null : Number(e.target.value))
            }
            disabled={pending || semLimite}
            className="h-8 w-16 rounded border border-border bg-background px-2 text-sm tabular-nums focus:border-california-red/40 focus:outline-none focus:ring-2 focus:ring-california-red/15 disabled:bg-muted/40"
          />
          <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={semLimite}
              onChange={(e) => setSemLimite(e.target.checked)}
              disabled={pending}
            />
            s/ limite
          </label>
        </div>
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex items-center">
          <span className="text-xs text-muted-foreground">R$</span>
          <input
            type="number"
            step="0.01"
            min={0.01}
            placeholder="0,00"
            value={valor}
            onChange={(e) =>
              setValor(e.target.value === "" ? "" : Number(e.target.value))
            }
            disabled={pending}
            className="h-8 w-28 rounded border border-border bg-background px-2 text-right text-sm tabular-nums focus:border-california-red/40 focus:outline-none focus:ring-2 focus:ring-california-red/15"
          />
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={salvar}
            disabled={pending}
            className="rounded bg-california-red px-2 py-1 text-[11px] font-medium text-white hover:bg-california-red/90 disabled:opacity-50"
          >
            {pending ? "…" : "OK"}
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}
