/**
 * Convite em lote de usuários novos ao ERP.
 *
 * Roda uma vez, local, com SUPABASE_SERVICE_ROLE_KEY do .env.local.
 * Reusa a mesma lógica da server action `convidarUsuario`
 * (app/(app)/admin/usuarios/actions.ts) mas sem passar pela UI.
 *
 * Uso (o --env-file é nativo do Node 20+):
 *   # Dry-run: mostra o plano sem enviar nada
 *   node --env-file=.env.local --import tsx scripts/convidar-lote.ts --site-url=https://SEU_DOMINIO
 *
 *   # Executa de verdade
 *   node --env-file=.env.local --import tsx scripts/convidar-lote.ts --site-url=https://SEU_DOMINIO --executar
 *
 * Rate limit: throttle de 1500ms entre chamadas + retry x3 em 429.
 * O SMTP customizado (Resend) suporta a vazão; o gargalo é o GoTrue.
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "d2a02c10-9c7e-4157-8dd5-84bbf5a7044c"; // Agência California

type Role = "gerente_producao" | "produtor";

interface Convidado {
  nome: string;
  email: string;
  role: Role;
}

const LISTA: Convidado[] = [
  // Gerentes de Projetos → gerente_producao
  { nome: "Ana Rizia Cavalcante Paiva", email: "pessoal_005@exemplo.com", role: "gerente_producao" },
  { nome: "Andrezza Marins Nicolau", email: "colaborador_008@exemplo.com", role: "gerente_producao" },
  { nome: "Barbara Sophia Tank Moya Teixeira Siciliano", email: "colaborador_011@exemplo.com", role: "gerente_producao" },
  { nome: "Berg Muniz do Nascimento", email: "colaborador_012@exemplo.com", role: "gerente_producao" },
  { nome: "Bruna Vidal Pereira", email: "colaborador_135@exemplo.com", role: "gerente_producao" },
  { nome: "Carolina Dal Sasso Barakat", email: "colaborador_139@exemplo.com", role: "gerente_producao" },
  { nome: "Davi Branco Fontinelli", email: "colaborador_022@exemplo.com", role: "gerente_producao" },
  { nome: "Filipe Nery Silva", email: "colaborador_034@exemplo.com", role: "gerente_producao" },
  { nome: "Gabriela Cavalleiro Singh", email: "colaborador_158@exemplo.com", role: "gerente_producao" },
  { nome: "Guilherme de Marco Rabaça", email: "colaborador_042@exemplo.com", role: "gerente_producao" },
  { nome: "Júlia Beatriz Michelique", email: "colaborador_053@exemplo.com", role: "gerente_producao" },
  { nome: "Julia Simas Ferreira de Faria", email: "colaborador_054@exemplo.com", role: "gerente_producao" },
  { nome: "Karena Carneiro Arnaud", email: "colaborador_056@exemplo.com", role: "gerente_producao" },
  { nome: "Liz Torres de Campos", email: "colaborador_059@exemplo.com", role: "gerente_producao" },
  { nome: "Luan Iseppe Martins", email: "colaborador_179@exemplo.com", role: "gerente_producao" },
  { nome: "Lucas Fernandes Mano de Lima", email: "colaborador_063@exemplo.com", role: "gerente_producao" },
  { nome: "Luis Felipe da Silva Regis", email: "colaborador_203@exemplo.com", role: "gerente_producao" },
  { nome: "Luis Fernando Zoppi de Lima", email: "colaborador_208@exemplo.com", role: "gerente_producao" },
  { nome: "Márcia Joseanne Xerez Martins Brasil de Oliveira Mota", email: "colaborador_069@exemplo.com", role: "gerente_producao" },
  { nome: "Marcos Paulo Gomides Abe", email: "colaborador_181@exemplo.com", role: "gerente_producao" },
  { nome: "Mariana Lamarão Santos de Barros e Vasconcellos", email: "colaborador_074@exemplo.com", role: "gerente_producao" },
  { nome: "Marília Wey Märtz de Souza Pinto", email: "colaborador_076@exemplo.com", role: "gerente_producao" },
  { nome: "Marina Bramucci Delfim Veiga", email: "colaborador_184@exemplo.com", role: "gerente_producao" },
  { nome: "Maurício Campos Scorza", email: "colaborador_188@exemplo.com", role: "gerente_producao" },
  { nome: "Munira Mirna Pinto Rocha", email: "colaborador_084@exemplo.com", role: "gerente_producao" },
  { nome: "Nathalia Mendes Lima", email: "colaborador_086@exemplo.com", role: "gerente_producao" },
  { nome: "Nathalia Vilão Frederico", email: "colaborador_087@exemplo.com", role: "gerente_producao" },
  { nome: "Patrick Stryjer Hojda", email: "colaborador_089@exemplo.com", role: "gerente_producao" },
  { nome: "Rafael Cordeiro Capitão", email: "colaborador_097@exemplo.com", role: "gerente_producao" },
  { nome: "Sofia Frutuoso", email: "colaborador_193@exemplo.com", role: "gerente_producao" },
  { nome: "Tatiana Pizii Stefano", email: "colaborador_111@exemplo.com", role: "gerente_producao" },
  { nome: "Teila Almeida Silva", email: "colaborador_194@exemplo.com", role: "gerente_producao" },
  { nome: "Thais Palhares Cordeiro", email: "colaborador_112@exemplo.com", role: "gerente_producao" },
  { nome: "Victor Batista Landeiro", email: "colaborador_118@exemplo.com", role: "gerente_producao" },
  { nome: "Victoria Nathalie de Oliveira Cunha", email: "colaborador_121@exemplo.com", role: "gerente_producao" },
  { nome: "Yasmin de Oliveira Feitosa", email: "colaborador_124@exemplo.com", role: "gerente_producao" },
  { nome: "Yohana Menezes Manfredi", email: "colaborador_125@exemplo.com", role: "gerente_producao" },

  // Produtores → produtor
  { nome: "Ana Carolina Pereira", email: "colaborador_127@exemplo.com", role: "produtor" },
  { nome: "Ana Cristina de Oliveira Pringler", email: "colaborador_004@exemplo.com", role: "produtor" },
  { nome: "Anne Gabrielle Vieira Madeiro", email: "colaborador_009@exemplo.com", role: "produtor" },
  { nome: "Bruna Thayse Leskowicz", email: "colaborador_134@exemplo.com", role: "produtor" },
  { nome: "Débora Pereira Brito", email: "colaborador_023@exemplo.com", role: "produtor" },
  { nome: "Elódia Baima Guerra", email: "colaborador_027@exemplo.com", role: "produtor" },
  { nome: "Everton Ferrari", email: "colaborador_152@exemplo.com", role: "produtor" },
  { nome: "Felipe Bispo da Silva", email: "colaborador_032@exemplo.com", role: "produtor" },
  { nome: "Filipe Silva da Cunha", email: "colaborador_155@exemplo.com", role: "produtor" },
  { nome: "Gabriela Fedato Contiero", email: "colaborador_039@exemplo.com", role: "produtor" },
  { nome: "Isabella Oliveira Gandra", email: "colaborador_164@exemplo.com", role: "produtor" },
  { nome: "Ítalo Felipe Azevedo de Jesus", email: "colaborador_202@exemplo.com", role: "produtor" },
  { nome: "Janaína Silva Leal dos Santos", email: "colaborador_049@exemplo.com", role: "produtor" },
  { nome: "Larissa de Avelar Paranhos", email: "colaborador_174@exemplo.com", role: "produtor" },
  { nome: "Marcos Correia dos Santos Junior", email: "colaborador_180@exemplo.com", role: "produtor" },
  { nome: "Marcos Vinicius de Souza Santos", email: "colaborador_072@exemplo.com", role: "produtor" },
  { nome: "Matheus Theodor Santos Voss", email: "colaborador_187@exemplo.com", role: "produtor" },
  { nome: "Miguel Pontes Leite", email: "colaborador_082@exemplo.com", role: "produtor" },
  { nome: "EMPRESA 189 EXEMPLO LTDA", email: "colaborador_189@exemplo.com", role: "produtor" },
  { nome: "Miríades de Santana Pereira", email: "colaborador_083@exemplo.com", role: "produtor" },
  { nome: "Patrick Yuri Barbosa Sousa", email: "colaborador_090@exemplo.com", role: "produtor" },
  { nome: "Paulo Alberto Sobral de Moraes", email: "colaborador_205@exemplo.com", role: "produtor" },
  { nome: "Sofia de Campos Marinho Diniz", email: "colaborador_192@exemplo.com", role: "produtor" },
  { nome: "Victória Ostrower", email: "colaborador_122@exemplo.com", role: "produtor" },
  { nome: "Wallace Souza Dorea", email: "colaborador_206@exemplo.com", role: "produtor" },

  // OMITIDOS:
  // - Eduardo Manoel Costa da Silva (já cadastrado como gerente_producao)
];

interface Args {
  siteUrl: string;
  executar: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const siteUrlArg = args.find((a) => a.startsWith("--site-url="));
  const executar = args.includes("--executar");
  if (!siteUrlArg) {
    console.error("ERRO: informe --site-url=https://SEU_DOMINIO");
    process.exit(1);
  }
  const siteUrl = siteUrlArg.split("=")[1]?.replace(/\/$/, "");
  if (!siteUrl || !/^https?:\/\//.test(siteUrl)) {
    console.error("ERRO: --site-url precisa começar com http:// ou https://");
    process.exit(1);
  }
  return { siteUrl, executar };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Resultado =
  | { status: "convidado"; email: string; userId: string }
  | { status: "vinculado_existente"; email: string; userId: string }
  | { status: "ja_no_tenant"; email: string; userId: string }
  | { status: "erro"; email: string; motivo: string };

async function processar(
  service: ReturnType<typeof createClient<any, any, any>>,
  c: Convidado,
  redirectTo: string,
): Promise<Resultado> {
  const email = c.email.toLowerCase();

  // 1) Já existe profile?
  const { data: profiles, error: pErr } = await service
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .limit(1);
  if (pErr) return { status: "erro", email, motivo: `select profiles: ${pErr.message}` };

  const existente = profiles?.[0] as { id: string; email: string } | undefined;

  if (existente) {
    // Já é membro do tenant?
    const { data: member, error: mErr } = await service
      .from("tenant_members")
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .eq("user_id", existente.id)
      .maybeSingle();
    if (mErr) return { status: "erro", email, motivo: `select member: ${mErr.message}` };
    if (member) return { status: "ja_no_tenant", email, userId: existente.id };

    // Cria só o vínculo
    const { error: insErr } = await service.from("tenant_members").insert({
      tenant_id: TENANT_ID,
      user_id: existente.id,
      role: c.role,
      status: "ativo",
    });
    if (insErr) return { status: "erro", email, motivo: `insert member: ${insErr.message}` };

    await service.from("profiles").update({ role: c.role, nome: c.nome }).eq("id", existente.id);
    return { status: "vinculado_existente", email, userId: existente.id };
  }

  // 2) Não existe: invite com retry em 429
  let tentativa = 0;
  while (tentativa < 3) {
    tentativa++;
    const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        tenant_id: TENANT_ID,
        nome: c.nome,
        permissoes: { escopo: "todas" },
      },
    });

    if (!error && data?.user) {
      const newId = data.user.id;
      await service.from("profiles").update({ role: c.role, nome: c.nome }).eq("id", newId);
      const { error: memErr } = await service.from("tenant_members").insert({
        tenant_id: TENANT_ID,
        user_id: newId,
        role: c.role,
        status: "ativo",
      });
      if (memErr) return { status: "erro", email, motivo: `insert member após invite: ${memErr.message}` };
      return { status: "convidado", email, userId: newId };
    }

    const msg = error?.message ?? "sem user";
    const eh429 = msg.toLowerCase().includes("rate") || msg.toLowerCase().includes("too many");
    if (!eh429 || tentativa === 3) {
      return { status: "erro", email, motivo: msg };
    }
    console.log(`  ⏳ rate limit, aguardando 30s antes de tentar de novo (tentativa ${tentativa}/3)…`);
    await sleep(30_000);
  }
  return { status: "erro", email, motivo: "esgotou tentativas" };
}

async function main() {
  const { siteUrl, executar } = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em .env.local");
    process.exit(1);
  }

  const redirectTo = `${siteUrl}/api/auth/callback?next=/definir-senha`;

  console.log(`\n=== CONVITE EM LOTE — ${LISTA.length} pessoas ===`);
  console.log(`Modo:       ${executar ? "EXECUTAR (envia e-mails de verdade)" : "DRY-RUN"}`);
  console.log(`SiteURL:    ${siteUrl}`);
  console.log(`redirectTo: ${redirectTo}`);
  console.log(`Tenant:     ${TENANT_ID}\n`);

  if (!executar) {
    console.log("Lista que seria processada:");
    for (const c of LISTA) {
      console.log(`  - [${c.role.padEnd(16)}] ${c.email}  ${c.nome}`);
    }
    console.log("\nDRY-RUN — nada foi enviado. Rode com --executar para disparar.\n");
    return;
  }

  const service = createClient<any, any, any>(url, key, {
    auth: { persistSession: false },
  });

  const resultados: Resultado[] = [];
  let i = 0;
  for (const c of LISTA) {
    i++;
    process.stdout.write(`[${String(i).padStart(2, "0")}/${LISTA.length}] ${c.email} … `);
    const r = await processar(service, c, redirectTo);
    resultados.push(r);
    console.log(r.status === "erro" ? `❌ ${r.motivo}` : `✅ ${r.status}`);
    if (i < LISTA.length) await sleep(1500);
  }

  const por = (s: Resultado["status"]) => resultados.filter((r) => r.status === s).length;
  console.log("\n=== RESUMO ===");
  console.log(`✅ convidados novos:        ${por("convidado")}`);
  console.log(`🔗 vínculo criado (já auth): ${por("vinculado_existente")}`);
  console.log(`ℹ️  já eram do tenant:       ${por("ja_no_tenant")}`);
  console.log(`❌ erros:                    ${por("erro")}`);

  const erros = resultados.filter((r) => r.status === "erro");
  if (erros.length > 0) {
    console.log("\nErros detalhados:");
    for (const e of erros) console.log(`  - ${e.email}: ${(e as { motivo: string }).motivo}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FALHA:", e);
  process.exit(1);
});
