/**
 * Verificação de contrato do fornecedorSchema. Não é framework de testes —
 * é um script tsx com assertions básicas para pegar regressões antes de
 * commitar. Cobre os casos que mais nos morderam na brainstorming:
 * banco parcial, PIX parcial, banco OU PIX, formato de chave PIX.
 */
import { fornecedorSchema } from "../lib/validations/fornecedores";

let passou = 0;
let falhou = 0;

function assertOk(nome: string, entrada: unknown) {
  const r = fornecedorSchema.safeParse(entrada);
  if (r.success) {
    passou++;
    console.log(`  OK  ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHA (esperava OK)  ${nome}`);
    console.log("     issues:", JSON.stringify(r.error.issues, null, 2));
  }
}

function assertErroEm(nome: string, entrada: unknown, campoEsperado: string) {
  const r = fornecedorSchema.safeParse(entrada);
  if (r.success) {
    falhou++;
    console.log(`  FALHA (esperava erro em ${campoEsperado})  ${nome}`);
    return;
  }
  const tem = r.error.issues.some((i) => i.path.includes(campoEsperado));
  if (tem) {
    passou++;
    console.log(`  OK  ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHA (erro em outro campo)  ${nome}`);
    console.log("     issues:", JSON.stringify(r.error.issues, null, 2));
  }
}

const base = {
  tipo_pessoa: "juridica",
  nome: "Prime Comunicação",
  razao_social: "Prime Comunicação e Marketing Ltda",
  cpf_cnpj: "64582932000172",
  email: "regularize@contabilidade.com.br",
  telefone: "11987654321",
  cep: "44245000",
  logradouro: "Rua João Hipólito de Azevedo",
  numero: "18",
  complemento: "Andar 01",
  bairro: "Centro",
  cidade: "Conceição do Jacuípe",
  uf: "BA",
};

const bancoCompleto = {
  banco_codigo: "260",
  agencia: "0001",
  agencia_dv: null,
  conta: "218443214",
  conta_dv: "7",
  tipo_conta: "pagamento",
};

const pixCompleto = {
  pix_tipo: "cnpj",
  pix_chave: "64582932000172",
};

console.log("\n== Fornecedor completo (banco + PIX) ==");
assertOk("banco + PIX preenchidos", { ...base, ...bancoCompleto, ...pixCompleto });

console.log("\n== Fornecedor só com banco ==");
assertOk("só banco", { ...base, ...bancoCompleto });

console.log("\n== Fornecedor só com PIX ==");
assertOk("só PIX (chave CNPJ válida)", { ...base, ...pixCompleto });

console.log("\n== Nem banco nem PIX ==");
assertErroEm("nenhum bloco de pagamento", base, "banco_codigo");

console.log("\n== Banco parcialmente preenchido ==");
assertErroEm(
  "banco sem conta_dv",
  { ...base, ...bancoCompleto, conta_dv: null },
  "conta_dv",
);

console.log("\n== PIX parcialmente preenchido ==");
assertErroEm(
  "pix_tipo sem chave",
  { ...base, ...pixCompleto, pix_chave: "" },
  "pix_chave",
);

console.log("\n== Chave PIX com formato inválido ==");
assertErroEm(
  "chave CPF com 10 dígitos",
  { ...base, pix_tipo: "cpf", pix_chave: "1234567890" },
  "pix_chave",
);
assertErroEm(
  "chave e-mail sem @",
  { ...base, pix_tipo: "email", pix_chave: "abcabc" },
  "pix_chave",
);
assertErroEm(
  "chave telefone com 8 dígitos",
  { ...base, pix_tipo: "telefone", pix_chave: "12345678" },
  "pix_chave",
);

console.log("\n== Endereço obrigatório ==");
assertErroEm("sem CEP", { ...base, cep: "", ...pixCompleto }, "cep");
assertErroEm("CEP com 7 dígitos", { ...base, cep: "1234567", ...pixCompleto }, "cep");
assertErroEm("UF inválida", { ...base, uf: "XX", ...pixCompleto }, "uf");

console.log("\n== Banco inválido ==");
assertErroEm(
  "banco_codigo não existe na FEBRABAN",
  { ...base, ...bancoCompleto, banco_codigo: "999" },
  "banco_codigo",
);

console.log(`\n== ${passou} OK / ${falhou} falha(s) ==`);
process.exit(falhou > 0 ? 1 : 0);
