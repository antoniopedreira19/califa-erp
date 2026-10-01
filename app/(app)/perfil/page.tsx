import { User, Landmark, CalendarDays } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { roleLabel, tipoContratacaoLabel } from "@/lib/types";
import type {
  Colaborador,
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  Nivel,
} from "@/lib/types";
import { CardNotificacoesFerias } from "@/components/notificacoes-ferias/card";
import { CardMinhasFerias } from "./card-minhas-ferias";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await requireSession();
  const supabase = createClient();

  // Busca o colaborador vinculado ao usuário logado. Pode não existir
  // (admin que nunca foi colaborador, usuário fora do RH, etc.).
  const { data: colabData } = await supabase
    .from("colaboradores")
    .select("*, nivel:niveis(id, codigo, descricao), lider:profiles!lider_id(id, nome)")
    .eq("user_id", session.profile.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  const colab = colabData as unknown as
    | (Colaborador & {
        nivel: Pick<Nivel, "id" | "codigo" | "descricao"> | null;
        lider: { id: string; nome: string } | null;
      })
    | null;

  // Se o perfil não está vinculado a um colaborador, mostra uma mensagem
  // amigável mas ainda renderiza info do profile + notificações.
  if (!colab) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Meu perfil</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Seus dados no sistema California.
          </p>
        </header>

        <CardNotificacoesFerias
          tenantId={session.activeTenant.id}
          userId={session.profile.id}
          verTodasHref="/perfil"
        />

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-california-red/10 p-3">
              <User className="h-6 w-6 text-california-red" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold">{session.profile.nome}</h2>
              <p className="text-sm text-muted-foreground">
                {session.profile.email}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                {roleLabel(session.activeRole)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-900">
            Seu login ainda não está vinculado a um cadastro de colaborador.
            Por isso, não é possível mostrar seus dados pessoais, bancários ou
            de férias.
          </p>
          <p className="mt-2 text-sm text-amber-800">
            Se você acredita que isso é um erro, procure o RH para fazer o
            vínculo.
          </p>
        </div>
      </div>
    );
  }

  // Períodos aquisitivos do colaborador
  const { data: periodosData } = await supabase
    .from("colaboradores_ferias_periodos")
    .select("*")
    .eq("colaborador_id", colab.id)
    .order("numero", { ascending: true });

  const periodos = (periodosData ?? []) as ColaboradorFeriasPeriodo[];

  // Histórico de lançamentos (todos — passados, pendentes, aprovados)
  const { data: lancamentosData } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("*")
    .eq("colaborador_id", colab.id)
    .order("data_inicio", { ascending: false });

  const lancamentos = (lancamentosData ?? []) as ColaboradorFeriasLancamento[];

  const dataAdmissaoFmt = colab.data_admissao
    ? new Date(colab.data_admissao + "T00:00:00").toLocaleDateString("pt-BR")
    : "—";

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Meu perfil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Seus dados no sistema California.
        </p>
      </header>

      {/* Notificações pessoais (férias e outros) */}
      <CardNotificacoesFerias
        tenantId={session.activeTenant.id}
        userId={session.profile.id}
        verTodasHref="/perfil"
      />

      {/* Card: Dados pessoais */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="flex items-center gap-3 mb-5">
          <div className="rounded-lg bg-california-red/10 p-2">
            <User className="h-4 w-4 text-california-red" />
          </div>
          <h2 className="text-lg font-semibold">Dados pessoais</h2>
        </div>

        <div className="flex items-start gap-4 mb-6">
          <div>
            <h3 className="text-xl font-semibold">{colab.nome}</h3>
            <p className="text-sm text-muted-foreground">
              {colab.funcao}
              {colab.nivel ? ` · ${colab.nivel.codigo}` : ""}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
              {tipoContratacaoLabel(colab.tipo_contratacao)}
            </p>
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2 text-sm">
          <Campo rotulo="E-mail (corporativo)" valor={colab.email} />
          <Campo rotulo="E-mail pessoal" valor={colab.email_pessoal} />
          <Campo rotulo="Telefone" valor={colab.telefone} />
          <Campo
            rotulo="Admissão"
            valor={dataAdmissaoFmt}
            icon={<CalendarDays className="h-3.5 w-3.5" />}
          />
          <Campo rotulo="Área" valor={colab.area} />
          <Campo
            rotulo="Líder direto"
            valor={colab.lider?.nome ?? null}
          />
        </div>
      </div>

      {/* Card: Dados bancários (read-only) */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="flex items-center gap-3 mb-5">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Landmark className="h-4 w-4 text-california-red" />
          </div>
          <h2 className="text-lg font-semibold">Dados bancários</h2>
        </div>

        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Conta bancária
            </p>
            {colab.banco_codigo &&
            (colab.agencia || colab.tipo_conta) &&
            (colab.conta || colab.tipo_conta) ? (
              <div className="space-y-0.5">
                <p className="font-medium">
                  {colab.banco_codigo}
                  {colab.banco_nome ? ` — ${colab.banco_nome}` : ""}
                </p>
                {colab.agencia && colab.conta && (
                  <p className="text-muted-foreground">
                    Ag. {colab.agencia}
                    {colab.agencia_dv ? `-${colab.agencia_dv}` : ""}
                    {" · "}
                    Cc. {colab.conta}
                    {colab.conta_dv ? `-${colab.conta_dv}` : ""}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {colab.tipo_conta === "corrente"
                    ? "Conta corrente"
                    : colab.tipo_conta === "poupanca"
                      ? "Conta poupança"
                      : colab.tipo_conta === "pagamento"
                        ? "Conta de pagamento"
                        : "—"}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">Não cadastrado.</p>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Chave PIX
            </p>
            {colab.pix_tipo && colab.pix_chave ? (
              <div className="space-y-0.5">
                <p className="font-medium">{colab.pix_chave}</p>
                <p className="text-xs text-muted-foreground">
                  Tipo:{" "}
                  {colab.pix_tipo === "cpf"
                    ? "CPF"
                    : colab.pix_tipo === "cnpj"
                      ? "CNPJ"
                      : colab.pix_tipo === "email"
                        ? "E-mail"
                        : colab.pix_tipo === "telefone"
                          ? "Telefone"
                          : "Chave aleatória"}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">Não cadastrado.</p>
            )}
          </div>
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          Para atualizar seus dados bancários, procure o RH.
        </p>
      </div>

      {/* Card: Minhas férias */}
      <CardMinhasFerias
        periodos={periodos}
        lancamentos={lancamentos}
        tipoContratacao={colab.tipo_contratacao}
      />
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  icon,
}: {
  rotulo: string;
  valor: string | null | undefined;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </p>
      <div className="flex items-center gap-1.5 text-sm">
        {icon}
        <span className={valor ? "font-medium" : "text-muted-foreground"}>
          {valor ?? "—"}
        </span>
      </div>
    </div>
  );
}
