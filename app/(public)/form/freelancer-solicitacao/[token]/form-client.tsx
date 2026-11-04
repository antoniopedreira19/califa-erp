"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
import { DatePicker } from "@/components/ui/date-picker";
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

// Seções âncora do rail lateral. A ordem define a numeração visual.
const SECOES = [
  { id: "voce", rotulo: "Você" },
  { id: "contato", rotulo: "Contato" },
  { id: "endereco", rotulo: "Endereço" },
  { id: "pj", rotulo: "Pessoa jurídica" },
  { id: "pagamento", rotulo: "Pagamento" },
] as const;

export function FormClient({ token, nomePreenchido, cpfPreenchido }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [ativa, setAtiva] = React.useState<string>(SECOES[0].id);

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

  // Observa quais seções estão visíveis pra destacar no rail. Usa threshold
  // baixo com rootMargin pra ativar antes de chegar ao topo — sensação de
  // "estou nessa seção" quando ainda tem sobra pra rolar.
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visiveis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visiveis[0]) setAtiva(visiveis[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );
    for (const s of SECOES) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    setFieldErrors({});

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
      erros.razao_social = ["Razão social obrigatória"];
    if (Object.keys(erros).length > 0) {
      setFieldErrors(erros);
      // Rola até a primeira seção com erro.
      const primeiraSecaoComErro = detectarSecaoDoErro(Object.keys(erros)[0]);
      if (primeiraSecaoComErro) {
        document.getElementById(primeiraSecaoComErro)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
      return;
    }

    startTransition(async () => {
      try {
        const fd = new FormData();
        for (const [k, v] of Object.entries(state)) {
          fd.set(k, v);
        }
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

  return (
    <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
      {/* Rail âncora — some no mobile, vira sticky no desktop. */}
      <aside className="hidden lg:block">
        <nav
          className="sticky top-10 py-2"
          aria-label="Seções do formulário"
        >
          <ol className="relative space-y-6">
            {SECOES.map((s, i) => {
              const ativaBool = ativa === s.id;
              return (
                <li key={s.id} className="relative pl-6">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 top-1 h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all",
                      ativaBool
                        ? "border-california-red bg-california-red text-white scale-110"
                        : "border-foreground/20 bg-transparent text-foreground/40",
                    )}
                  >
                    {i + 1}
                  </span>
                  {i < SECOES.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute left-[9px] top-6 bottom-[-18px] w-px bg-foreground/10"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById(s.id)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className={cn(
                      "text-left text-sm transition-colors",
                      ativaBool
                        ? "font-semibold text-foreground"
                        : "text-foreground/50 hover:text-foreground/80",
                    )}
                  >
                    {s.rotulo}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </aside>

      {/* Form */}
      <form onSubmit={onSubmit} className="space-y-12 pb-32">
        {erroGeral && (
          <div
            role="alert"
            className="rounded-xl border border-california-red/30 bg-california-red/5 p-4 flex items-start gap-3"
          >
            <AlertCircle className="h-5 w-5 text-california-red shrink-0 mt-0.5" />
            <p className="text-sm text-california-red font-medium">{erroGeral}</p>
          </div>
        )}

        <Secao
          id="voce"
          numero={1}
          titulo="Você"
          descricao="Como a gente te chama e os dados pessoais pro contrato."
        >
          <Campo rotulo="Nome como você é conhecido" obrigatorio erro={fieldErrors.nome_social}>
            <Input
              value={state.nome_social}
              onChange={(e) => set("nome_social", e.target.value)}
              required
              className={inputCls(!!fieldErrors.nome_social)}
            />
          </Campo>
          <Campo
            rotulo="Nome completo oficial"
            dica="Como aparece no RG / documento de identidade."
            obrigatorio
            erro={fieldErrors.nome_completo}
          >
            <Input
              value={state.nome_completo}
              onChange={(e) => set("nome_completo", e.target.value)}
              placeholder="Ex.: Maria Joana da Silva Souza"
              required
              className={inputCls(!!fieldErrors.nome_completo)}
            />
          </Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Campo rotulo="CPF" obrigatorio erro={fieldErrors.cpf}>
              <MaskedInput
                mask="cpf"
                defaultValue={state.cpf}
                onDigitsChange={(d) => set("cpf", d)}
                className={inputCls(!!fieldErrors.cpf)}
              />
            </Campo>
            <Campo rotulo="RG" erro={fieldErrors.rg}>
              <Input
                value={state.rg}
                onChange={(e) => set("rg", e.target.value)}
                className={inputCls(!!fieldErrors.rg)}
              />
            </Campo>
          </div>
          <Campo rotulo="Data de nascimento" erro={fieldErrors.data_nascimento}>
            <DatePicker
              name="data_nascimento_visual"
              defaultValue={state.data_nascimento}
              onDateChange={(d) =>
                set("data_nascimento", d ? d.toISOString().slice(0, 10) : "")
              }
              className="max-w-[240px]"
            />
          </Campo>
        </Secao>

        <Secao
          id="contato"
          numero={2}
          titulo="Contato"
          descricao="Pra gente avisar sobre o contrato e alinhar detalhes do job."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Campo rotulo="Email" erro={fieldErrors.email}>
              <Input
                type="email"
                value={state.email}
                onChange={(e) => set("email", e.target.value)}
                className={inputCls(!!fieldErrors.email)}
              />
            </Campo>
            <Campo rotulo="Celular" erro={fieldErrors.celular}>
              <MaskedInput
                mask="telefone"
                defaultValue={state.celular}
                onDigitsChange={(d) => set("celular", d)}
                className={inputCls(!!fieldErrors.celular)}
              />
            </Campo>
          </div>
        </Secao>

        <Secao
          id="endereco"
          numero={3}
          titulo="Endereço"
          descricao="Pra nota fiscal e documentos oficiais."
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Campo rotulo="CEP" obrigatorio erro={fieldErrors.cep}>
              <CepInput
                defaultValue={state.cep}
                required
                onDigitsChange={(d) => set("cep", d)}
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
            <Campo
              rotulo="Cidade"
              obrigatorio
              erro={fieldErrors.cidade}
              className="sm:col-span-2"
            >
              <Input
                value={state.cidade}
                onChange={(e) => set("cidade", e.target.value)}
                required
                className={inputCls(!!fieldErrors.cidade)}
              />
            </Campo>
          </div>
          <Campo rotulo="Rua" obrigatorio erro={fieldErrors.rua}>
            <Input
              value={state.rua}
              onChange={(e) => set("rua", e.target.value)}
              required
              className={inputCls(!!fieldErrors.rua)}
            />
          </Campo>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Campo rotulo="Número" obrigatorio erro={fieldErrors.numero}>
              <Input
                value={state.numero}
                onChange={(e) => set("numero", e.target.value)}
                required
                className={inputCls(!!fieldErrors.numero)}
              />
            </Campo>
            <Campo rotulo="Complemento" erro={fieldErrors.complemento}>
              <Input
                value={state.complemento}
                onChange={(e) => set("complemento", e.target.value)}
                placeholder="Apto, bloco, casa..."
                className={inputCls(!!fieldErrors.complemento)}
              />
            </Campo>
            <Campo rotulo="Bairro" obrigatorio erro={fieldErrors.bairro}>
              <Input
                value={state.bairro}
                onChange={(e) => set("bairro", e.target.value)}
                required
                className={inputCls(!!fieldErrors.bairro)}
              />
            </Campo>
          </div>
        </Secao>

        <Secao
          id="pj"
          numero={4}
          titulo="Pessoa jurídica"
          descricao="O contrato é emitido pra PJ — CNPJ e razão social obrigatórios."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Campo rotulo="CNPJ" obrigatorio erro={fieldErrors.cnpj}>
              <MaskedInput
                mask="cnpj"
                defaultValue={state.cnpj}
                onDigitsChange={(d) => set("cnpj", d)}
                required
                className={inputCls(!!fieldErrors.cnpj)}
              />
            </Campo>
            <Campo rotulo="Razão social" obrigatorio erro={fieldErrors.razao_social}>
              <Input
                value={state.razao_social}
                onChange={(e) => set("razao_social", e.target.value)}
                required
                className={inputCls(!!fieldErrors.razao_social)}
              />
            </Campo>
          </div>
        </Secao>

        <Secao
          id="pagamento"
          numero={5}
          titulo="Pagamento"
          descricao="PIX ou conta bancária — um dos dois já basta. Se preencher os dois, melhor."
        >
          <PagamentoDoFreelancer
            state={state}
            set={set}
            fieldErrors={fieldErrors}
            pending={pending}
            avisarChaveSemTipo={false}
          />
        </Secao>

        {/* CTA sticky no bottom pra não exigir rolar até o fim. Fundo opaco
            com desfoque leve pra separar do conteúdo que passa por baixo. */}
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-black/5 bg-[#F6F3EE]/90 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-6 py-4 lg:pl-[calc(220px+56px+24px)] flex items-center justify-between gap-4">
            <p className="text-[11px] text-foreground/60 hidden sm:block">
              Seus dados ficam no sistema da California, só o RH e o produtor
              acessam.
            </p>
            <button
              type="submit"
              disabled={pending}
              className="group inline-flex items-center gap-2 rounded-xl bg-california-red px-6 py-3 text-sm font-semibold text-white shadow-brand hover:bg-california-red-hover disabled:opacity-50 transition-all"
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  Enviar e aguardar contrato
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Secao({
  id,
  numero,
  titulo,
  descricao,
  children,
}: {
  id: string;
  numero: number;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-10 space-y-6">
      <header className="flex items-baseline gap-4">
        <span className="font-display text-sm font-semibold text-california-red tabular-nums">
          {String(numero).padStart(2, "0")}
        </span>
        <div>
          <h2 className="font-display text-3xl lg:text-4xl font-normal tracking-tight text-foreground leading-tight">
            {titulo}
          </h2>
          {descricao && (
            <p className="mt-1.5 text-sm text-foreground/60 max-w-md leading-relaxed">
              {descricao}
            </p>
          )}
        </div>
      </header>
      <div className="rounded-2xl bg-white border border-black/[0.06] shadow-soft p-6 lg:p-8 space-y-5">
        {children}
      </div>
    </section>
  );
}

function Campo({
  rotulo,
  dica,
  obrigatorio,
  erro,
  children,
  className,
}: {
  rotulo: string;
  dica?: string;
  obrigatorio?: boolean;
  erro?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
        {rotulo}
        {obrigatorio && (
          <span className="text-california-red ml-1" aria-label="obrigatório">
            *
          </span>
        )}
      </Label>
      {dica && (
        <p className="text-[11px] text-foreground/50 italic">{dica}</p>
      )}
      {children}
      {erro && erro.length > 0 && (
        <p className="text-xs text-california-red font-medium flex items-start gap-1">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          {erro[0]}
        </p>
      )}
    </div>
  );
}

function inputCls(temErro: boolean): string {
  return cn(
    "bg-white transition-shadow",
    temErro
      ? "border-california-red/50 focus-visible:ring-california-red/30"
      : "focus-visible:ring-california-red/20",
  );
}

/** Mapeia um nome de campo pra id da seção, pra scrollar até o erro. */
function detectarSecaoDoErro(campo: string): string | null {
  const porCampo: Record<string, string> = {
    nome_social: "voce",
    nome_completo: "voce",
    cpf: "voce",
    rg: "voce",
    data_nascimento: "voce",
    email: "contato",
    celular: "contato",
    cep: "endereco",
    rua: "endereco",
    numero: "endereco",
    complemento: "endereco",
    bairro: "endereco",
    cidade: "endereco",
    cnpj: "pj",
    razao_social: "pj",
    banco: "pagamento",
    agencia: "pagamento",
    conta: "pagamento",
    pix_chave: "pagamento",
  };
  return porCampo[campo] ?? null;
}
