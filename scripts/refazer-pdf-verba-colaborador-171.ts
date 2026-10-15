// Decisão 171 (14/10/2026): refaz o PDF das PPs de verba cujo titular é um
// colaborador do RH, geradas antes da decisão — sem os dados de pagamento.
// Em 14/10/2026 eram duas: PP-00160 (em avaliação) e PP-00165 (gerada), as
// duas do DEE-1001/26. O Tiago escolheu "refazer as duas".
//
// A foto do pagamento (conta, PIX e CPF da ficha do RH) já está na PP: a
// migration 20261014100001 a preencheu. Aqui só o documento muda. Tudo o
// mais sai como estava — mesmo número, mesma data de emissão, mesmo CNPJ no
// cabeçalho, mesmas parcelas —, e o script confere isso comparando o texto
// do PDF de hoje com o novo: a única diferença aceita é o bloco "DADOS
// BANCÁRIOS DO TITULAR DA VERBA PARA PAGAMENTO".
//
//   npx tsx scripts/refazer-pdf-verba-colaborador-171.ts            # ensaio
//   npx tsx scripts/refazer-pdf-verba-colaborador-171.ts --gravar   # grava
//
// O ensaio escreve os PDFs novos numa pasta temporária e mostra a diferença
// (com os dígitos mascarados: o relatório não carrega conta nem CPF). A
// gravação sobe cada PDF no MESMO caminho e confere o que ficou no Storage.
// Nada no banco muda.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPedidoCompraPDF } from "@/lib/pdf/pedido-compra";
import { empresaDoDocumento, type CnpjDoDocumento } from "@/lib/fiscal/cnpj-da-pp";
import { pagamentoDoTitularDaPP } from "@/lib/data/foto-pagamento-da-pp";
import { linhasDoPdf } from "./rastros-codigo-anterior/pdf-texto";
import { BUCKET_PPS, TENANT_ID, clienteDeServico, sha256 } from "./rastros-codigo-anterior/comum";

const GRAVAR = process.argv.includes("--gravar");
const CODIGOS = ["PP-00160", "PP-00165"];
const PASTA = join(tmpdir(), "refazer-pdf-171");
/** Cópia dos PDFs de antes, fora do repositório (têm dado pessoal). */
const PASTA_BACKUP = "/Users/tiagomendonca/Documents/California/backups/verba-colaborador-171-2026-10-14";

const mascara = (l: string) => l.replace(/\d/g, "•");

async function main() {
  const s = clienteDeServico();
  mkdirSync(PASTA, { recursive: true });

  const { data: pps, error } = await s
    .from("pedidos_compra")
    .select("*, parcelas:pedidos_compra_parcelas(numero, data_vencimento, valor)")
    .eq("tenant_id", TENANT_ID)
    .in("codigo", CODIGOS);
  if (error) throw new Error(error.message);

  for (const pp of pps ?? []) {
    console.log(`\n=== ${pp.codigo} (${pp.status})`);
    if (!pp.verba_producao || pp.verba_titular_tipo !== "colaborador") {
      throw new Error("não é verba de colaborador");
    }
    const pagamento = pagamentoDoTitularDaPP(pp);
    if (!pagamento) throw new Error("a PP não tem a foto do pagamento do colaborador");

    const [jobRes, estabRes] = await Promise.all([
      s.from("jobs").select("id, codigo, nome, produto, projeto_id").eq("id", pp.job_id).single(),
      s
        .from("fiscal_estabelecimentos")
        .select(
          "id, nome, cnpj, municipio, uf, logradouro, numero, complemento, bairro, cep, telefone, email, inscricao_estadual, inscricao_municipal, contabil:empresas_contabeis(razao_social)",
        )
        .eq("id", pp.estabelecimento_id)
        .single(),
    ]);
    if (jobRes.error || estabRes.error) throw new Error(jobRes.error?.message ?? estabRes.error?.message);
    const job = jobRes.data;
    const estab = estabRes.data as unknown as CnpjDoDocumento & {
      contabil: { razao_social: string | null } | Array<{ razao_social: string | null }> | null;
    };
    const contabil = Array.isArray(estab.contabil) ? estab.contabil[0] : estab.contabil;
    const { data: projeto, error: projErr } = await s
      .from("projetos")
      .select("campanha, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)")
      .eq("id", job.projeto_id)
      .single();
    if (projErr || !projeto) throw new Error(`projeto: ${projErr?.message}`);

    const { data: atual, error: dlErr } = await s.storage.from(BUCKET_PPS).download(pp.pdf_path);
    if (dlErr || !atual) throw new Error(`baixar: ${dlErr?.message}`);
    const antigo = linhasDoPdf(Buffer.from(await atual.arrayBuffer()));

    const parcelas = (pp.parcelas as Array<{ numero: number; data_vencimento: string; valor: number }>)
      .slice()
      .sort((a, b) => a.numero - b.numero);
    const novo = await renderPedidoCompraPDF({
      pp: {
        codigo: pp.codigo,
        servico: pp.servico,
        quantidade: Number(pp.quantidade),
        especificacoes: pp.especificacoes,
        valor: Number(pp.valor),
        prazo_pagamento: parcelas[0]?.data_vencimento ?? pp.prazo_pagamento,
        created_at: pp.created_at,
        verba_producao: true,
        tipo_verba: pp.tipo_verba,
        verba_titular_tipo: pp.verba_titular_tipo,
      },
      empresa: empresaDoDocumento(estab, contabil?.razao_social ?? null) as never,
      fornecedor: null,
      responsavelVerbaNome: pp.verba_titular_nome,
      pagamentoDoTitular: pagamento,
      job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
      // Script já rodado (decisão 171): o documento como era, sem as linhas
      // da revisão da 156.
      empresaGerencial: null,
      regional: null,
      projeto: { campanha: projeto.campanha ?? null },
      cliente: {
        nome_fantasia: (projeto.cliente as unknown as { nome_fantasia: string } | null)?.nome_fantasia ?? "",
      },
      responsavelNome: (projeto.responsavel as unknown as { nome: string } | null)?.nome ?? "",
      parcelas: parcelas.map((p) => ({
        numero: p.numero,
        data_vencimento: String(p.data_vencimento).slice(0, 10),
        valor: Number(p.valor),
      })),
    });
    const linhasNovas = linhasDoPdf(novo);

    // A diferença: o que saiu do documento de hoje e o que entrou.
    const restoNovo = [...linhasNovas];
    const saiu: string[] = [];
    for (const l of antigo) {
      const i = restoNovo.indexOf(l);
      if (i >= 0) restoNovo.splice(i, 1);
      else saiu.push(l);
    }
    console.log("saiu:", saiu.length ? saiu.map(mascara) : "(nada)");
    console.log("entrou:", restoNovo.map(mascara));
    const aceito =
      saiu.length === 0 &&
      restoNovo[0] === "DADOS BANCÁRIOS DO TITULAR DA VERBA PARA PAGAMENTO" &&
      restoNovo.every((l) => !/^(Cliente|Titular da verba|Emissão|Job|Serviço|Valor|Natureza):/.test(l));
    if (!aceito) throw new Error("a diferença vai além do bloco de pagamento — nada foi gravado");

    const local = join(PASTA, `${pp.codigo}.pdf`);
    writeFileSync(local, novo);
    console.log("ensaio em", local);

    if (GRAVAR) {
      mkdirSync(PASTA_BACKUP, { recursive: true });
      writeFileSync(join(PASTA_BACKUP, `${pp.codigo}-antes.pdf`), Buffer.from(await atual.arrayBuffer()));
      const { error: upErr } = await s.storage
        .from(BUCKET_PPS)
        .upload(pp.pdf_path, novo, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error(`subir: ${upErr.message}`);
      const { data: conf, error: confErr } = await s.storage.from(BUCKET_PPS).download(pp.pdf_path);
      if (confErr || !conf) throw new Error(`conferir: ${confErr?.message}`);
      if (sha256(Buffer.from(await conf.arrayBuffer())) !== sha256(novo)) {
        throw new Error("o arquivo no Storage não é o que subiu");
      }
      console.log("gravado e conferido no Storage");
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
