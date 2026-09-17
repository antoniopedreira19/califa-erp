"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
import { MoedaInput } from "@/components/ui/moeda-input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Empresa, Nivel } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import {
  criarColaborador,
  buscarFornecedorPorDocumento,
} from "./actions";

type RegionalOption = { id: string; nome: string; empresa_id: string };
type NivelOption = Pick<Nivel, "id" | "codigo" | "descricao">;
type EmpresaOption = Pick<Empresa, "id" | "nome_fantasia">;

const NONE_SENTINEL = "__none__";

export function ColaboradorFormNovo({
  empresas,
  regionais,
  niveis,
}: {
  empresas: EmpresaOption[];
  regionais: RegionalOption[];
  niveis: NivelOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [tipoContratacao, setTipoContratacao] = React.useState<
    "pj" | "mei" | "clt_recibo" | "clt" | "estagio"
  >("clt");
  const [empresaId, setEmpresaId] = React.useState<string>("");
  const [regionalId, setRegionalId] = React.useState<string>("");
  const [nivelSel, setNivelSel] = React.useState<string>(NONE_SENTINEL);
  const [cpfCnpj, setCpfCnpj] = React.useState<string>("");
  const [dataAdmissao, setDataAdmissao] = React.useState<string>(
    hoje(),
  );

  // Auto-match com fornecedor
  const [fornecedorMatch, setFornecedorMatch] = React.useState<
    { id: string; nome: string } | null
  >(null);
  const [vincularFornecedor, setVincularFornecedor] = React.useState(false);
  const [criarFornecedor, setCriarFornecedor] = React.useState(false);
  const [buscando, setBuscando] = React.useState(false);

  const isPJ = tipoContratacao === "pj" || tipoContratacao === "mei" || tipoContratacao === "clt_recibo";
  const documentoLabel = isPJ ? "CNPJ" : "CPF";
  const documentoMask = isPJ ? "cnpj" : "cpf";
  const documentoDigitosEsperados = isPJ ? 14 : 11;

  const regionaisDaEmpresa = regionais
    .filter((r) => r.empresa_id === empresaId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Auto-match: quando CPF/CNPJ completo, busca em fornecedores
  React.useEffect(() => {
    const digitos = cpfCnpj.replace(/\D/g, "");
    if (digitos.length !== documentoDigitosEsperados) {
      setFornecedorMatch(null);
      setVincularFornecedor(false);
      setCriarFornecedor(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    buscarFornecedorPorDocumento(digitos)
      .then((res) => {
        if (cancelado) return;
        if (res.ok) {
          setFornecedorMatch(res.fornecedor);
          if (res.fornecedor) {
            setVincularFornecedor(true);
            setCriarFornecedor(false);
          } else {
            setVincularFornecedor(false);
          }
        }
      })
      .finally(() => {
        if (!cancelado) setBuscando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [cpfCnpj, documentoDigitosEsperados]);

  // Ao trocar de PJ → PF ou vice-versa, zera o documento pra evitar formato errado
  React.useEffect(() => {
    setCpfCnpj("");
    setFornecedorMatch(null);
    setVincularFornecedor(false);
    setCriarFornecedor(false);
  }, [tipoContratacao]);

  // Ao trocar de empresa, zera a regional (evita regional de outra empresa)
  React.useEffect(() => {
    setRegionalId("");
  }, [empresaId]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    // Traduz sentinels e valores derivados
    if (nivelSel === NONE_SENTINEL) formData.delete("nivel_id");
    else formData.set("nivel_id", nivelSel);
    formData.set("tipo_contratacao", tipoContratacao);
    formData.set("empresa_id", empresaId);
    formData.set("regional_id", regionalId);
    formData.set("cpf_cnpj", cpfCnpj);
    formData.set("data_admissao", dataAdmissao);
    if (vincularFornecedor && fornecedorMatch) {
      formData.set("fornecedor_id", fornecedorMatch.id);
    } else {
      formData.delete("fornecedor_id");
    }
    formData.set("criar_fornecedor", criarFornecedor ? "1" : "0");

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
                <SelectItem value="mei">{tipoContratacaoLabel("mei")}</SelectItem>
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
            <Label htmlFor="cpf_cnpj">
              {documentoLabel}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (opcional — exigido antes de gerar folha)
              </span>
            </Label>
            <MaskedInput
              key={documentoMask}
              id="cpf_cnpj"
              mask={documentoMask}
              onDigitsChange={setCpfCnpj}
            />
            {fieldErrors.cpf_cnpj?.map((msg, i) => (
              <p key={i} className="text-xs text-california-red">
                {msg}
              </p>
            ))}
            {buscando && (
              <p className="text-xs text-muted-foreground">
                Verificando se {documentoLabel} já está cadastrado como fornecedor…
              </p>
            )}
            {fornecedorMatch && (
              <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="flex-1">
                  Fornecedor já cadastrado:{" "}
                  <strong>{fornecedorMatch.nome}</strong>. Dados bancários /
                  PIX serão reaproveitados na baixa da folha.
                  <span className="mt-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={vincularFornecedor}
                      onChange={(e) => setVincularFornecedor(e.target.checked)}
                    />
                    Vincular ao fornecedor existente
                  </span>
                </span>
              </label>
            )}
            {!fornecedorMatch && isPJ && cpfCnpj.replace(/\D/g, "").length === 14 && (
              <label className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="flex-1">
                  CNPJ ainda não está cadastrado como fornecedor.
                  <span className="mt-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={criarFornecedor}
                      onChange={(e) => setCriarFornecedor(e.target.checked)}
                    />
                    Criar fornecedor a partir deste cadastro
                  </span>
                </span>
              </label>
            )}
          </div>

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
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              maxLength={200}
              placeholder="colaborador@exemplo.com"
            />
            {fieldErrors.email?.map((msg, i) => (
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
            Nasce com 100% em uma empresa e regional. Rateio entre múltiplas
            alocações é definido na página do colaborador depois do cadastro.
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
                    empresaId
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
              Salário / Pró-labore mensal{" "}
              <span className="text-california-red">*</span>
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
