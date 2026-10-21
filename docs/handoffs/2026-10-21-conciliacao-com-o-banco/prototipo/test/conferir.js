import { TITULOS_INICIAIS, LANCAMENTOS_INICIAIS, LOTES, REGRAS, ofxDeExemplo } from "../src/data.js";
import { lerOfx, casar } from "../src/ofx.js";
const ofx = lerOfx(ofxDeExemplo("091923").replace("__SALDO__","0"));
const res = casar(ofx.movimentos, {titulos: TITULOS_INICIAIS, lancamentos: LANCAMENTOS_INICIAIS.filter(l=>!l.conciliado), lotes: LOTES, regras: REGRAS, deslocamento: 0}, {recomendada: true});
res.filter(r => (r.estado === "sugestao" && !(r.confianca === "alta" && r.titulo.centro)) || r.estado === "diferenca").forEach(r =>
  console.log(r.mov.valor, r.estado, r.confianca, r.titulo?.ref, r.titulo?.contraparte, "| cands:", r.candidatos.map(c => `${c.t.ref}(${c.s})`).join(" "), "|", r.motivo));
console.log("ja_lancado:", res.filter(r => r.estado === "ja_lancado").map(r => [r.mov.valor, r.lancamento.descricao]));
