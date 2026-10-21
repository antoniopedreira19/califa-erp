import { TITULOS_INICIAIS, LANCAMENTOS_INICIAIS, LOTES, REGRAS, ofxDeExemplo, SALDO_INICIAL_OUTUBRO } from "../src/data.js";
import { lerOfx, casar, digitais } from "../src/ofx.js";
const ofx = lerOfx(ofxDeExemplo("091923").replace("__SALDO__","0"));
console.log("movs", ofx.movimentos.length, "soma", ofx.movimentos.reduce((s,m)=>s+m.valor,0).toFixed(2));
const folha = LOTES[0].titulos.map(t=>t.valor); console.log("folha n", folha.length, "min", Math.min(...folha), "soma", folha.reduce((a,b)=>a+b,0).toFixed(2));
for (const rec of [false,true]) {
  const res = casar(ofx.movimentos, {titulos: TITULOS_INICIAIS, lancamentos: LANCAMENTOS_INICIAIS.filter(l=>!l.conciliado), lotes: LOTES, regras: REGRAS, deslocamento: 0}, {recomendada: rec});
  const c = {}; res.forEach(r => { const k = r.estado + (r.confianca? ":"+r.confianca:""); c[k]=(c[k]||0)+1; });
  console.log(rec ? "REC" : "PED", JSON.stringify(c));
  res.filter(r=>["sem_par","diferenca","par"].includes(r.estado) || r.confianca==="media").forEach(r=>console.log("  ", r.mov.valor, r.estado, r.confianca||"", r.titulo?.ref||"", "|", r.motivo));
}
// reimport dedupe
const a = digitais(ofx.movimentos,"cs"), b = digitais(lerOfx(ofxDeExemplo("091935").replace("__SALDO__","0")).movimentos,"cs");
console.log("dedupe iguais:", b.filter(d=>a.includes(d)).length, "de", b.length);
