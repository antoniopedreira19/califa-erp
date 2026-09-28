import { CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import type { Contratacao, Empresa } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import { PropostaView } from "./proposta-view";

export const dynamic = "force-dynamic";

async function carregar(token: string) {
  if (!token || token.length < 32) return null;
  const service = createServiceClient();
  // Sem embed em regional/empresa — contratacoes tem duas FKs pra
  // regionais e o PostgREST fica ambíguo, retornando null silencioso.
  const { data: base } = await service
    .from("contratacoes")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (!base) return null;
  const c = base as unknown as Contratacao;
  const [empresaRes, regionalRes] = await Promise.all([
    service
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("id", c.empresa_id)
      .maybeSingle(),
    c.regional_id
      ? service
          .from("regionais")
          .select("id, nome")
          .eq("id", c.regional_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    ...c,
    empresa: empresaRes.data as Pick<Empresa, "id" | "nome_fantasia"> | null,
    regional: regionalRes.data as { id: string; nome: string } | null,
  } as Contratacao & {
    empresa: Pick<Empresa, "id" | "nome_fantasia"> | null;
    regional: { id: string; nome: string } | null;
  };
}

export default async function PropostaPage({
  params,
}: {
  params: { token: string };
}) {
  const contratacao = await carregar(params.token);

  // Link inválido
  if (!contratacao) {
    return (
      <MensagemFinal
        icon={<XCircle className="h-12 w-12 text-california-red" />}
        titulo="Link inválido"
        texto="Este link não existe ou já foi cancelado. Se você acha que é um erro, entre em contato com o RH."
      />
    );
  }

  const vencido = new Date(contratacao.token_expira_em).getTime() < Date.now();

  // Estados terminais negativos
  if (contratacao.status === "recusada") {
    return (
      <MensagemFinal
        icon={<XCircle className="h-12 w-12 text-california-red" />}
        titulo="Proposta recusada"
        texto="Esta proposta foi marcada como recusada. Se houve engano, procure o RH."
      />
    );
  }
  if (contratacao.status === "desistiu") {
    return (
      <MensagemFinal
        icon={<XCircle className="h-12 w-12 text-california-red" />}
        titulo="Contratação encerrada"
        texto="Este processo foi encerrado. Procure o RH se precisar reabri-lo."
      />
    );
  }
  if (contratacao.status === "expirada" || vencido) {
    return (
      <MensagemFinal
        icon={<Clock className="h-12 w-12 text-california-red" />}
        titulo="Link expirado"
        texto="O prazo para responder a esta proposta expirou. Peça ao RH para gerar um novo link."
      />
    );
  }

  // Estados finais positivos
  if (contratacao.status === "efetivada") {
    return (
      <MensagemFinal
        icon={<CheckCircle2 className="h-12 w-12 text-emerald-600" />}
        titulo={`Bem-vindo${contratacao.nome ? `, ${contratacao.nome.split(" ")[0]}` : ""}!`}
        texto="Sua contratação foi efetivada. Aguarde as próximas orientações do RH sobre onboarding e primeiro dia."
      />
    );
  }

  // Estados intermediários pós-aceite: aguardando ação do RH
  if (
    contratacao.status === "dados_completos" ||
    contratacao.status === "contrato_gerado" ||
    contratacao.status === "contrato_assinado"
  ) {
    return (
      <MensagemFinal
        icon={<Clock className="h-12 w-12 text-amber-600" />}
        titulo="Recebemos tudo, obrigado!"
        texto={
          contratacao.status === "contrato_assinado"
            ? "Seu contrato foi anexado. Estamos finalizando a efetivação."
            : contratacao.status === "contrato_gerado"
              ? "Seu contrato foi gerado. Em breve você receberá o link para assinar."
              : "Nossa equipe está preparando o seu contrato. Em breve você receberá o link para assinar."
        }
      />
    );
  }

  // Fluxo interativo: proposta_enviada ou aceite_recebido
  return (
    <PropostaView
      contratacao={contratacao}
      token={params.token}
    />
  );
}

function MensagemFinal({
  icon,
  titulo,
  texto,
}: {
  icon: React.ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-10 text-center shadow-soft">
      <div className="flex justify-center">{icon}</div>
      <h1 className="mt-4 text-2xl font-bold">{titulo}</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        {texto}
      </p>
    </div>
  );
}
