"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, X, AlertCircle, Sparkles, Calendar, Wallet, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Contratacao, Empresa } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import {
  aceitarProposta,
  recusarProposta,
  salvarDadosCandidato,
} from "./actions";

type ContratacaoRica = Contratacao & {
  empresa: Pick<Empresa, "id" | "nome_fantasia"> | null;
  regional: { id: string; nome: string } | null;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function PropostaView({
  contratacao: c,
  token,
}: {
  contratacao: ContratacaoRica;
  token: string;
}) {
  if (c.status === "proposta_enviada") {
    return <LandingCarta contratacao={c} token={token} />;
  }
  if (c.status === "aceite_recebido") {
    return <VisaoDados contratacao={c} token={token} />;
  }
  return null;
}

/* =========================================================================
 * LANDING CARTA — apresenta os 7 slides originais da California + card com
 * os dados personalizados do candidato + botões de aceitar/recusar
 * ========================================================================= */

function LandingCarta({
  contratacao: c,
  token,
}: {
  contratacao: ContratacaoRica;
  token: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [openRecusa, setOpenRecusa] = React.useState(false);
  const [motivoRecusa, setMotivoRecusa] = React.useState("");

  function aceitar() {
    setErro(null);
    startTransition(async () => {
      const r = await aceitarProposta(token);
      if (!r.ok) setErro(r.message);
      else router.refresh();
    });
  }

  function recusar() {
    setErro(null);
    const fd = new FormData();
    fd.set("motivo", motivoRecusa);
    startTransition(async () => {
      const r = await recusarProposta(token, fd);
      if (!r.ok) setErro(r.message);
      else router.refresh();
    });
  }

  const primeiroNome = c.nome.split(" ")[0];

  return (
    <div className="space-y-8">
      {/* Card personalizado no topo com os dados reais do candidato */}
      <section className="rounded-3xl bg-gradient-to-br from-california-red via-california-red to-red-900 p-8 md:p-10 text-white shadow-elevated">
        <div className="flex items-start gap-3">
          <Sparkles className="h-6 w-6 mt-1 shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest opacity-80">
              Sua proposta
            </p>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold leading-tight">
              Olá, {primeiroNome}! Boas-vindas à Califa. 🐻
            </h1>
            <p className="mt-2 text-sm md:text-base opacity-90">
              Preparamos uma proposta exclusiva pra você. Confira os detalhes
              abaixo e, depois, dá um role pela nossa apresentação institucional.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <DadoCard
            icon={<Briefcase className="h-5 w-5" />}
            label="Cargo"
            valor={c.cargo}
          />
          <DadoCard
            icon={<Wallet className="h-5 w-5" />}
            label="Remuneração"
            valor={brl.format(Number(c.salario_proposto))}
            complemento={`em regime ${tipoContratacaoLabel(c.tipo_contratacao)}`}
            destaque
          />
          <DadoCard
            icon={<Calendar className="h-5 w-5" />}
            label="Data de início"
            valor={formatarData(c.data_admissao)}
          />
        </div>
      </section>

      {/* Apresentação institucional — os 7 slides originais */}
      <section className="space-y-6">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <SlideImagem key={n} numero={n} candidato={c.nome} />
        ))}
      </section>

      {erro && (
        <div className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* CTA final grande */}
      <section className="rounded-3xl bg-neutral-900 p-10 md:p-14 text-center text-white shadow-elevated">
        <h2 className="text-2xl md:text-3xl font-bold">
          Vamos surfar juntos, {primeiroNome}? 🌊
        </h2>
        <p className="mt-3 text-sm md:text-base opacity-80 max-w-md mx-auto">
          Ao aceitar, você vai preencher alguns dados para o RH preparar seu
          contrato.
        </p>
        <div className="mt-8 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-center">
          <button
            type="button"
            onClick={aceitar}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-california-red px-8 py-4 text-base font-bold text-white shadow-brand hover:bg-california-red-hover disabled:opacity-50 transition-all"
          >
            <Check className="h-5 w-5" />
            {pending ? "Enviando..." : "Aceitar proposta"}
          </button>
          <button
            type="button"
            onClick={() => setOpenRecusa(true)}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 border border-white/20 px-8 py-4 text-base font-medium text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
          >
            <X className="h-5 w-5" />
            Recusar proposta
          </button>
        </div>
        <div className="mt-8 pt-6 border-t border-white/10 text-xs opacity-70">
          <p className="font-medium">Time de Cultura & Talento</p>
          <p>Contato: rh@agenciacalifornia.com.br</p>
        </div>
      </section>

      {openRecusa && (
        <div className="rounded-2xl border border-border bg-white p-6 shadow-soft">
          <h2 className="font-semibold">Recusar a proposta</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nos conte brevemente o motivo. Isso ajuda a equipe a entender.
          </p>
          <div className="mt-4 space-y-3">
            <Label htmlFor="motivo">Motivo</Label>
            <textarea
              id="motivo"
              value={motivoRecusa}
              onChange={(e) => setMotivoRecusa(e.target.value)}
              rows={4}
              maxLength={500}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              placeholder="Ex.: aceitei outra oportunidade"
            />
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpenRecusa(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={recusar}
              disabled={pending || motivoRecusa.trim().length < 3}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              Confirmar recusa
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Componentes de apoio da landing */

function DadoCard({
  icon,
  label,
  valor,
  complemento,
  destaque,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  complemento?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 ${destaque ? "bg-white/20 ring-2 ring-white/30" : "bg-white/10"}`}
    >
      <div className="flex items-center gap-2 text-white/80">
        {icon}
        <span className="text-xs font-bold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p
        className={`mt-2 leading-tight font-bold ${destaque ? "text-3xl" : "text-xl"}`}
      >
        {valor}
      </p>
      {complemento && <p className="text-xs opacity-80 mt-1">{complemento}</p>}
    </div>
  );
}

/**
 * Renderiza uma das 7 páginas da apresentação institucional da California.
 * Se a imagem ainda não existir em /public/proposta/carta/SlideN.JPG,
 * cai num placeholder discreto (não quebra layout).
 */
function SlideImagem({
  numero,
  candidato,
}: {
  numero: number;
  candidato: string;
}) {
  return (
    <div className="overflow-hidden rounded-3xl bg-neutral-100 shadow-soft">
      <div className="relative aspect-[16/9]">
        <Image
          src={`/proposta/carta/Slide${numero}.JPG`}
          alt={`Carta Proposta California — página ${numero}`}
          fill
          sizes="(max-width: 768px) 100vw, 900px"
          className="object-contain"
          priority={numero <= 2}
          unoptimized
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">
          {/* Placeholder — fica visível se a imagem não carregar */}
          <div className="text-center opacity-30">
            <p className="text-4xl font-black">
              Página {numero} de 7
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
 * FORMULÁRIO DE DADOS (aceite_recebido) — igual à v1, sem mudanças
 * ========================================================================= */

function VisaoDados({
  contratacao: c,
  token,
}: {
  contratacao: ContratacaoRica;
  token: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [cpf, setCpf] = React.useState("");
  const [cnpj, setCnpj] = React.useState("");
  const [telefone, setTelefone] = React.useState("");
  const [cep, setCep] = React.useState("");
  const [dataNascimento, setDataNascimento] = React.useState("");
  const [tipoConta, setTipoConta] = React.useState<string>("");
  const [pixTipo, setPixTipo] = React.useState<string>("");

  const ehPJ =
    c.tipo_contratacao === "pj" || c.tipo_contratacao === "clt_recibo";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setFieldErrors({});
    const fd = new FormData(e.currentTarget);
    fd.set("cpf", cpf);
    fd.set("cnpj", cnpj);
    fd.set("telefone", telefone);
    fd.set("cep", cep);
    fd.set("data_nascimento", dataNascimento);
    if (tipoConta) fd.set("tipo_conta", tipoConta);
    if (pixTipo) fd.set("pix_tipo", pixTipo);

    startTransition(async () => {
      const r = await salvarDadosCandidato(token, fd);
      if (!r.ok) {
        setErro(r.message);
        if (r.fieldErrors) setFieldErrors(r.fieldErrors);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-8 shadow-soft">
        <h1 className="text-2xl font-bold">Complete seus dados</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Precisamos das informações abaixo para preparar seu contrato. Todos
          os campos são obrigatórios
          {ehPJ ? " (dados da pessoa jurídica no final)" : ""}.
        </p>
      </div>

      {/* Bloco 1 — Documentos */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Documentos
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cpf">CPF</Label>
            <MaskedInput id="cpf" mask="cpf" required onDigitsChange={setCpf} />
            {fieldErrors.cpf?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rg">RG</Label>
            <Input
              id="rg"
              name="rg"
              required
              maxLength={20}
              placeholder="Ex.: 12.345.678-9"
            />
            {fieldErrors.rg?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="data_nascimento">Data de nascimento</Label>
            <DatePicker
              name="data_nascimento_visual"
              id="data_nascimento"
              onDateChange={(d) =>
                setDataNascimento(d ? d.toISOString().slice(0, 10) : "")
              }
            />
            {fieldErrors.data_nascimento?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefone">Telefone (celular)</Label>
            <MaskedInput
              id="telefone"
              mask="telefone"
              required
              onDigitsChange={setTelefone}
            />
            {fieldErrors.telefone?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Bloco PJ */}
      {ehPJ && (
        <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Pessoa Jurídica
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ</Label>
              <MaskedInput
                id="cnpj"
                mask="cnpj"
                required
                onDigitsChange={setCnpj}
              />
              {fieldErrors.cnpj?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="razao_social">Razão Social</Label>
              <Input
                id="razao_social"
                name="razao_social"
                required
                maxLength={200}
                placeholder="Nome empresarial completo"
              />
              {fieldErrors.razao_social?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bloco 2 — Endereço */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Endereço
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="cep">CEP</Label>
            <MaskedInput id="cep" mask="cep" required onDigitsChange={setCep} />
            {fieldErrors.cep?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="logradouro">Logradouro (rua/avenida)</Label>
            <Input
              id="logradouro"
              name="logradouro"
              required
              maxLength={200}
              placeholder="Ex.: Av. da França"
            />
            {fieldErrors.logradouro?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="numero">Número</Label>
            <Input
              id="numero"
              name="numero"
              required
              maxLength={20}
              placeholder="Ex.: 393"
            />
            {fieldErrors.numero?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="complemento">Complemento (opcional)</Label>
            <Input
              id="complemento"
              name="complemento"
              maxLength={100}
              placeholder="Ex.: Apto 302"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bairro">Bairro</Label>
            <Input id="bairro" name="bairro" required maxLength={100} />
            {fieldErrors.bairro?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cidade">Cidade</Label>
            <Input id="cidade" name="cidade" required maxLength={100} />
            {fieldErrors.cidade?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="uf">UF</Label>
            <Input
              id="uf"
              name="uf"
              required
              maxLength={2}
              placeholder="Ex.: BA"
              className="uppercase"
            />
            {fieldErrors.uf?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Bloco 3 — Bancário */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Dados para pagamento
        </h2>
        <p className="text-xs text-muted-foreground">
          Preencha a conta bancária <strong>OU</strong> o PIX. Um dos dois é
          suficiente.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="banco_codigo">Código do banco</Label>
            <Input
              id="banco_codigo"
              name="banco_codigo"
              maxLength={3}
              placeholder="Ex.: 341"
            />
            {fieldErrors.banco_codigo?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="banco_nome">Nome do banco</Label>
            <Input
              id="banco_nome"
              name="banco_nome"
              maxLength={200}
              placeholder="Ex.: Itaú"
            />
          </div>
          <div className="grid grid-cols-[1fr_60px] gap-2">
            <div className="space-y-2">
              <Label htmlFor="agencia">Agência</Label>
              <Input id="agencia" name="agencia" maxLength={5} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agencia_dv">DV</Label>
              <Input id="agencia_dv" name="agencia_dv" maxLength={1} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_60px] gap-2">
            <div className="space-y-2">
              <Label htmlFor="conta">Conta</Label>
              <Input id="conta" name="conta" maxLength={12} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conta_dv">DV</Label>
              <Input id="conta_dv" name="conta_dv" maxLength={1} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tipo_conta">Tipo de conta</Label>
            <Select value={tipoConta} onValueChange={setTipoConta}>
              <SelectTrigger id="tipo_conta">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corrente">Conta Corrente</SelectItem>
                <SelectItem value="poupanca">Poupança</SelectItem>
                <SelectItem value="pagamento">Conta Pagamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix_tipo">Tipo do PIX</Label>
            <Select value={pixTipo} onValueChange={setPixTipo}>
              <SelectTrigger id="pix_tipo">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cpf">CPF</SelectItem>
                <SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="telefone">Telefone</SelectItem>
                <SelectItem value="aleatoria">Chave aleatória</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="pix_chave">Chave PIX</Label>
            <Input
              id="pix_chave"
              name="pix_chave"
              maxLength={200}
              placeholder="Sua chave PIX"
            />
            {fieldErrors.banco_codigo?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>

      {erro && (
        <div className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-california-red px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
      >
        {pending ? "Enviando..." : "Enviar meus dados"}
      </button>
    </form>
  );
}
