import { describe, expect, it } from 'vitest';
import {
  stNetLoadAmount,
  stNetLoadChoicesFor,
  stNetLoadExit,
  stNetLoadExitMessage,
  stNetLoadFor,
  stNetLoadMessage,
  type StNetLoadInput,
} from './st-net-loads';

/**
 * F3-26.d.CE.e: o que o texto dos decretos do Ceará deixa para a empresa escolher (dúvida D-042).
 * Sem a escolha, o cálculo volta como "falta configurar"; com ela, a conta segue o texto.
 */

const calc = (input: Partial<StNetLoadInput> & { buyerCnae: string; originUf: string }) =>
  stNetLoadFor({ uf: 'CE', date: '2026-10-23', goodsClass: 'rate-20', ...input });

const exit = (over: Partial<Parameters<typeof stNetLoadExit>[0]> & { sellerCnae: string }) =>
  stNetLoadExit({
    uf: 'CE',
    destinationUf: 'CE',
    date: '2026-10-23',
    goodsClass: 'rate-20',
    operationCents: 1_000_000,
    ...over,
  });

describe('transferência com "a base definida no caput, acrescida de X%"', () => {
  it('sem a leitura escolhida: falta configurar, com as duas margens no texto', () => {
    const r = calc({ buyerCnae: '4741500', originUf: 'SP', transfer: true });
    expect(r).toMatchObject({ status: 'missing', topic: 'transfer' });
    expect(stNetLoadMessage(r)).toMatch(/acrescida de 50%.*margem de 35%.*Empresas e lojas/);
  });

  it('"no lugar": a margem do parágrafo troca a do caput (construção, 50%)', () => {
    const r = calc({
      buyerCnae: '4741500',
      originUf: 'SP',
      transfer: true,
      options: { transferMargin: 'replace' },
    });
    // Varejista de construção, Sul e Sudeste, 20%: 21% (Anexo III do Decreto 35.807).
    expect(r).toMatchObject({ status: 'applies', mva: '50', totalPercent: '21' });
    expect(stNetLoadAmount({ documentCents: 1_000_000, mva: '50', loadPercent: '21' })).toEqual({
      baseCents: 1_500_000,
      stCents: 315_000,
    });
  });

  it('"uma sobre a outra": 1,35 × 1,50 na construção, 1,30 × 1,30 na informática', () => {
    const construcao = calc({
      buyerCnae: '4741500',
      originUf: 'SP',
      transfer: true,
      options: { transferMargin: 'compound' },
    });
    expect(construcao).toMatchObject({ status: 'applies', mva: '102.5' });
    expect(construcao.status === 'applies' && construcao.warnings.join(' ')).toMatch(
      /margem do caput \(35%\) e mais 50%.*102,5%/,
    );
    // R$ 10.000,00 × 2,025 = R$ 20.250,00; × 21% = R$ 4.252,50.
    expect(stNetLoadAmount({ documentCents: 1_000_000, mva: '102.5', loadPercent: '21' })).toEqual({
      baseCents: 2_025_000,
      stCents: 425_250,
    });
    // Informática: o parágrafo vale também para a transferência interna.
    const info = calc({
      buyerCnae: '4651601',
      originUf: 'CE',
      transfer: true,
      options: { transferMargin: 'compound' },
    });
    expect(info).toMatchObject({ status: 'applies', mva: '69' });
  });

  it('móveis: no comprador do Simples a margem do caput é 27% (art. 3º, § 8º)', () => {
    const r = calc({
      buyerCnae: '4754701',
      originUf: 'SP',
      transfer: true,
      buyerSimples: true,
      options: { transferMargin: 'compound' },
    });
    // 1,27 × 1,40 = 1,778.
    expect(r).toMatchObject({ status: 'applies', mva: '77.8' });
  });

  it('a leitura não muda os decretos que já têm a conta no texto (autopeças, vestuário)', () => {
    const options = { transferMargin: 'compound' as const };
    expect(calc({ buyerCnae: '2910701', originUf: 'SP', transfer: true, options })).toMatchObject({
      mva: '80',
    });
    expect(calc({ buyerCnae: '4781400', originUf: 'SP', transfer: true, options })).toMatchObject({
      mva: '100',
    });
  });
});

describe('carga opcional da cerâmica (Decreto 31.270, art. 2º-A)', () => {
  it('sem escolha: falta configurar; com a escolha, 4,49% ou 7,64%, sempre + 45%', () => {
    const sem = exit({ sellerCnae: '2342702' });
    expect(sem && stNetLoadExitMessage(sem)).toMatch(/art\. 2º-A \(4,49%\).*Empresas e lojas/);
    const opcional = exit({ sellerCnae: '2342702', options: { industryLoad: 'optional' } });
    // R$ 10.000,00 × 1,45 = R$ 14.500,00; × 4,49% = R$ 651,05.
    expect(opcional).toMatchObject({
      status: 'retains',
      option: { loadPercent: '4.49', mva: '45', baseCents: 1_450_000, stCents: 65_105 },
    });
    expect(opcional && stNetLoadExitMessage(opcional)).toMatch(/art\. 2º-A.*opção da empresa/);
    const padrao = exit({ sellerCnae: '2349499', options: { industryLoad: 'standard' } });
    expect(padrao).toMatchObject({ option: { loadPercent: '7.64', stCents: 110_780 } });
    // O "ajuste proporcional" (art. 2º-B) vale para os dois artigos: fora de 20%, falta configurar.
    const outra = exit({
      sellerCnae: '2342702',
      goodsClass: 'rate-25',
      options: { industryLoad: 'optional' },
    });
    expect(outra && stNetLoadExitMessage(outra)).toMatch(/ajuste proporcional/);
  });
});

describe('RET dos farmacêuticos', () => {
  const base = { buyerCnae: '4644301', cest: '1300100', specialRegime: true };

  it('centro de distribuição informado pela empresa: 1,00% e 1,33% na entrada (art. 7º)', () => {
    const cd = { distributionCenter: true };
    expect(calc({ ...base, originUf: 'BA', options: cd })).toMatchObject({
      status: 'applies',
      totalPercent: '1.00',
      row: { label: 'RET, centro de distribuição (art. 7º)' },
    });
    expect(calc({ ...base, originUf: 'SP', options: cd })).toMatchObject({ totalPercent: '1.33' });
    // Na transferência recebida vale a tabela de transferências do art. 6º.
    expect(calc({ ...base, originUf: 'SP', transfer: true, options: cd })).toMatchObject({
      totalPercent: '2.38',
    });
    expect(calc({ ...base, originUf: 'SP' })).toMatchObject({ totalPercent: '2.16' });
  });

  it('venda a pessoa física do Estado: só o Canal Farma (art. 4º, § 4º-A)', () => {
    const r = exit({
      sellerCnae: '4644301',
      cest: '1300100',
      specialRegime: true,
      recipientIndividual: true,
    });
    expect(r).toMatchObject({
      status: 'retains',
      option: { loadPercent: '9.30', stCents: 93_000 },
    });
    expect(r && stNetLoadExitMessage(r)).toMatch(/pessoa física.*§ 4º-A/);
    // Para empresa o canal depende da atividade do destinatário: as opções continuam.
    expect(exit({ sellerCnae: '4644301', cest: '1300100', specialRegime: true })).toMatchObject({
      status: 'channels',
    });
  });
});

describe('escolhas que valem para a CNAE (tela de Empresas e lojas)', () => {
  it('cada decreto mostra só a escolha que o texto deixa', () => {
    expect(stNetLoadChoicesFor('CE', '4741-5/00', '2026-10-23')).toEqual({
      act: 'Decreto 31.270/2013 (CE)',
      transferMargin: { caputMva: '35', transferMva: '50', interstateOnly: true },
      industryLoad: null,
      distributionCenter: null,
    });
    expect(stNetLoadChoicesFor('CE', '2342702', '2026-10-23')).toMatchObject({
      transferMargin: null,
      industryLoad: { article: 'art. 2º-A', load: '4.49', standardLoad: '7.64' },
    });
    expect(stNetLoadChoicesFor('CE', '2342701', '2026-10-23')).toMatchObject({
      industryLoad: null,
    });
    expect(stNetLoadChoicesFor('CE', '4644301', '2026-10-23')).toMatchObject({
      transferMargin: null,
      distributionCenter: { article: 'art. 7º' },
    });
    expect(stNetLoadChoicesFor('CE', '2910701', '2026-10-23')?.transferMargin).toBeNull();
    expect(stNetLoadChoicesFor('CE', '4711302', '2026-10-23')).toBeNull();
  });
});
