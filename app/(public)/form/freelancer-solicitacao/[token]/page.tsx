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

  // Service client: rota pública, sem session Supabase. Validamos tudo
  // na mão — qualquer vazamento aqui é bug nosso, não RLS.
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

  // Mensagens por status
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

  // Status = aprovada e dentro da validade → mostra form
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Olá, {sol.nome_freela.split(" ")[0]}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Preencha os seus dados pessoais pra finalizarmos a contratação. Isso é
          rápido — depois é só assinar o contrato quando ele chegar.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-california-dark text-white p-5 shadow-elevated">
        <p className="text-[10px] uppercase tracking-wider text-white/50">
          Contrato aprovado
        </p>
        <h3 className="mt-1 text-lg font-bold">
          {sol.job_codigo && (
            <span className="text-white/60 mr-2">{sol.job_codigo}</span>
          )}
          {sol.job_nome ?? "—"}
        </h3>
        <div className="mt-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-white/80">
          {sol.cargo && <span>{sol.cargo}</span>}
          <span>{formatCurrency(sol.valor)} · {sol.tipo}</span>
          {sol.data_inicio && (
            <span>
              {formatarDataBR(sol.data_inicio)}
              {sol.data_termino ? ` → ${formatarDataBR(sol.data_termino)}` : ""}
            </span>
          )}
          {sol.cidade && <span>{sol.cidade}</span>}
        </div>
      </div>

      <FormClient
        token={sol.token}
        nomePreenchido={sol.nome_freela}
        cpfPreenchido={sol.cpf_freela}
      />
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
    <div className="rounded-2xl border border-border bg-white p-10 text-center shadow-soft">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-bold text-foreground">{titulo}</h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        {texto}
      </p>
    </div>
  );
}

function formatarDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
