"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoedaInput } from "@/components/ui/moeda-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Empresa, Nivel, PjNatureza } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import { NATUREZA_PJ_LABEL, NATUREZA_PJ_LABEL_LONGO } from "@/lib/rh/naturezas-pj";
import { criarContratacao } from "../actions";

type RegionalOption = { id: string; nome: string; empresa_id: string };
type NivelOption = Pick<Nivel, "id" | "codigo" | "descricao">;
type EmpresaOption = Pick<Empresa, "id" | "nome_fantasia">;

const NONE_SENTINEL = "__none__";
const TIPOS = ["pj", "clt_recibo", "clt", "estagio"] as const;
const NATUREZAS_PJ: PjNatureza[] = ["mei", "me", "ltda", "eireli", "slu"];

type LiderOption = { id: string; nome: string; email: string };

export function FormNovaContratacao({
  empresas,
  regionais,
  niveis,
  lideres,
}: {
  empresas: EmpresaOption[];
  regionais: RegionalOption[];
  niveis: NivelOption[];
  lideres: LiderOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [tipoContratacao, setTipoContratacao] =
    React.useState<(typeof TIPOS)[number]>("clt");
  const [pjNatureza, setPjNatureza] = React.useState<PjNatureza | "">("");
  const [empresaId, setEmpresaId] = React.useState<string>("");
  const [regionalId, setRegionalId] = React.useState<string>("");
  const [nivelSel, setNivelSel] = React.useState<string>(NONE_SENTINEL);
  const [liderSel, setLiderSel] = React.useState<string>(NONE_SENTINEL);
  const [dataAdmissao, setDataAdmissao] = React.useState<string>("");

  const isPJ = tipoContratacao === "pj" || tipoContratacao === "clt_recibo";

  const regionaisDaEmpresa = regionais
    .filter((r) => r.empresa_id === empresaId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Ao trocar de empresa, zera regional
  React.useEffect(() => {
    setRegionalId("");
  }, [empresaId]);

  // Ao trocar pra não-PJ, zera natureza
  React.useEffect(() => {
    if (!isPJ) setPjNatureza("");
  }, [isPJ]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("tipo_contratacao", tipoContratacao);
    formData.set("empresa_id", empresaId);
    formData.set("regional_id", regionalId);
    formData.set("data_admissao", dataAdmissao);
    if (nivelSel === NONE_SENTINEL) formData.delete("nivel_id");
    else formData.set("nivel_id", nivelSel);
    if (liderSel === NONE_SENTINEL) formData.delete("lider_id");
    else formData.set("lider_id", liderSel);
    if (pjNatureza) formData.set("pj_natureza", pjNatureza);

    startTransition(async () => {
      const res = await criarContratacao(formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      router.push(`/rh/contratacoes/${res.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Bloco 1 — Carta proposta */}
      <section className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Carta proposta (o candidato vê)
          </h2>
          <div className="mt-1 h-px bg-border" />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="nome">
              Nome do candidato <span className="text-california-red">*</span>
            </Label>
            <Input
              id="nome"
              name="nome"
              required
              maxLength={200}
              placeholder="Ex.: Carolina Cerqueira Inácio"
            />
            {fieldErrors.nome?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">{msg}</p>
            ))}
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="email">
              E-mail do candidato <span className="text-california-red">*</span>
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              maxLength={200}
              placeholder="candidato@exemplo.com"
            />
            {fieldErrors.email?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">{msg}</p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cargo">
              Cargo <span className="text-california-red">*</span>
            </Label>
            <Input
              id="cargo"
              name="cargo"
              required
              maxLength={200}
              placeholder="Ex.: Gerente de Projetos"
            />
            {fieldErrors.cargo?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">{msg}</p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="salario_proposto">
              Salário proposto{" "}
              <span className="text-california-red">*</span>
            </Label>
            <MoedaInput
              id="salario_proposto"
              name="salario_proposto"
              required
            />
            {fieldErrors.salario_proposto?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">{msg}</p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="data_admissao">
              Data prevista de admissão{" "}
              <span className="text-california-red">*</span>
            </Label>
            <DatePicker
              name="data_admissao_visual"
              id="data_admissao"
              onDateChange={(d) =>
                setDataAdmissao(d ? d.toISOString().slice(0, 10) : "")
              }
            />
            {fieldErrors.data_admissao?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">{msg}</p>
            ))}
          </div>
        </div>
      </section>

      {/* Bloco 2 — Configuração interna */}
      <section className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Configuração interna
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Definida pelo RH — o candidato não vê essas escolhas na carta.
          </p>
          <div className="mt-2 h-px bg-border" />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tipo_contratacao">
              Tipo de contratação{" "}
              <span className="text-california-red">*</span>
            </Label>
            <Select
              value={tipoContratacao}
              onValueChange={(v) => setTipoContratacao(v as any)}
            >
              <SelectTrigger id="tipo_contratacao">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pj">{tipoContratacaoLabel("pj")}</SelectItem>
                <SelectItem value="clt_recibo">
                  {tipoContratacaoLabel("clt_recibo")}
                </SelectItem>
                <SelectItem value="clt">{tipoContratacaoLabel("clt")}</SelectItem>
                <SelectItem value="estagio">
                  {tipoContratacaoLabel("estagio")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isPJ && (
            <div className="space-y-2">
              <Label htmlFor="pj_natureza">
                Natureza do PJ <span className="text-california-red">*</span>
              </Label>
              <Select
                value={pjNatureza}
                onValueChange={(v) => setPjNatureza(v as PjNatureza)}
              >
                <SelectTrigger id="pj_natureza">
                  <SelectValue placeholder="Selecione a natureza" />
                </SelectTrigger>
                <SelectContent>
                  {NATUREZAS_PJ.map((n) => (
                    <SelectItem key={n} value={n}>
                      {NATUREZA_PJ_LABEL[n]} — {NATUREZA_PJ_LABEL_LONGO[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.pj_natureza?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">{msg}</p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="empresa_id">
              Empresa <span className="text-california-red">*</span>
            </Label>
            <Select value={empresaId} onValueChange={setEmpresaId}>
              <SelectTrigger id="empresa_id">
                <SelectValue placeholder="Selecione a empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome_fantasia}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.empresa_id?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">{msg}</p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="regional_id">
              Regional <span className="text-california-red">*</span>
            </Label>
            <Select
              value={regionalId}
              onValueChange={setRegionalId}
              disabled={!empresaId}
            >
              <SelectTrigger id="regional_id">
                <SelectValue
                  placeholder={
                    empresaId ? "Selecione a regional" : "Selecione a empresa primeiro"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {regionaisDaEmpresa.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.regional_id?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">{msg}</p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nivel_id">Nível</Label>
            <Select value={nivelSel} onValueChange={setNivelSel}>
              <SelectTrigger id="nivel_id">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>Sem nível definido</SelectItem>
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
              placeholder="Sem líder definido"
              buscaPlaceholder="Buscar por nome..."
              limpavel
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="area">Área</Label>
            <Input
              id="area"
              name="area"
              maxLength={80}
              placeholder="Ex.: PROJETOS, CRIAÇÃO, DIGITAL"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
        <button
          type="button"
          onClick={() => router.push("/rh/contratacoes")}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
        >
          {pending ? "Salvando..." : "Criar contratação"}
        </button>
      </div>
    </form>
  );
}
