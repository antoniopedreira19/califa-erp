// Leitura de OFX (SGML 1.0x e XML 2.x) e o motor de correspondência do
// protótipo. Tudo roda no navegador: o arquivo não sai da máquina.

export function lerOfx(texto) {
  const t = texto.replace(/\r/g, "");
  const tag = (bloco, nome) => {
    const m = bloco.match(new RegExp(`<${nome}>([^<\\n]*)`, "i"));
    return m ? m[1].trim() : null;
  };
  const corpo = t.slice(t.search(/<OFX>/i) >= 0 ? t.search(/<OFX>/i) : 0);
  const blocos = corpo.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const movimentos = blocos.map((b, i) => ({
    ordem: i,
    tipo: (tag(b, "TRNTYPE") || "").toUpperCase(),
    data: dataOfx(tag(b, "DTPOSTED")),
    valor: valorOfx(tag(b, "TRNAMT")),
    fitid: tag(b, "FITID") || "",
    documento: tag(b, "CHECKNUM") || "",
    historico: (tag(b, "MEMO") || tag(b, "NAME") || "").replace(/\s+/g, " ").trim(),
  }));
  const ledger = corpo.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i);
  return {
    banco: tag(corpo, "ORG") || tag(corpo, "BANKID") || "",
    bancoId: tag(corpo, "BANKID") || "",
    conta: tag(corpo, "ACCTID") || "",
    moeda: tag(corpo, "CURDEF") || "",
    inicio: dataOfx(tag(corpo, "DTSTART")),
    fim: dataOfx(tag(corpo, "DTEND")),
    geradoEm: dataOfx(tag(corpo, "DTSERVER")),
    // A hora em que o banco gerou o arquivo: se for do mesmo dia do último
    // movimento, o dia ainda não tinha terminado.
    geradoHora: (tag(corpo, "DTSERVER").match(/^\d{8}(\d{2})(\d{2})/) ?? []).slice(1, 3).join(":") || null,
    saldoBanco: ledger ? valorOfx(tag(ledger[1], "BALAMT")) : null,
    saldoEm: ledger ? dataOfx(tag(ledger[1], "DTASOF")) : null,
    movimentos,
  };
}

function dataOfx(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// O Santander manda "-1920,00"; o padrão OFX é "-1920.00". Os dois valem.
function valorOfx(s) {
  if (!s) return 0;
  let v = s.trim();
  if (v.includes(",") && v.includes(".")) v = v.replace(/\./g, "").replace(",", ".");
  else if (v.includes(",")) v = v.replace(",", ".");
  return Math.round(parseFloat(v) * 100) / 100;
}

/** A impressão digital do movimento. O FITID do Santander muda a cada
 *  download (ele carrega a hora da exportação), então a reimportação se
 *  reconhece por data + valor + histórico + posição entre iguais. */
export function digitais(movimentos, contaId) {
  const vistos = {};
  return movimentos.map((m) => {
    const base = `${contaId}|${m.data}|${Math.round(m.valor * 100)}|${normalizar(m.historico)}`;
    vistos[base] = (vistos[base] || 0) + 1;
    return `${base}|${vistos[base]}`;
  });
}

export function normalizar(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function diasEntre(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function somaDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

const cents = (v) => Math.round(Math.abs(v) * 100);

/** O que o histórico do banco diz sobre a forma do pagamento. */
export function formaDoHistorico(h) {
  const n = normalizar(h);
  if (/^TAR /.test(n)) return "tarifa";
  if (n.includes("CONCESSIONARIA")) return "concessionaria";
  if (n.includes("PAGAMENTO DE TITULO")) return "boleto";
  if (n.includes("DEVOLUCAO")) return "devolucao";
  if (n.includes("PIX")) return "pix";
  if (n.includes("TED")) return "ted";
  return "outro";
}

export function cnpjDoHistorico(h) {
  const m = (h || "").match(/\b(\d{14})\b/);
  return m ? m[1] : null;
}

/**
 * O motor de correspondência. Recebe os movimentos do banco (já sem os
 * repetidos) e devolve, para cada um, o que o sistema tem para ele.
 *
 * Ordem das tentativas, da mais certa para a menos:
 *   1. lançamento que já está no extrato do sistema e não foi conciliado;
 *   2. par anulado (o PIX que saiu e voltou no mesmo dia);
 *   3. título aberto pelo valor exato (líquido, depois da retenção);
 *   4. lote (remessa) cuja soma bate com uma linha só do banco;
 *   5. título com diferença pequena (juros, multa);
 *   6. regra de histórico (tarifas) — só na versão recomendada;
 *   7. sem correspondência.
 *
 * `opcoes.recomendada` liga as regras, os pares e o agrupamento por valor.
 */
export function casar(movimentos, sistema, opcoes = {}) {
  const { titulos, lancamentos, lotes, regras, deslocamento = 0 } = sistema;
  const rec = !!opcoes.recomendada;
  const usados = new Set();
  const lancUsados = new Set();
  const res = movimentos.map((m) => ({ mov: m, estado: "sem_par", candidatos: [] }));
  const venc = (t) => somaDias(t.vencimento, deslocamento);
  const forma = (m) => formaDoHistorico(m.historico);

  // 1. Já lançado
  res.forEach((r) => {
    const l = lancamentos.find(
      (l) => !lancUsados.has(l.id) && cents(l.valor) === cents(r.mov.valor) && Math.sign(l.valor) === Math.sign(r.mov.valor) &&
        Math.abs(diasEntre(somaDias(l.data, deslocamento), r.mov.data)) <= 3,
    );
    if (l) {
      lancUsados.add(l.id);
      r.estado = "ja_lancado";
      r.lancamento = l;
      r.confianca = "alta";
      r.motivo = "Já está no extrato do sistema, lançado à mão. Conciliar só liga as duas linhas.";
    }
  });

  // 1b. Já lançado, mas com outro valor: a baixa feita à mão não bate com o
  // banco (juros a mais, dígito trocado). Até R$ 1 ou 1% de diferença, na
  // mesma direção e até 3 dias. Não concilia: destaca para corrigir.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    const l = lancamentos.find(
      (l) =>
        !lancUsados.has(l.id) &&
        Math.sign(l.valor) === Math.sign(r.mov.valor) &&
        cents(l.valor) !== cents(r.mov.valor) &&
        Math.abs(Math.abs(l.valor) - Math.abs(r.mov.valor)) <= Math.max(1, Math.abs(r.mov.valor) * 0.01) &&
        Math.abs(diasEntre(somaDias(l.data, deslocamento), r.mov.data)) <= 3,
    );
    if (l) {
      lancUsados.add(l.id);
      r.estado = "divergencia";
      r.lancamento = l;
      r.confianca = "media";
      r.diferencaBaixa = Math.round((Math.abs(l.valor) - Math.abs(r.mov.valor)) * 100) / 100;
      r.motivo = `A baixa registrou ${fmt(Math.abs(l.valor))}${l.juros ? `, com ${fmt(l.juros)} de juros` : ""}; o banco ${r.mov.valor < 0 ? "debitou" : "creditou"} ${fmt(Math.abs(r.mov.valor))}.`;
    }
  });

  // 2. Par anulado: a devolução e a saída de mesmo valor no mesmo dia.
  if (rec) {
    res.forEach((r) => {
      if (r.estado !== "sem_par" || forma(r.mov) !== "devolucao") return;
      const outro = res.find(
        (o) => o !== r && o.estado === "sem_par" && cents(o.mov.valor) === cents(r.mov.valor) && o.mov.valor < 0 && o.mov.data === r.mov.data,
      );
      if (outro) {
        const t = titulos.find((t) => !usados.has(t.id) && t.lado === "pagar" && cents(t.liquido) === cents(r.mov.valor));
        r.estado = outro.estado = "par";
        r.par = outro;
        outro.par = r;
        r.titulo = outro.titulo = t || null;
        r.confianca = outro.confianca = "alta";
        r.motivo = outro.motivo = t
          ? `O PIX de ${t.contraparte} saiu e voltou no mesmo dia. As duas linhas entram no extrato e o título continua a pagar.`
          : "Saiu e voltou no mesmo dia. As duas linhas entram no extrato, e nenhum título é baixado.";
      }
    });
  }

  // 3. Título pelo valor exato
  const pontuar = (m, t) => {
    let s = 60;
    const d = Math.abs(diasEntre(venc(t), m.data));
    s += d === 0 ? 20 : d <= 3 ? 15 : d <= 7 ? 5 : d > 20 ? -25 : 0;
    const f = forma(m);
    if (t.forma && (t.forma === f || (f === "boleto" && t.forma === "guia"))) s += 10;
    const cnpj = cnpjDoHistorico(m.historico);
    if (cnpj && t.cnpj && cnpj === t.cnpj.replace(/\D/g, "")) s += 30;
    return s;
  };
  const compativel = (m, t) => (m.valor < 0 ? t.lado !== "receber" && !t.entra : t.lado === "receber" || t.entra);

  const pendentes = res.filter((r) => r.estado === "sem_par");
  const pares = [];
  pendentes.forEach((r) => {
    titulos.forEach((t) => {
      if (t.loteId || !compativel(r.mov, t) || cents(t.liquido) !== cents(r.mov.valor)) return;
      pares.push({ r, t, s: pontuar(r.mov, t) });
    });
  });
  pares.sort((a, b) => b.s - a.s);
  pares.forEach(({ r, t, s }) => {
    r.candidatos.push({ t, s });
    if (r.estado !== "sem_par" || usados.has(t.id)) return;
    usados.add(t.id);
    r.estado = "sugestao";
    r.titulo = t;
    r.pontos = s;
  });
  res.forEach((r) => {
    if (r.estado !== "sugestao") return;
    // Vários títulos do mesmo valor: a escolha é pela data, e pede conferência.
    const mesmos = r.candidatos.filter((c) => c.t.id !== r.titulo.id && c.s >= r.pontos - 5).length;
    r.empate = mesmos;
    r.confianca = r.pontos >= 90 && !mesmos ? "alta" : r.pontos >= 75 ? "media" : "baixa";
    const cnpj = cnpjDoHistorico(r.mov.historico);
    r.motivo = [
      "valor exato",
      r.titulo.retencao ? "pelo líquido, depois da retenção" : null,
      cnpj && r.titulo.cnpj && cnpj === r.titulo.cnpj.replace(/\D/g, "") ? "CNPJ do histórico é o do cliente" : null,
      ((d) => (d === 0 ? "mesma data" : d === 1 ? "1 dia de diferença" : `${d} dias de diferença`))(Math.abs(diasEntre(venc(r.titulo), r.mov.data))),
      mesmos ? `há ${mesmos + 1} títulos de ${fmt(r.mov.valor)} — confira o fornecedor` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  // 3a. Linhas iguais (mesmo dia, mesmo valor) e o mesmo número de títulos
  //     empatados: cada linha paga um, e qual fica com qual não muda o
  //     Extrato. Valem como certas (Tiago, 21/10/2026). Com mais títulos
  //     que linhas, o empate continua: alguém diz qual não foi pago.
  if (rec) {
    const iguais = new Map();
    res.forEach((r) => {
      if (r.estado !== "sugestao" || !r.empate) return;
      const k = `${r.mov.data}|${cents(r.mov.valor)}`;
      iguais.set(k, [...(iguais.get(k) ?? []), r]);
    });
    iguais.forEach((linhas) => {
      const empatados = new Set();
      linhas.forEach((r) => {
        empatados.add(r.titulo.id);
        r.candidatos.forEach((c) => c.s >= r.pontos - 5 && empatados.add(c.t.id));
      });
      if (empatados.size !== linhas.length) return;
      linhas.forEach((r) => {
        r.empate = 0;
        r.confianca = "alta";
        r.iguais = linhas.length;
        r.motivo = `valor exato · ${linhas.length} linhas iguais e ${linhas.length} títulos de ${fmt(Math.abs(r.mov.valor))}: cada linha paga um`;
      });
    });
  }

  // 3b. Retenção na fonte: o banco tem menos que a nota, e a diferença bate
  //     com as retenções de sempre (IRRF 1,5%; PIS/COFINS/CSLL 4,65%; ISS).
  //     Só para título sem retenção já combinada na aprovação. Não
  //     concilia sozinho: a baixa abre com a retenção destrinchada.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    for (const t of titulos) {
      if (usados.has(t.id) || t.loteId || t.retencao > 0 || !compativel(r.mov, t)) continue;
      if (Math.abs(diasEntre(venc(t), r.mov.data)) > 10) continue;
      const combo = RETENCOES_COMUNS.find((c) => Math.abs(liquidoCom(t.valor, c.aliquotas) - Math.abs(r.mov.valor)) <= 0.01);
      if (!combo) continue;
      usados.add(t.id);
      r.estado = "diferenca";
      r.titulo = t;
      r.confianca = "media";
      r.retencaoSugerida = valoresRetidos(t.valor, combo.aliquotas, Math.abs(r.mov.valor));
      r.motivo = `O banco tem ${fmt(t.valor - Math.abs(r.mov.valor))} a menos que o título: bate com ${combo.nome} retidos na fonte.`;
      break;
    }
  });

  // 4. Lote: uma linha do banco = vários títulos (a remessa da folha).
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    const lote = lotes.find((l) => cents(l.total) === cents(r.mov.valor));
    if (lote) {
      r.estado = "soma";
      r.lote = lote;
      r.confianca = "alta";
      r.motivo = `A soma dos ${lote.titulos.length} títulos da ${lote.nome} bate centavo a centavo.`;
      lote.titulos.forEach((t) => usados.add(t.id));
    }
  });

  // 4b. Vários títulos da mesma contraparte numa linha só: duas PPs do mesmo
  //     fornecedor pagas num PIX, ou o cliente que paga duas notas numa TED
  //     (Tiago, 21/10/2026). Só entre títulos de um mesmo fornecedor ou
  //     cliente (no recebimento, o do CNPJ do histórico, quando vem), de 2 a
  //     4 títulos, vencendo até 10 dias da data do banco, com a soma batendo
  //     centavo a centavo. Pede conferência: não concilia sozinho.
  res.forEach((r) => {
    if (!rec || r.estado !== "sem_par") return;
    const cnpj = cnpjDoHistorico(r.mov.historico);
    const alvo = cents(r.mov.valor);
    const porContraparte = new Map();
    titulos.forEach((t) => {
      if (usados.has(t.id) || t.loteId || !compativel(r.mov, t) || cents(t.liquido) >= alvo) return;
      if (Math.abs(diasEntre(venc(t), r.mov.data)) > 10) return;
      if (cnpj && t.cnpj && t.cnpj.replace(/\D/g, "") !== cnpj) return;
      porContraparte.set(t.contraparte, [...(porContraparte.get(t.contraparte) ?? []), t]);
    });
    const achadas = [];
    porContraparte.forEach((ts) => {
      const busca = (ini, escolhidos, soma) => {
        if (soma === alvo && escolhidos.length >= 2) return achadas.push(escolhidos);
        if (escolhidos.length === 4 || soma >= alvo) return;
        for (let i = ini; i < ts.length; i++) busca(i + 1, [...escolhidos, ts[i]], soma + cents(ts[i].liquido));
      };
      busca(0, [], 0);
    });
    if (!achadas.length) return;
    const ts = achadas[0];
    ts.forEach((t) => usados.add(t.id));
    r.estado = "combinacao";
    r.titulos = ts;
    // Uma combinação só vai para Prontos (um clique); mais de uma pede
    // escolha (Tiago, 21/10/2026).
    r.confianca = achadas.length === 1 ? "alta" : "media";
    r.motivo = `A soma de ${ts.length} títulos de ${ts[0].contraparte} bate centavo a centavo${achadas.length > 1 ? ` · há ${achadas.length} combinações possíveis` : ""}.`;
  });

  // 5. Diferença: juros e multa no boleto pago depois (até 3%, até 10
  //    dias) e na guia de imposto paga em atraso (multa de mora de 0,33%
  //    ao dia, limitada a 20%, mais juros: até 25%, até 60 dias depois do
  //    vencimento da guia, que não muda). Só quando o banco diz que foi
  //    boleto ou guia: no PIX e na TED o valor é o que a agência mandou, e
  //    a fatura do cartão e a conta de consumo cobram o atraso na seguinte.
  res.forEach((r) => {
    if (r.estado !== "sem_par" || r.mov.valor > 0 || forma(r.mov) !== "boleto") return;
    const cabe = (t) => {
      if (t.lado !== "imposto" && (t.forma !== "boleto" || t.origem === "fatura")) return false;
      const dif = cents(r.mov.valor) - cents(t.liquido);
      if (dif <= 0) return false;
      const vencLegal = somaDias(t.vencOrig ?? t.vencimento, deslocamento);
      if (t.lado === "imposto" && r.mov.data > vencLegal) return dif <= cents(t.liquido) * 0.25 && diasEntre(vencLegal, r.mov.data) <= 60;
      return dif <= cents(t.liquido) * 0.03 && Math.abs(diasEntre(venc(t), r.mov.data)) <= 10;
    };
    const t = titulos.find((t) => !usados.has(t.id) && !t.loteId && compativel(r.mov, t) && cabe(t));
    if (t) {
      usados.add(t.id);
      r.estado = "diferenca";
      r.titulo = t;
      r.diferenca = Math.round((Math.abs(r.mov.valor) - t.liquido) * 100) / 100;
      r.confianca = "media";
      const atraso = diasEntre(somaDias(t.vencOrig ?? t.vencimento, deslocamento), r.mov.data);
      r.motivo =
        t.lado === "imposto"
          ? `Guia paga ${atraso} ${atraso === 1 ? "dia" : "dias"} depois do vencimento: os ${fmt(r.diferenca)} a mais entram como multa e juros (11 · Despesa com Juros).`
          : `O banco pagou ${fmt(r.diferenca)} a mais que o título: entra como juros e multa (11 · Despesa com Juros).`;
    }
  });

  // 6. Regras de histórico
  if (rec) {
    res.forEach((r) => {
      if (r.estado !== "sem_par") return;
      const regra = regras.find((g) => normalizar(r.mov.historico).startsWith(normalizar(g.padrao)));
      if (regra) {
        r.estado = "regra";
        r.regra = regra;
        r.confianca = "alta";
        r.motivo = `Regra "${regra.padrao}…" → ${regra.centro}. Criada em ${regra.criadaEm}, usada ${regra.usos} vezes.`;
      }
    });
  }

  // 7. O que sobrou: os candidatos de mesmo valor que já foram usados.
  res.forEach((r) => {
    if (r.estado !== "sem_par") return;
    r.motivo = r.candidatos.length
      ? `Os títulos de ${fmt(r.mov.valor)} já foram para outras linhas do extrato.`
      : "Nenhum título ou lançamento do sistema tem esse valor.";
  });
  return res;
}

// As retenções que mais aparecem, para reconhecer a diferença do banco.
const RETENCOES_COMUNS = [
  { nome: "IRRF 1,5% e PIS/COFINS/CSLL 4,65% (6,15%)", aliquotas: { IRRF: 1.5, PIS: 0.65, COFINS: 3, CSLL: 1 } },
  { nome: "PIS/COFINS/CSLL 4,65%", aliquotas: { PIS: 0.65, COFINS: 3, CSLL: 1 } },
  { nome: "IRRF 1,5%", aliquotas: { IRRF: 1.5 } },
  { nome: "ISS 5%", aliquotas: { ISS: 5 } },
  { nome: "ISS 2%", aliquotas: { ISS: 2 } },
  { nome: "IRRF, PIS/COFINS/CSLL e ISS 5% (11,15%)", aliquotas: { IRRF: 1.5, PIS: 0.65, COFINS: 3, CSLL: 1, ISS: 5 } },
];
const r2o = (n) => Math.round(n * 100) / 100;

/** A retenção de alíquotas comuns que explica o banco ter menos que o
 *  título (a mesma do passo 3b), para a busca manual. Só para título que
 *  pode ter retenção e que não a tem combinada na aprovação: com ela, o
 *  título já está pelo líquido. */
export function retencaoQueExplica(t, valorDoBanco) {
  if (t.retencao > 0 || t.baixado > 0 || !["pp", "avulso", "recorrencia", "desembolso", "nf", "rec_avulso"].includes(t.origem)) return null;
  const combo = RETENCOES_COMUNS.find((c) => Math.abs(liquidoCom(t.valor, c.aliquotas) - valorDoBanco) <= 0.01);
  return combo ? { nome: combo.nome, retidos: valoresRetidos(t.valor, combo.aliquotas, valorDoBanco) } : null;
}
function liquidoCom(valor, aliquotas) {
  return r2o(valor - Object.values(aliquotas).reduce((s, a) => s + r2o((valor * a) / 100), 0));
}
/** Os valores retidos, imposto a imposto; o centavo do arredondamento vai
 *  no maior, para o líquido bater com o banco. */
export function valoresRetidos(valor, aliquotas, liquidoDoBanco) {
  const v = Object.fromEntries(Object.entries(aliquotas).map(([k, a]) => [k, r2o((valor * a) / 100)]));
  if (liquidoDoBanco !== undefined) {
    const sobra = r2o(valor - Object.values(v).reduce((s, x) => s + x, 0) - liquidoDoBanco);
    if (sobra !== 0) {
      const maior = Object.keys(v).sort((a, b) => v[b] - v[a])[0];
      v[maior] = r2o(v[maior] + sobra);
    }
  }
  return v;
}

export function fmt(n) {
  return Math.abs(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
