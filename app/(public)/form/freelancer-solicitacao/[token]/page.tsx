import { notFound } from "next/navigation";
import { AlertCircle, Clock, Ban, CheckCircle2 } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { FormClient } from "./form-client";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{32}$/i;

interface SolicitacaoPublica {
  id: string;
  token: string;
  nome_freela: string;
  cpf_freela: string | null;
  cargo: string | null;
  tipo: string;
  valor: number;
  data_inicio: string | null;
  data_termino: string | null;
  cidade: string | null;
  status: string;
  expira_em: string | null;
  job_nome: string | null;
  job_codigo: string | null;
}

export default async function FormPublicoPage({
  params,
}: {
  params: { token: string };
}) {
  if (!TOKEN_RE.test(params.token)) notFound();

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("freelancer_solicitacoes")
    .select(
      "id, token, nome_freela, cpf_freela, cargo, tipo, valor, data_inicio, data_termino, cidade, status, expira_em, job:jobs(codigo, nome)",
    )
    .eq("token", params.token)
    .maybeSingle();

  if (error || !data) notFound();

  const sol: SolicitacaoPublica = {
    id: (data as any).id,
    token: (data as any).token,
    nome_freela: (data as any).nome_freela,
    cpf_freela: (data as any).cpf_freela,
    cargo: (data as any).cargo,
    tipo: (data as any).tipo,
    valor: Number((data as any).valor),
    data_inicio: (data as any).data_inicio,
    data_termino: (data as any).data_termino,
    cidade: (data as any).cidade,
    status: (data as any).status,
    expira_em: (data as any).expira_em,
    job_codigo: (data as any).job?.codigo ?? null,
    job_nome: (data as any).job?.nome ?? null,
  };

  const expirado =
    sol.expira_em !== null && new Date(sol.expira_em).getTime() < Date.now();

  if (sol.status === "pendente") {
    return (
      <Mensagem
        icon={Clock}
        titulo="Aguardando aprovação"
        texto="Esta solicitação ainda não foi aprovada pelo RH. Quando for, você receberá uma nova confirmação."
      />
    );
  }

  if (sol.status === "rejeitada") {
    return (
      <Mensagem
        icon={AlertCircle}
        titulo="Solicitação rejeitada"
        texto="Esta solicitação foi rejeitada pelo RH. Entre em contato com quem te enviou para entender o motivo."
      />
    );
  }

  if (sol.status === "cancelada") {
    return (
      <Mensagem
        icon={Ban}
        titulo="Solicitação cancelada"
        texto="Esta solicitação foi cancelada e o link não é mais válido."
      />
    );
  }

  if (sol.status === "cadastrada") {
    return (
      <Mensagem
        icon={CheckCircle2}
        titulo="Dados já preenchidos"
        texto="Esta solicitação já foi preenchida. Se precisar corrigir alguma coisa, fale com quem te enviou o link."
      />
    );
  }

  if (expirado) {
    return (
      <Mensagem
        icon={Clock}
        titulo="Link expirado"
        texto="O prazo pra preencher este formulário expirou. Entre em contato com quem te enviou pra pedir um novo link."
      />
    );
  }

  // Status = aprovada e dentro da validade → mostra o form com rail lateral.
  const primeiroNome = sol.nome_freela.split(/\s+/)[0] ?? sol.nome_freela;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 lg:py-14">
      {/* Hero editorial — Fraunces grande, copy curto, cartão dark com o
          resumo do contrato. Não grita "CONTRATO APROVADO" em tag — o
          próprio cartão é o selo. */}
      <section className="mb-10 lg:mb-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-california-red">
          Boas-vindas
        </p>
        <h2 className="mt-2 font-display text-5xl lg:text-6xl font-light tracking-tight text-foreground leading-[1.02]">
          Olá, <span className="italic">{primeiroNome}</span>.
        </h2>
        <p className="mt-4 max-w-xl text-base text-foreground/70 leading-relaxed">
          Falta pouco pro primeiro job. Preenche os dados abaixo e a gente
          manda o contrato pra assinatura em seguida.
        </p>

        <div className="mt-8 rounded-2xl bg-california-dark text-white p-6 lg:p-7 shadow-elevated relative overflow-hidden">
          <div
            aria-hidden
            className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-california-red/20 blur-3xl"
          />
          <div className="relative">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
              Contrato aprovado
            </p>
            <h3 className="mt-2 font-display text-2xl lg:text-3xl font-normal tracking-tight leading-tight">
              {sol.job_codigo && (
                <span className="text-white/60 mr-2 font-sans text-base tracking-normal">
                  {sol.job_codigo}
                </span>
              )}
              {sol.job_nome ?? "—"}
            </h3>
            <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {sol.cargo && (
                <ItemContrato rotulo="Cargo" valor={sol.cargo} />
              )}
              <ItemContrato
                rotulo="Valor"
                valor={`${formatCurrency(sol.valor)} / ${sol.tipo}`}
              />
              {sol.data_inicio && (
                <ItemContrato
                  rotulo="Período"
                  valor={
                    sol.data_termino
                      ? `${formatarDataBR(sol.data_inicio)} → ${formatarDataBR(sol.data_termino)}`
                      : formatarDataBR(sol.data_inicio)
                  }
                />
              )}
              {sol.cidade && (
                <ItemContrato rotulo="Cidade" valor={sol.cidade} />
              )}
            </dl>
          </div>
        </div>
      </section>

      <FormClient
        token={sol.token}
        cpfPreenchido={sol.cpf_freela}
      />
    </div>
  );
}

function ItemContrato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">
        {rotulo}
      </dt>
      <dd className="mt-1 text-white/90 leading-snug">{valor}</dd>
    </div>
  );
}

function Mensagem({
  icon: Icon,
  titulo,
  texto,
}: {
  icon: React.ElementType;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="rounded-2xl border border-black/5 bg-white p-10 text-center shadow-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
          <Icon className="h-6 w-6 text-foreground/50" />
        </div>
        <h2 className="font-display text-2xl text-foreground">{titulo}</h2>
        <p className="mt-2 text-sm text-foreground/60 max-w-md mx-auto">
          {texto}
        </p>
      </div>
    </div>
  );
}

function formatarDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
