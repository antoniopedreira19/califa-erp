// Passo 2 — refaz o PDF de cada PP com os códigos atuais (decisão 126).
//
// Mantém tudo o que o documento já dizia: o número da PP, a data de emissão
// (a impressa no PDF atual), os dados bancários fotografados na emissão
// (decisão 067) e todos os demais campos. O que muda: a linha "Orçamento"
// vira "Job" (decisão 121); a linha "Projeto" sai (o código da PP é o do
// job, pedido do Tiago em 29/09/2026); cliente e marca seguem o cadastro
// atual (o Beats saiu do cliente provisório "Novo" em 18/09, e o Tiago
// escolheu AMBEV/BEATS); e, nas PPs parceladas de 17/08 a 28/09 (um PDF por
// parcela), o documento passa a ser um só, com a tabela das parcelas
// (decisão 112).
//
//   npx tsx scripts/rastros-codigo-anterior/2-refazer-pdfs.ts            # ensaio
//   npx tsx scripts/rastros-codigo-anterior/2-refazer-pdfs.ts --gravar   # grava
//
// O ensaio escreve os PDFs novos e o relatório em <backup>/ensaio. A
// gravação refaz tudo de novo, confere que nada mudou desde a cópia e só
// então sobe cada PDF e confere o que ficou no Storage. Ela NÃO mexe no
// banco nem apaga nada: o ponteiro das PPs que passam a ter documento único
// muda na migration 20260929700001 (que preserva o `updated_at`, mostrado no
// chat das PPs), e os documentos por parcela saem no passo 3, depois dela.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderPedidoCompraPDF } from "@/lib/pdf/pedido-compra";
import { lerFoto, type FotoDePagamentoDaPP } from "@/lib/data/foto-pagamento-da-pp";
import { linhasDoPdf } from "./pdf-texto";
import { BUCKET_PPS, PASTA_BACKUP, TENANT_ID, clienteDeServico, md5, sha256 } from "./comum";

const GRAVAR = process.argv.includes("--gravar");
const PASTA_SAIDA = join(PASTA_BACKUP, GRAVAR ? "gravacao" : "ensaio");

type Banco = {
  pedidos_compra: { id: string; codigo: string; pdf_path: string; updated_at: string }[];
  pedidos_compra_parcelas: { id: string; pedido_compra_id: string; pdf_path: string | null; updated_at: string }[];
};
type Manifesto = { bucket: string; path: string; md5: string }[];

const banco = JSON.parse(readFileSync(join(PASTA_BACKUP, "banco.json"), "utf8")) as Banco;
const manifesto = JSON.parse(readFileSync(join(PASTA_BACKUP, "manifesto.json"), "utf8")) as Manifesto;

function arquivoDaCopia(path: string): Buffer {
  return readFileSync(join(PASTA_BACKUP, "storage", BUCKET_PPS, path));
}

function caminhoPdfDaPP(jobId: string, ppId: string, codigo: string): string {
  // O mesmo de `caminhoPdfDaPP` em app/(app)/jobs/[jobId]/realizado/actions-pp.ts.
  return `${TENANT_ID}/${jobId}/${ppId}/pp-${codigo}.pdf`;
}

/** Diferença linha a linha (LCS), com as linhas só de um lado. */
function diferenca(a: string[], b: string[]) {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const saiu: string[] = [];
  const entrou: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) saiu.push(a[i++]);
    else entrou.push(b[j++]);
  }
  while (i < n) saiu.push(a[i++]);
  while (j < m) entrou.push(b[j++]);
  return { saiu, entrou };
}

async function main() {
  const s = clienteDeServico();
  mkdirSync(PASTA_SAIDA, { recursive: true });

  const { data: pps, error } = await s
    .from("pedidos_compra")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .order("codigo");
  if (error || !pps) throw new Error(`ler PPs: ${error?.message}`);

  const relatorio: Array<Record<string, unknown>> = [];

  for (const pp of pps) {
    const nota: Record<string, unknown> = { pp: pp.codigo, status: pp.status };
    try {
      // ---- dados, como a emissão lê ----
      const [parcelasRes, jobRes, empRes, fornRes, verbaRes] = await Promise.all([
        s.from("pedidos_compra_parcelas").select("*").eq("pedido_compra_id", pp.id).order("numero"),
        s.from("jobs").select("id, codigo, nome, produto, projeto_id").eq("id", pp.job_id).single(),
        s.from("empresas").select("*").eq("id", pp.empresa_id).single(),
        pp.fornecedor_id
          ? s.from("fornecedores").select("*").eq("id", pp.fornecedor_id).single()
          : Promise.resolve({ data: null, error: null }),
        pp.responsavel_verba_id
          ? s.from("profiles").select("nome").eq("id", pp.responsavel_verba_id).single()
          : Promise.resolve({ data: null, error: null }),
      ]);
      for (const r of [parcelasRes, jobRes, empRes, fornRes, verbaRes]) {
        if (r.error) throw new Error(r.error.message);
      }
      const parcelas = parcelasRes.data!;
      const job = jobRes.data!;
      const { data: projeto, error: projErr } = await s
        .from("projetos")
        .select("id, campanha, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)")
        .eq("id", job.projeto_id)
        .single();
      if (projErr || !projeto) throw new Error(`projeto: ${projErr?.message}`);

      // ---- o documento de hoje ----
      const docsAntigos = Array.from(
        new Set([pp.pdf_path, ...parcelas.map((p: { pdf_path: string | null }) => p.pdf_path)].filter(Boolean)),
      ) as string[];
      const antigo = linhasDoPdf(arquivoDaCopia(pp.pdf_path));
      const emissao = antigo.find((l) => l.startsWith("Emissão: "))?.slice("Emissão: ".length) ?? null;
      const rodape = antigo.find((l) => /Data \d{2}\/\d{2}\/\d{4}$/.test(l))?.match(/Data (\d{2}\/\d{2}\/\d{4})$/)?.[1] ?? null;
      if (!emissao || !/^\d{2}\/\d{2}\/\d{4}$/.test(emissao)) throw new Error(`sem data de emissão no PDF (${emissao})`);
      if (rodape !== emissao) throw new Error(`data do rodapé (${rodape}) diferente da emissão (${emissao})`);
      const [dd, mm, aaaa] = emissao.split("/");

      // ---- fornecedor: cadastro, com a foto bancária da emissão por cima ----
      const foto: FotoDePagamentoDaPP = {
        fornecedor_banco_codigo: pp.fornecedor_banco_codigo,
        fornecedor_banco_nome: pp.fornecedor_banco_nome,
        fornecedor_agencia: pp.fornecedor_agencia,
        fornecedor_agencia_dv: pp.fornecedor_agencia_dv,
        fornecedor_conta: pp.fornecedor_conta,
        fornecedor_conta_dv: pp.fornecedor_conta_dv,
        fornecedor_tipo_conta: pp.fornecedor_tipo_conta,
        fornecedor_pix_tipo: pp.fornecedor_pix_tipo,
        fornecedor_pix_chave: pp.fornecedor_pix_chave,
      };
      const fornecedor = fornRes.data
        ? pp.dados_pagamento_congelados_em
          ? { ...fornRes.data, ...lerFoto(foto) }
          : fornRes.data
        : null;

      // ---- o documento novo ----
      const novo = await renderPedidoCompraPDF({
        pp: {
          codigo: pp.codigo,
          servico: pp.servico,
          quantidade: pp.quantidade,
          especificacoes: pp.especificacoes,
          valor: Number(pp.valor),
          prazo_pagamento: parcelas[0]?.data_vencimento ?? pp.prazo_pagamento,
          created_at: `${aaaa}-${mm}-${dd}T12:00:00.000Z`,
          verba_producao: pp.verba_producao,
        },
        empresa: empRes.data as never,
        fornecedor: fornecedor as never,
        responsavelVerbaNome: pp.verba_producao ? (verbaRes.data?.nome ?? "") : null,
        job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
        projeto: { campanha: projeto.campanha ?? null },
        cliente: { nome_fantasia: (projeto.cliente as unknown as { nome_fantasia: string } | null)?.nome_fantasia ?? "" },
        responsavelNome: (projeto.responsavel as unknown as { nome: string } | null)?.nome ?? "",
        parcelas: parcelas.map((p: { numero: number; data_vencimento: string; valor: number }) => ({
          numero: p.numero,
          data_vencimento: String(p.data_vencimento).slice(0, 10),
          valor: Number(p.valor),
        })),
      });
      const linhasNovas = linhasDoPdf(novo);

      // ---- o que é troca esperada ----
      // "Orçamento: <código>" vira "Job: <código do job>"; "Projeto: <código>"
      // sai. Qualquer outra diferença aparece no relatório.
      const esperado = antigo
        .filter((l) => !l.startsWith("Projeto: "))
        .map((l) => (l.startsWith("Orçamento: ") ? `Job: ${job.codigo}` : l));
      const { saiu, entrou } = diferenca(esperado, linhasNovas);

      nota.emissao = emissao;
      nota.parcelas = parcelas.length;
      nota.documentos_hoje = docsAntigos.length;
      nota.projeto_sai = antigo.find((l) => l.startsWith("Projeto: ")) ?? null;
      nota.orcamento_job = `${antigo.find((l) => l.startsWith("Orçamento: ") || l.startsWith("Job: "))} → Job: ${job.codigo}`;
      // Toda linha do documento novo que tenha cara de código.
      nota.linhas_com_codigo_no_novo = linhasNovas.filter((l) =>
        /(JOB-\d{4}|[A-Za-z0-9]+-[0-9P]\d{3}\/\d{2}|[A-Za-z0-9]+-\d{4}\/\d{2})/.test(l),
      );
      nota.foto_bancaria = Boolean(pp.dados_pagamento_congelados_em);
      nota.diferencas_alem_dos_codigos = { saiu, entrou };

      const destino = caminhoPdfDaPP(job.id, pp.id, pp.codigo);
      nota.caminho = destino === pp.pdf_path ? "o mesmo" : `${pp.pdf_path} → ${destino}`;
      const local = join(PASTA_SAIDA, destino);
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, novo);

      if (GRAVAR) {
        // Nada mudou desde a cópia? PP, parcelas e os arquivos atuais.
        const antes = banco.pedidos_compra.find((b) => b.id === pp.id);
        if (!antes || antes.updated_at !== pp.updated_at) throw new Error("a PP mudou desde a cópia");
        for (const p of parcelas) {
          const b = banco.pedidos_compra_parcelas.find((x) => x.id === p.id);
          if (!b || b.updated_at !== p.updated_at) throw new Error(`a parcela ${p.numero} mudou desde a cópia`);
        }
        for (const doc of docsAntigos) {
          const { data: atual, error: e } = await s.storage.from(BUCKET_PPS).download(doc);
          if (e || !atual) throw new Error(`baixar ${doc}: ${e?.message}`);
          const hashAtual = md5(Buffer.from(await atual.arrayBuffer()));
          const hashCopia = manifesto.find((f) => f.path === doc)?.md5;
          if (hashAtual !== hashCopia) throw new Error(`o arquivo ${doc} mudou desde a cópia`);
        }

        const { error: upErr } = await s.storage
          .from(BUCKET_PPS)
          .upload(destino, novo, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(`subir: ${upErr.message}`);
        const { data: conf, error: confErr } = await s.storage.from(BUCKET_PPS).download(destino);
        if (confErr || !conf) throw new Error(`conferir: ${confErr?.message}`);
        if (sha256(Buffer.from(await conf.arrayBuffer())) !== sha256(novo)) {
          throw new Error("o arquivo no Storage não é o que subiu");
        }

        // Ponteiros e documentos por parcela ficam para depois (migration e
        // passo 3): aqui só se anota o que vai mudar.
        nota.gravado = true;
        nota.sha256 = sha256(novo);
        nota.ponteiro_muda =
          pp.pdf_path !== destino ||
          parcelas.some((p: { pdf_path: string | null }) => p.pdf_path !== destino);
        nota.documentos_por_parcela = docsAntigos.filter((d) => d !== destino);
      }
    } catch (e) {
      nota.erro = e instanceof Error ? e.message : String(e);
    }
    relatorio.push(nota);
  }

  writeFileSync(join(PASTA_SAIDA, "relatorio.json"), JSON.stringify(relatorio, null, 2));
  const resumo = {
    modo: GRAVAR ? "gravação" : "ensaio",
    pps: relatorio.length,
    com_erro: relatorio.filter((r) => r.erro).map((r) => `${r.pp}: ${r.erro}`),
    com_diferenca_alem_dos_codigos: relatorio
      .filter((r) => {
        const d = r.diferencas_alem_dos_codigos as { saiu: string[]; entrou: string[] } | undefined;
        return d && (d.saiu.length > 0 || d.entrou.length > 0);
      })
      .map((r) => r.pp),
    caminho_muda: relatorio.filter((r) => r.caminho && r.caminho !== "o mesmo").map((r) => r.pp),
    gravados: relatorio.filter((r) => r.gravado).length,
  };
  console.log(JSON.stringify(resumo, null, 2));
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
