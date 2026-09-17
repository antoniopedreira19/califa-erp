"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Pencil, CheckCircle2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Colaborador, Nivel } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import {
  editarColaborador,
  buscarFornecedorPorDocumento,
} from "../actions";

const NONE_SENTINEL = "__none__";

export function EditarDadosDrawer({
  colaborador,
  niveis,
}: {
  colaborador: Colaborador & {
    fornecedor: { id: string; nome: string } | null;
  };
  niveis: Pick<Nivel, "id" | "codigo" | "descricao">[];
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
  const [cpfCnpj, setCpfCnpj] = React.useState<string>(
    colaborador.cpf_cnpj ?? "",
  );
  const [dataAdmissao, setDataAdmissao] = React.useState<string>(
    colaborador.data_admissao,
  );
  const [fornecedorId, setFornecedorId] = React.useState<string | null>(
    colaborador.fornecedor_id,
  );
  const [fornecedorMatch, setFornecedorMatch] = React.useState<
    { id: string; nome: string } | null
  >(colaborador.fornecedor);

  const isPJ =
    tipoContratacao === "pj" ||
    tipoContratacao === "mei" ||
    tipoContratacao === "clt_recibo";
  const documentoLabel = isPJ ? "CNPJ" : "CPF";
  const documentoMask = isPJ ? "cnpj" : "cpf";
  const documentoDigitosEsperados = isPJ ? 14 : 11;

  React.useEffect(() => {
    if (!open) return;
    const digitos = cpfCnpj.replace(/\D/g, "");
    if (digitos.length !== documentoDigitosEsperados) return;
    let cancelado = false;
    buscarFornecedorPorDocumento(digitos).then((res) => {
      if (cancelado) return;
      if (res.ok) setFornecedorMatch(res.fornecedor);
    });
    return () => {
      cancelado = true;
    };
  }, [open, cpfCnpj, documentoDigitosEsperados]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
      // Reset ao estado do colaborador
      setTipoContratacao(colaborador.tipo_contratacao);
      setNivelSel(colaborador.nivel_id ?? NONE_SENTINEL);
      setCpfCnpj(colaborador.cpf_cnpj ?? "");
      setDataAdmissao(colaborador.data_admissao);
      setFornecedorId(colaborador.fornecedor_id);
      setFornecedorMatch(colaborador.fornecedor);
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    formData.set("tipo_contratacao", tipoContratacao);
    formData.set("cpf_cnpj", cpfCnpj);
    formData.set("data_admissao", dataAdmissao);
    if (nivelSel === NONE_SENTINEL) formData.delete("nivel_id");
    else formData.set("nivel_id", nivelSel);
    if (fornecedorId) formData.set("fornecedor_id", fornecedorId);
    else formData.delete("fornecedor_id");

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
                    <SelectItem value="mei">
                      {tipoContratacaoLabel("mei")}
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
                <Label htmlFor="cpf_cnpj">{documentoLabel}</Label>
                <MaskedInput
                  key={documentoMask}
                  id="cpf_cnpj"
                  mask={documentoMask}
                  defaultValue={cpfCnpj}
                  onDigitsChange={setCpfCnpj}
                />
                {fieldErrors.cpf_cnpj?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
                {fornecedorMatch && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="flex-1">
                      Fornecedor: <strong>{fornecedorMatch.nome}</strong>
                      <label className="mt-1 flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={fornecedorId === fornecedorMatch.id}
                          onChange={(e) =>
                            setFornecedorId(
                              e.target.checked ? fornecedorMatch.id : null,
                            )
                          }
                        />
                        Vincular ao fornecedor
                      </label>
                    </span>
                  </div>
                )}
              </div>

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
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  maxLength={200}
                  defaultValue={colaborador.email ?? ""}
                />
                {fieldErrors.email?.map((msg, i) => (
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
