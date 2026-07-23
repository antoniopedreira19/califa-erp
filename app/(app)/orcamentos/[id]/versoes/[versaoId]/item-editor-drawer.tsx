"use client";

import * as React from "react";
import { AlertCircle, Plus, Save } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoCategoria,
  type VersaoOrcamentoItem,
} from "@/lib/types";
import {
  adicionarItem,
  atualizarItem,
  type ActionResult,
} from "../actions";

interface Props {
  /** Grupo dono do item (novo). Ignorado em modo edição. */
  grupoId?: string;
  /** Nome do grupo — usado só no header do drawer pra contexto. */
  grupoNome?: string;
  /** Se passado, drawer entra em modo edição desse item. */
  item?: VersaoOrcamentoItem | null;
  /** Modo controlado externo: pai passa open + onOpenChange. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Se false, esconde o trigger (usado quando o pai controla via botão externo). */
  showTrigger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  categorias?: VersaoOrcamentoCategoria[];
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

export function ItemEditorDrawer({
  grupoId,
  grupoNome,
  item,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
  disabled,
  disabledReason,
  categorias = [],
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setUncontrolledOpen;

  const isEdit = Boolean(item);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>(
    {},
  );

  const [tipoCusto, setTipoCusto] = React.useState<TipoCusto>(
    item?.tipo_custo ?? "A",
  );

  // Valores dos campos orçado/planejado controlados para calcular
  // rentabilidade em tempo real dentro do drawer (spec 6.2).
  const [valorOrc, setValorOrc] = React.useState<string>(
    item?.valor_unitario_orcado?.toString() ?? "",
  );
  const [qtdOrc, setQtdOrc] = React.useState<string>(
    item?.quantidade_orcada?.toString() ?? "1",
  );
  const [dmOrc, setDmOrc] = React.useState<string>(
    item?.dias_meses_orcado?.toString() ?? "1",
  );
  const [valorPlan, setValorPlan] = React.useState<string>(
    item?.valor_unitario_planejado?.toString() ?? "0",
  );
  const [qtdPlan, setQtdPlan] = React.useState<string>(
    item?.quantidade_planejada?.toString() ?? "0",
  );
  const [dmPlan, setDmPlan] = React.useState<string>(
    item?.dias_meses_planejado?.toString() ?? "0",
  );

  React.useEffect(() => {
    setTipoCusto(item?.tipo_custo ?? "A");
    setValorOrc(item?.valor_unitario_orcado?.toString() ?? "");
    setQtdOrc(item?.quantidade_orcada?.toString() ?? "1");
    setDmOrc(item?.dias_meses_orcado?.toString() ?? "1");
    setValorPlan(item?.valor_unitario_planejado?.toString() ?? "0");
    setQtdPlan(item?.quantidade_planejada?.toString() ?? "0");
    setDmPlan(item?.dias_meses_planejado?.toString() ?? "0");
    setError(null);
    setFieldErrors({});
  }, [item]);

  const totalOrc =
    (Number(valorOrc) || 0) * (Number(qtdOrc) || 0) * (Number(dmOrc) || 0);
  const totalPlan =
    (Number(valorPlan) || 0) * (Number(qtdPlan) || 0) * (Number(dmPlan) || 0);
  const rentabilidade = totalOrc - totalPlan;
  const temPlan = totalPlan > 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("tipo_custo", tipoCusto);

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarItem(item!.id, formData)
        : grupoId
          ? await adicionarItem(grupoId, formData)
          : { ok: false, message: "Grupo não informado." };

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo item
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{isEdit ? "Editar item" : "Novo item"}</DialogTitle>
          <DialogDescription>
            {grupoNome ? (
              <>
                Grupo: <strong className="text-foreground">{grupoNome}</strong>
                {" · "}Total é calculado (valor × qtd × dias/meses).
              </>
            ) : (
              "Total é calculado automaticamente: valor × quantidade × dias/meses."
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <Field label="Descrição do item" name="item" required errors={fieldErrors}>
              <Input
                name="item"
                defaultValue={item?.item ?? ""}
                required
                autoFocus
                placeholder="Ex.: Gerente de Projeto, Locação Vending Machine..."
              />
            </Field>

            <Field label="Tipo de custo" name="tipo_custo" required errors={fieldErrors}>
              <Select value={tipoCusto} onValueChange={(v) => setTipoCusto(v as TipoCusto)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tipoCustoLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="space-y-2">
              <Label htmlFor="categoria_id">Categoria (opcional)</Label>
              <Select
                name="categoria_id"
                defaultValue={item?.categoria_id ?? ""}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhuma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhuma</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Crie novas categorias pelo botão &ldquo;Nova categoria&rdquo; no
                topo da versão.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field
                label="Valor unitário"
                name="valor_unitario_orcado"
                required
                errors={fieldErrors}
              >
                <Input
                  name="valor_unitario_orcado"
                  type="number"
                  step="0.01"
                  min="0"
                  value={valorOrc}
                  onChange={(e) => setValorOrc(e.target.value)}
                  required
                  className="no-spinner"
                />
              </Field>
              <Field
                label="Quantidade"
                name="quantidade_orcada"
                required
                errors={fieldErrors}
              >
                <Input
                  name="quantidade_orcada"
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={qtdOrc}
                  onChange={(e) => setQtdOrc(e.target.value)}
                  required
                />
              </Field>
              <Field
                label="Dias / meses"
                name="dias_meses_orcado"
                required
                errors={fieldErrors}
              >
                <Input
                  name="dias_meses_orcado"
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={dmOrc}
                  onChange={(e) => setDmOrc(e.target.value)}
                  required
                />
              </Field>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-800">
                  Planejado
                </span>
                <span className="text-[10px] text-blue-800/70">
                  (custo real negociado com fornecedor)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="valor_unitario_planejado">Valor unit.</Label>
                  <Input
                    id="valor_unitario_planejado"
                    name="valor_unitario_planejado"
                    type="number"
                    step="0.01"
                    min="0"
                    className="no-spinner"
                    value={valorPlan}
                    onChange={(e) => setValorPlan(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantidade_planejada">QT</Label>
                  <Input
                    id="quantidade_planejada"
                    name="quantidade_planejada"
                    type="number"
                    step="0.001"
                    min="0"
                    className="no-spinner"
                    value={qtdPlan}
                    onChange={(e) => setQtdPlan(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dias_meses_planejado">D/M</Label>
                  <Input
                    id="dias_meses_planejado"
                    name="dias_meses_planejado"
                    type="number"
                    step="0.001"
                    min="0"
                    className="no-spinner"
                    value={dmPlan}
                    onChange={(e) => setDmPlan(e.target.value)}
                  />
                </div>
              </div>
              {/* Rentabilidade em tempo real */}
              <div className="flex items-center justify-between border-t border-blue-200 pt-3 text-xs">
                <span className="font-semibold uppercase tracking-wider text-blue-800">
                  Rentabilidade
                </span>
                {temPlan ? (
                  <span
                    className={
                      "font-mono font-semibold " +
                      (rentabilidade >= 0
                        ? "text-emerald-700"
                        : "text-california-red")
                    }
                  >
                    {rentabilidade.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </span>
                ) : (
                  <span className="text-blue-800/60">— não planejado</span>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isEdit ? "Salvar" : "Adicionar item"}
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors: Record<string, string[]>;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-california-red ml-1">*</span>}
      </Label>
      {children}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}
