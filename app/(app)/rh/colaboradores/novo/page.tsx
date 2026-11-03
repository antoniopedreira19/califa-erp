import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Empresa, Nivel } from "@/lib/types";
import { ColaboradorFormNovo, type ColaboradorFormDefaults } from "../colaborador-form-novo";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function NovoColaboradorPage({
  searchParams,
}: {
  searchParams: { from_freelancer?: string; data_admissao?: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const [empresasRes, regionaisRes, niveisRes, lideresRes] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("niveis")
      .select("id, codigo, descricao")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    // Membros ativos do tenant pro Combobox de líder direto. Sem embed
    // porque não há FK direta entre tenant_members.user_id e profiles.id
    // (ambos apontam pra auth.users; PostgREST não segue transitiva).
    // Nomes vêm na próxima query.
    supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
  ]);

  const empresas = (empresasRes.data ?? []) as Pick<
    Empresa,
    "id" | "nome_fantasia"
  >[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];
  const niveis = ((niveisRes.data ?? []) as Pick<
    Nivel,
    "id" | "codigo" | "descricao"
  >[])
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR"));

  const memberIds = ((lideresRes.data ?? []) as { user_id: string }[]).map(
    (m) => m.user_id,
  );
  const lideresRawRes =
    memberIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, nome")
          .in("id", memberIds)
      : { data: [] as { id: string; nome: string }[] };
  const lideres = ((lideresRawRes.data ?? []) as { id: string; nome: string }[])
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Efetivação de freela → colaborador: busca a pessoa + o contrato vigente
  // e monta os defaults do form. Se o CPF já existir em colaboradores, mostra
  // alerta com link e NÃO permite seguir (evita duplicado silencioso).
  let defaults: ColaboradorFormDefaults | undefined;
  let bannerEfetivacao: {
    nome: string;
    freelancer_id: string;
  } | null = null;
  let cpfJaExiste: { id: string; nome: string } | null = null;

  const freelancerId = searchParams.from_freelancer?.trim();
  if (freelancerId) {
    const { data: freela } = await supabase
      .from("freelancers")
      .select("id, nome_social, nome_completo, cpf, email, celular")
      .eq("id", freelancerId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle();

    if (freela) {
      // Pega o contrato vigente (status_real=true, janela atual) ou o
      // futuro mais próximo. Sem janela? pega o mais recente ativo.
      const hojeISO = new Date().toISOString().slice(0, 10);
      const { data: contratos } = await supabase
        .from("freelancer_contratos")
        .select("id, cargo, data_inicio, data_termino, status_real")
        .eq("freelancer_id", freela.id)
        .eq("tenant_id", session.activeTenant.id)
        .eq("status_real", true)
        .order("data_inicio", { ascending: false, nullsFirst: false });

      const contratoAtivo = (contratos ?? []).find(
        (c) =>
          c.data_inicio !== null &&
          c.data_inicio <= hojeISO &&
          (c.data_termino === null || c.data_termino >= hojeISO),
      ) ?? (contratos?.[0] ?? null);

      if (freela.cpf) {
        const { data: colabExistente } = await supabase
          .from("colaboradores")
          .select("id, nome")
          .eq("tenant_id", session.activeTenant.id)
          .eq("cpf", freela.cpf)
          .maybeSingle();
        if (colabExistente) {
          cpfJaExiste = {
            id: (colabExistente as { id: string; nome: string }).id,
            nome: (colabExistente as { id: string; nome: string }).nome,
          };
        }
      }

      defaults = {
        nome: freela.nome_completo || freela.nome_social,
        cpf: freela.cpf ?? "",
        email: freela.email ?? "",
        telefone: freela.celular ?? "",
        funcao: contratoAtivo?.cargo ?? "",
        data_admissao:
          searchParams.data_admissao &&
          /^\d{4}-\d{2}-\d{2}$/.test(searchParams.data_admissao)
            ? searchParams.data_admissao
            : hojeISO,
        from_freelancer_contrato_id: contratoAtivo?.id,
      };
      bannerEfetivacao = {
        nome: freela.nome_completo || freela.nome_social,
        freelancer_id: freela.id,
      };
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <BotaoVoltar
          reserva={
            bannerEfetivacao
              ? `/freelancers/${bannerEfetivacao.freelancer_id}`
              : "/rh/colaboradores"
          }
        />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          {bannerEfetivacao ? "Efetivar como colaborador" : "Novo colaborador"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastra dados fixos + primeira alocação (100% em empresa/regional) +
          salário inicial. Rateio, mudanças de alocação e mudanças salariais
          são feitas depois na página do colaborador.
        </p>
      </div>

      {bannerEfetivacao && !cpfJaExiste && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <ArrowLeftRight className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              Convertendo freelancer em colaborador
            </p>
            <p className="mt-0.5 text-xs text-emerald-800">
              <strong>{bannerEfetivacao.nome}</strong> será cadastrado(a) em
              /rh/colaboradores. Ao salvar, o contrato de freela vigente é
              encerrado automaticamente na data de admissão informada e qualquer
              minuta de distrato pendente é cancelada.
            </p>
          </div>
        </div>
      )}

      {bannerEfetivacao && cpfJaExiste && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
            <ArrowLeftRight className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              Já existe colaborador com esse CPF
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              <strong>{cpfJaExiste.nome}</strong> já está cadastrado(a). Antes
              de criar um novo, abra o registro existente —{" "}
              <Link
                href={`/rh/colaboradores/${cpfJaExiste.id}`}
                className="font-semibold underline decoration-dotted hover:text-amber-900"
              >
                ver colaborador
              </Link>
              . Se mesmo assim quiser prosseguir, altere o CPF abaixo (não
              recomendado).
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ColaboradorFormNovo
          empresas={empresas}
          regionais={regionais}
          niveis={niveis}
          lideres={lideres}
          defaults={defaults}
        />
      </div>
    </div>
  );
}
