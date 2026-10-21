"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { addDays, addMonths, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Save,
  FileText,
  X,
  Upload,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Combobox,
  COMBOBOX_COMO_SELECT,
  type ComboboxItem,
} from "@/components/ui/combobox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn, isValidCpf, onlyDigits } from "@/lib/utils";
import {
  CIDADES,
  COR_RACA,
  IDENTIDADE_GENERO,
  DEFICIENCIA,
  resolveOutro,
} from "@/lib/freelancers/constantes";
import type { FreelancerCargo } from "@/lib/types";
import { CepInput } from "./cep-input";
import { JobPicker, type JobItem } from "./job-picker";
import { CargoPicker } from "./cargo-picker";
import { criarFreelancerCompleto } from "../actions";

interface Props {
  responsaveis: Array<{ id: string; nome: string }>;
  jobs: JobItem[];
  cargos: FreelancerCargo[];
  trigger?: React.ReactNode;
}

type Modo = "mensal" | "periodo" | "diarias";
type DuracaoUnidade = "meses" | "dias";

const STEPS = [
  { id: 1, label: "Identificação" },
  { id: 2, label: "Contato" },
  { id: 3, label: "Pagamento" },
  { id: 4, label: "Diversidade" },
  { id: 5, label: "Contrato" },
] as const;

const TIPO_OPCOES = [
  { value: "mensal", label: "Mensal" },
  { value: "periodo", label: "Período" },
  { value: "diarias", label: "Diárias" },
];

const DURACAO_UNIDADE_OPCOES = [
  { value: "meses", label: "meses" },
  { value: "dias", label: "dias" },
];

function isoDate(d: Date | null): string {
  return d ? format(d, "yyyy-MM-dd") : "";
}

/**
 * Calcula data_termino a partir de data_inicio + duração (N meses ou N dias).
 * Ex.: 21/10/2026 + 2 meses → 21/12/2026.
 */
function calcularDataTermino(
  dataInicio: string,
  qtd: string,
  unidade: DuracaoUnidade,
): string {
  const n = Number(qtd);
  if (!dataInicio || !Number.isFinite(n) || n <= 0) return "";
  try {
    const base = parseISO(dataInicio);
    const fim = unidade === "meses" ? addMonths(base, n) : addDays(base, n);
    return format(fim, "yyyy-MM-dd");
  } catch {
    return "";
  }
}

export function NovoFreelancerDialog({
  responsaveis,
  jobs,
  cargos,
  trigger,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(1);
  const [pending, startTransition] = React.useTransition();
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  // Step 1 — Identificação
  const [responsavelId, setResponsavelId] = React.useState<string | null>(null);
  const [nome, setNome] = React.useState("");
  const [sobrenome, setSobrenome] = React.useState("");
  const [nomeSocial, setNomeSocial] = React.useState("");
  const [dataNascimento, setDataNascimento] = React.useState("");
  const [rg, setRg] = React.useState("");
  const [cpf, setCpf] = React.useState("");

  // Step 2 — Contato + endereço
  const [celular, setCelular] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [cep, setCep] = React.useState("");
  const [rua, setRua] = React.useState("");
  const [numero, setNumero] = React.useState("");
  const [complemento, setComplemento] = React.useState("");
  const [bairro, setBairro] = React.useState("");
  const [cidade, setCidade] = React.useState("");

  // Step 3 — PJ + pagamento
  const [cnpj, setCnpj] = React.useState("");
  const [razaoSocial, setRazaoSocial] = React.useState("");
  const [cartaoCnpjFile, setCartaoCnpjFile] = React.useState<File | null>(null);
  const [banco, setBanco] = React.useState("");
  const [agencia, setAgencia] = React.useState("");
  const [conta, setConta] = React.useState("");
  const [pixChave, setPixChave] = React.useState("");

  // Step 4 — Diversidade
  const [corRaca, setCorRaca] = React.useState("");
  const [corRacaOutro, setCorRacaOutro] = React.useState("");
  const [identidadeGenero, setIdentidadeGenero] = React.useState("");
  const [identidadeGeneroOutro, setIdentidadeGeneroOutro] = React.useState("");
  const [deficiencia, setDeficiencia] = React.useState("");
  const [deficienciaOutro, setDeficienciaOutro] = React.useState("");
  const [saudeObs, setSaudeObs] = React.useState("");
  const [contatoEmergencia, setContatoEmergencia] = React.useState("");

  // Step 5 — Contrato
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [cargoContrato, setCargoContrato] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState<number | null>(null);
  const [tipo, setTipo] = React.useState<Modo>("mensal");
  const [dataInicio, setDataInicio] = React.useState("");
  const [duracaoQtd, setDuracaoQtd] = React.useState("");
  const [duracaoUnidade, setDuracaoUnidade] =
    React.useState<DuracaoUnidade>("meses");
  const [cidadeContrato, setCidadeContrato] = React.useState("");

  const dataTerminoCalculada = calcularDataTermino(
    dataInicio,
    duracaoQtd,
    duracaoUnidade,
  );

  function reset() {
    setStep(1);
    setResponsavelId(null);
    setNome("");
    setSobrenome("");
    setNomeSocial("");
    setDataNascimento("");
    setRg("");
    setCpf("");
    setCelular("");
    setEmail("");
    setCep("");
    setRua("");
    setNumero("");
    setComplemento("");
    setBairro("");
    setCidade("");
    setCnpj("");
    setRazaoSocial("");
    setCartaoCnpjFile(null);
    setBanco("");
    setAgencia("");
    setConta("");
    setPixChave("");
    setCorRaca("");
    setCorRacaOutro("");
    setIdentidadeGenero("");
    setIdentidadeGeneroOutro("");
    setDeficiencia("");
    setDeficienciaOutro("");
    setSaudeObs("");
    setContatoEmergencia("");
    setJobId(null);
    setCargoContrato(null);
    setValor(null);
    setTipo("mensal");
    setDataInicio("");
    setDuracaoQtd("");
    setDuracaoUnidade("meses");
    setCidadeContrato("");
    setErroGeral(null);
    setFieldErrors({});
  }

  function fechar() {
    setOpen(false);
    reset();
  }

  function validarStep(n: number): string | null {
    if (n === 1) {
      if (!responsavelId) return "Selecione o responsável";
      if (!nome.trim() || !sobrenome.trim()) return "Preencha nome e sobrenome";
      if (!nomeSocial.trim()) return "Nome social é obrigatório";
      if (cpf && !isValidCpf(onlyDigits(cpf))) return "CPF inválido";
    }
    if (n === 2) {
      if (!cep || !rua.trim() || !numero.trim() || !bairro.trim())
        return "Preencha o endereço completo (CEP, rua, número, bairro)";
      if (!cidade) return "Selecione a cidade";
    }
    if (n === 3) {
      if (cnpj && !razaoSocial.trim())
        return "Razão Social obrigatória quando CNPJ é preenchido";
      if (!banco.trim() || !agencia.trim() || !conta.trim())
        return "Dados bancários (banco, agência, conta) são obrigatórios";
    }
    if (n === 5) {
      if (!jobId) return "Selecione um job";
      if (!cargoContrato) return "Selecione o cargo";
      if (!valor || valor <= 0) return "Valor inválido";
      if (!dataInicio) return "Data de início obrigatória";
      if (!cidadeContrato) return "Selecione a cidade do contrato";
    }
    return null;
  }

  function avancar() {
    setErroGeral(null);
    const erro = validarStep(step);
    if (erro) {
      setErroGeral(erro);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length));
  }

  function voltar() {
    setErroGeral(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  function submit() {
    setErroGeral(null);
    setFieldErrors({});
    const erro = validarStep(5);
    if (erro) {
      setErroGeral(erro);
      return;
    }

    const nomeCompleto = `${nome.trim()} ${sobrenome.trim()}`.trim();
    const fd = new FormData();
    // Freelancer
    fd.set("nome_social", nomeSocial);
    fd.set("nome_completo", nomeCompleto);
    fd.set("cpf", onlyDigits(cpf));
    fd.set("rg", rg);
    fd.set("data_nascimento", dataNascimento);
    fd.set("email", email);
    fd.set("celular", onlyDigits(celular));
    fd.set("cep", onlyDigits(cep));
    fd.set("rua", rua);
    fd.set("numero", numero);
    fd.set("complemento", complemento);
    fd.set("bairro", bairro);
    fd.set("cidade", cidade);
    fd.set("cnpj", onlyDigits(cnpj));
    fd.set("razao_social", razaoSocial);
    fd.set("banco", banco);
    fd.set("agencia", agencia);
    fd.set("conta", conta);
    fd.set("pix_chave", pixChave);
    fd.set("cor_raca", resolveOutro(corRaca, corRacaOutro));
    fd.set(
      "identidade_genero",
      resolveOutro(identidadeGenero, identidadeGeneroOutro),
    );
    fd.set("deficiencia", resolveOutro(deficiencia, deficienciaOutro));
    fd.set("saude_obs", saudeObs);
    fd.set("contato_emergencia", contatoEmergencia);
    // Contrato
    fd.set("responsavel_id", responsavelId ?? "");
    fd.set("job_id", jobId ?? "");
    fd.set("cargo_contrato", cargoContrato ?? "");
    fd.set("valor_centavos", String(Math.round((valor ?? 0) * 100)));
    fd.set("tipo_contrato", tipo);
    fd.set("data_inicio_contrato", dataInicio);
    fd.set("data_termino_contrato", dataTerminoCalculada);
    fd.set("cidade_contrato", cidadeContrato);
    // Arquivo opcional
    if (cartaoCnpjFile) fd.set("cartao_cnpj_file", cartaoCnpjFile);

    startTransition(async () => {
      const r = await criarFreelancerCompleto(fd);
      if (!r.ok) {
        setErroGeral(r.message);
        if (r.fieldErrors) setFieldErrors(r.fieldErrors);
        return;
      }
      fechar();
      router.push(`/freelancers/${r.data!.freelancer_id}`);
      router.refresh();
    });
  }

  const responsaveisItems: ComboboxItem[] = responsaveis.map((r) => ({
    value: r.id,
    label: r.nome,
  }));

  const defaultTrigger = (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-colors"
    >
      <Plus className="h-4 w-4" />
      Novo freelancer
    </button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <div className="flex flex-col h-[640px]">
          {/* Header fixo */}
          <div className="px-6 py-4 border-b border-border shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-california-red">
              Novo freelancer
            </p>
            <h2 className="text-lg font-bold text-foreground mt-0.5">
              Cadastro em {STEPS.length} passos
            </h2>
            <StepsBar step={step} />
          </div>

          {/* Conteúdo do step (altura fixa) */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {step === 1 && (
              <Step1Identificacao
                responsaveisItems={responsaveisItems}
                responsavelId={responsavelId}
                setResponsavelId={setResponsavelId}
                nome={nome}
                setNome={setNome}
                sobrenome={sobrenome}
                setSobrenome={setSobrenome}
                nomeSocial={nomeSocial}
                setNomeSocial={setNomeSocial}
                dataNascimento={dataNascimento}
                setDataNascimento={setDataNascimento}
                rg={rg}
                setRg={setRg}
                cpf={cpf}
                setCpf={setCpf}
                pending={pending}
              />
            )}
            {step === 2 && (
              <Step2Contato
                celular={celular}
                setCelular={setCelular}
                email={email}
                setEmail={setEmail}
                cep={cep}
                setCep={setCep}
                rua={rua}
                setRua={setRua}
                numero={numero}
                setNumero={setNumero}
                complemento={complemento}
                setComplemento={setComplemento}
                bairro={bairro}
                setBairro={setBairro}
                cidade={cidade}
                setCidade={setCidade}
                onCepPreencheu={(d: {
                  rua: string;
                  bairro: string;
                  cidade: string;
                }) => {
                  if (!rua && d.rua) setRua(d.rua);
                  if (!bairro && d.bairro) setBairro(d.bairro);
                  if (
                    !cidade &&
                    d.cidade &&
                    (CIDADES as readonly string[]).includes(d.cidade)
                  )
                    setCidade(d.cidade);
                }}
                pending={pending}
              />
            )}
            {step === 3 && (
              <Step3Pagamento
                cnpj={cnpj}
                setCnpj={setCnpj}
                razaoSocial={razaoSocial}
                setRazaoSocial={setRazaoSocial}
                cartaoCnpjFile={cartaoCnpjFile}
                setCartaoCnpjFile={setCartaoCnpjFile}
                banco={banco}
                setBanco={setBanco}
                agencia={agencia}
                setAgencia={setAgencia}
                conta={conta}
                setConta={setConta}
                pixChave={pixChave}
                setPixChave={setPixChave}
                pending={pending}
              />
            )}
            {step === 4 && (
              <Step4Diversidade
                corRaca={corRaca}
                setCorRaca={setCorRaca}
                corRacaOutro={corRacaOutro}
                setCorRacaOutro={setCorRacaOutro}
                identidadeGenero={identidadeGenero}
                setIdentidadeGenero={setIdentidadeGenero}
                identidadeGeneroOutro={identidadeGeneroOutro}
                setIdentidadeGeneroOutro={setIdentidadeGeneroOutro}
                deficiencia={deficiencia}
                setDeficiencia={setDeficiencia}
                deficienciaOutro={deficienciaOutro}
                setDeficienciaOutro={setDeficienciaOutro}
                saudeObs={saudeObs}
                setSaudeObs={setSaudeObs}
                contatoEmergencia={contatoEmergencia}
                setContatoEmergencia={setContatoEmergencia}
                pending={pending}
              />
            )}
            {step === 5 && (
              <Step5Contrato
                jobs={jobs}
                cargos={cargos}
                jobId={jobId}
                setJobId={setJobId}
                cargoContrato={cargoContrato}
                setCargoContrato={setCargoContrato}
                valor={valor}
                setValor={setValor}
                tipo={tipo}
                setTipo={setTipo}
                dataInicio={dataInicio}
                setDataInicio={setDataInicio}
                duracaoQtd={duracaoQtd}
                setDuracaoQtd={setDuracaoQtd}
                duracaoUnidade={duracaoUnidade}
                setDuracaoUnidade={setDuracaoUnidade}
                dataTerminoCalculada={dataTerminoCalculada}
                cidadeContrato={cidadeContrato}
                setCidadeContrato={setCidadeContrato}
                pending={pending}
              />
            )}
          </div>

          {/* Erro + navegação */}
          <div className="px-6 py-3 border-t border-border bg-muted/10 shrink-0 space-y-2">
            {erroGeral && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-2.5 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-california-red shrink-0 mt-0.5" />
                <p className="text-xs text-california-red font-medium">
                  {erroGeral}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={step === 1 ? fechar : voltar}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-60"
              >
                {step === 1 ? (
                  <>Cancelar</>
                ) : (
                  <>
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Voltar
                  </>
                )}
              </button>
              <p className="text-[11px] text-muted-foreground">
                Passo {step} de {STEPS.length}
              </p>
              {step < STEPS.length ? (
                <button
                  type="button"
                  onClick={avancar}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red text-white text-xs font-semibold px-4 py-2 hover:bg-california-red-hover transition-colors disabled:opacity-60"
                >
                  Próximo
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red text-white text-xs font-semibold px-4 py-2 hover:bg-california-red-hover transition-colors disabled:opacity-60"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Cadastrar freelancer
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------- UI auxiliares ----------------------------

function StepsBar({ step }: { step: number }) {
  return (
    <div className="mt-3 flex items-center gap-1.5">
      {STEPS.map((s) => {
        const estado =
          step > s.id ? "done" : step === s.id ? "active" : "pending";
        return (
          <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={cn(
                "h-1 w-full rounded-full transition-all",
                estado === "done" || estado === "active"
                  ? "bg-california-red"
                  : "bg-muted-foreground/20",
              )}
            />
            <span
              className={cn(
                "text-[9px] font-semibold uppercase tracking-[0.08em]",
                estado === "active"
                  ? "text-california-red"
                  : estado === "done"
                    ? "text-foreground"
                    : "text-muted-foreground/50",
              )}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Campo({
  rotulo,
  children,
  className,
}: {
  rotulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[11px] font-semibold text-foreground">
        {rotulo}
      </Label>
      {children}
    </div>
  );
}

// ---------------------------- Steps ----------------------------

function Step1Identificacao({
  responsaveisItems,
  responsavelId,
  setResponsavelId,
  nome,
  setNome,
  sobrenome,
  setSobrenome,
  nomeSocial,
  setNomeSocial,
  dataNascimento,
  setDataNascimento,
  rg,
  setRg,
  cpf,
  setCpf,
  pending,
}: any) {
  return (
    <div className="space-y-3">
      <Campo rotulo="Responsável *">
        <Combobox
          items={responsaveisItems}
          value={responsavelId}
          onChange={setResponsavelId}
          placeholder="Selecione o responsável"
          buscaPlaceholder="Buscar por nome…"
          disabled={pending}
          className={COMBOBOX_COMO_SELECT}
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Nome *">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome"
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Sobrenome *">
          <Input
            value={sobrenome}
            onChange={(e) => setSobrenome(e.target.value)}
            placeholder="Sobrenome"
            disabled={pending}
          />
        </Campo>
      </div>

      <Campo rotulo="Nome social / apelido *">
        <Input
          value={nomeSocial}
          onChange={(e) => setNomeSocial(e.target.value)}
          placeholder="Como esta pessoa é conhecida"
          disabled={pending}
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Data de nascimento">
          <DatePicker
            name="data_nascimento"
            defaultValue={dataNascimento}
            onDateChange={(d) => setDataNascimento(isoDate(d))}
            disabled={pending}
            comSeletorAnoMes
            fromYear={1940}
            toYear={new Date().getFullYear()}
          />
        </Campo>
        <Campo rotulo="RG">
          <Input
            value={rg}
            onChange={(e) => setRg(e.target.value)}
            placeholder="Número do RG"
            disabled={pending}
          />
        </Campo>
      </div>

      <Campo rotulo="CPF">
        <MaskedInput
          mask="cpf"
          defaultValue={cpf}
          onDigitsChange={setCpf}
          disabled={pending}
        />
      </Campo>
    </div>
  );
}

function Step2Contato({
  celular,
  setCelular,
  email,
  setEmail,
  cep,
  setCep,
  rua,
  setRua,
  numero,
  setNumero,
  complemento,
  setComplemento,
  bairro,
  setBairro,
  cidade,
  setCidade,
  onCepPreencheu,
  pending,
}: any) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Celular *">
          <MaskedInput
            mask="telefone"
            defaultValue={celular}
            onDigitsChange={setCelular}
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            disabled={pending}
          />
        </Campo>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="CEP *">
          <CepInput
            name="cep"
            defaultValue={cep}
            disabled={pending}
            onDigitsChange={setCep}
            onEnderecoEncontrado={onCepPreencheu}
          />
        </Campo>
        <Campo rotulo="Número *">
          <Input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Complemento">
          <Input
            value={complemento}
            onChange={(e) => setComplemento(e.target.value)}
            placeholder="Apto, bloco, etc."
            disabled={pending}
          />
        </Campo>
      </div>

      <Campo rotulo="Rua *">
        <Input
          value={rua}
          onChange={(e) => setRua(e.target.value)}
          placeholder="Ex.: Av. Paulista"
          disabled={pending}
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Bairro *">
          <Input
            value={bairro}
            onChange={(e) => setBairro(e.target.value)}
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Cidade *">
          <Select
            value={cidade || undefined}
            onValueChange={setCidade}
            disabled={pending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {CIDADES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>
    </div>
  );
}

function Step3Pagamento({
  cnpj,
  setCnpj,
  razaoSocial,
  setRazaoSocial,
  cartaoCnpjFile,
  setCartaoCnpjFile,
  banco,
  setBanco,
  agencia,
  setAgencia,
  conta,
  setConta,
  pixChave,
  setPixChave,
  pending,
}: any) {
  const inputFileRef = React.useRef<HTMLInputElement>(null);
  const temPj = cnpj && cnpj.length > 0;
  return (
    <div className="space-y-4">
      {/* PJ */}
      <section className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-california-red">
          Pessoa Jurídica (opcional)
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="CNPJ">
            <MaskedInput
              mask="cnpj"
              defaultValue={cnpj}
              onDigitsChange={setCnpj}
              disabled={pending}
            />
          </Campo>
          <Campo rotulo={temPj ? "Razão Social *" : "Razão Social"}>
            <Input
              value={razaoSocial}
              onChange={(e) => setRazaoSocial(e.target.value)}
              placeholder="Nome empresarial"
              disabled={pending}
            />
          </Campo>
        </div>
        <Campo rotulo="Cartão CNPJ">
          <input
            ref={inputFileRef}
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) =>
              setCartaoCnpjFile(e.target.files?.[0] ?? null)
            }
            className="sr-only"
          />
          {cartaoCnpjFile ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-california-red shrink-0" />
                <span className="text-xs text-foreground truncate">
                  {cartaoCnpjFile.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {(cartaoCnpjFile.size / 1024).toFixed(0)} KB
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCartaoCnpjFile(null);
                  if (inputFileRef.current) inputFileRef.current.value = "";
                }}
                className="text-california-red hover:text-california-red-hover"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputFileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-3 py-2 text-xs text-muted-foreground hover:border-california-red/40 hover:text-california-red transition-all"
            >
              <Upload className="h-3.5 w-3.5" />
              Clique para enviar PDF ou imagem
            </button>
          )}
        </Campo>
      </section>

      {/* Conta bancária */}
      <section className="space-y-3 pt-3 border-t border-border">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-california-red">
          Conta bancária *
        </h3>
        <Campo rotulo="Banco *">
          <Input
            value={banco}
            onChange={(e) => setBanco(e.target.value)}
            placeholder="Ex: Nubank, Itaú, Bradesco…"
            disabled={pending}
          />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Agência *">
            <Input
              value={agencia}
              onChange={(e) => setAgencia(e.target.value)}
              placeholder="0001"
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="Conta *">
            <Input
              value={conta}
              onChange={(e) => setConta(e.target.value)}
              placeholder="12345-6"
              disabled={pending}
            />
          </Campo>
        </div>
      </section>

      {/* PIX */}
      <section className="space-y-3 pt-3 border-t border-border">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          PIX (opcional)
        </h3>
        <Campo rotulo="Chave PIX">
          <Input
            value={pixChave}
            onChange={(e) => setPixChave(e.target.value)}
            placeholder="CPF, email, telefone ou chave aleatória"
            disabled={pending}
          />
        </Campo>
      </section>
    </div>
  );
}

function Step4Diversidade({
  corRaca,
  setCorRaca,
  corRacaOutro,
  setCorRacaOutro,
  identidadeGenero,
  setIdentidadeGenero,
  identidadeGeneroOutro,
  setIdentidadeGeneroOutro,
  deficiencia,
  setDeficiencia,
  deficienciaOutro,
  setDeficienciaOutro,
  saudeObs,
  setSaudeObs,
  contatoEmergencia,
  setContatoEmergencia,
  pending,
}: any) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Cor / raça">
          <Select
            value={corRaca || undefined}
            onValueChange={setCorRaca}
            disabled={pending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {COR_RACA.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {corRaca === "Outro" && (
            <Input
              value={corRacaOutro}
              onChange={(e) => setCorRacaOutro(e.target.value)}
              placeholder="Especifique"
              disabled={pending}
              className="mt-1.5"
            />
          )}
        </Campo>

        <Campo rotulo="Identidade de gênero">
          <Select
            value={identidadeGenero || undefined}
            onValueChange={setIdentidadeGenero}
            disabled={pending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {IDENTIDADE_GENERO.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {identidadeGenero === "Outro" && (
            <Input
              value={identidadeGeneroOutro}
              onChange={(e) => setIdentidadeGeneroOutro(e.target.value)}
              placeholder="Especifique"
              disabled={pending}
              className="mt-1.5"
            />
          )}
        </Campo>
      </div>

      <Campo rotulo="Possui alguma deficiência?">
        <Select
          value={deficiencia || undefined}
          onValueChange={setDeficiencia}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {DEFICIENCIA.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {deficiencia === "Outro" && (
          <Input
            value={deficienciaOutro}
            onChange={(e) => setDeficienciaOutro(e.target.value)}
            placeholder="Especifique"
            disabled={pending}
            className="mt-1.5"
          />
        )}
      </Campo>

      <Campo rotulo="Observações de saúde">
        <Textarea
          value={saudeObs}
          onChange={(e) => setSaudeObs(e.target.value)}
          rows={2}
          disabled={pending}
          placeholder="Alguma particularidade relevante, ou 'Nenhuma'"
        />
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <button
            type="button"
            onClick={() => setSaudeObs("Nenhuma")}
            className="inline-flex items-center rounded-full border border-border bg-white px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-california-red/40 hover:text-california-red transition-colors"
          >
            Nenhuma
          </button>
          <button
            type="button"
            onClick={() => setSaudeObs("Prefiro não informar")}
            className="inline-flex items-center rounded-full border border-border bg-white px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-california-red/40 hover:text-california-red transition-colors"
          >
            Prefiro não informar
          </button>
        </div>
      </Campo>

      <Campo rotulo="Contato de emergência">
        <Input
          value={contatoEmergencia}
          onChange={(e) => setContatoEmergencia(e.target.value)}
          placeholder="Ex: Maria Silva (mãe) — (11) 99999-9999"
          disabled={pending}
        />
      </Campo>
    </div>
  );
}

function Step5Contrato({
  jobs,
  cargos,
  jobId,
  setJobId,
  cargoContrato,
  setCargoContrato,
  valor,
  setValor,
  tipo,
  setTipo,
  dataInicio,
  setDataInicio,
  duracaoQtd,
  setDuracaoQtd,
  duracaoUnidade,
  setDuracaoUnidade,
  dataTerminoCalculada,
  cidadeContrato,
  setCidadeContrato,
  pending,
}: any) {
  return (
    <div className="space-y-3">
      <Campo rotulo="Job *">
        <JobPicker jobs={jobs} value={jobId} onChange={setJobId} disabled={pending} />
      </Campo>

      <Campo rotulo="Cargo *">
        <CargoPicker
          cargos={cargos}
          value={cargoContrato}
          onChange={setCargoContrato}
          disabled={pending}
        />
      </Campo>

      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <Campo rotulo="Valor *">
          <MoneyInput
            value={valor}
            onValueChange={setValor}
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Tipo *">
          <Combobox
            items={TIPO_OPCOES}
            value={tipo}
            onChange={(v) => {
              const novo = (v ?? "mensal") as Modo;
              setTipo(novo);
              if (!duracaoQtd) {
                setDuracaoUnidade(novo === "mensal" ? "meses" : "dias");
              }
            }}
            disabled={pending}
            className={COMBOBOX_COMO_SELECT}
          />
        </Campo>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Início *">
          <DatePicker
            name="data_inicio_contrato"
            defaultValue={dataInicio}
            onDateChange={(d) => setDataInicio(isoDate(d))}
            disabled={pending}
          />
        </Campo>
        <Campo rotulo="Duração">
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={duracaoQtd}
              onChange={(e) =>
                setDuracaoQtd(e.target.value.replace(/\D/g, ""))
              }
              disabled={pending}
              placeholder="Ex: 2"
              className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 tabular-nums focus:outline-none focus:ring-2 focus:ring-california-red/30 disabled:opacity-60"
            />
            <div className="w-[110px]">
              <Combobox
                items={DURACAO_UNIDADE_OPCOES}
                value={duracaoUnidade}
                onChange={(v) =>
                  setDuracaoUnidade((v ?? "meses") as DuracaoUnidade)
                }
                disabled={pending}
                className={COMBOBOX_COMO_SELECT}
              />
            </div>
          </div>
          {dataTerminoCalculada && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Término:{" "}
              {format(parseISO(dataTerminoCalculada), "dd/MM/yyyy", {
                locale: ptBR,
              })}
            </p>
          )}
        </Campo>
      </div>

      <Campo rotulo="Cidade do contrato *">
        <Select
          value={cidadeContrato || undefined}
          onValueChange={setCidadeContrato}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue placeholder="Onde o trabalho acontece" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {CIDADES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
    </div>
  );
}
