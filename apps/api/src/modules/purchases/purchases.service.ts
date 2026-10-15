import { X509Certificate } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  uuidv7,
  type CatalogProduct,
  type PurchasePreview,
  type PurchaseSummary,
  type purchaseImportInput,
} from '@bipae/domain';
import {
  purchaseLotMilli,
  purchaseStockMilli,
  purchaseUnitCostCents,
  readPurchaseNfe,
  PurchaseXmlError,
  type PurchaseNfe,
} from '@bipae/fiscal';
import { ICP_BRASIL_CERTIFICATES } from '@bipae/fiscal/icp-brasil';
import { DOMParser } from '@xmldom/xmldom';
import { desc, eq, inArray } from 'drizzle-orm';
import { SignedXml } from 'xml-crypto';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { assertStore, storeCondition } from '../../common/stores';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  productBarcodes,
  productPacks,
  products,
  purchaseInvoices,
  stockMovements,
  stores,
  supplierProductCodes,
  suppliers,
  units,
  type PurchaseInvoiceItem,
} from '../../db/schema';
import { LimitsService } from '../account/limits.service';
import { AuditService } from '../audit/audit.service';
import { assertProductFiscal } from '../fiscal/fiscal-validation';
import { MercadoflowCatalog } from '../mercadoflow/mercadoflow.catalog';
import { MercadoflowContributions } from '../mercadoflow/mercadoflow.contributions';
import { MercadoflowMarketSync } from '../mercadoflow/mercadoflow.market-sync';
import { LotsService } from '../stock/lots.service';

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

export interface SignatureCheck {
  valid: boolean;
  signer: string | null;
  /** O certificado do assinante vem da ICP-Brasil? */
  trusted: boolean;
}

const ICP_CERTS = ICP_BRASIL_CERTIFICATES.map((c) => new X509Certificate(c.pem));

/** O certificado foi emitido, direta ou indiretamente, por uma raiz da ICP-Brasil? */
function chainsToIcpBrasil(cert: X509Certificate): boolean {
  let current = cert;
  for (let depth = 0; depth < 6; depth++) {
    const issuer = ICP_CERTS.find((ca) => current.checkIssued(ca) && current.verify(ca.publicKey));
    if (!issuer) return false;
    if (issuer.checkIssued(issuer)) return true;
    current = issuer;
  }
  return false;
}

/**
 * Confere a assinatura digital do XML (XMLDSig sobre o infNFe): se o conteúdo foi alterado
 * depois de assinado, ela não confere. Diz também se o certificado é da ICP-Brasil.
 */
export function checkNfeSignature(xml: string, accessKey: string): SignatureCheck {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const signature = doc.getElementsByTagNameNS(DSIG_NS, 'Signature')[0];
    if (!signature) return { valid: false, signer: null, trusted: false };
    const reference = signature
      .getElementsByTagNameNS(DSIG_NS, 'Reference')[0]
      ?.getAttribute('URI');
    const certText = signature
      .getElementsByTagNameNS(DSIG_NS, 'X509Certificate')[0]
      ?.textContent?.replace(/\s+/g, '');
    if (reference !== `#NFe${accessKey}` || !certText)
      return { valid: false, signer: null, trusted: false };
    const cert = new X509Certificate(Buffer.from(certText, 'base64'));
    const verifier = new SignedXml({ publicCert: cert.toString() });
    verifier.loadSignature(signature as never);
    const valid = verifier.checkSignature(xml);
    const signer = /CN=([^\n]+)/.exec(cert.subject)?.[1] ?? null;
    return { valid, signer, trusted: valid && chainsToIcpBrasil(cert) };
  } catch {
    return { valid: false, signer: null, trusted: false };
  }
}

/**
 * Entrada de compra pelo XML da NF-e do fornecedor (F3-19): mostra antes o que vai acontecer
 * (fornecedor, itens e os produtos associados), e na confirmação cria o que falta, dá entrada no
 * estoque com o custo de aquisição e guarda a nota. Cada nota entra uma vez só.
 */
@Injectable()
export class PurchasesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LimitsService) private readonly limits: LimitsService,
    @Inject(MercadoflowCatalog) private readonly catalog: MercadoflowCatalog,
    @Inject(MercadoflowContributions) private readonly contributions: MercadoflowContributions,
    @Inject(MercadoflowMarketSync) private readonly marketSync: MercadoflowMarketSync,
    @Inject(LotsService) private readonly lots: LotsService,
  ) {}

  private read(xml: string): PurchaseNfe {
    try {
      return readPurchaseNfe(xml);
    } catch (error) {
      if (error instanceof PurchaseXmlError) throw new AppError(400, 'validation', error.message);
      throw error;
    }
  }

  /** Empresa da nota (destinatário), fornecedor já cadastrado e sugestões de produto por item. */
  private async analyze(tx: Tx, nfe: PurchaseNfe) {
    const recipient = nfe.recipient.cnpj ?? nfe.recipient.cpf ?? '';
    const [company] = await tx.select().from(companies).where(eq(companies.taxId, recipient));
    if (!company) {
      throw new AppError(
        400,
        'not_recipient',
        `Esta nota não é para nenhuma empresa sua: o destinatário é o CNPJ ${recipient || 'não informado'}.`,
      );
    }
    const supplierTaxId = nfe.supplier.cnpj ?? nfe.supplier.cpf ?? '';
    const [supplier] = supplierTaxId
      ? await tx.select().from(suppliers).where(eq(suppliers.taxId, supplierTaxId))
      : [];
    const [already] = await tx
      .select({ id: purchaseInvoices.id })
      .from(purchaseInvoices)
      .where(eq(purchaseInvoices.accessKey, nfe.accessKey));

    const codes = supplier
      ? await tx
          .select({
            code: supplierProductCodes.supplierCode,
            productId: supplierProductCodes.productId,
            factor: supplierProductCodes.factor,
          })
          .from(supplierProductCodes)
          .where(eq(supplierProductCodes.supplierId, supplier.id))
      : [];
    const gtins = nfe.items.map((i) => i.gtin).filter((g): g is string => !!g);
    const barcodes = gtins.length
      ? await tx.select().from(productBarcodes).where(inArray(productBarcodes.code, gtins))
      : [];
    const productIds = [...codes.map((c) => c.productId), ...barcodes.map((b) => b.productId)];
    const found = productIds.length
      ? await tx
          .select({ id: products.id, name: products.name, unit: products.unit })
          .from(products)
          .where(inArray(products.id, productIds))
      : [];
    const byId = new Map(found.map((p) => [p.id, p]));
    const suggestions = nfe.items.map((item) => {
      const viaSupplier = codes.find((c) => c.code === item.supplierCode);
      const product = viaSupplier && byId.get(viaSupplier.productId);
      if (product) {
        return {
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          factor: String(Number(viaSupplier.factor)),
          via: 'fornecedor' as const,
        };
      }
      const viaBarcode = item.gtin ? barcodes.find((b) => b.code === item.gtin) : undefined;
      const byBarcode = viaBarcode && byId.get(viaBarcode.productId);
      if (byBarcode) {
        return {
          productId: byBarcode.id,
          productName: byBarcode.name,
          unit: byBarcode.unit,
          factor: '1',
          via: 'codigo-de-barras' as const,
        };
      }
      return null;
    });
    return { company, supplier, alreadyImported: !!already, suggestions };
  }

  /** O que o catálogo sabe dos itens da nota (por GTIN), para cadastrar o que for novo. */
  private async catalogFor(ctx: RequestContext, nfe: PurchaseNfe) {
    const gtins = nfe.items.map((i) => i.gtin).filter((g): g is string => !!g);
    if (gtins.length === 0) return new Map<string, CatalogProduct>();
    const found = await this.catalog.lookup(ctx, gtins);
    return new Map(found.filter((p) => p.found).map((p) => [p.gtin, p]));
  }

  async preview(ctx: RequestContext, xml: string): Promise<PurchasePreview> {
    const nfe = this.read(xml);
    const signature = checkNfeSignature(xml, nfe.accessKey);
    const catalog = await this.catalogFor(ctx, nfe);
    return withTenant(this.db, ctx, async (tx) => {
      const { company, supplier, alreadyImported, suggestions } = await this.analyze(tx, nfe);
      return {
        accessKey: nfe.accessKey,
        number: nfe.number,
        series: nfe.series,
        issuedAt: nfe.issuedAt,
        totalCents: nfe.totalCents,
        environment: nfe.environment,
        authorized: !!nfe.protocol && ['100', '150'].includes(nfe.protocol.cStat),
        signature,
        company: { id: company.id, name: company.tradeName ?? company.legalName },
        supplier: {
          id: supplier?.id ?? null,
          name: nfe.supplier.name,
          taxId: nfe.supplier.cnpj ?? nfe.supplier.cpf ?? '',
        },
        alreadyImported,
        items: nfe.items.map((item, i) => ({
          line: item.line,
          supplierCode: item.supplierCode,
          gtin: item.gtin ?? null,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          totalCents: item.totalCents,
          suggestion: suggestions[i] ?? null,
          catalog: (() => {
            const found = item.gtin ? catalog.get(item.gtin) : undefined;
            return found
              ? {
                  description: found.description ?? item.description,
                  brand: found.brand ?? null,
                  packageDescription: found.packageDescription ?? null,
                }
              : null;
          })(),
        })),
      };
    });
  }

  async import(ctx: RequestContext, input: z.output<typeof purchaseImportInput>) {
    const nfe = this.read(input.xml);
    const signature = checkNfeSignature(input.xml, nfe.accessKey);
    if (!signature.valid) {
      throw new AppError(
        400,
        'invalid_signature',
        'A assinatura digital da nota não confere: o XML foi alterado ou não é o original do fornecedor.',
      );
    }
    const catalog = await this.catalogFor(ctx, nfe);
    return withTenant(this.db, ctx, async (tx) => {
      const { company, supplier, alreadyImported } = await this.analyze(tx, nfe);
      if (alreadyImported)
        throw new AppError(
          409,
          'already_imported',
          `A NF-e ${nfe.number} deste fornecedor já foi importada.`,
        );
      const [store] = await tx.select().from(stores).where(eq(stores.id, input.storeId));
      if (!store || store.companyId !== company.id) throw notFound('Loja desta empresa');
      assertStore(ctx, store.id);
      const decisions = new Map(input.items.map((d) => [d.line, d]));
      for (const item of nfe.items) {
        if (!decisions.has(item.line))
          throw new AppError(
            400,
            'validation',
            `Diga o que fazer com o item ${item.line} (${item.description}).`,
          );
      }

      // Fornecedor: o da nota, criado na primeira compra.
      let supplierId = supplier?.id;
      if (!supplierId) {
        supplierId = uuidv7();
        const a = nfe.supplier.address;
        await tx.insert(suppliers).values({
          id: supplierId,
          tenantId: ctx.tenantId,
          name: nfe.supplier.tradeName ?? nfe.supplier.name,
          taxId: nfe.supplier.cnpj ?? nfe.supplier.cpf ?? null,
          phone: a?.phone ?? null,
          address: a
            ? {
                cep: a.cep ?? '',
                street: a.street,
                number: a.number,
                complement: a.complement ?? null,
                district: a.district,
                city: a.cityName,
                uf: a.uf,
                ibgeCode: a.cityCode,
              }
            : null,
          notes: `Cadastrado pela importação da NF-e ${nfe.number}. Razão social: ${nfe.supplier.name}.`,
        });
      }

      const unitCodes = new Set(
        (await tx.select({ code: units.code }).from(units)).map((u) => u.code),
      );
      const lines: PurchaseInvoiceItem[] = [];
      const invoiceId = uuidv7();
      const now = new Date();
      for (const item of nfe.items) {
        const decision = decisions.get(item.line)!;
        const factor = decision.factor;
        const unitCostCents = purchaseUnitCostCents(item, factor);
        const quantityMilli = purchaseStockMilli(item, factor);
        let productId = decision.productId;
        let created = false;
        if (productId) {
          const [product] = await tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.id, productId));
          if (!product) throw notFound(`Produto do item ${item.line}`);
          await tx
            .update(products)
            .set({ costCents: unitCostCents, updatedAt: now })
            .where(eq(products.id, productId));
        } else {
          const unit = (decision.unit ?? item.unit).toUpperCase();
          if (!unitCodes.has(unit)) {
            throw new AppError(
              400,
              'validation',
              `A unidade ${unit} do item ${item.line} não está cadastrada. Escolha uma das suas unidades.`,
            );
          }
          await this.limits.assertCanAdd(tx, 'products');
          productId = uuidv7();
          created = true;
          // NCM ou CEST fora da tabela vigente não impedem a compra: o produto entra sem eles.
          const fiscal = { ncm: item.ncm, cest: item.cest ?? null };
          try {
            assertProductFiscal(fiscal);
          } catch {
            fiscal.ncm = '';
            fiscal.cest = null;
          }
          const known = item.gtin ? catalog.get(item.gtin) : undefined;
          const name = (decision.name ?? known?.description ?? item.description).slice(0, 120);
          await tx.insert(products).values({
            id: productId,
            tenantId: ctx.tenantId,
            name,
            catalog: known
              ? {
                  brand: known.brand ?? null,
                  manufacturer: known.manufacturer ?? null,
                  department: known.department ?? null,
                  category: known.category ?? null,
                  packageDescription: known.packageDescription ?? null,
                  content: known.content ?? null,
                  source: known.source ?? null,
                }
              : null,
            sku: null,
            unit,
            priceCents: decision.priceCents ?? unitCostCents,
            costCents: unitCostCents,
            ncm: fiscal.ncm || null,
            cest: fiscal.cest,
          });
          if (item.gtin) {
            const [taken] = await tx
              .select()
              .from(productBarcodes)
              .where(eq(productBarcodes.code, item.gtin));
            if (!taken)
              await tx
                .insert(productBarcodes)
                .values({ tenantId: ctx.tenantId, code: item.gtin, productId });
          }
          for (const pack of known?.packs ?? []) {
            await tx
              .insert(productPacks)
              .values({
                tenantId: ctx.tenantId,
                packGtin: pack.packGtin,
                productId,
                unitsPerPack: pack.unitsPerPack,
              })
              .onConflictDoNothing();
          }
          await this.contributions.enqueue(tx, ctx.tenantId, {
            barcodes: item.gtin ? [item.gtin] : [],
            name,
            unit,
            ncm: fiscal.ncm || null,
            cest: fiscal.cest,
            catalog: known
              ? {
                  brand: known.brand ?? null,
                  department: known.department ?? null,
                  packageDescription: known.packageDescription ?? null,
                }
              : null,
          });
        }
        // Na próxima nota deste fornecedor, o item já vem associado.
        await tx
          .insert(supplierProductCodes)
          .values({
            tenantId: ctx.tenantId,
            supplierId,
            supplierCode: item.supplierCode,
            productId,
            factor,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              supplierProductCodes.tenantId,
              supplierProductCodes.supplierId,
              supplierProductCodes.supplierCode,
            ],
            set: { productId, factor, updatedAt: now },
          });
        await tx.insert(stockMovements).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: store.id,
          productId,
          deltaMilli: quantityMilli,
          reason: 'purchase',
          refId: invoiceId,
          note: `NF-e ${nfe.number} série ${nfe.series}`,
          actorId: ctx.userId,
          occurredAt: now,
        });
        // Entrada fora do Confere: o custo novo vai às lojas vinculadas ao MercadoFlow.
        const [saved] = await tx.select().from(products).where(eq(products.id, productId));
        // Lote e validade (F5-04.b): o que o fornecedor informou no grupo rastro.
        if (saved!.tracksLot) {
          for (const lot of item.lots ?? []) {
            const lotMilli = purchaseLotMilli(lot, factor);
            if (lotMilli <= 0 || !lot.code) continue;
            await this.lots.register(
              ctx,
              {
                storeId: store.id,
                productId,
                lotCode: lot.code,
                expiresOn: lot.expiresOn || null,
                manufacturedOn: lot.manufacturedOn || null,
                quantityMilli: lotMilli,
                addsStock: false,
              },
              tx,
              'purchase',
              invoiceId,
            );
          }
        }
        const codes = await tx
          .select({ code: productBarcodes.code })
          .from(productBarcodes)
          .where(eq(productBarcodes.productId, productId));
        await this.marketSync.enqueueProduct(tx, ctx.tenantId, {
          ...saved!,
          catalog: saved!.catalog ?? null,
          barcodes: codes.map((c) => c.code),
        });
        lines.push({
          line: item.line,
          supplierCode: item.supplierCode,
          description: item.description,
          productId,
          factor,
          quantityMilli,
          unitCostCents,
          created,
          taxes: item.taxes,
        });
      }

      await tx.insert(purchaseInvoices).values({
        id: invoiceId,
        tenantId: ctx.tenantId,
        companyId: company.id,
        storeId: store.id,
        supplierId,
        accessKey: nfe.accessKey,
        number: nfe.number,
        series: nfe.series,
        issuedAt: new Date(nfe.issuedAt),
        totalCents: nfe.totalCents,
        authorized: !!nfe.protocol && ['100', '150'].includes(nfe.protocol.cStat),
        signatureValid: signature.valid,
        xml: input.xml,
        items: lines,
        importedBy: ctx.userId,
      });
      await this.audit.record(tx, ctx, {
        action: 'purchase.imported',
        entity: 'purchase_invoice',
        entityId: invoiceId,
        data: {
          accessKey: nfe.accessKey,
          supplier: nfe.supplier.name,
          totalCents: nfe.totalCents,
          items: lines.length,
          createdProducts: lines.filter((l) => l.created).length,
        },
      });
      return {
        id: invoiceId,
        items: lines.length,
        createdProducts: lines.filter((l) => l.created).length,
      };
    });
  }

  async list(ctx: RequestContext): Promise<PurchaseSummary[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          id: purchaseInvoices.id,
          accessKey: purchaseInvoices.accessKey,
          number: purchaseInvoices.number,
          series: purchaseInvoices.series,
          issuedAt: purchaseInvoices.issuedAt,
          totalCents: purchaseInvoices.totalCents,
          supplierName: suppliers.name,
          storeName: stores.name,
          authorized: purchaseInvoices.authorized,
          items: purchaseInvoices.items,
          createdAt: purchaseInvoices.createdAt,
        })
        .from(purchaseInvoices)
        .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
        .innerJoin(stores, eq(stores.id, purchaseInvoices.storeId))
        .where(storeCondition(ctx, purchaseInvoices.storeId))
        .orderBy(desc(purchaseInvoices.createdAt))
        .limit(100);
      return rows.map(({ items, issuedAt, createdAt, ...row }) => ({
        ...row,
        issuedAt: issuedAt.toISOString(),
        createdAt: createdAt.toISOString(),
        itemCount: items.length,
      }));
    });
  }
}
