"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X, AlertCircle } from "lucide-react";
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
    return <VisaoProposta contratacao={c} token={token} />;
  }
  if (c.status === "aceite_recebido") {
    return <VisaoDados contratacao={c} token={token} />;
  }
  return null;
}

function VisaoProposta({
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

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-8 shadow-soft">
        <h1 className="text-2xl font-bold">
          Olá, {c.nome.split(" ")[0]}!
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Temos uma proposta de contratação para você trabalhar conosco na{" "}
          <strong>{c.empresa?.nome_fantasia ?? "California"}</strong>. Confira
          os detalhes abaixo:
        </p>

        <div className="mt-6 grid gap-4 rounded-xl bg-muted/40 p-6 md:grid-cols-2">
          <Campo label="Cargo" valor={c.cargo} />
          <Campo
            label="Contratação"
            valor={tipoContratacaoLabel(c.tipo_contratacao)}
          />
          <Campo
            label="Salário mensal"
            valor={brl.format(Number(c.salario_proposto))}
            destaque
          />
          <Campo
            label="Data prevista de início"
            valor={formatarData(c.data_admissao)}
          />
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Ao aceitar, você será direcionado ao formulário para preencher seus
          dados. Você terá até{" "}
          <strong>{formatarData(c.token_expira_em)}</strong> para concluir.
        </p>

        {erro && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={aceitar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
          >
            <Check className="h-4 w-4" />
            Aceitar proposta
          </button>
          <button
            type="button"
            onClick={() => setOpenRecusa(true)}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-6 py-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <X className="h-4 w-4" />
            Recusar
          </button>
        </div>
      </div>

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

  const ehPJ = c.tipo_contratacao === "pj" || c.tipo_contratacao === "clt_recibo";

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
          Precisamos das informações abaixo para preparar seu contrato.
          Todos os campos são obrigatórios{ehPJ ? " (dados da pessoa jurídica no final)" : ""}.
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
            <MaskedInput
              id="cpf"
              mask="cpf"
              required
              onDigitsChange={setCpf}
            />
            {fieldErrors.cpf?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Bloco PJ (se aplicável) */}
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
                <p key={i} className="text-xs text-california-red">{m}</p>
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
                <p key={i} className="text-xs text-california-red">{m}</p>
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
            <MaskedInput
              id="cep"
              mask="cep"
              required
              onDigitsChange={setCep}
            />
            {fieldErrors.cep?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
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
            <Input
              id="bairro"
              name="bairro"
              required
              maxLength={100}
            />
            {fieldErrors.bairro?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">{m}</p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cidade">Cidade</Label>
            <Input
              id="cidade"
              name="cidade"
              required
              maxLength={100}
            />
            {fieldErrors.cidade?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
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
              <p key={i} className="text-xs text-california-red">{m}</p>
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

function Campo({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 ${destaque ? "text-2xl font-bold text-california-red" : "text-base font-medium text-foreground"}`}
      >
        {valor}
      </p>
    </div>
  );
}
