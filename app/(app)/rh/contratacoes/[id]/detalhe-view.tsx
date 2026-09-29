"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Send,
  Copy,
  Check,
  RefreshCw,
  FileText,
  Upload,
  UserCheck,
  X,
  AlertCircle,
  Clock,
  Mail,
  Phone,
  MapPin,
  Building2,
  Landmark,
  CreditCard,
  Calendar,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Contratacao, ContratacaoStatus, Empresa } from "@/lib/types";
import {
  contratacaoStatusLabel,
  tipoContratacaoLabel,
} from "@/lib/types";
import { NATUREZA_PJ_LABEL } from "@/lib/rh/naturezas-pj";
import {
  enviarProposta,
  renovarLink,
  gerarContrato,
  finalizarAnexoContrato,
  efetivar,
  marcarDesistiu,
  marcarRecusadaPeloRh,
} from "../actions";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";

type ContratacaoRica = Contratacao & {
  empresa: Pick<Empresa, "id" | "nome_fantasia"> | null;
  regional: { id: string; nome: string } | null;
  nivel: { id: string; codigo: string; descricao: string | null } | null;
};

function corStatus(status: ContratacaoStatus): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground";
    case "proposta_enviada":
    case "aceite_recebido":
    case "dados_completos":
    case "contrato_gerado":
    case "contrato_assinado":
      return "bg-amber-50 text-amber-800";
    case "efetivada":
      return "bg-emerald-50 text-emerald-700";
    case "recusada":
    case "desistiu":
    case "expirada":
      return "bg-california-red/10 text-california-red";
  }
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatarCpf(v: string | null): string {
  if (!v || v.length !== 11) return v ?? "—";
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
}

function formatarCnpj(v: string | null): string {
  if (!v || v.length !== 14) return v ?? "—";
  return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
}

function formatarTelefone(v: string | null): string {
  if (!v) return "—";
  if (v.length === 11) return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
  if (v.length === 10) return `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  return v;
}

function formatarCep(v: string | null): string {
  if (!v || v.length !== 8) return v ?? "—";
  return `${v.slice(0, 5)}-${v.slice(5)}`;
}

export function ContratacaoDetalheView({
  contratacao: cReal,
  linkPublico,
}: {
  contratacao: ContratacaoRica;
  linkPublico: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [copiado, setCopiado] = React.useState(false);
  const [erroAcao, setErroAcao] = React.useState<string | null>(null);
  // Override otimista: quando o RH anexa o contrato, mostramos "Pronto
  // pra efetivar" na hora, sem esperar o revalidatePath do server ir e
  // voltar. Reseta pra null quando o dado real chega via router.refresh.
  const [statusOverride, setStatusOverride] =
    React.useState<ContratacaoStatus | null>(null);
  const [pathOverride, setPathOverride] = React.useState<string | null>(null);

  // Se o dado real já reflete o que otimizamos localmente, limpa o override.
  React.useEffect(() => {
    if (statusOverride && cReal.status === statusOverride) {
      setStatusOverride(null);
      setPathOverride(null);
    }
  }, [cReal.status, statusOverride]);

  const c: ContratacaoRica = statusOverride
    ? {
        ...cReal,
        status: statusOverride,
        contrato_assinado_path: pathOverride ?? cReal.contrato_assinado_path,
      }
    : cReal;

  const linkExpira = new Date(c.token_expira_em);
  const linkVencido = linkExpira.getTime() < Date.now();

  function acao(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setErroAcao(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setErroAcao(r.message ?? "Falha na operação.");
      // Sem router.refresh(): todas as actions daqui chamam
      // revalidatePath(`/rh/contratacoes/${id}`) e o Next.js já devolve
      // o RSC atualizado na resposta do server action. Um refresh
      // extra disparava um GET RSC redundante de ~2s.
    });
  }

  function copiarLink() {
    navigator.clipboard.writeText(linkPublico);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  const ehPJ = c.tipo_contratacao === "pj" || c.tipo_contratacao === "clt_recibo";
  const enderecoCompleto =
    c.logradouro && c.numero && c.bairro && c.cidade && c.uf && c.cep;

  return (
    <div className="space-y-6">
<header>
        <p className="text-xs font-semibold uppercase tracking-wider text-california-red">
          Contratação
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{c.nome}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {c.cargo} · {tipoContratacaoLabel(c.tipo_contratacao)}
          {ehPJ && c.pj_natureza ? ` (${NATUREZA_PJ_LABEL[c.pj_natureza]})` : ""}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(c.status)}`}
          >
            {contratacaoStatusLabel(c.status)}
          </span>
          {c.virou_colaborador_id && (
            <Link
              href={`/rh/colaboradores/${c.virou_colaborador_id}`}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:underline"
            >
              Ver colaborador →
            </Link>
          )}
        </div>
      </header>

      {erroAcao && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erroAcao}</span>
        </div>
      )}

      {/* Ações contextuais */}
      <AcoesContextuais
        c={c}
        linkPublico={linkPublico}
        linkVencido={linkVencido}
        pending={pending}
        copiado={copiado}
        onCopiarLink={copiarLink}
        onAcao={acao}
        onSucessoAnexo={(path) => {
          setStatusOverride("contrato_assinado");
          setPathOverride(path);
          router.refresh();
        }}
      />

      {/* Trilha */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Trilha
        </h2>
        <div className="mt-4 space-y-2 text-sm">
          <TrilhaItem
            label="Criada em"
            valor={formatarDataHora(c.created_at)}
            feito
          />
          <TrilhaItem
            label="Proposta enviada"
            valor={formatarDataHora(c.proposta_enviada_em)}
            feito={c.proposta_enviada_em !== null}
          />
          <TrilhaItem
            label="Aceite do candidato"
            valor={formatarDataHora(c.aceite_em)}
            feito={c.aceite_em !== null}
          />
          <TrilhaItem
            label="Dados completos"
            valor={formatarDataHora(c.dados_completados_em)}
            feito={c.dados_completados_em !== null}
          />
          {ehPJ && (
            <TrilhaItem
              label="Contrato gerado"
              valor={formatarDataHora(c.contrato_gerado_em)}
              feito={c.contrato_gerado_em !== null}
            />
          )}
          <TrilhaItem
            label="Contrato assinado anexado"
            valor={formatarDataHora(c.contrato_assinado_anexado_em)}
            feito={c.contrato_assinado_anexado_em !== null}
          />
          <TrilhaItem
            label="Efetivada"
            valor={formatarDataHora(c.efetivada_em)}
            feito={c.efetivada_em !== null}
          />
        </div>
        {c.motivo_recusa && (
          <div className="mt-4 rounded-lg border border-california-red/20 bg-california-red/5 p-3 text-sm text-california-red">
            <strong>Motivo da recusa:</strong> {c.motivo_recusa}
          </div>
        )}
        {c.motivo_desistencia && (
          <div className="mt-4 rounded-lg border border-california-red/20 bg-california-red/5 p-3 text-sm text-california-red">
            <strong>Motivo da desistência:</strong> {c.motivo_desistencia}
          </div>
        )}
      </div>

      {/* Proposta */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Carta proposta
        </h2>
        <div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2 text-sm">
          <Info icon={<Mail className="h-4 w-4" />} label="E-mail" value={c.email} />
          <Info icon={<Building2 className="h-4 w-4" />} label="Empresa" value={c.empresa?.nome_fantasia ?? "—"} />
          <Info label="Cargo" value={c.cargo} />
          <Info label="Regional" value={c.regional?.nome ?? "—"} />
          <Info label="Salário proposto" value={brl.format(Number(c.salario_proposto))} />
          <Info icon={<Calendar className="h-4 w-4" />} label="Admissão prevista" value={formatarData(c.data_admissao)} />
          {c.nivel && <Info label="Nível" value={`${c.nivel.codigo}${c.nivel.descricao ? ` — ${c.nivel.descricao}` : ""}`} />}
          {c.area && <Info label="Área" value={c.area} />}
        </div>
      </div>

      {/* Dados coletados do candidato — só se já preencheu */}
      {(c.cpf || c.cnpj || c.rg || c.telefone) && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Dados do candidato
          </h2>
          <div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2 text-sm">
            <Info icon={<CreditCard className="h-4 w-4" />} label="CPF" value={formatarCpf(c.cpf)} />
            <Info icon={<CreditCard className="h-4 w-4" />} label="RG" value={c.rg ?? "—"} />
            {ehPJ && (
              <>
                <Info label="CNPJ" value={formatarCnpj(c.cnpj)} />
                <Info label="Razão Social" value={c.razao_social ?? "—"} />
              </>
            )}
            <Info icon={<Phone className="h-4 w-4" />} label="Telefone" value={formatarTelefone(c.telefone)} />
            <Info icon={<Calendar className="h-4 w-4" />} label="Nascimento" value={formatarData(c.data_nascimento)} />
          </div>
          {enderecoCompleto && (
            <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">Endereço</p>
                  <p className="text-muted-foreground">
                    {c.logradouro}, {c.numero}
                    {c.complemento ? ` — ${c.complemento}` : ""}
                    {" · "}
                    {c.bairro}
                    {" · "}
                    {c.cidade}/{c.uf}
                    {" · CEP "}
                    {formatarCep(c.cep)}
                  </p>
                </div>
              </div>
            </div>
          )}
          {(c.banco_codigo || c.pix_chave) && (
            <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
              <div className="flex items-start gap-2">
                <Landmark className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">Dados bancários</p>
                  {c.banco_codigo && (
                    <p className="text-muted-foreground">
                      Banco {c.banco_codigo}
                      {c.banco_nome ? ` — ${c.banco_nome}` : ""}
                      {" · Ag. "}
                      {c.agencia}
                      {c.agencia_dv ? `-${c.agencia_dv}` : ""}
                      {" · CC. "}
                      {c.conta}
                      {c.conta_dv ? `-${c.conta_dv}` : ""}
                    </p>
                  )}
                  {c.pix_chave && (
                    <p className="text-muted-foreground">
                      PIX ({c.pix_tipo}): {c.pix_chave}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrilhaItem({
  label,
  valor,
  feito,
}: {
  label: string;
  valor: string;
  feito: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 ${
          feito
            ? "bg-emerald-100 text-emerald-700"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {feito ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      </div>
      <div className="flex-1 flex items-center justify-between">
        <span className={feito ? "text-foreground" : "text-muted-foreground"}>
          {label}
        </span>
        <span className="text-muted-foreground tabular-nums">{valor}</span>
      </div>
    </div>
  );
}

function Info({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function AcoesContextuais({
  c,
  linkPublico,
  linkVencido,
  pending,
  copiado,
  onCopiarLink,
  onAcao,
  onSucessoAnexo,
}: {
  c: Contratacao & {
    empresa: Pick<Empresa, "id" | "nome_fantasia"> | null;
    regional: { id: string; nome: string } | null;
    nivel: { id: string; codigo: string; descricao: string | null } | null;
  };
  linkPublico: string;
  linkVencido: boolean;
  pending: boolean;
  copiado: boolean;
  onCopiarLink: () => void;
  onAcao: (fn: () => Promise<{ ok: boolean; message?: string }>) => void;
  onSucessoAnexo: (path: string) => void;
}) {
  const ehPJ = c.tipo_contratacao === "pj" || c.tipo_contratacao === "clt_recibo";

  // Rascunho
  if (c.status === "rascunho") {
    return (
      <div className="rounded-2xl border border-california-red/20 bg-california-red/5 p-6">
        <h3 className="font-semibold text-california-red">
          Próximo passo: enviar proposta
        </h3>
        <p className="mt-1 text-sm text-california-red/80">
          Ao enviar, um link único é gerado. Copie e mande ao candidato por
          e-mail ou WhatsApp.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onAcao(async () => {
                const r = await enviarProposta(c.id);
                return { ok: r.ok, message: r.ok ? undefined : r.message };
              })
            }
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            Enviar proposta
          </button>
          <DesistirButton status={c.status} id={c.id} pending={pending} onAcao={onAcao} textoBotao="Cancelar contratação" />
        </div>
      </div>
    );
  }

  // Aguardando aceite (link copiável)
  if (c.status === "proposta_enviada" || c.status === "aceite_recebido") {
    return (
      <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-6">
        <h3 className="font-semibold text-amber-900">
          {c.status === "proposta_enviada"
            ? "Aguardando o candidato aceitar"
            : "Aguardando o candidato preencher os dados"}
        </h3>
        <p className="mt-1 text-sm text-amber-800">
          Link expira em {new Date(c.token_expira_em).toLocaleDateString("pt-BR")}.
          {linkVencido && " Já venceu — renove."}
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              readOnly
              value={linkPublico}
              className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-foreground focus:outline-none"
            />
            <button
              type="button"
              onClick={onCopiarLink}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-950 transition-colors"
            >
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                onAcao(async () => {
                  const r = await renovarLink(c.id);
                  return { ok: r.ok, message: r.ok ? undefined : r.message };
                })
              }
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Renovar link
            </button>
            {c.status === "proposta_enviada" && (
              <MarcarRecusadaButton id={c.id} pending={pending} onAcao={onAcao} />
            )}
            {c.status === "aceite_recebido" && (
              <DesistirButton status={c.status} id={c.id} pending={pending} onAcao={onAcao} />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Dados completos — PJ gera contrato, CLT anexa direto
  if (c.status === "dados_completos") {
    return (
      <div className="rounded-2xl border border-california-red/20 bg-california-red/5 p-6">
        <h3 className="font-semibold text-california-red">
          {ehPJ
            ? "Próximo passo: gerar contrato"
            : "Próximo passo: anexar contrato assinado"}
        </h3>
        <p className="mt-1 text-sm text-california-red/80">
          {ehPJ
            ? "O sistema monta o PDF com os dados coletados. Você baixa, sobe pra ZapSign e depois anexa o assinado."
            : "Para CLT/estágio, a contabilidade envia o contrato externamente. Anexe aqui o PDF assinado quando voltar."}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {ehPJ ? (
            <button
              type="button"
              onClick={() =>
                onAcao(async () => {
                  const r = await gerarContrato(c.id);
                  return { ok: r.ok, message: r.ok ? undefined : r.message };
                })
              }
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              <FileText className="h-4 w-4" />
              Gerar contrato
            </button>
          ) : (
            <UploadContratoButton
              id={c.id}
              tenantId={c.tenant_id}
              pending={pending}
              onAcao={onAcao}
              onSucesso={onSucessoAnexo}
            />
          )}
          <DesistirButton status={c.status} id={c.id} pending={pending} onAcao={onAcao} />
        </div>
      </div>
    );
  }

  // Contrato gerado — mostrar link do PDF + upload do assinado
  if (c.status === "contrato_gerado") {
    return (
      <div className="rounded-2xl border border-california-red/20 bg-california-red/5 p-6">
        <h3 className="font-semibold text-california-red">
          Contrato gerado — envie pra assinar
        </h3>
        <p className="mt-1 text-sm text-california-red/80">
          Baixe o PDF, suba na ZapSign e mande pro candidato. Quando voltar
          assinado, anexe aqui.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {c.contrato_gerado_path && (
            <a
              href={`/api/rh/contratacoes/${c.id}/pdf/gerado`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg border border-california-red/30 bg-white px-4 py-2 text-sm font-semibold text-california-red hover:bg-california-red/5 transition-colors"
            >
              <FileText className="h-4 w-4" />
              Baixar contrato gerado
            </a>
          )}
          <UploadContratoButton
              id={c.id}
              tenantId={c.tenant_id}
              pending={pending}
              onAcao={onAcao}
              onSucesso={onSucessoAnexo}
            />
          <DesistirButton status={c.status} id={c.id} pending={pending} onAcao={onAcao} />
        </div>
      </div>
    );
  }

  // Contrato assinado — pronto pra efetivar
  if (c.status === "contrato_assinado") {
    return (
      <div className="rounded-2xl border border-emerald-300/60 bg-emerald-50 p-6">
        <h3 className="font-semibold text-emerald-900">
          Pronto pra efetivar
        </h3>
        <p className="mt-1 text-sm text-emerald-800">
          O contrato assinado já foi anexado. Efetivar transforma o candidato
          em colaborador ativo, com salário e alocação preenchidos.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onAcao(async () => {
                const r = await efetivar(c.id);
                return { ok: r.ok, message: r.ok ? undefined : r.message };
              })
            }
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50 transition-colors"
          >
            <UserCheck className="h-4 w-4" />
            Efetivar como colaborador
          </button>
          {c.contrato_assinado_path && (
            <a
              href={`/api/rh/contratacoes/${c.id}/pdf/assinado`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
            >
              <FileText className="h-4 w-4" />
              Baixar contrato assinado
            </a>
          )}
          <DesistirButton status={c.status} id={c.id} pending={pending} onAcao={onAcao} />
        </div>
      </div>
    );
  }

  // Efetivada — só linka pro colaborador
  if (c.status === "efetivada") {
    return (
      <div className="rounded-2xl border border-emerald-300/60 bg-emerald-50 p-6">
        <h3 className="font-semibold text-emerald-900">
          Contratação efetivada em {formatarDataHora(c.efetivada_em)}
        </h3>
        <p className="mt-1 text-sm text-emerald-800">
          O candidato virou colaborador ativo.
        </p>
        {c.virou_colaborador_id && (
          <div className="mt-4">
            <Link
              href={`/rh/colaboradores/${c.virou_colaborador_id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 transition-colors"
            >
              Ver colaborador →
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Estados finais negativos
  if (c.status === "recusada" || c.status === "desistiu" || c.status === "expirada") {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 p-6">
        <h3 className="font-semibold text-foreground">
          Contratação encerrada — {contratacaoStatusLabel(c.status)}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Não há mais ações disponíveis para esta contratação.
        </p>
      </div>
    );
  }

  return null;
}

function DesistirButton({
  status,
  id,
  pending,
  onAcao,
  textoBotao = "Marcar desistência",
}: {
  status: ContratacaoStatus;
  id: string;
  pending: boolean;
  onAcao: (fn: () => Promise<{ ok: boolean; message?: string }>) => void;
  textoBotao?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
          {textoBotao}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {status === "rascunho" ? "Cancelar contratação?" : "Marcar como desistiu?"}
          </DialogTitle>
          <DialogDescription>
            {status === "rascunho"
              ? "Marca a contratação como recusada. Esta ação não pode ser desfeita."
              : "Marca a contratação como desistência. Esta ação não pode ser desfeita."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="motivo">Motivo (obrigatório)</Label>
          <textarea
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            maxLength={500}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
            placeholder="Ex.: candidato aceitou outra proposta"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={pending || motivo.trim().length < 3}
            onClick={() => {
              const fd = new FormData();
              fd.set("motivo", motivo);
              onAcao(async () => {
                const fn = status === "rascunho" ? marcarRecusadaPeloRh : marcarDesistiu;
                const r = await fn(id, fd);
                if (r.ok) setOpen(false);
                return { ok: r.ok, message: r.ok ? undefined : r.message };
              });
            }}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
          >
            Confirmar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MarcarRecusadaButton({
  id,
  pending,
  onAcao,
}: {
  id: string;
  pending: boolean;
  onAcao: (fn: () => Promise<{ ok: boolean; message?: string }>) => void;
}) {
  return (
    <DesistirButton
      status="proposta_enviada"
      id={id}
      pending={pending}
      onAcao={onAcao}
      textoBotao="Marcar recusa"
    />
  );
}

function UploadContratoButton({
  id,
  tenantId,
  pending,
  onAcao,
  onSucesso,
}: {
  id: string;
  tenantId: string;
  pending: boolean;
  onAcao: (fn: () => Promise<{ ok: boolean; message?: string }>) => void;
  onSucesso: (path: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [arquivo, setArquivo] = React.useState<File | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-colors"
        >
          <Upload className="h-4 w-4" />
          Anexar contrato assinado
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Anexar contrato assinado</DialogTitle>
          <DialogDescription>
            Faça upload do PDF que voltou da ZapSign (ou de onde o candidato
            assinou). Depois disso, você pode efetivar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="arquivo">Arquivo PDF</Label>
          <input
            id="arquivo"
            type="file"
            accept="application/pdf"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-california-red file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-california-red-hover"
          />
          <p className="text-xs text-muted-foreground">
            Limite: 20 MB. Precisa ser PDF.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={pending || !arquivo}
            onClick={() => {
              if (!arquivo) return;
              if (arquivo.type !== "application/pdf") {
                onAcao(async () => ({
                  ok: false,
                  message: "O contrato assinado precisa ser PDF.",
                }));
                return;
              }
              if (arquivo.size > 20 * 1024 * 1024) {
                onAcao(async () => ({
                  ok: false,
                  message: "Arquivo grande demais (limite 20 MB).",
                }));
                return;
              }
              // Fecha o dialog na hora — feedback otimista. Se algo falhar,
              // o erro aparece no card e o RH reabre pra tentar de novo.
              setOpen(false);
              const arquivoRef = arquivo;
              const path = `${tenantId}/${id}/contrato-assinado.pdf`;
              onAcao(async () => {
                // Upload direto do browser pro Supabase — RLS do bucket
                // `contratacoes-anexos` só deixa RH/admin gravar em
                // `{tenant_id}/...`. Mesmo padrão dos anexos de Pedido
                // de Compra, Desembolso, Conta Avulsa, etc.
                console.time("upload_storage");
                const sb = createBrowserSupabase();
                const { error: upErr } = await sb.storage
                  .from("contratacoes-anexos")
                  .upload(path, arquivoRef, {
                    contentType: "application/pdf",
                    upsert: true,
                  });
                console.timeEnd("upload_storage");
                if (upErr) {
                  return {
                    ok: false,
                    message: "Falha no upload do PDF: " + upErr.message,
                  };
                }
                console.time("finalize_action");
                const r = await finalizarAnexoContrato(
                  id,
                  path,
                  arquivoRef.size,
                );
                console.timeEnd("finalize_action");
                if (r.ok) onSucesso(path);
                return { ok: r.ok, message: r.ok ? undefined : r.message };
              });
            }}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
          >
            Enviar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
