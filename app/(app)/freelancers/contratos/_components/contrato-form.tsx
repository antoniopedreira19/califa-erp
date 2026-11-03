"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, AlertCircle, Loader2, UserCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { format as formatDate } from "date-fns";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type {
  FreelancerContrato,
  TipoFreelancerContrato,
} from "@/lib/types";
import { JobPicker, type JobItem } from "../../_components/job-picker";
import {
  ResponsavelPicker,
  type ResponsavelItem,
} from "../../_components/responsavel-picker";
import { CargoPicker } from "../../_components/cargo-picker";
import type { FreelancerCargo } from "@/lib/types";
import {
  criarFreelancerContrato,
  atualizarFreelancerContrato,
} from "../actions";

interface FreelancerResumo {
  id: string;
  nome_social: string;
}

type Modo = "novo" | "editar";
type FieldErrors = Record<string, string[]>;

interface Props {
  modo: Modo;
  contrato?: FreelancerContrato;
  freelancer: FreelancerResumo;
  jobs: JobItem[];
  responsaveis: ResponsavelItem[];
  cargos: FreelancerCargo[];
}

export function ContratoForm({
  modo,
  contrato,
  freelancer,
  jobs,
  responsaveis,
  cargos,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const erroBannerRef = React.useRef<HTMLDivElement>(null);

  // Legados vêm do RH antigo (ag_california_rh). Esses contratos nasceram
  // sem vínculo a um job do califa-erp — o form não deve exigir job pra deixar
  // o RH corrigir data/valor/cargo sem precisar migrar a vinculação agora.
  const ehLegado =
    modo === "editar" && contrato?.origem_sistema === "ag_california_rh";

  // Pro form, o `jobId` representa a escolha visível no picker — pode vir de
  // qualquer uma das duas fontes. A origem é inferida pelo item escolhido na
  // lista `jobs` e enviada em campo auxiliar `job_origem` pra action decidir
  // em qual coluna gravar.
  const [jobId, setJobId] = React.useState<string | null>(
    contrato?.job_interno_id ?? contrato?.job_id ?? null,
  );
  const [responsavelId, setResponsavelId] = React.useState<string | null>(
    contrato?.responsavel_id ?? null,
  );
  const [cargo, setCargo] = React.useState<string | null>(contrato?.cargo ?? null);
  const [tipo, setTipo] = React.useState<TipoFreelancerContrato>(
    contrato?.tipo ?? "mensal",
  );
  const [valor, setValor] = React.useState<number | null>(
    contrato?.valor !== undefined && contrato?.valor !== null
      ? Number(contrato.valor)
      : null,
  );
  const [dataInicio, setDataInicio] = React.useState(
    contrato?.data_inicio ?? "",
  );
  const [dataTermino, setDataTermino] = React.useState(
    contrato?.data_termino ?? "",
  );
  const [cidade, setCidade] = React.useState(contrato?.cidade ?? "");
  const [observacoes, setObservacoes] = React.useState(
    contrato?.observacoes ?? "",
  );

  function clearField(key: string) {
    if (fieldErrors[key]) {
      setFieldErrors((e) => {
        const n = { ...e };
        delete n[key];
        return n;
      });
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    setFieldErrors({});

    const fd = new FormData();
    fd.set("freelancer_id", freelancer.id);
    fd.set("job_id", jobId ?? "");
    const jobEscolhido = jobs.find((j) => j.id === jobId);
    fd.set("job_origem", jobEscolhido?.origem === "interno" ? "interno" : "producao");
    fd.set("responsavel_id", responsavelId ?? "");
    fd.set("cargo", cargo ?? "");
    fd.set("tipo", tipo);
    fd.set("valor", String(valor ?? 0));
    fd.set("data_inicio", dataInicio);
    fd.set("data_termino", dataTermino);
    fd.set("cidade", cidade);
    fd.set("observacoes", observacoes);

    startTransition(async () => {
      const result =
        modo === "novo"
          ? await criarFreelancerContrato(fd)
          : await atualizarFreelancerContrato(contrato!.id, fd);

      if (!result.ok) {
        setErroGeral(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        // scrollIntoView com um offset no topo pra não ficar atrás do header
        // fixo (o window.scrollTo({top:0}) antigo escondia a mensagem).
        requestAnimationFrame(() => {
          erroBannerRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
        return;
      }

      if (modo === "editar") {
        router.push(`/freelancers/${freelancer.id}`);
      }
      // modo novo: action faz redirect
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {erroGeral && (
        <div
          ref={erroBannerRef}
          className="rounded-lg border border-california-red/30 bg-california-red/5 p-4 flex items-start gap-3"
        >
          <AlertCircle className="h-5 w-5 text-california-red shrink-0 mt-0.5" />
          <p className="text-sm text-california-red font-medium">{erroGeral}</p>
        </div>
      )}

      {/* Freelancer (readonly) */}
      <Secao
        titulo="Freelancer"
        descricao="O freelancer deste contrato. Para trocar, cancele e abra o perfil de outro."
      >
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {freelancer.nome_social}
            </p>
            <Link
              href={`/freelancers/${freelancer.id}`}
              prefetch={false}
              className="text-xs text-california-red hover:underline"
            >
              Abrir perfil
            </Link>
          </div>
        </div>
      </Secao>

      {/* Job */}
      <Secao
        titulo="Job"
        descricao={
          ehLegado
            ? `Contrato migrado do RH antigo — vincular a um job do califa-erp é opcional. O nome "${contrato?.nome_job ?? ""}" fica como snapshot.`
            : "Qual job do califa-erp este freelancer vai atender. O nome é guardado como snapshot no momento do cadastro."
        }
      >
        <Campo
          rotulo={ehLegado ? "Job" : "Job *"}
          erro={fieldErrors.job_id}
        >
          <JobPicker
            jobs={jobs}
            value={jobId}
            onChange={(v) => {
              setJobId(v);
              clearField("job_id");
            }}
            disabled={pending}
          />
        </Campo>
      </Secao>

      {/* Dados do contrato */}
      <Secao
        titulo="Dados do contrato"
        descricao="Cargo, valor, período e cidade onde o trabalho acontece."
      >
        <Campo rotulo="Cargo" erro={fieldErrors.cargo}>
          <CargoPicker
            cargos={cargos}
            value={cargo}
            onChange={(v) => {
              setCargo(v);
              clearField("cargo");
            }}
            disabled={pending}
          />
        </Campo>

        <Campo rotulo="Tipo *" erro={fieldErrors.tipo}>
          <RadioGroup
            value={tipo}
            onValueChange={(v) => setTipo(v as TipoFreelancerContrato)}
            disabled={pending}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <TipoOpcao value="mensal" titulo="Mensal" descricao="Valor por mês" />
            <TipoOpcao
              value="periodo"
              titulo="Período"
              descricao="Valor único pelo período inteiro"
            />
            <TipoOpcao
              value="diarias"
              titulo="Diárias"
              descricao="Valor por dia trabalhado"
            />
          </RadioGroup>
        </Campo>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="Valor *" erro={fieldErrors.valor}>
            <MoneyInput
              value={valor}
              onValueChange={(v) => {
                setValor(v);
                clearField("valor");
              }}
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="Cidade do trabalho" erro={fieldErrors.cidade}>
            <Input
              value={cidade}
              onChange={(e) => {
                setCidade(e.target.value);
                clearField("cidade");
              }}
              placeholder="Onde o trabalho acontece"
              disabled={pending}
            />
          </Campo>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="Data de início" erro={fieldErrors.data_inicio}>
            <DatePicker
              name="data_inicio_display"
              value={dataInicio}
              onDateChange={(d) => {
                setDataInicio(d ? formatDate(d, "yyyy-MM-dd") : "");
                clearField("data_inicio");
              }}
              disabled={pending}
              comSeletorAnoMes
              fromYear={2000}
              toYear={new Date().getFullYear() + 5}
            />
          </Campo>
          <Campo rotulo="Data de término" erro={fieldErrors.data_termino}>
            <DatePicker
              name="data_termino_display"
              value={dataTermino}
              onDateChange={(d) => {
                setDataTermino(d ? formatDate(d, "yyyy-MM-dd") : "");
                clearField("data_termino");
              }}
              disabled={pending}
              comSeletorAnoMes
              fromYear={2000}
              toYear={new Date().getFullYear() + 5}
            />
          </Campo>
        </div>
      </Secao>

      {/* Responsável */}
      <Secao
        titulo="Responsável"
        descricao="Quem toma conta deste contrato. Pode ficar em branco e definir depois."
      >
        <Campo rotulo="Responsável" erro={fieldErrors.responsavel_id}>
          <ResponsavelPicker
            responsaveis={responsaveis}
            value={responsavelId}
            onChange={(v) => {
              setResponsavelId(v);
              clearField("responsavel_id");
            }}
            disabled={pending}
          />
        </Campo>
      </Secao>

      {/* Observações */}
      <Secao titulo="Observações" descricao="Qualquer anotação pertinente ao contrato.">
        <Campo rotulo="Texto livre" erro={fieldErrors.observacoes}>
          <Textarea
            value={observacoes}
            onChange={(e) => {
              setObservacoes(e.target.value);
              clearField("observacoes");
            }}
            rows={3}
            disabled={pending}
            maxLength={1000}
          />
        </Campo>
      </Secao>

      {/* Rodapé */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        <Link
          href={
            modo === "editar"
              ? `/freelancers/${freelancer.id}`
              : `/freelancers/${freelancer.id}`
          }
          prefetch={false}
          className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:border-california-red/40 transition-all"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {modo === "novo" ? "Cadastrar contrato" : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}

function TipoOpcao({
  value,
  titulo,
  descricao,
}: {
  value: string;
  titulo: string;
  descricao: string;
}) {
  return (
    <label
      htmlFor={`tipo-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white p-3 hover:border-california-red/40 has-[:checked]:border-california-red has-[:checked]:bg-california-red/5 transition-all"
    >
      <RadioGroupItem value={value} id={`tipo-${value}`} className="mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{titulo}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{descricao}</p>
      </div>
    </label>
  );
}

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          {titulo}
        </h2>
        {descricao && (
          <p className="text-xs text-muted-foreground mt-1">{descricao}</p>
        )}
      </div>
      <div className="space-y-4 pt-1 border-t border-border pt-5">
        {children}
      </div>
    </section>
  );
}

function Campo({
  rotulo,
  erro,
  children,
  className,
}: {
  rotulo: string;
  erro?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-semibold text-foreground">{rotulo}</Label>
      {children}
      {erro && erro.length > 0 && (
        <p className="text-xs text-california-red font-medium">{erro[0]}</p>
      )}
    </div>
  );
}
