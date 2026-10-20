import { Inject, Injectable } from '@nestjs/common';
import {
  authorizationRequest,
  buildDistributionQuery,
  buildNfeProc,
  distributionRequest,
  parseDistributionResponse,
  recipientEventRequest,
  consultRequest,
  eventRequest,
  inutilizationRequest,
  parseBatchResponse,
  parseConsultResponse,
  parseEventResponse,
  parseInutilizationResponse,
  parseStatusResponse,
  receiptRequest,
  SefazMessageError,
  SefazResponseError,
  statusRequest,
  type SefazBatchResult,
  type FiscalEventResult,
  type SefazConsultResult,
  type DistributionQuery,
  type DistributionResult,
  type SefazRequest,
} from '@bipae/fiscal';
import { eq } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { companies } from '../../db/schema';
import { CertificatesService } from './certificates.service';
import { SefazUnavailableError, type SefazTransport } from './sefaz.transport';

export const SEFAZ_TRANSPORT = Symbol('SEFAZ_TRANSPORT');

export type NfeModel = '55' | '65';

export interface SefazStatusView {
  model: NfeModel;
  uf: string;
  environment: 'homologacao';
  cStat: string;
  xMotivo: string;
  online: boolean;
  averageSeconds?: number;
  observation?: string;
  checkedAt: string;
}

/**
 * Conversa com os webservices da SEFAZ em homologação (F3-11): status do serviço, envio de notas
 * assinadas, consulta do recibo e da nota pela chave. A chamada de rede fica fora da transação
 * do banco; dentro dela só se lê a empresa e o certificado.
 */
@Injectable()
export class SefazService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(SEFAZ_TRANSPORT) private transport: SefazTransport,
  ) {}

  /** UF da empresa e credenciais do certificado, lidas no tenant de quem pede. */
  private async prepare(ctx: RequestContext, companyId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
      if (!company) throw notFound('Empresa não encontrada.');
      if (!company.uf) throw new AppError(400, 'missing_uf', 'Falta configurar a UF da empresa.');
      return {
        uf: company.uf,
        taxId: company.taxId,
        credentials: await this.certificates.tlsCredentials(tx, companyId),
      };
    });
  }

  private async call(request: () => SefazRequest, credentials: { key: string; cert: string }) {
    let sefaz: SefazRequest;
    try {
      sefaz = request();
    } catch (error) {
      if (error instanceof SefazMessageError)
        throw new AppError(400, 'sefaz_message', error.message);
      throw error;
    }
    try {
      return await this.transport.send(sefaz, credentials);
    } catch (error) {
      if (error instanceof SefazUnavailableError) {
        throw new AppError(
          502,
          'sefaz_unavailable',
          `${error.message} Tente de novo em alguns minutos.`,
        );
      }
      throw error;
    }
  }

  private read<T>(parse: () => T): T {
    try {
      return parse();
    } catch (error) {
      if (error instanceof SefazResponseError)
        throw new AppError(502, 'sefaz_response', error.message);
      throw error;
    }
  }

  async status(
    ctx: RequestContext,
    companyId: string,
    model: NfeModel,
    svc = false,
  ): Promise<SefazStatusView> {
    const { uf, credentials } = await this.prepare(ctx, companyId);
    const response = await this.call(() => statusRequest(model, uf, svc), credentials);
    const result = this.read(() => parseStatusResponse(response));
    return {
      model,
      uf,
      ...(svc && { svc: true }),
      environment: 'homologacao',
      cStat: result.cStat,
      xMotivo: result.xMotivo,
      online: result.online,
      ...(result.averageSeconds !== undefined && { averageSeconds: result.averageSeconds }),
      ...(result.observation && { observation: result.observation }),
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Envia uma nota assinada. Quando a SEFAZ autoriza, devolve também o XML autorizado (nfeProc),
   * que é o que se guarda e se entrega ao cliente.
   */
  async authorize(
    ctx: RequestContext,
    input: {
      companyId: string;
      model: NfeModel;
      batchId: string;
      signedXml: string;
      /** Contingência SVC da NF-e (F3-16). */
      svc?: boolean;
    },
  ): Promise<SefazBatchResult & { nfeProc?: string }> {
    const { uf, credentials } = await this.prepare(ctx, input.companyId);
    const response = await this.call(
      () =>
        authorizationRequest({
          model: input.model,
          uf,
          batchId: input.batchId,
          signedXmls: [input.signedXml],
          svc: input.svc ?? false,
        }),
      credentials,
    );
    const result = this.read(() => parseBatchResponse(response));
    const [protocol] = result.protocols;
    if (protocol && (protocol.outcome === 'authorized' || protocol.outcome === 'denied')) {
      return { ...result, nfeProc: this.read(() => buildNfeProc(input.signedXml, protocol)) };
    }
    return result;
  }

  /** Resultado de um lote enviado sem processamento síncrono. */
  async receipt(
    ctx: RequestContext,
    companyId: string,
    model: NfeModel,
    receipt: string,
  ): Promise<SefazBatchResult> {
    const { uf, credentials } = await this.prepare(ctx, companyId);
    const response = await this.call(() => receiptRequest(model, uf, receipt), credentials);
    return this.read(() => parseBatchResponse(response));
  }

  /** Situação de uma nota pela chave: usada antes de reenviar, para nunca autorizar duas vezes. */
  async consult(
    ctx: RequestContext,
    companyId: string,
    accessKey: string,
  ): Promise<SefazConsultResult> {
    const { uf, credentials } = await this.prepare(ctx, companyId);
    const response = await this.call(() => consultRequest(uf, accessKey), credentials);
    return this.read(() => parseConsultResponse(response));
  }

  /** Envia um evento assinado (cancelamento, F3-17); o Bipaê manda um evento por lote. */
  async event(
    ctx: RequestContext,
    companyId: string,
    model: NfeModel,
    signedEvent: string,
  ): Promise<FiscalEventResult> {
    const { uf, credentials } = await this.prepare(ctx, companyId);
    const response = await this.call(
      () =>
        eventRequest({
          model,
          uf,
          batchId: String(Date.now()).slice(-15),
          signedEvents: [signedEvent],
        }),
      credentials,
    );
    return this.read(() => parseEventResponse(response));
  }

  /** Pede a inutilização de uma faixa de números (pedido já assinado). */
  async inutilize(
    ctx: RequestContext,
    companyId: string,
    model: NfeModel,
    signedXml: string,
  ): Promise<FiscalEventResult> {
    const { uf, credentials } = await this.prepare(ctx, companyId);
    const response = await this.call(
      () => inutilizationRequest({ model, uf, signedXml }),
      credentials,
    );
    return this.read(() => parseInutilizationResponse(response));
  }

  /**
   * Distribuição de DF-e (F3-20): pergunta ao Ambiente Nacional pelos documentos emitidos contra
   * o CNPJ da empresa, a partir do último NSU (ou por um NSU ou uma chave).
   */
  async distribution(
    ctx: RequestContext,
    companyId: string,
    query: DistributionQuery,
  ): Promise<DistributionResult> {
    const { uf, taxId, credentials } = await this.prepare(ctx, companyId);
    if (!taxId) throw new AppError(400, 'missing_tax_id', 'Falta o CNPJ da empresa.');
    const response = await this.call(
      () => distributionRequest(buildDistributionQuery({ taxId, uf, query })),
      credentials,
    );
    try {
      return await parseDistributionResponse(response);
    } catch (error) {
      if (error instanceof SefazResponseError)
        throw new AppError(502, 'sefaz_response', error.message);
      throw error;
    }
  }

  /** Manifestação do destinatário, já assinada, na recepção de eventos do Ambiente Nacional. */
  async recipientEvent(
    ctx: RequestContext,
    companyId: string,
    signedEvent: string,
  ): Promise<FiscalEventResult> {
    const { credentials } = await this.prepare(ctx, companyId);
    const response = await this.call(
      () => recipientEventRequest({ batchId: String(Date.now()).slice(-15), signedEvent }),
      credentials,
    );
    return this.read(() => parseEventResponse(response));
  }
}
