"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Save } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { Combobox } from "@/components/ui/combobox";
import { BANCOS_FEBRABAN } from "@/lib/dados/bancos-febraban";
import { onlyDigits, cn } from "@/lib/utils";
import type {
  Fornecedor,
  TipoPessoa,
  PixTipoChave,
  UF,
} from "@/lib/types";
import {
  atualizarFornecedor,
  criarFornecedor,
  verificarPixDuplicado,
  type ActionResult,
} from "./actions";

const UFS: UF[] = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

const BANCO_ITEMS = BANCOS_FEBRABAN.map((b) => ({
  value: b.codigo,
  label: `${b.codigo} - ${b.nome}`,
}));

// ---------------------------------------------------------------------------
// Helper component: PixChaveInput
// ---------------------------------------------------------------------------

interface PixChaveInputProps {
  tipo: PixTipoChave | "";
  /** Current value — used as defaultValue on each remount triggered by tipo change.
   *  For MaskedInput we cannot use controlled mode (onChange is omitted from its
   *  props), so we use uncontrolled + onDigitsChange to propagate updates. */
  initialValue: string;
  /** Called with digits string for masked inputs (cpf/cnpj/telefone). */
  onDigitsChange: (digits: string) => void;
  /** Called with raw string for text/email inputs and "Usar do cadastro". */
  onRawChange: (raw: string) => void;
  /** Ref to the cpf_cnpj input so "Usar do cadastro" can copy its value. */
  cpfCnpjRef: React.RefObject<HTMLInputElement | null>;
}

function PixChaveInput({
  tipo,
  initialValue,
  onDigitsChange,
  onRawChange,
  cpfCnpjRef,
}: PixChaveInputProps) {
  // Always declare ref (rules of hooks: no conditional calls)
  const maskRef = React.useRef<HTMLInputElement>(null);

  const inputClass =
    "flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

  if (tipo === "") {
    return (
      <input
        type="text"
        disabled
        placeholder="Selecione o tipo primeiro"
        className={inputClass}
      />
    );
  }

  function handleUsarDoCadastro() {
    const raw = cpfCnpjRef.current?.value ?? "";
    // Drive MaskedInput's internal state by using the native setter + input event.
    if (maskRef.current) {
      const nativeSet = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSet?.call(maskRef.current, raw);
      maskRef.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
    onRawChange(raw);
  }

  if (tipo === "cpf" || tipo === "cnpj") {
    return (
      <div className="space-y-1.5">
        <MaskedInput
          mask={tipo}
          defaultValue={initialValue}
          onDigitsChange={onDigitsChange}
          ref={maskRef}
          placeholder={tipo === "cpf" ? "000.000.000-00" : "00.000.000/0000-00"}
        />
        <button
          type="button"
          onClick={handleUsarDoCadastro}
          className="text-xs text-california-red hover:underline"
        >
          Usar {tipo === "cpf" ? "CPF" : "CNPJ"} do cadastro
        </button>
      </div>
    );
  }

  if (tipo === "telefone") {
    return (
      <MaskedInput
        mask="telefone"
        defaultValue={initialValue}
        onDigitsChange={onDigitsChange}
      />
    );
  }

  if (tipo === "email") {
    return (
      <Input
        type="email"
        defaultValue={initialValue}
        onChange={(e) => onRawChange(e.target.value)}
        placeholder="chave@email.com"
      />
    );
  }

  // aleatoria
  return (
    <Input
      type="text"
      defaultValue={initialValue}
      onChange={(e) => onRawChange(e.target.value)}
      maxLength={36}
      placeholder="Chave aleatória (UUID)"
    />
  );
}

// ---------------------------------------------------------------------------
// Helper component: Field
// ---------------------------------------------------------------------------

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
  const msgs = errors[name];
  return (
    <div className="space-y-2" data-field={name}>
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-california-red ml-1">*</span>}
      </Label>
      {children}
      {msgs?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component: FornecedorForm
// ---------------------------------------------------------------------------

interface Props {
  fornecedor?: Fornecedor;
}

export function FornecedorForm({ fornecedor }: Props) {
  const router = useRouter();
  const isEdit = Boolean(fornecedor);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // Controlled state: only what drives conditional rendering or async logic
  const [tipoPessoa, setTipoPessoa] = React.useState<TipoPessoa>(
    fornecedor?.tipo_pessoa ?? "juridica",
  );
  const [bancoCodigo, setBancoCodigo] = React.useState<string | null>(
    fornecedor?.banco_codigo ?? null,
  );
  const [pixTipo, setPixTipo] = React.useState<PixTipoChave | "">(
    fornecedor?.pix_tipo ?? "",
  );
  const [pixChave, setPixChave] = React.useState<string>(
    fornecedor?.pix_chave ?? "",
  );
  const [pixWarning, setPixWarning] = React.useState<string | null>(null);

  // Refs for ViaCEP autocomplete
  const cepRef = React.useRef<HTMLInputElement>(null);
  const logradouroRef = React.useRef<HTMLInputElement>(null);
  const bairroRef = React.useRef<HTMLInputElement>(null);
  const cidadeRef = React.useRef<HTMLInputElement>(null);
  const ufRef = React.useRef<HTMLSelectElement>(null);
  const cpfCnpjRef = React.useRef<HTMLInputElement>(null);

  // ViaCEP state
  const [cepLoading, setCepLoading] = React.useState(false);
  const [cepError, setCepError] = React.useState<string | null>(null);

  // ViaCEP handler
  async function handleCepBlur() {
    const cep = onlyDigits(cepRef.current?.value ?? "");
    if (cep.length !== 8) return;

    setCepLoading(true);
    setCepError(null);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);

    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (data.erro) {
        setCepError("CEP não encontrado, preencha manualmente.");
        return;
      }
      // Only fill empty fields — respect manual user edits
      if (logradouroRef.current && !logradouroRef.current.value)
        logradouroRef.current.value = data.logradouro ?? "";
      if (bairroRef.current && !bairroRef.current.value)
        bairroRef.current.value = data.bairro ?? "";
      if (cidadeRef.current && !cidadeRef.current.value)
        cidadeRef.current.value = data.localidade ?? "";
      if (ufRef.current && !ufRef.current.value && data.uf)
        ufRef.current.value = data.uf;
    } catch {
      setCepError("Não foi possível consultar o CEP, preencha manualmente.");
    } finally {
      clearTimeout(to);
      setCepLoading(false);
    }
  }

  // PIX duplicate debounce check
  React.useEffect(() => {
    if (!pixTipo || !pixChave) {
      setPixWarning(null);
      return;
    }

    let chaveNormalizada = pixChave;
    if (pixTipo === "cpf" || pixTipo === "cnpj" || pixTipo === "telefone") {
      chaveNormalizada = onlyDigits(pixChave);
    } else {
      chaveNormalizada = pixChave.trim().toLowerCase();
    }
    if (!chaveNormalizada) {
      setPixWarning(null);
      return;
    }

    const t = setTimeout(async () => {
      const res = await verificarPixDuplicado(chaveNormalizada, pixTipo || null, fornecedor?.id);
      if (res.existe) {
        setPixWarning(
          `Já existe fornecedor com esta chave PIX: "${res.nome}". Confirme se está correto.`,
        );
      } else {
        setPixWarning(null);
      }
    }, 500);

    return () => clearTimeout(t);
  }, [pixTipo, pixChave, fornecedor?.id]);

  // Initial document value (reset if tipo_pessoa changed)
  const initialDoc =
    fornecedor?.cpf_cnpj && fornecedor.tipo_pessoa === tipoPessoa
      ? fornecedor.cpf_cnpj
      : "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("tipo_pessoa", tipoPessoa);
    formData.set("banco_codigo", bancoCodigo ?? "");
    formData.set("pix_tipo", pixTipo);
    formData.set("pix_chave", pixChave);
    formData.set("cpf_cnpj", onlyDigits(formData.get("cpf_cnpj")?.toString() ?? ""));
    formData.set("telefone", onlyDigits(formData.get("telefone")?.toString() ?? ""));
    formData.set("cep", onlyDigits(formData.get("cep")?.toString() ?? ""));

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarFornecedor(fornecedor!.id, formData)
        : await criarFornecedor(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        // Scroll to first field with error
        const firstField = res.fieldErrors ? Object.keys(res.fieldErrors)[0] : null;
        if (firstField) {
          const el = document.querySelector<HTMLElement>(`[data-field="${firstField}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      if (isEdit) router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-24">

      {/* ------------------------------------------------------------------ */}
      {/* Section 1: Identificação                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-border bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold">Identificação</h3>

        {/* Toggle PF / PJ */}
        <div className="space-y-2">
          <Label>Tipo de pessoa</Label>
          <div className="inline-flex rounded-lg border border-border bg-white p-1">
            {(["juridica", "fisica"] as const).map((tp) => (
              <button
                type="button"
                key={tp}
                onClick={() => setTipoPessoa(tp)}
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                  tipoPessoa === tp
                    ? "bg-california-red text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tp === "juridica" ? "Pessoa Jurídica" : "Pessoa Física"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={tipoPessoa === "fisica" ? "Nome" : "Nome fantasia"}
            name="nome"
            required
            errors={fieldErrors}
          >
            <Input name="nome" defaultValue={fornecedor?.nome ?? ""} required autoFocus />
          </Field>

          {tipoPessoa === "juridica" && (
            <Field label="Razão social" name="razao_social" errors={fieldErrors}>
              <Input name="razao_social" defaultValue={fornecedor?.razao_social ?? ""} />
            </Field>
          )}

          <Field
            label={tipoPessoa === "fisica" ? "CPF" : "CNPJ"}
            name="cpf_cnpj"
            errors={fieldErrors}
          >
            <MaskedInput
              key={tipoPessoa}
              mask={tipoPessoa === "fisica" ? "cpf" : "cnpj"}
              name="cpf_cnpj"
              defaultValue={initialDoc}
              ref={cpfCnpjRef}
            />
          </Field>

          <Field label="E-mail" name="email" errors={fieldErrors}>
            <Input name="email" type="email" defaultValue={fornecedor?.email ?? ""} />
          </Field>

          <Field label="Telefone" name="telefone" errors={fieldErrors}>
            <MaskedInput
              mask="telefone"
              name="telefone"
              defaultValue={fornecedor?.telefone ?? ""}
            />
          </Field>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2: Endereço                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-border bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold">Endereço</h3>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="CEP" name="cep" errors={fieldErrors}>
            <div className="relative">
              <MaskedInput
                mask="cep"
                name="cep"
                defaultValue={fornecedor?.cep ?? ""}
                onBlur={handleCepBlur}
                ref={cepRef}
              />
              {cepLoading && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-california-red/30 border-t-california-red animate-spin" />
              )}
            </div>
            {cepError && (
              <p className="text-xs text-muted-foreground mt-1">{cepError}</p>
            )}
          </Field>

          <Field label="Logradouro" name="logradouro" errors={fieldErrors}>
            <Input
              name="logradouro"
              defaultValue={fornecedor?.logradouro ?? ""}
              ref={logradouroRef}
              placeholder="Rua, Av., etc."
            />
          </Field>

          <Field label="Número" name="numero" errors={fieldErrors}>
            <Input
              name="numero"
              defaultValue={fornecedor?.numero ?? ""}
              placeholder="123"
            />
          </Field>

          <Field label="Complemento" name="complemento" errors={fieldErrors}>
            <Input
              name="complemento"
              defaultValue={fornecedor?.complemento ?? ""}
              placeholder="Apto, sala, bloco..."
            />
          </Field>

          <Field label="Bairro" name="bairro" errors={fieldErrors}>
            <Input
              name="bairro"
              defaultValue={fornecedor?.bairro ?? ""}
              ref={bairroRef}
            />
          </Field>

          <Field label="Cidade" name="cidade" errors={fieldErrors}>
            <Input
              name="cidade"
              defaultValue={fornecedor?.cidade ?? ""}
              ref={cidadeRef}
            />
          </Field>

          <Field label="UF" name="uf" errors={fieldErrors}>
            <select
              name="uf"
              defaultValue={fornecedor?.uf ?? ""}
              ref={ufRef}
              className="flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 transition-colors"
            >
              <option value="">Selecione</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 3: Dados bancários                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-border bg-white p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold">Dados bancários</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Preencha os dados bancários OU o PIX (pelo menos um).
          </p>
        </div>

        <Field label="Banco" name="banco_codigo" errors={fieldErrors}>
          <Combobox
            items={BANCO_ITEMS}
            value={bancoCodigo}
            onChange={setBancoCodigo}
            placeholder="Selecione o banco"
            name="banco_codigo"
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Agência" name="agencia" errors={fieldErrors}>
            <Input
              name="agencia"
              inputMode="numeric"
              maxLength={5}
              defaultValue={fornecedor?.agencia ?? ""}
            />
          </Field>
          <Field label="Dígito ag." name="agencia_dv" errors={fieldErrors}>
            <Input
              name="agencia_dv"
              maxLength={1}
              defaultValue={fornecedor?.agencia_dv ?? ""}
            />
          </Field>
          <Field label="Conta" name="conta" errors={fieldErrors}>
            <Input
              name="conta"
              inputMode="numeric"
              maxLength={12}
              defaultValue={fornecedor?.conta ?? ""}
            />
          </Field>
          <Field label="Dígito ct." name="conta_dv" errors={fieldErrors}>
            <Input
              name="conta_dv"
              maxLength={1}
              defaultValue={fornecedor?.conta_dv ?? ""}
            />
          </Field>
        </div>

        <Field label="Tipo de conta" name="tipo_conta" errors={fieldErrors}>
          <select
            name="tipo_conta"
            defaultValue={fornecedor?.tipo_conta ?? ""}
            className="flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm text-foreground hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 transition-colors"
          >
            <option value="">Selecione</option>
            <option value="corrente">Conta corrente</option>
            <option value="poupanca">Conta poupança</option>
            <option value="pagamento">Conta de pagamento</option>
          </select>
        </Field>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 4: PIX                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-border bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold">PIX</h3>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tipo de chave" name="pix_tipo" errors={fieldErrors}>
            <select
              value={pixTipo}
              onChange={(e) => {
                setPixTipo(e.target.value as PixTipoChave | "");
                setPixChave("");
                setPixWarning(null);
              }}
              className="flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm text-foreground hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 transition-colors"
            >
              <option value="">Selecione</option>
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="email">E-mail</option>
              <option value="telefone">Telefone</option>
              <option value="aleatoria">Chave aleatória</option>
            </select>
          </Field>

          <Field label="Chave PIX" name="pix_chave" errors={fieldErrors}>
            <PixChaveInput
              key={pixTipo}
              tipo={pixTipo}
              initialValue={pixChave}
              onDigitsChange={setPixChave}
              onRawChange={setPixChave}
              cpfCnpjRef={cpfCnpjRef}
            />
            {pixWarning && (
              <div className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{pixWarning}</span>
              </div>
            )}
          </Field>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 5: Observações                                              */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-border bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold">Observações</h3>
        <Field label="Observações" name="observacoes" errors={fieldErrors}>
          <Textarea
            name="observacoes"
            defaultValue={fornecedor?.observacoes ?? ""}
            rows={4}
            placeholder="Especialidade, forma de pagamento habitual..."
          />
        </Field>
      </section>

      {/* Global error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Sticky footer                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="sticky bottom-0 -mx-6 border-t border-border bg-white/95 backdrop-blur px-6 py-4 flex items-center justify-end gap-3">
        <Link
          href="/fornecedores"
          prefetch={false}
          className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
        >
          Cancelar
        </Link>
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
              {isEdit ? "Salvar alterações" : "Criar fornecedor"}
            </>
          )}
        </button>
      </div>
    </form>
  );
}
