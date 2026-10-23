import { X509Certificate } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  uuidv7,
  type CatalogProduct,
  type PurchasePreview,
  type PurchasePurpose,
  type PurchaseSummary,
  type purchaseImportInput,
} from '@bipae/domain';
import {
  fixedAssetCredit,
  purchaseLotMilli,
  purchaseNetLoad,
  purchaseStockMilli,
  purchaseUnitCostCents,
  readEfdDocument,
  readPurchaseNfe,
  PurchaseXmlError,
  type PurchaseNetLoad,
  type PurchaseNfe,
} from '@bipae/fiscal';
import { ICP_BRASIL_CERTIFICATES } from '@bipae/fiscal/icp-brasil';
import { recoverableTaxes } from '@bipae/fiscal/tables';
import { DOMParser } from '@xmldom/xmldom';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { SignedXml } from 'xml-crypto';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { assertStore, storeCondition } from '../../common/stores';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  ciapAssets,
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

/** Data de hoje no fuso de Brasília (AAAA-MM-DD): a data da entrada. */
const brasiliaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

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

  /**
   * ST de entrada pela carga líquida de um item (F3-26.d.CE.c): CNAE principal e RET da empresa,
   * classe da mercadoria e CEST do produto. Qualquer erro vira "sem cálculo": nunca impede a compra.
   */
  private async netLoadOf(
    tx: Tx,
    company: typeof companies.$inferSelect,
    nfe: PurchaseNfe,
    item: PurchaseNfe['items'][number],
    productId: string | null | undefined,
  ): Promise<PurchaseNetLoad | null> {
    if (!company.cnae || !company.uf) return null;
    try {
      let goodsClass: string | null = null;
      let cest = item.cest ?? null;
      if (productId) {
        const [product] = await tx
          .select({ stNetLoadClass: products.stNetLoadClass, cest: products.cest })
          .from(products)
          .where(eq(products.id, productId));
        goodsClass = product?.stNetLoadClass ?? null;
        cest = product?.cest ?? cest;
      }
      return purchaseNetLoad({
        company: {
          uf: company.uf,
          cnae: company.cnae,
          regime: company.taxRegime,
          specialRegime: company.stSpecialRegime,
          taxId: company.taxId,
        },
        nfe,
        item,
        goodsClass,
        cest,
        date: brasiliaToday(),
      });
    } catch {
      return null;
    }
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
      const netLoads: (PurchaseNetLoad | null)[] = [];
      for (const [i, item] of nfe.items.entries()) {
        netLoads.push(await this.netLoadOf(tx, company, nfe, item, suggestions[i]?.productId));
      }
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
          netLoad: netLoads[i] ?? null,
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
      // Créditos recuperáveis do regime da empresa saem do custo (RIR/2018, art. 301, § 3º; D-024).
      const recoverable = recoverableTaxes(company.taxRegime);
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
        // ST de entrada pela carga líquida (F3-26.d.CE.c): sem crédito para quem recolhe (art. 8º
        // dos decretos), então entra no custo como a ST retida pelo fornecedor.
        const netLoad = await this.netLoadOf(tx, company, nfe, item, decision.productId);
        const unitCostCents = purchaseUnitCostCents(
          { ...item, stCents: item.stCents + (netLoad?.stCents ?? 0) },
          factor,
          recoverable,
        );
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
            const lotMilli = purchaseLotMilli(lot, factor, item);
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
          ...(netLoad && { netLoad }),
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
      const netLoadCents = lines.reduce((sum, l) => sum + (l.netLoad?.stCents ?? 0), 0);
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
          ...(netLoadCents > 0 && { stNetLoadCents: netLoadCents }),
        },
      });
      return {
        id: invoiceId,
        items: lines.length,
        createdProducts: lines.filter((l) => l.created).length,
        /** ST de entrada pela carga líquida somada nos itens (F3-26.d.CE.c). */
        stNetLoadCents: netLoadCents,
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
          personalUse: purchaseInvoices.personalUse,
          purpose: purchaseInvoices.purpose,
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

  /**
   * Marca a nota como uso ou consumo pessoal (LC 214/2025, art. 57): o IBS e a CBS dela saem do
   * crédito na apuração (art. 47, caput). É alteração fiscal, então fica na auditoria.
   */
  async setPersonalUse(ctx: RequestContext, id: string, personalUse: boolean) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({ storeId: purchaseInvoices.storeId, personalUse: purchaseInvoices.personalUse })
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, id));
      if (!row) throw notFound('Nota de compra');
      assertStore(ctx, row.storeId);
      if (row.personalUse !== personalUse) {
        await tx.update(purchaseInvoices).set({ personalUse }).where(eq(purchaseInvoices.id, id));
        await this.audit.record(tx, ctx, {
          action: 'purchase.personal_use',
          entity: 'purchase_invoice',
          entityId: id,
          data: { from: row.personalUse, to: personalUse },
        });
      }
      return { id, personalUse };
    });
  }

  /**
   * Finalidade da compra (F4-14.b.2): muda o CFOP de entrada e o crédito do ICMS da nota no
   * arquivo da EFD. É alteração fiscal, então fica na auditoria.
   */
  async setPurpose(ctx: RequestContext, id: string, purpose: PurchasePurpose) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({
          storeId: purchaseInvoices.storeId,
          companyId: purchaseInvoices.companyId,
          purpose: purchaseInvoices.purpose,
          xml: purchaseInvoices.xml,
          createdAt: purchaseInvoices.createdAt,
        })
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, id));
      if (!row) throw notFound('Nota de compra');
      assertStore(ctx, row.storeId);
      if (row.purpose !== purpose) {
        if (row.purpose === 'fixed_asset') await this.dropAssets(tx, id);
        await tx.update(purchaseInvoices).set({ purpose }).where(eq(purchaseInvoices.id, id));
        const assets =
          purpose === 'fixed_asset' ? await this.createAssets(tx, ctx, { id, ...row }) : 0;
        await this.audit.record(tx, ctx, {
          action: 'purchase.purpose',
          entity: 'purchase_invoice',
          entityId: id,
          data: { from: row.purpose, to: purpose, ...(assets > 0 && { ciapAssets: assets }) },
        });
      }
      return { id, purpose };
    });
  }

  /**
   * Compra para o ativo (F4-14.b.7): cada item vira um bem no CIAP, com o ICMS que dá crédito em
   * 48 parcelas (`fixedAssetCredit`, LC 87/1996, art. 20, § 5º). A entrada é o dia em que a nota
   * entrou na empresa (Brasília), o mesmo que decide o mês da compra no arquivo da EFD.
   */
  private async createAssets(
    tx: Tx,
    ctx: RequestContext,
    invoice: { id: string; companyId: string; xml: string; createdAt: Date },
  ): Promise<number> {
    const [company] = await tx
      .select({ taxRegime: companies.taxRegime })
      .from(companies)
      .where(eq(companies.id, invoice.companyId));
    const simples = company?.taxRegime === 'simples' || company?.taxRegime === 'mei';
    const document = readEfdDocument(invoice.xml);
    const enteredOn = new Date(invoice.createdAt.getTime() - 3 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const rows = document.items
      .map((item) => ({ item, icms: fixedAssetCredit(item, simples) }))
      .filter(({ icms }) => icms.ownCents + icms.stCents > 0)
      .map(({ item, icms }) => ({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId: invoice.companyId,
        purchaseInvoiceId: invoice.id,
        itemLine: item.line,
        code: `${document.accessKey}-${item.line}`,
        description: item.description || `Item ${item.line} da nota ${document.number}`,
        enteredOn,
        icmsOwnCents: icms.ownCents,
        icmsStCents: icms.stCents,
      }));
    if (rows.length > 0) await tx.insert(ciapAssets).values(rows).onConflictDoNothing();
    return rows.length;
  }

  /** Desfaz os bens da compra; bem que já teve parcela num arquivo baixado não sai assim. */
  private async dropAssets(tx: Tx, invoiceId: string) {
    const [used] = await tx
      .select({ id: ciapAssets.id })
      .from(ciapAssets)
      .where(
        and(
          eq(ciapAssets.purchaseInvoiceId, invoiceId),
          gt(ciapAssets.appropriatedInstallments, 0),
        ),
      )
      .limit(1);
    if (used) {
      throw new AppError(
        422,
        'ciap_in_use',
        'Esta compra já tem crédito do ativo (CIAP) em arquivo do SPED baixado, então a finalidade não muda mais. A baixa do bem pela tela chega em breve; até lá, combine com o contador.',
      );
    }
    await tx.delete(ciapAssets).where(eq(ciapAssets.purchaseInvoiceId, invoiceId));
  }
}
