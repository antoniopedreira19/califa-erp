"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
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
import type { Empresa, Nivel } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import { criarColaborador } from "./actions";

type RegionalOption = { id: string; nome: string; empresa_id: string };
type NivelOption = Pick<Nivel, "id" | "codigo" | "descricao">;
type EmpresaOption = Pick<Empresa, "id" | "nome_fantasia">;
type LiderOption = { id: string; nome: string };

const NONE_SENTINEL = "__none__";

/** Dados pré-preenchidos vindos do perfil do freelancer que está sendo
 *  efetivado como colaborador. Todos opcionais — o form não força nada. */
export interface ColaboradorFormDefaults {
  nome?: string;
  cpf?: string;
  email?: string;
  telefone?: string;
  funcao?: string;
  data_admissao?: string;
  /** Id do contrato de freela que, ao salvar o colaborador, deve ser
   *  encerrado via RPC `efetivar_contrato_freelancer`. */
  from_freelancer_contrato_id?: string;
}

export function ColaboradorFormNovo({
  empresas,
  regionais,
  niveis,
  lideres,
  defaults,
}: {
  empresas: EmpresaOption[];
  regionais: RegionalOption[];
  niveis: NivelOption[];
  lideres: LiderOption[];
  defaults?: ColaboradorFormDefaults;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [tipoContratacao, setTipoContratacao] = React.useState<
    "pj" | "clt_recibo" | "clt" | "estagio"
  >("clt");
  const [empresaId, setEmpresaId] = React.useState<string>("");
  const [regionalId, setRegionalId] = React.useState<string>("");
  // Hub = colaborador nasce com rateio pela empresa toda, sem regional
  // cravada. Mesma semântica do toggle do modal "Alterar alocação".
  const [usaRateioEmpresa, setUsaRateioEmpresa] = React.useState<boolean>(false);
  const [nivelSel, setNivelSel] = React.useState<string>(NONE_SENTINEL);
  const [liderSel, setLiderSel] = React.useState<string>(NONE_SENTINEL);
  const [cpf, setCpf] = React.useState<string>(defaults?.cpf ?? "");
  const [cnpj, setCnpj] = React.useState<string>("");
  const [telefone, setTelefone] = React.useState<string>(defaults?.telefone ?? "");
  const [dataAdmissao, setDataAdmissao] = React.useState<string>(
    defaults?.data_admissao ?? hoje(),
  );

  const isPJ =
    tipoContratacao === "pj" || tipoContratacao === "clt_recibo";

  const regionaisDaEmpresa = regionais
    .filter((r) => r.empresa_id === empresaId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Ao trocar pra tipo não-PJ, zera CNPJ pra não guardar dado que sairia
  // como pendência silenciosa em cargo CLT/estágio.
  React.useEffect(() => {
    if (!isPJ) setCnpj("");
  }, [isPJ]);

  // Ao trocar de empresa, zera a regional (evita regional de outra empresa)
  // e desliga o Hub (rateio é por empresa — mudar empresa reseta a escolha).
  React.useEffect(() => {
    setRegionalId("");
    setUsaRateioEmpresa(false);
  }, [empresaId]);

  // Ao ligar Hub, limpa a regional selecionada (regra do validador).
  React.useEffect(() => {
    if (usaRateioEmpresa) setRegionalId("");
  }, [usaRateioEmpresa]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    if (nivelSel === NONE_SENTINEL) formData.delete("nivel_id");
    else formData.set("nivel_id", nivelSel);
    if (liderSel === NONE_SENTINEL) formData.delete("lider_id");
    else formData.set("lider_id", liderSel);
    formData.set("tipo_contratacao", tipoContratacao);
    formData.set("empresa_id", empresaId);
    formData.set("regional_id", usaRateioEmpresa ? "" : regionalId);
    formData.set("usa_rateio_empresa", usaRateioEmpresa ? "true" : "false");
    formData.set("cpf", cpf);
    formData.set("cnpj", cnpj);
    formData.set("telefone", telefone);
    formData.set("data_admissao", dataAdmissao);
    if (defaults?.from_freelancer_contrato_id) {
      formData.set(
        "from_freelancer_contrato_id",
        defaults.from_freelancer_contrato_id,
      );
    }

    startTransition(async () => {
      const res = await criarColaborador(formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      router.push(`/rh/colaboradores/${res.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Bloco 1 — Dados fixos */}
      <section className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Dados do colaborador
          </h2>
          <div className="mt-1 h-px bg-border" />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="nome">
              Nome <span className="text-california-red">*</span>
            </Label>
            <Input
              id="nome"
              name="nome"
              required
              maxLength={200}
              placeholder="Ex.: Carolina Cerqueira Inácio"
              defaultValue={defaults?.nome ?? ""}
            />
            {fieldErrors.nome?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
          </div>

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

          <div className="space-y-2">
            <Label htmlFor="cpf">
              CPF <span className="text-california-red">*</span>
            </Label>
            <MaskedInput
              id="cpf"
              mask="cpf"
              required
              defaultValue={defaults?.cpf ?? ""}
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
                required
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
            <Label htmlFor="funcao">
              Função <span className="text-california-red">*</span>
            </Label>
            <Input
              id="funcao"
              name="funcao"
              required
              maxLength={200}
              placeholder="Ex.: Gerente de Projetos, Filmmaker"
              defaultValue={defaults?.funcao ?? ""}
            />
            {fieldErrors.funcao?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nivel_id">Nível</Label>
            <Select value={nivelSel} onValueChange={setNivelSel}>
              <SelectTrigger id="nivel_id">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>
                  Sem nível definido
                </SelectItem>
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
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              maxLength={200}
              placeholder="colaborador@exemplo.com"
              defaultValue={defaults?.email ?? ""}
            />
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
              defaultValue={defaults?.telefone ?? ""}
              onDigitsChange={setTelefone}
            />
            {fieldErrors.telefone?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="data_admissao">
              Data de admissão <span className="text-california-red">*</span>
            </Label>
            <DatePicker
              name="data_admissao_visual"
              id="data_admissao"
              defaultValue={dataAdmissao}
              onDateChange={(d) =>
                setDataAdmissao(d ? d.toISOString().slice(0, 10) : "")
              }
            />
            {fieldErrors.data_admissao?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Bloco 2 — Alocação inicial */}
      <section className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Alocação inicial
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nasce com 100% em uma empresa — em uma regional específica ou no
            rateio da empresa (Hub). Rateio entre múltiplas empresas é
            definido na página do colaborador depois do cadastro.
          </p>
          <div className="mt-2 h-px bg-border" />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
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
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="regional_id">
              Regional{" "}
              {!usaRateioEmpresa && (
                <span className="text-california-red">*</span>
              )}
            </Label>
            <Select
              value={regionalId}
              onValueChange={setRegionalId}
              disabled={!empresaId || usaRateioEmpresa}
            >
              <SelectTrigger id="regional_id">
                <SelectValue
                  placeholder={
                    usaRateioEmpresa
                      ? "Usando rateio da empresa"
                      : empresaId
                        ? "Selecione a regional"
                        : "Selecione a empresa primeiro"
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
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
          </div>

          {empresaId && (
            <div className="md:col-span-2">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="pr-4">
                  <p className="text-sm font-medium">
                    Usar rateio da empresa (Hub)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Quando ativo, o custo é distribuído pelo rateio anual
                    configurado da empresa — sem regional cravada.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={usaRateioEmpresa}
                  onClick={() => setUsaRateioEmpresa((v) => !v)}
                  className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    usaRateioEmpresa
                      ? "bg-california-red"
                      : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform ${
                      usaRateioEmpresa ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Bloco 3 — Salário inicial */}
      <section className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Salário inicial
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Valor mensal em BRL. Mudanças futuras entram como movimentação
            salarial na página do colaborador.
          </p>
          <div className="mt-2 h-px bg-border" />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="salario_valor">
              Salário <span className="text-california-red">*</span>
            </Label>
            <MoedaInput id="salario_valor" name="salario_valor" required />
            {fieldErrors.valor?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
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
          onClick={() => router.push("/rh/colaboradores")}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
        >
          {pending ? "Salvando..." : "Cadastrar colaborador"}
        </button>
      </div>
    </form>
  );
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}
