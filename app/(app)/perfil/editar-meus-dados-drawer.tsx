"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Phone,
  MapPin,
  Landmark,
  QrCode,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Colaborador } from "@/lib/types";
import { editarMeuPerfil } from "./actions";

type Props = {
  colaborador: Pick<
    Colaborador,
    | "telefone"
    | "email_pessoal"
    | "cep"
    | "logradouro"
    | "numero"
    | "complemento"
    | "bairro"
    | "cidade"
    | "uf"
    | "banco_codigo"
    | "banco_nome"
    | "agencia"
    | "agencia_dv"
    | "conta"
    | "conta_dv"
    | "tipo_conta"
    | "pix_tipo"
    | "pix_chave"
  >;
  onFechar: () => void;
};

type FormState = {
  telefone: string;
  email_pessoal: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  banco_codigo: string;
  banco_nome: string;
  agencia: string;
  agencia_dv: string;
  conta: string;
  conta_dv: string;
  tipo_conta: string;
  pix_tipo: string;
  pix_chave: string;
};

function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}

export function EditarMeusDadosDrawer({ colaborador: c, onFechar }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [form, setForm] = React.useState<FormState>({
    telefone: toStr(c.telefone),
    email_pessoal: toStr(c.email_pessoal),
    cep: toStr(c.cep),
    logradouro: toStr(c.logradouro),
    numero: toStr(c.numero),
    complemento: toStr(c.complemento),
    bairro: toStr(c.bairro),
    cidade: toStr(c.cidade),
    uf: toStr(c.uf),
    banco_codigo: toStr(c.banco_codigo),
    banco_nome: toStr(c.banco_nome),
    agencia: toStr(c.agencia),
    agencia_dv: toStr(c.agencia_dv),
    conta: toStr(c.conta),
    conta_dv: toStr(c.conta_dv),
    tipo_conta: toStr(c.tipo_conta),
    pix_tipo: toStr(c.pix_tipo),
    pix_chave: toStr(c.pix_chave),
  });

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setFieldErrors({});

    startTransition(async () => {
      const res = await editarMeuPerfil(form);
      if (!res.ok) {
        setErro(res.message);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      router.refresh();
      onFechar();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-lg">Editar meus dados</DialogTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Atualize contato, endereço e dados bancários. Alterações em dados
            oficiais (CPF, nome, cargo) precisam passar pelo RH.
          </p>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5"
        >
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          <Tabs defaultValue="contato" className="w-full">
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="contato" className="gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                Contato
              </TabsTrigger>
              <TabsTrigger value="endereco" className="gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Endereço
              </TabsTrigger>
              <TabsTrigger value="banco" className="gap-1.5">
                <Landmark className="h-3.5 w-3.5" />
                Banco
              </TabsTrigger>
              <TabsTrigger value="pix" className="gap-1.5">
                <QrCode className="h-3.5 w-3.5" />
                PIX
              </TabsTrigger>
            </TabsList>

            {/* Contato */}
            <TabsContent value="contato" className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoInput
                  label="Telefone"
                  id="telefone"
                  value={form.telefone}
                  onChange={(v) => set("telefone", v)}
                  placeholder="(11) 99999-9999"
                  errors={fieldErrors.telefone}
                />
                <CampoInput
                  label="E-mail pessoal"
                  id="email_pessoal"
                  type="email"
                  value={form.email_pessoal}
                  onChange={(v) => set("email_pessoal", v)}
                  placeholder="voce@gmail.com"
                  errors={fieldErrors.email_pessoal}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                O e-mail corporativo é o do seu login no sistema — não pode ser
                alterado aqui.
              </p>
            </TabsContent>

            {/* Endereço */}
            <TabsContent value="endereco" className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <CampoInput
                  label="CEP"
                  id="cep"
                  value={form.cep}
                  onChange={(v) => set("cep", v)}
                  placeholder="00000-000"
                  errors={fieldErrors.cep}
                />
                <div className="sm:col-span-2 grid gap-4 sm:grid-cols-[1fr_120px]">
                  <CampoInput
                    label="Logradouro"
                    id="logradouro"
                    value={form.logradouro}
                    onChange={(v) => set("logradouro", v)}
                    placeholder="Rua, avenida..."
                    errors={fieldErrors.logradouro}
                  />
                  <CampoInput
                    label="Número"
                    id="numero"
                    value={form.numero}
                    onChange={(v) => set("numero", v)}
                    errors={fieldErrors.numero}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoInput
                  label="Complemento"
                  id="complemento"
                  value={form.complemento}
                  onChange={(v) => set("complemento", v)}
                  placeholder="Apto, bloco..."
                  errors={fieldErrors.complemento}
                />
                <CampoInput
                  label="Bairro"
                  id="bairro"
                  value={form.bairro}
                  onChange={(v) => set("bairro", v)}
                  errors={fieldErrors.bairro}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                <CampoInput
                  label="Cidade"
                  id="cidade"
                  value={form.cidade}
                  onChange={(v) => set("cidade", v)}
                  errors={fieldErrors.cidade}
                />
                <CampoInput
                  label="UF"
                  id="uf"
                  value={form.uf}
                  onChange={(v) => set("uf", v.toUpperCase().slice(0, 2))}
                  placeholder="SP"
                  errors={fieldErrors.uf}
                />
              </div>
            </TabsContent>

            {/* Banco */}
            <TabsContent value="banco" className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                <CampoInput
                  label="Código"
                  id="banco_codigo"
                  value={form.banco_codigo}
                  onChange={(v) => set("banco_codigo", v)}
                  placeholder="001"
                  errors={fieldErrors.banco_codigo}
                />
                <CampoInput
                  label="Nome do banco"
                  id="banco_nome"
                  value={form.banco_nome}
                  onChange={(v) => set("banco_nome", v)}
                  placeholder="Banco do Brasil"
                  errors={fieldErrors.banco_nome}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_80px_1fr_80px]">
                <CampoInput
                  label="Agência"
                  id="agencia"
                  value={form.agencia}
                  onChange={(v) => set("agencia", v)}
                  errors={fieldErrors.agencia}
                />
                <CampoInput
                  label="Dígito"
                  id="agencia_dv"
                  value={form.agencia_dv}
                  onChange={(v) => set("agencia_dv", v.slice(0, 2))}
                  errors={fieldErrors.agencia_dv}
                />
                <CampoInput
                  label="Conta"
                  id="conta"
                  value={form.conta}
                  onChange={(v) => set("conta", v)}
                  errors={fieldErrors.conta}
                />
                <CampoInput
                  label="Dígito"
                  id="conta_dv"
                  value={form.conta_dv}
                  onChange={(v) => set("conta_dv", v.slice(0, 2))}
                  errors={fieldErrors.conta_dv}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tipo_conta">Tipo de conta</Label>
                <Select
                  value={form.tipo_conta || "__none__"}
                  onValueChange={(v) =>
                    set("tipo_conta", v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger id="tipo_conta">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    <SelectItem value="corrente">Conta corrente</SelectItem>
                    <SelectItem value="poupanca">Conta poupança</SelectItem>
                    <SelectItem value="pagamento">
                      Conta de pagamento
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* PIX */}
            <TabsContent value="pix" className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pix_tipo">Tipo da chave</Label>
                <Select
                  value={form.pix_tipo || "__none__"}
                  onValueChange={(v) =>
                    set("pix_tipo", v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger id="pix_tipo">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    <SelectItem value="cpf">CPF</SelectItem>
                    <SelectItem value="cnpj">CNPJ</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="telefone">Telefone</SelectItem>
                    <SelectItem value="aleatoria">Chave aleatória</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <CampoInput
                label="Chave PIX"
                id="pix_chave"
                value={form.pix_chave}
                onChange={(v) => set("pix_chave", v)}
                errors={fieldErrors.pix_chave}
              />
              <p className="text-xs text-amber-700">
                Atenção: alterar a chave PIX muda a conta de destino dos
                pagamentos futuros. Confirme com o RH se precisar validar.
              </p>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-end gap-2 pt-6 mt-4 border-t border-border">
            <button
              type="button"
              onClick={onFechar}
              disabled={pending}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
            >
              {pending ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CampoInput({
  label,
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  errors,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  errors?: string[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {errors?.map((msg, i) => (
        <p key={i} className="text-xs text-red-700">
          {msg}
        </p>
      ))}
    </div>
  );
}
