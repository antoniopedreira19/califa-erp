import { redirect } from "next/navigation";
import { Files } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { carregarCadastroFiscal } from "@/lib/fiscal/cadastro";
import { montarFiscalDoFaturar } from "@/lib/fiscal/faturar";
import { AbasDasNotas, type AbaDasNotas } from "./abas";
import { AbaEmitidas } from "./aba-emitidas";
import { AbaTomadas } from "./aba-tomadas";
import { carregarCnpjs, carregarEmitidas, carregarTomadas } from "./dados";

export const dynamic = "force-dynamic";
// A leitura das NFs pela IA (Server Action desta página) lê até
// `NOTAS_POR_LEITURA` notas por chamada, em paralelo.
export const maxDuration = 60;

/**
 * Notas Fiscais, seção da Central Financeira (decisão 271): o controle das
 * NFs que as empresas do grupo emitem (**Emitidas**) e das que elas tomam,
 * emitidas contra os nossos CNPJs (**Tomadas**). A aba vive na URL; cada uma
 * é lida no servidor só quando está aberta, de todas as datas, e o
 * navegador de período recorta na tela (as abas abrem em "Tudo").
 */
export default async function NotasFiscaisPage({ searchParams }: { searchParams?: { aba?: string } }) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const hoje = hojeEmSaoPauloIso();
  const aba: AbaDasNotas = searchParams?.aba === "tomadas" ? "tomadas" : "emitidas";

  const [emitidas, tomadas, cnpjs, cadastro, pjsRes, empresasRes] = await Promise.all([
    aba === "emitidas" ? carregarEmitidas(supabase, tenantId, hoje) : Promise.resolve(null),
    aba === "tomadas" ? carregarTomadas(supabase, tenantId) : Promise.resolve(null),
    carregarCnpjs(supabase, tenantId),
    // O painel da nota emitida e a visão Impostos leem o CNAE pelo cadastro fiscal.
    aba === "emitidas" ? carregarCadastroFiscal(supabase, tenantId) : Promise.resolve(null),
    aba === "emitidas"
      ? supabase.from("empresas_contabeis").select("id, nome_fantasia, razao_social").eq("tenant_id", tenantId)
      : Promise.resolve({ data: [] }),
    aba === "emitidas"
      ? supabase.from("empresas").select("id, razao_social, nome_fantasia, cnpj").eq("tenant_id", tenantId)
      : Promise.resolve({ data: [] }),
  ]);
  const fiscal = cadastro
    ? montarFiscalDoFaturar({
        cadastro,
        pjs: (pjsRes.data ?? []) as Parameters<typeof montarFiscalDoFaturar>[0]["pjs"],
        empresas: (empresasRes.data ?? []) as Parameters<typeof montarFiscalDoFaturar>[0]["empresas"],
        notas: [],
      })
    : null;

  return (
    <div className="space-y-8">
      <div>
        <BotaoVoltar reserva="/financeiro" />
      </div>
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Notas Fiscais"
        description="As notas que os CNPJs do grupo emitem e as que eles tomam (emitidas contra os nossos CNPJs)."
        icon={Files}
      />
      <AbasDasNotas aba={aba}>
        {emitidas && fiscal && <AbaEmitidas dados={emitidas} cnpjs={cnpjs} fiscal={fiscal} hoje={hoje} />}
        {tomadas && <AbaTomadas dados={tomadas} cnpjs={cnpjs} hoje={hoje} />}
      </AbasDasNotas>
    </div>
  );
}
