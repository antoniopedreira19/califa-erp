"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Pencil } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Colaborador, Nivel } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import { editarColaborador } from "../actions";

const NONE_SENTINEL = "__none__";

type LiderOption = { id: string; nome: string };

export function EditarDadosDrawer({
  colaborador,
  niveis,
  lideres,
}: {
  colaborador: Colaborador;
  niveis: Pick<Nivel, "id" | "codigo" | "descricao">[];
  lideres: LiderOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [tipoContratacao, setTipoContratacao] = React.useState(
    colaborador.tipo_contratacao,
  );
  const [nivelSel, setNivelSel] = React.useState<string>(
    colaborador.nivel_id ?? NONE_SENTINEL,
  );
  const [liderSel, setLiderSel] = React.useState<string>(
    colaborador.lider_id ?? NONE_SENTINEL,
  );
  const [cpf, setCpf] = React.useState<string>(colaborador.cpf ?? "");
  const [cnpj, setCnpj] = React.useState<string>(colaborador.cnpj ?? "");
  const [telefone, setTelefone] = React.useState<string>(
    colaborador.telefone ?? "",
  );
  const [dataAdmissao, setDataAdmissao] = React.useState<string>(
    colaborador.data_admissao,
  );

  const isPJ =
    tipoContratacao === "pj" || tipoContratacao === "clt_recibo";

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
      // Reset ao estado do colaborador
      setTipoContratacao(colaborador.tipo_contratacao);
      setNivelSel(colaborador.nivel_id ?? NONE_SENTINEL);
      setLiderSel(colaborador.lider_id ?? NONE_SENTINEL);
      setCpf(colaborador.cpf ?? "");
      setCnpj(colaborador.cnpj ?? "");
      setTelefone(colaborador.telefone ?? "");
      setDataAdmissao(colaborador.data_admissao);
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    formData.set("tipo_contratacao", tipoContratacao);
    formData.set("cpf", cpf);
    formData.set("cnpj", cnpj);
    formData.set("telefone", telefone);
    formData.set("data_admissao", dataAdmissao);
    if (nivelSel === NONE_SENTINEL) formData.delete("nivel_id");
    else formData.set("nivel_id", nivelSel);
    if (liderSel === NONE_SENTINEL) formData.delete("lider_id");
    else formData.set("lider_id", liderSel);

    startTransition(async () => {
      const res = await editarColaborador(colaborador.id, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
      </DialogTrigger>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Editar dados do colaborador</DialogTitle>
          <DialogDescription>
            Dados fixos do cadastro. Alocação e salário são editados nos cards
            próprios.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                name="nome"
                required
                maxLength={200}
                defaultValue={colaborador.nome}
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tipo_contratacao">Tipo de contratação</Label>
                <Select
                  value={tipoContratacao}
                  onValueChange={(v) => setTipoContratacao(v as any)}
                >
                  <SelectTrigger id="tipo_contratacao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pj">
                      {tipoContratacaoLabel("pj")}
                    </SelectItem>
                    <SelectItem value="clt_recibo">
                      {tipoContratacaoLabel("clt_recibo")}
                    </SelectItem>
                    <SelectItem value="clt">
                      {tipoContratacaoLabel("clt")}
                    </SelectItem>
                    <SelectItem value="estagio">
                      {tipoContratacaoLabel("estagio")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cpf">
                  CPF <span className="text-california-red">*</span>
                </Label>
                <MaskedInput
                  id="cpf"
                  mask="cpf"
                  defaultValue={cpf}
                  onDigitsChange={setCpf}
                />
                {fieldErrors.cpf?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>

              {isPJ && (
                <div className="space-y-2">
                  <Label htmlFor="cnpj">
                    CNPJ <span className="text-california-red">*</span>
                  </Label>
                  <MaskedInput
                    id="cnpj"
                    mask="cnpj"
                    defaultValue={cnpj}
                    onDigitsChange={setCnpj}
                  />
                  {fieldErrors.cnpj?.map((msg, i) => (
                    <p key={i} className="text-xs text-california-red">
                      {msg}
                    </p>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="funcao">Função</Label>
                <Input
                  id="funcao"
                  name="funcao"
                  required
                  maxLength={200}
                  defaultValue={colaborador.funcao}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nivel_id">Nível</Label>
                <Select value={nivelSel} onValueChange={setNivelSel}>
                  <SelectTrigger id="nivel_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_SENTINEL}>Sem nível</SelectItem>
                    {niveis.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.codigo}
                        {n.descricao ? ` — ${n.descricao}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lider_id">Líder direto</Label>
                <Combobox
                  id="lider_id"
                  ariaLabel="Líder direto"
                  className={COMBOBOX_COMO_SELECT}
                  items={lideres.map((l) => ({ value: l.id, label: l.nome }))}
                  value={liderSel === NONE_SENTINEL ? null : liderSel}
                  onChange={(v) => setLiderSel(v ?? NONE_SENTINEL)}
                  placeholder="Sem líder"
                  buscaPlaceholder="Buscar por nome..."
                  limpavel
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  maxLength={200}
                  defaultValue={colaborador.email ?? ""}
                  readOnly={!!colaborador.user_id}
                  className={colaborador.user_id ? "bg-muted/40 cursor-not-allowed" : ""}
                />
                {colaborador.user_id && (
                  <p className="text-xs text-muted-foreground">
                    Esse email vem do login do colaborador. Para alterar,
                    desvincule o usuário no card &ldquo;Acesso ao sistema&rdquo;
                    primeiro.
                  </p>
                )}
                {fieldErrors.email?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="telefone">Telefone</Label>
                <MaskedInput
                  id="telefone"
                  mask="telefone"
                  defaultValue={telefone}
                  onDigitsChange={setTelefone}
                />
                {fieldErrors.telefone?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Data de admissão</Label>
                <DatePicker
                  name="data_admissao_visual"
                  defaultValue={dataAdmissao}
                  onDateChange={(d) =>
                    setDataAdmissao(d ? d.toISOString().slice(0, 10) : "")
                  }
                />
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
              onClick={() => handleOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
