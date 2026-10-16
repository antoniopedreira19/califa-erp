"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Save,
  AlertCircle,
  UserCheck,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn, isValidCpf, onlyDigits } from "@/lib/utils";
import type { Freelancer } from "@/lib/types";
import { CepInput } from "./cep-input";
import { criarFreelancer, atualizarFreelancer } from "../actions";

type Modo = "novo" | "editar";

interface Props {
  modo: Modo;
  freelancer?: Freelancer;
}

type FieldErrors = Record<string, string[]>;

/** Converte valores do estado em um FormData amigável à server action. */
function montarFormData(state: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(state)) {
    fd.set(k, v ?? "");
  }
  return fd;
}

export function FreelancerForm({ modo, freelancer }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // Estado controlado — simples record string→string pra ter 1 ponto só
  // de leitura/escrita e submissão via FormData.
  const [state, setState] = React.useState<Record<string, string>>(() => ({
    nome_social: freelancer?.nome_social ?? "",
    nome_completo: freelancer?.nome_completo ?? "",
    cpf: freelancer?.cpf ?? "",
    rg: freelancer?.rg ?? "",
    data_nascimento: freelancer?.data_nascimento ?? "",
    email: freelancer?.email ?? "",
    celular: freelancer?.celular ?? "",
    cep: freelancer?.cep ?? "",
    rua: freelancer?.rua ?? "",
    numero: freelancer?.numero ?? "",
    complemento: freelancer?.complemento ?? "",
    bairro: freelancer?.bairro ?? "",
    cidade: freelancer?.cidade ?? "",
    cnpj: freelancer?.cnpj ?? "",
    razao_social: freelancer?.razao_social ?? "",
    tipo_pagamento: freelancer?.tipo_pagamento ?? "",
    banco: freelancer?.banco ?? "",
    agencia: freelancer?.agencia ?? "",
    conta: freelancer?.conta ?? "",
    pix_chave: freelancer?.pix_chave ?? "",
    cor_raca: freelancer?.cor_raca ?? "",
    identidade_genero: freelancer?.identidade_genero ?? "",
    deficiencia: freelancer?.deficiencia ?? "",
    saude_obs: freelancer?.saude_obs ?? "",
    contato_emergencia: freelancer?.contato_emergencia ?? "",
    acao_prevista: freelancer?.acao_prevista ?? "",
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

  // Dedup de CPF — quando usuário digita 11 dígitos válidos, consulta API.
  const [duplicata, setDuplicata] = React.useState<{
    id: string;
    nome_social: string;
  } | null>(null);

  async function verificarCpfDuplicado(cpfDigitos: string) {
    if (cpfDigitos.length !== 11 || !isValidCpf(cpfDigitos)) {
      setDuplicata(null);
      return;
    }
    // Em modo editar, não alerta se bater com o próprio registro
    if (modo === "editar" && cpfDigitos === freelancer?.cpf) {
      setDuplicata(null);
      return;
    }
    try {
      const r = await fetch(
        `/api/freelancers/buscar-por-cpf?cpf=${cpfDigitos}`,
      );
      if (!r.ok) return;
      const d = (await r.json()) as {
        encontrado: { id: string; nome_social: string } | null;
      };
      setDuplicata(d.encontrado);
    } catch {
      // ignora
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    setFieldErrors({});

    const fd = montarFormData(state);

    startTransition(async () => {
      const resultado =
        modo === "novo"
          ? await criarFreelancer(fd)
          : await atualizarFreelancer(freelancer!.id, fd);

      if (!resultado.ok) {
        setErroGeral(resultado.message);
        if (resultado.fieldErrors) setFieldErrors(resultado.fieldErrors);
        // scroll para o topo pra mostrar o erro
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (modo === "editar") {
        router.push(`/freelancers/${freelancer!.id}`);
      }
      // Em modo novo, a action faz redirect — nada a fazer aqui
    });
  }

  const temPj = !!state.cnpj;
  const tipoPagamentoPix = state.tipo_pagamento === "pix";
  const tipoPagamentoConta = state.tipo_pagamento === "conta_bancaria";

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Erro geral e aviso de duplicata */}
      {erroGeral && (
        <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-california-red shrink-0 mt-0.5" />
          <p className="text-sm text-california-red font-medium">{erroGeral}</p>
        </div>
      )}

      {duplicata && modo === "novo" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <UserCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              Já existe um freelancer com esse CPF
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Cadastrado como <strong>{duplicata.nome_social}</strong>. Para
              evitar duplicata, abra o cadastro existente em vez de criar outro.
            </p>
            <Link
              href={`/freelancers/${duplicata.id}`}
              prefetch={false}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 hover:text-amber-700"
            >
              Abrir cadastro existente
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* ============== Identificação ============== */}
      <Secao titulo="Identificação" descricao="Dados pessoais básicos. Nome social é o único obrigatório.">
        <Campo rotulo="Nome social *" erro={fieldErrors.nome_social}>
          <Input
            name="nome_social"
            value={state.nome_social}
            onChange={(e) => set("nome_social", e.target.value)}
            placeholder="Como esta pessoa é conhecida"
            required
            disabled={pending}
          />
        </Campo>

        <Campo rotulo="Nome completo" erro={fieldErrors.nome_completo}>
          <Input
            name="nome_completo"
            value={state.nome_completo}
            onChange={(e) => set("nome_completo", e.target.value)}
            placeholder="Nome oficial (RG), se diferente"
            disabled={pending}
          />
        </Campo>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="CPF" erro={fieldErrors.cpf}>
            <MaskedInput
              mask="cpf"
              name="cpf"
              defaultValue={state.cpf}
              onDigitsChange={(d) => {
                set("cpf", d);
                verificarCpfDuplicado(d);
              }}
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="RG" erro={fieldErrors.rg}>
            <Input
              name="rg"
              value={state.rg}
              onChange={(e) => set("rg", e.target.value)}
              placeholder="Número do RG"
              disabled={pending}
            />
          </Campo>
        </div>

        <Campo rotulo="Data de nascimento" erro={fieldErrors.data_nascimento}>
          <Input
            type="date"
            name="data_nascimento"
            value={state.data_nascimento}
            onChange={(e) => set("data_nascimento", e.target.value)}
            disabled={pending}
            className="max-w-[200px]"
          />
        </Campo>
      </Secao>

      {/* ============== Contato ============== */}
      <Secao titulo="Contato" descricao="Como falar com esta pessoa.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="Email" erro={fieldErrors.email}>
            <Input
              type="email"
              name="email"
              value={state.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="exemplo@email.com"
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="Celular" erro={fieldErrors.celular}>
            <MaskedInput
              mask="telefone"
              name="celular"
              defaultValue={state.celular}
              onDigitsChange={(d) => set("celular", d)}
              disabled={pending}
            />
          </Campo>
        </div>
      </Secao>

      {/* ============== Endereço ============== */}
      <Secao titulo="Endereço" descricao="CEP preenche rua, bairro e cidade automaticamente.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Campo rotulo="CEP" erro={fieldErrors.cep}>
            <CepInput
              name="cep"
              defaultValue={state.cep}
              disabled={pending}
              onEnderecoEncontrado={(d) => {
                setState((s) => ({
                  ...s,
                  rua: d.rua || s.rua,
                  bairro: d.bairro || s.bairro,
                  cidade: d.cidade || s.cidade,
                }));
              }}
            />
          </Campo>
          <Campo rotulo="Cidade" erro={fieldErrors.cidade} className="sm:col-span-2">
            <Input
              name="cidade"
              value={state.cidade}
              onChange={(e) => set("cidade", e.target.value)}
              disabled={pending}
            />
          </Campo>
        </div>

        <Campo rotulo="Rua" erro={fieldErrors.rua}>
          <Input
            name="rua"
            value={state.rua}
            onChange={(e) => set("rua", e.target.value)}
            disabled={pending}
          />
        </Campo>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Campo rotulo="Número" erro={fieldErrors.numero}>
            <Input
              name="numero"
              value={state.numero}
              onChange={(e) => set("numero", e.target.value)}
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="Complemento" erro={fieldErrors.complemento}>
            <Input
              name="complemento"
              value={state.complemento}
              onChange={(e) => set("complemento", e.target.value)}
              placeholder="Apto, bloco, etc."
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="Bairro" erro={fieldErrors.bairro}>
            <Input
              name="bairro"
              value={state.bairro}
              onChange={(e) => set("bairro", e.target.value)}
              disabled={pending}
            />
          </Campo>
        </div>
      </Secao>

      {/* ============== Pessoa jurídica ============== */}
      <Secao
        titulo="Pessoa jurídica (opcional)"
        descricao="Preencha se o freelancer emite nota como PJ. CNPJ e Razão Social andam juntos."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="CNPJ" erro={fieldErrors.cnpj}>
            <MaskedInput
              mask="cnpj"
              name="cnpj"
              defaultValue={state.cnpj}
              onDigitsChange={(d) => set("cnpj", d)}
              disabled={pending}
            />
          </Campo>
          <Campo
            rotulo={temPj ? "Razão Social *" : "Razão Social"}
            erro={fieldErrors.razao_social}
          >
            <Input
              name="razao_social"
              value={state.razao_social}
              onChange={(e) => set("razao_social", e.target.value)}
              placeholder="Nome oficial da empresa"
              disabled={pending}
              required={temPj}
            />
          </Campo>
        </div>
      </Secao>

      {/* ============== Pagamento ============== */}
      <Secao
        titulo="Pagamento"
        descricao="Como transferir o valor dos contratos para este freelancer."
      >
        <Campo rotulo="Tipo de pagamento" erro={fieldErrors.tipo_pagamento}>
          <Select
            value={state.tipo_pagamento || undefined}
            onValueChange={(v) => set("tipo_pagamento", v)}
            disabled={pending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Escolha o tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conta_bancaria">Conta bancária</SelectItem>
              <SelectItem value="pix">PIX</SelectItem>
            </SelectContent>
          </Select>
          <input type="hidden" name="tipo_pagamento" value={state.tipo_pagamento} />
        </Campo>

        {tipoPagamentoConta && (
          <>
            <Campo rotulo="Banco *" erro={fieldErrors.banco}>
              <Input
                name="banco"
                value={state.banco}
                onChange={(e) => set("banco", e.target.value)}
                placeholder="Nome do banco"
                disabled={pending}
              />
            </Campo>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Campo rotulo="Agência *" erro={fieldErrors.agencia}>
                <Input
                  name="agencia"
                  value={state.agencia}
                  onChange={(e) => set("agencia", e.target.value)}
                  disabled={pending}
                />
              </Campo>
              <Campo rotulo="Conta *" erro={fieldErrors.conta}>
                <Input
                  name="conta"
                  value={state.conta}
                  onChange={(e) => set("conta", e.target.value)}
                  disabled={pending}
                />
              </Campo>
            </div>
          </>
        )}

        {tipoPagamentoPix && (
          <Campo rotulo="Chave PIX *" erro={fieldErrors.pix_chave}>
            <Input
              name="pix_chave"
              value={state.pix_chave}
              onChange={(e) => set("pix_chave", e.target.value)}
              placeholder="CPF, email, telefone ou chave aleatória"
              disabled={pending}
            />
          </Campo>
        )}
      </Secao>

      {/* ============== Diversidade (opcional) ============== */}
      <Secao
        titulo="Diversidade e saúde (opcional)"
        descricao="Preenchimento voluntário. Serve para relatórios e para gestão responsável."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="Cor/raça" erro={fieldErrors.cor_raca}>
            <Input
              name="cor_raca"
              value={state.cor_raca}
              onChange={(e) => set("cor_raca", e.target.value)}
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="Identidade de gênero" erro={fieldErrors.identidade_genero}>
            <Input
              name="identidade_genero"
              value={state.identidade_genero}
              onChange={(e) => set("identidade_genero", e.target.value)}
              disabled={pending}
            />
          </Campo>
        </div>
        <Campo rotulo="Deficiência" erro={fieldErrors.deficiencia}>
          <Input
            name="deficiencia"
            value={state.deficiencia}
            onChange={(e) => set("deficiencia", e.target.value)}
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Observações de saúde" erro={fieldErrors.saude_obs}>
          <Textarea
            name="saude_obs"
            value={state.saude_obs}
            onChange={(e) => set("saude_obs", e.target.value)}
            rows={2}
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Contato de emergência" erro={fieldErrors.contato_emergencia}>
          <Input
            name="contato_emergencia"
            value={state.contato_emergencia}
            onChange={(e) => set("contato_emergencia", e.target.value)}
            placeholder="Nome e telefone"
            disabled={pending}
          />
        </Campo>
      </Secao>

      {/* ============== Ação prevista ============== */}
      <Secao
        titulo="Ação prevista"
        descricao="Qual é o próximo passo com este freelancer? Pode mudar a qualquer momento."
      >
        <Campo rotulo="Decisão" erro={fieldErrors.acao_prevista}>
          <Select
            value={state.acao_prevista || undefined}
            onValueChange={(v) => set("acao_prevista", v)}
            disabled={pending}
          >
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Sem decisão" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contratar">Contratar</SelectItem>
              <SelectItem value="renovar">Renovar</SelectItem>
              <SelectItem value="manter">Manter</SelectItem>
              <SelectItem value="substituir">Substituir</SelectItem>
              <SelectItem value="encerrar">Encerrar</SelectItem>
            </SelectContent>
          </Select>
          <input type="hidden" name="acao_prevista" value={state.acao_prevista} />
        </Campo>
      </Secao>

      {/* Rodapé */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        <Link
          href={
            modo === "editar" && freelancer
              ? `/freelancers/${freelancer.id}`
              : "/freelancers/lista"
          }
          prefetch={false}
          className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:border-california-red/40 transition-all"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {modo === "novo" ? "Cadastrar freelancer" : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}

// ------------------- UI auxiliares -------------------

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
      <div className="space-y-4 pt-1 border-t border-border pt-5">
        {children}
      </div>
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
