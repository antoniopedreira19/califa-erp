import { TITULOS_INICIAIS, LANCAMENTOS_INICIAIS, LOTES, REGRAS, ofxDeExemplo } from "../src/data.js";
import { lerOfx, casar } from "../src/ofx.js";
const ofx = lerOfx(ofxDeExemplo("091923").replace("__SALDO__","0"));
for (const rec of [false, true]) {
const res = casar(ofx.movimentos, {titulos: TITULOS_INICIAIS, lancamentos: LANCAMENTOS_INICIAIS.filter(l=>!l.conciliado), lotes: LOTES, regras: REGRAS, deslocamento: 0}, {recomendada: rec});
const c = {}; res.forEach(r => { const k = r.estado + (r.confianca? ":"+r.confianca:""); c[k]=(c[k]||0)+1; });
console.log(rec ? "REC" : "PED", JSON.stringify(c));
res.filter(r => r.estado === "combinacao" || r.estado === "sem_par").forEach(r => console.log("  ", r.mov.valor, r.estado, (r.titulos ?? []).map(t => t.ref).join("+"), "|", r.motivo));
}
