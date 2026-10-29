"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save, AlertCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { cn, isValidCpf } from "@/lib/utils";
import { CepInput } from "@/app/(app)/freelancers/_components/cep-input";
import {
  PagamentoDoFreelancer,
  tipoDePagamentoPreenchido,
} from "@/app/(app)/freelancers/_components/pagamento-do-freelancer";

interface Props {
  token: string;
  nomePreenchido: string;
  cpfPreenchido: string | null;
}

type FieldErrors = Record<string, string[]>;

export function FormClient({ token, nomePreenchido, cpfPreenchido }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  const [state, setState] = React.useState<Record<string, string>>(() => ({
    nome_social: nomePreenchido,
    nome_completo: "",
    cpf: cpfPreenchido ?? "",
    rg: "",
    data_nascimento: "",
    email: "",
    celular: "",
    cep: "",
    rua: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    cnpj: "",
    razao_social: "",
    tipo_pagamento: "",
    banco: "",
    agencia: "",
    conta: "",
    tipo_conta: "",
    pix_chave: "",
    pix_tipo: "",
  }));

  function set(key: string, value: string) {
    setState((s) => ({ ...s, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((e) => {
        const n = { ...e };
        delete n[key];
        return n;
      });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    setFieldErrors({});

    // Validação cliente: CPF + endereço estruturado + CNPJ/razão são
    // obrigatórios no fluxo público (ADR 30/10/2026). Server valida de novo
    // via freelancerCriarSchema.
    const erros: Record<string, string[]> = {};
    if (!state.cpf || state.cpf.length !== 11 || !isValidCpf(state.cpf)) {
      erros.cpf = ["CPF obrigatório e válido pra confirmar o cadastro"];
    }
    if (!state.cep) erros.cep = ["CEP obrigatório"];
    if (!state.rua.trim()) erros.rua = ["Rua obrigatória"];
    if (!state.numero.trim()) erros.numero = ["Número obrigatório"];
    if (!state.bairro.trim()) erros.bairro = ["Bairro obrigatório"];
    if (!state.cidade.trim()) erros.cidade = ["Cidade obrigatória"];
    if (!state.cnpj) erros.cnpj = ["CNPJ obrigatório"];
    if (!state.razao_social.trim())
      erros.razao_social = ["Razão Social obrigatória"];
    if (Object.keys(erros).length > 0) {
      setFieldErrors(erros);
      return;
    }

    startTransition(async () => {
      try {
        const fd = new FormData();
        for (const [k, v] of Object.entries(state)) {
          fd.set(k, v);
        }
        // Decisão 212: o tipo de pagamento sai do que foi preenchido.
        fd.set("tipo_pagamento", tipoDePagamentoPreenchido(state));
        const r = await fetch(
          `/api/public/freelancer-solicitacao/${token}/submit`,
          { method: "POST", body: fd },
        );
        const data = await r.json();
        if (!r.ok) {
          setErroGeral(data.error ?? "Falha ao enviar");
          if (data.fieldErrors) setFieldErrors(data.fieldErrors);
          return;
        }
        router.push(
          `/form/freelancer-solicitacao/${token}/concluido?ja_existia=${data.ja_existia ? "1" : "0"}`,
        );
      } catch (err) {
        setErroGeral(
          err instanceof Error ? err.message : "Erro inesperado",
        );
      }
    });
  }

  const temPj = !!state.cnpj;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {erroGeral && (
        <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-california-red shrink-0 mt-0.5" />
          <p className="text-sm text-california-red font-medium">{erroGeral}</p>
        </div>
      )}

      <Secao titulo="Identificação">
        <Campo rotulo="Nome como você é conhecido *" erro={fieldErrors.nome_social}>
          <Input
            value={state.nome_social}
            onChange={(e) => set("nome_social", e.target.value)}
            required
          />
        </Campo>
        <Campo rotulo="Nome completo oficial (RG) *" erro={fieldErrors.nome_completo}>
          <Input
            value={state.nome_completo}
            onChange={(e) => set("nome_completo", e.target.value)}
            placeholder="Nome e sobrenome como no RG"
            required
          />
        </Campo>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="CPF *" erro={fieldErrors.cpf}>
            <MaskedInput
              mask="cpf"
              defaultValue={state.cpf}
              onDigitsChange={(d) => set("cpf", d)}
            />
          </Campo>
          <Campo rotulo="RG" erro={fieldErrors.rg}>
            <Input value={state.rg} onChange={(e) => set("rg", e.target.value)} />
          </Campo>
        </div>
        <Campo rotulo="Data de nascimento" erro={fieldErrors.data_nascimento}>
          <Input
            type="date"
            value={state.data_nascimento}
            onChange={(e) => set("data_nascimento", e.target.value)}
            className="max-w-[200px]"
          />
        </Campo>
      </Secao>

      <Secao titulo="Contato">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="Email" erro={fieldErrors.email}>
            <Input
              type="email"
              value={state.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Campo>
          <Campo rotulo="Celular" erro={fieldErrors.celular}>
            <MaskedInput
              mask="telefone"
              defaultValue={state.celular}
              onDigitsChange={(d) => set("celular", d)}
            />
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Endereço">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Campo rotulo="CEP *" erro={fieldErrors.cep}>
            <CepInput
              defaultValue={state.cep}
              required
              onEnderecoEncontrado={(d) =>
                setState((s) => ({
                  ...s,
                  rua: d.rua || s.rua,
                  bairro: d.bairro || s.bairro,
                  cidade: d.cidade || s.cidade,
                }))
              }
            />
          </Campo>
          <Campo rotulo="Cidade *" erro={fieldErrors.cidade} className="sm:col-span-2">
            <Input
              value={state.cidade}
              onChange={(e) => set("cidade", e.target.value)}
              required
            />
          </Campo>
        </div>
        <Campo rotulo="Rua *" erro={fieldErrors.rua}>
          <Input
            value={state.rua}
            onChange={(e) => set("rua", e.target.value)}
            required
          />
        </Campo>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Campo rotulo="Número *" erro={fieldErrors.numero}>
            <Input
              value={state.numero}
              onChange={(e) => set("numero", e.target.value)}
              required
            />
          </Campo>
          <Campo rotulo="Complemento" erro={fieldErrors.complemento}>
            <Input
              value={state.complemento}
              onChange={(e) => set("complemento", e.target.value)}
            />
          </Campo>
          <Campo rotulo="Bairro *" erro={fieldErrors.bairro}>
            <Input
              value={state.bairro}
              onChange={(e) => set("bairro", e.target.value)}
              required
            />
          </Campo>
        </div>
      </Secao>

      <Secao
        titulo="Pessoa jurídica"
        descricao="CNPJ e Razão Social são obrigatórios — o contrato é emitido pra PJ."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="CNPJ *" erro={fieldErrors.cnpj}>
            <MaskedInput
              mask="cnpj"
              defaultValue={state.cnpj}
              onDigitsChange={(d) => set("cnpj", d)}
              required
            />
          </Campo>
          <Campo rotulo="Razão Social *" erro={fieldErrors.razao_social}>
            <Input
              value={state.razao_social}
              onChange={(e) => set("razao_social", e.target.value)}
              required
            />
          </Campo>
        </div>
      </Secao>

      {/* Decisão 212: PIX e conta à vista, com o tipo da chave e o tipo de
          conta (antes, um seletor mostrava um ou outro). */}
      <Secao titulo="Pagamento" descricao="Preencha o PIX e a conta, se tiver os dois. Um deles já basta.">
        <PagamentoDoFreelancer
          state={state}
          set={set}
          fieldErrors={fieldErrors}
          pending={pending}
          avisarChaveSemTipo={false}
        />
      </Secao>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Enviar dados
        </button>
      </div>
    </form>
  );
}

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          {titulo}
        </h2>
        {descricao && (
          <p className="text-xs text-muted-foreground mt-1">{descricao}</p>
        )}
      </div>
      <div className="space-y-4 border-t border-border pt-5">{children}</div>
    </section>
  );
}

function Campo({
  rotulo,
  erro,
  children,
  className,
}: {
  rotulo: string;
  erro?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-semibold text-foreground">{rotulo}</Label>
      {children}
      {erro && erro.length > 0 && (
        <p className="text-xs text-california-red font-medium">{erro[0]}</p>
      )}
    </div>
  );
}
