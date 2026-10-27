import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dec } from '../decimal';
import {
  CE_PHARMA_CHANNEL_RULE,
  ST_NET_LOAD_REGIMES,
  pharmaChannelOf,
  stNetLoadAmount,
  stNetLoadExit,
  stNetLoadFor,
} from './st-net-loads';

/**
 * F3-26.d.CE.g: o texto do LegisWeb (fonte de texto de norma aprovada pelo dono em 27/10/2026) dos
 * Decretos 31.270/2013, 32.900/2018 e 34.256/2021 confere com o Anexo III gerado do SefazLegis, e
 * os exemplos numéricos do que os decretos DIZEM (não o que supomos) são reproduzidos. O "ajuste
 * proporcional" do art. 2º-B (construção) e do art. 2º, § 5º (móveis) não traz conta: continua
 * "falta configurar" (dúvida D-042).
 */

const pagina = (arquivo: string) => {
  const html = gunzipSync(
    readFileSync(fileURLToPath(new URL(`../../sources/${arquivo}`, import.meta.url))),
  ).toString('utf8');
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
};

/** Os valores do último "ANEXO III" da página: cada linha é rótulo (7%, 12%...) e 3 cargas. */
const anexoIII = (texto: string): string[] => {
  const inicio = texto.lastIndexOf('ANEXO III');
  const fim = texto.indexOf('ASSINAR O LEGISWEB', inicio);
  return [...texto.slice(inicio, fim).matchAll(/(\d{1,2}(?:,\d{1,2})?)%/g)]
    .map((m) => m[1]!.replace(',', '.'))
    .filter((_, i) => i % 4 !== 0);
};

const esperado = (id: string): string[] => {
  const versao = ST_NET_LOAD_REGIMES.find((r) => r.id === id)!.versions[0]!;
  expect(versao.validTo).toBeNull();
  return versao.loads.flatMap((l) => [
    l.percents.internal!,
    l.percents['n-ne-co-es']!,
    l.percents['s-se-except-es']!,
  ]);
};

const numeros = (lista: string[]) => lista.map((v) => dec(v).toString());

describe('Anexo III do LegisWeb contra o gerado do SefazLegis', () => {
  it.each([
    [
      'stCeCargaConstrucao',
      'LegisWeb_CE_Decreto_31270-2013_construcao_ajuste_proporcional_2026-10-27.html.gz',
    ],
    [
      'stCeCargaMoveis',
      'LegisWeb_CE_Decreto_32900-2018_moveis_ajuste_proporcional_2026-10-27.html.gz',
    ],
    ['stCeCargaVestuario', 'LegisWeb_CE_Decreto_34256-2021_vestuario_2026-10-27.html.gz'],
  ])('%s: mesmas cargas, linha a linha', (id, arquivo) => {
    expect(numeros(anexoIII(pagina(arquivo)))).toEqual(numeros(esperado(id)));
  });
});

describe('o que os decretos dizem com número (LegisWeb)', () => {
  const texto = {
    construcao: pagina(
      'LegisWeb_CE_Decreto_31270-2013_construcao_ajuste_proporcional_2026-10-27.html.gz',
    ),
    moveis: pagina('LegisWeb_CE_Decreto_32900-2018_moveis_ajuste_proporcional_2026-10-27.html.gz'),
    vestuario: pagina('LegisWeb_CE_Decreto_34256-2021_vestuario_2026-10-27.html.gz'),
  };

  it('os três textos trazem o "ajuste proporcional" sem fórmula', () => {
    expect(texto.construcao).toMatch(/Art\. 2\.º- B\. Nas hipóteses dos arts\. 2\.º e 2\.º- A/);
    expect(texto.construcao).toMatch(
      /será feito o ajuste proporcional à sua carga líquida efetiva/,
    );
    expect(texto.moveis).toMatch(/será feito o ajuste proporcional na carga tributária líquida/);
    // Nenhuma fórmula, razão ou exemplo numérico acompanha a expressão.
    expect(texto.moveis).not.toMatch(/ajuste proporcional[^.]{0,200}\d,\d{2}%/);
    // O vestuário não tem ajuste proporcional nem RET com carga.
    expect(texto.vestuario).not.toMatch(/proporcional/i);
    expect(texto.vestuario).not.toMatch(/Regime Especial de Tributação.{0,80}poderá aplicar/);
  });

  it('construção: indústria, art. 2º, 7,64% sobre a operação com 45% (produto de 20%)', () => {
    expect(texto.construcao).toMatch(
      /carga líquida tributária de 7,64%.*margem de valor agregado no percentual de 45%/,
    );
    // Operação de R$ 1.000,00: base R$ 1.450,00, imposto R$ 110,78.
    expect(stNetLoadAmount({ documentCents: 100_000, mva: '45', loadPercent: '7.64' })).toEqual({
      baseCents: 145_000,
      stCents: 11_078,
    });
    const saida = stNetLoadExit({
      uf: 'CE',
      sellerCnae: '2330301',
      destinationUf: 'CE',
      date: '2026-10-27',
      goodsClass: 'rate-20',
      operationCents: 100_000,
    });
    expect(saida?.status).toBe('retains');
  });

  it('construção e móveis: produto fora de 20% na indústria continua "falta configurar"', () => {
    const construcao = stNetLoadExit({
      uf: 'CE',
      sellerCnae: '2330301',
      destinationUf: 'CE',
      date: '2026-10-27',
      goodsClass: 'rate-25',
      operationCents: 100_000,
    });
    expect(construcao?.status).toBe('missing');
    const moveis = stNetLoadExit({
      uf: 'CE',
      sellerCnae: '3101200',
      destinationUf: 'CE',
      date: '2026-10-27',
      goodsClass: 'rate-28',
      operationCents: 100_000,
    });
    expect(moveis?.status).toBe('missing');
    if (moveis?.status === 'missing') expect(moveis.message).toMatch(/ajuste proporcional/);
  });

  it('móveis: margem de 40% (27% para MEI e Simples, art. 3º, § 8º) sobre o documento', () => {
    expect(texto.moveis).toMatch(/margem de valor agregado de 40%/);
    expect(texto.moveis).toMatch(
      /será de 27% \(vinte e sete por cento\) para os estabelecimentos enquadrados na condição de MEI ou que forem optantes pelo Simples Nacional/,
    );
    // Atacadista (4649-4/99 não é o ponto; a conta é pela função): R$ 1.000,00, 7,70% próprio Estado.
    expect(stNetLoadAmount({ documentCents: 100_000, mva: '40', loadPercent: '7.70' })).toEqual({
      baseCents: 140_000,
      stCents: 10_780,
    });
    expect(stNetLoadAmount({ documentCents: 100_000, mva: '27', loadPercent: '7.70' })).toEqual({
      baseCents: 127_000,
      stCents: 9_779,
    });
  });

  it('vestuário: margem de 50%, transferência 60% e 100%, Simples fora (art. 3º)', () => {
    expect(texto.vestuario).toMatch(/agregado de 50%/);
    expect(texto.vestuario).toMatch(/I - nas transferências internas, 60%/);
    expect(texto.vestuario).toMatch(/II - nas transferências interestaduais, 100%/);
    expect(texto.vestuario).toMatch(/não se aplicam às empresas optantes pelo Simples Nacional/);
    const simples = stNetLoadFor({
      uf: 'CE',
      buyerCnae: '4781400',
      originUf: 'SP',
      date: '2026-10-27',
      goodsClass: 'rate-20',
      buyerSimples: true,
    });
    expect(simples.status).toBe('simples-excluded');
  });

  it('FECOP e acréscimos do fornecedor do Simples, como no texto (construção e móveis)', () => {
    for (const t of [texto.construcao, texto.moveis]) {
      expect(t).toMatch(/2,58%.*operações internas/);
      expect(t).toMatch(
        /3% \(três por cento\), nas operações procedentes do Norte, Nordeste, Centro-oeste/,
      );
      expect(t).toMatch(/3,20%.*Sul e Sudeste/);
      expect(t).toMatch(
        /3% \(três por cento\), nas operações internas.*4% \(quatro por cento\).*6% \(seis por cento\)/,
      );
    }
  });
});

describe('RET dos farmacêuticos: canal pela CNAE do destinatário (IN SEFAZ 74/2025)', () => {
  const venda = (over: Partial<Parameters<typeof stNetLoadExit>[0]> = {}) =>
    stNetLoadExit({
      uf: 'CE',
      sellerCnae: '4644301',
      specialRegime: true,
      destinationUf: 'CE',
      date: '2026-10-27',
      goodsClass: 'rate-20',
      cest: '1300100',
      operationCents: 1_000_000,
      ...over,
    });

  it('o dado gerado traz as divisões 84, 86, 87 e 88, CNAE principal e vigência de 01/06/2025', () => {
    expect(CE_PHARMA_CHANNEL_RULE).toMatchObject({
      validFrom: '2025-06-01',
      hospitalCnaeDivisions: ['84', '86', '87', '88'],
      cnaeBasis: 'principal',
      individualGoesToPharma: true,
      hospitalShareOver: '50',
    });
    expect(pharmaChannelOf('8610-1/01', '2026-10-27')).toBe('hospital');
    expect(pharmaChannelOf('8411600', '2026-10-27')).toBe('hospital');
    expect(pharmaChannelOf('4771-7/01', '2026-10-27')).toBe('pharma');
    expect(pharmaChannelOf('8610101', '2025-05-31')).toBeNull();
    expect(pharmaChannelOf(null, '2026-10-27')).toBeNull();
  });

  it('hospital: carga de 7,08% (CST 60, valor em vICMSSTRet); farma: 9,30% (CST 30, pICMSST)', () => {
    const hospital = venda({ recipientCnae: '8610101' });
    expect(hospital).toMatchObject({
      status: 'retains',
      option: {
        loadPercent: '7.08',
        stCents: 70_800,
        stFields: { cst: '60', modBC: '3', pICMSST: null, vICMSSTRetCents: 70_800 },
      },
    });
    const farma = venda({ recipientCnae: '4771701' });
    expect(farma).toMatchObject({
      status: 'retains',
      option: {
        loadPercent: '9.30',
        stCents: 93_000,
        stFields: { cst: '30', modBC: '3', pICMSST: '9.30', vICMSSTRetCents: null },
      },
    });
  });

  it('sem CNAE do destinatário continua a escolha entre canais; pessoa física vai no Farma', () => {
    expect(venda()).toMatchObject({ status: 'channels' });
    expect(venda({ recipientIndividual: true, recipientCnae: '8610101' })).toMatchObject({
      status: 'retains',
      option: { loadPercent: '9.30' },
    });
    // Antes de 01/06/2025 a IN não vale: sem canal pela CNAE.
    expect(venda({ recipientCnae: '8610101', date: '2025-05-31' })).toMatchObject({
      status: 'missing',
    });
  });

  it('transferência não usa o canal pela CNAE nem leva campos da ST', () => {
    const t = venda({ transfer: true, recipientCnae: '8610101' });
    expect(t?.status).toBe('channels');
    if (t?.status === 'channels') expect(t.options.every((o) => !o.stFields)).toBe(true);
  });
});

describe('móveis: referência do "ajuste proporcional" por data', () => {
  it('o texto de 2018/2019 diz 18%; o do Decreto 35.807 (efeitos de 01/01/2024) diz 20%', () => {
    const antigo = pagina(
      'LegisWeb_CE_Decreto_32900-2018_moveis_ate_Decreto_32904-2018_2026-10-27.html.gz',
    );
    const atual = pagina(
      'LegisWeb_CE_Decreto_32900-2018_moveis_ajuste_proporcional_2026-10-27.html.gz',
    );
    expect(antigo).toMatch(
      /for diferente de 18% \(dezoito por cento\), será feito o ajuste proporcional/,
    );
    expect(atual).toMatch(
      /for diferente de 20% \(vinte por cento\), será feito o ajuste proporcional/,
    );
    expect(atual).toMatch(
      /diferente de 20%.*\(Redação do parágrafo dada pelo Decreto Nº 35807 DE 29\/12\/2023\)/,
    );
    const moveis = ST_NET_LOAD_REGIMES.find((r) => r.id === 'stCeCargaMoveis')!;
    expect(moveis.industry).toMatchObject({ referenceRate: '20', validFrom: '2024-01-01' });
    // Antes de 2024 o Bipaê não tem a regra do art. 2º: "falta configurar", não a de 20%.
    const antes = stNetLoadExit({
      uf: 'CE',
      sellerCnae: '3101200',
      destinationUf: 'CE',
      date: '2023-12-31',
      goodsClass: 'rate-20',
      operationCents: 100_000,
    });
    expect(antes?.status).toBe('missing');
  });
});

describe('Lei 13.025/2000 e Parecer CECON 771/2024: só registro, sem fórmula', () => {
  it('a lei fala em redução de até 41,18% e carga efetiva mínima de 10,59%', () => {
    const lei = pagina('LegisWeb_CE_Lei_13025-2000_2026-10-27.html.gz');
    expect(lei).toMatch(/reduzida em até 41,18%.*no mínimo 10,59%/);
    expect(lei).toMatch(/alíquota seja 17%/);
    expect(lei).toMatch(
      /não se aplica às operações:.*mercadorias submetidas ao regime de substituição tributária/,
    );
  });

  it('o parecer descreve a carga líquida como multiplicador direto, sem dar a conta do ajuste', () => {
    const parecer = pagina('LegisWeb_CE_Parecer_CECON_771-2024_2026-10-27.html.gz');
    expect(parecer).toMatch(/aplicação de multiplicadores diretos sobre o valor da operação/);
    expect(parecer).toMatch(/até 41,18%/);
    expect(parecer).not.toMatch(/ajuste proporcional.{0,200}\d,\d{2}%/);
  });
});
