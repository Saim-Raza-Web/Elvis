import express from 'express';
import Supplier from '../models/Supplier.js';
import ChartOfAccount from '../models/ChartOfAccount.js';
import SupplierBill from '../models/SupplierBill.js';
import SupplierProduct from '../models/SupplierProduct.js';
import Product from '../models/Product.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';
import mongoose from 'mongoose';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

const DEFAULT_SUPPLIERS = [
  { 
    name: 'Acme Global Suppliers', 
    supplierType: 'Vendor',
    taxId: 'B87654321', 
    country: 'Spain', 
    contact: 'Carlos Rodriguez', 
    email: 'carlos@acmeglobal.es', 
    phone: '+34 912 345 678',
    website: 'https://www.acmeglobal.es',
    defaultCarrier: 'DHL Express', 
    preferredCarrier: 'DHL Express', 
    leadTime: 7,
    paymentInfo: { defaultPaymentTerms: 'Net 30', bankName: 'Banco Santander', iban: 'ES9121000418450200051332', swiftBic: 'BSCHESMMXXX' },
    accountingInfo: { accountCode: '400.000.001', accountName: 'Acme Global Suppliers' }
  },
  { 
    name: 'TechParts International', 
    supplierType: 'Manufacturer',
    taxId: 'DE123456789', 
    country: 'Germany', 
    contact: 'Hans Schmidt', 
    email: 'hans@techparts.de', 
    phone: '+49 30 1234567',
    website: 'https://www.techparts.de',
    defaultCarrier: 'FedEx', 
    preferredCarrier: 'FedEx', 
    leadTime: 10,
    paymentInfo: { defaultPaymentTerms: 'Net 60', bankName: 'Deutsche Bank', iban: 'DE89370400440532013000', swiftBic: 'DEUTDEDBFXX' },
    accountingInfo: { accountCode: '400.000.002', accountName: 'TechParts International' }
  },
  { 
    name: 'Logistics Direct SA', 
    supplierType: 'Logistics / Carrier',
    taxId: 'FR987654321', 
    country: 'France', 
    contact: 'Jean Dupont', 
    email: 'jean@logisticsdirect.fr', 
    phone: '+33 1 42685500',
    website: 'https://www.logisticsdirect.fr',
    defaultCarrier: 'SEUR', 
    preferredCarrier: 'SEUR', 
    leadTime: 5,
    paymentInfo: { defaultPaymentTerms: 'Net 15', bankName: 'BNP Paribas', iban: 'FR7630004013370001234567890', swiftBic: 'BNPAFR22XXX' },
    accountingInfo: { accountCode: '400.000.003', accountName: 'Logistics Direct SA' }
  }
];

// Helper: Ensure parent supplier group exists dynamically based on config
async function ensureSupplierGroupAccounts(companyId) {
  let config = await CompanyAccountingConfig.findOne({ company: companyId });
  if (!config) {
    config = await CompanyAccountingConfig.create({ company: companyId });
  }

  // Resolve base 400 account
  let root400 = null;
  if (config.defaultAccountsPayableAccountId) {
    root400 = await ChartOfAccount.findOne({ _id: config.defaultAccountsPayableAccountId, company: companyId });
  }

  // Fallback to searching or creating 400
  if (!root400) {
    root400 = await ChartOfAccount.findOne({ company: companyId, accountCode: config.defaultAccountsPayableAccountCode || '400' });
    if (!root400) {
      root400 = await ChartOfAccount.create({
        accountCode: config.defaultAccountsPayableAccountCode || '400',
        accountName: config.defaultAccountsPayableAccountName || 'Suppliers',
        accountType: 'Liability',
        category: 'Accounts Payable',
        hierarchyLevel: 0,
        allowSubAccounts: true,
        isPostingAccount: false,
        company: companyId
      });
    }
    // Link it back to config
    config.defaultAccountsPayableAccountId = root400._id;
    await config.save();
  }

  const baseCode = root400.accountCode; // e.g. "400"
  const groupCode = `${baseCode}.000`;  // e.g. "400.000"

  let group400000 = await ChartOfAccount.findOne({ company: companyId, accountCode: groupCode });
  if (!group400000) {
    group400000 = await ChartOfAccount.create({
      accountCode: groupCode,
      accountName: 'Supplier Accounts Group',
      accountType: 'Liability',
      category: 'Accounts Payable',
      parentAccountId: root400._id,
      parentAccountCode: baseCode,
      hierarchyLevel: 1,
      allowSubAccounts: true,
      isPostingAccount: false,
      company: companyId
    });
  }

  return { root400, group400000, baseCode, groupCode };
}

// GET all suppliers
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    let suppliers = await Supplier.find({ company: req.user.company }).sort({ name: 1 });

    if (suppliers.length === 0) {
      const seedData = DEFAULT_SUPPLIERS.map(s => ({ ...s, company: req.user.company }));
      try {
        await Supplier.insertMany(seedData, { ordered: false });
        suppliers = await Supplier.find({ company: req.user.company }).sort({ name: 1 });
      } catch (_) {
        suppliers = await Supplier.find({ company: req.user.company }).sort({ name: 1 });
      }
    }

    res.json(suppliers);
  } catch (err) {
    next(err);
  }
});

// GET supplier by ID with detailed profile metrics
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const supplier = await Supplier.findOne({ _id: req.params.id, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    // Compute bill metrics
    const bills = await SupplierBill.find({ supplierId: supplier._id, company: req.user.company });
    let totalBilled = 0;
    let totalPaid = 0;
    let outstanding = 0;
    bills.forEach(b => {
      if (b.status !== 'reversed') {
        totalBilled += b.grandTotal || 0;
        totalPaid += b.amountPaid || 0;
        outstanding += b.outstandingAmount || 0;
      }
    });

    res.json({
      ...supplier.toObject(),
      metrics: {
        totalBills: bills.length,
        totalBilled: Math.round(totalBilled * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        outstandingBalance: Math.round(outstanding * 100) / 100
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET supplier products
router.get('/:id/products', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const products = await SupplierProduct.find({ supplierId: req.params.id, company: req.user.company })
      .populate('productId', 'name sku barcode');
    res.json(products);
  } catch (err) {
    next(err);
  }
});

// POST add a product to a supplier
router.post('/:id/products', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const { productId, supplierSku, supplierProductName, purchaseCost, currency, moq, leadTimeDays, isPreferred, taxRate } = req.body;
    
    if (!productId || !supplierSku || purchaseCost === undefined) {
      return res.status(400).json({ message: 'productId, supplierSku, and purchaseCost are required' });
    }

    const supplier = await Supplier.findOne({ _id: req.params.id, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    const product = await Product.findOne({ _id: productId, company: req.user.company });
    if (!product) return res.status(404).json({ message: 'Product not found in this company' });

    // Check if mapping already exists
    let mapping = await SupplierProduct.findOne({ supplierId: supplier._id, productId: product._id, company: req.user.company });
    if (mapping) {
      return res.status(400).json({ message: 'Product is already mapped to this supplier' });
    }

    // If this is set as preferred, unset preferred for this product on other suppliers
    if (isPreferred) {
      await SupplierProduct.updateMany(
        { productId: product._id, company: req.user.company, supplierId: { $ne: supplier._id } },
        { isPreferred: false }
      );
    }

    mapping = new SupplierProduct({
      company: req.user.company,
      supplierId: supplier._id,
      productId: product._id,
      supplierSku,
      supplierProductName: supplierProductName || '',
      purchaseCost,
      currency: currency || 'EUR',
      moq: moq || 1,
      leadTimeDays: leadTimeDays || 7,
      isPreferred: Boolean(isPreferred),
      taxRate: taxRate !== undefined ? taxRate : 21
    });

    await mapping.save();
    
    // Populate before return
    await mapping.populate('productId', 'name sku barcode');
    res.status(201).json(mapping);
  } catch (err) {
    next(err);
  }
});

// PUT update a supplier product mapping
router.put('/:id/products/:mappingId', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const mapping = await SupplierProduct.findOne({ _id: req.params.mappingId, supplierId: req.params.id, company: req.user.company });
    if (!mapping) return res.status(404).json({ message: 'Supplier product mapping not found' });

    const { supplierSku, supplierProductName, purchaseCost, currency, moq, leadTimeDays, isPreferred, active, taxRate } = req.body;

    if (supplierSku !== undefined) mapping.supplierSku = supplierSku;
    if (supplierProductName !== undefined) mapping.supplierProductName = supplierProductName;
    if (purchaseCost !== undefined) mapping.purchaseCost = purchaseCost;
    if (currency !== undefined) mapping.currency = currency;
    if (moq !== undefined) mapping.moq = moq;
    if (leadTimeDays !== undefined) mapping.leadTimeDays = leadTimeDays;
    if (taxRate !== undefined) mapping.taxRate = taxRate;
    if (active !== undefined) mapping.active = active;

    if (isPreferred !== undefined) {
      mapping.isPreferred = isPreferred;
      if (isPreferred) {
        // unset others
        await SupplierProduct.updateMany(
          { productId: mapping.productId, company: req.user.company, _id: { $ne: mapping._id } },
          { isPreferred: false }
        );
      }
    }

    await mapping.save();
    await mapping.populate('productId', 'name sku barcode');
    res.json(mapping);
  } catch (err) {
    next(err);
  }
});

// DELETE supplier product mapping
router.delete('/:id/products/:mappingId', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const mapping = await SupplierProduct.findOneAndDelete({ _id: req.params.mappingId, supplierId: req.params.id, company: req.user.company });
    if (!mapping) return res.status(404).json({ message: 'Mapping not found' });
    res.json({ message: 'Supplier product mapping deleted' });
  } catch (err) {
    next(err);
  }
});

// POST create supplier
router.post('/', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const {
      name,
      supplierType,
      contact,
      email,
      phone,
      website,
      taxId,
      country,
      taxRegistrationNotes,
      billingAddress,
      shippingAddress,
      paymentInfo,
      accountingInfo,
      createLedgerAccount,
      defaultCarrier,
      preferredCarrier,
      preferredForOwner,
      leadTime,
      notes,
      active
    } = req.body;

    if (!name || !name.trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Supplier name is required' });
    }
    if (!country || !country.trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Country is required' });
    }

    const existing = await Supplier.findOne({ company: req.user.company, name: name.trim() }).session(session);
    if (existing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Supplier '${name.trim()}' already exists.` });
    }

    const carrier = preferredCarrier || defaultCarrier || '';

    // Handle Ledger Account Creation or Linkage
    let assignedLedgerInfo = accountingInfo || {};
    let createdCoaId = null;

    if (createLedgerAccount || (!assignedLedgerInfo.accountCode && createLedgerAccount !== false)) {
      const { group400000, groupCode } = await ensureSupplierGroupAccounts(req.user.company);
      
      // Calculate next sub-account code under 400.000 (e.g. 400.000.001)
      // Escape groupCode for regex to avoid treating dots as wildcards
      const escapedGroupCode = groupCode.replace(/\./g, '\\.');
      const regexPattern = new RegExp(`^${escapedGroupCode}\\.\\d+$`);
      
      const existingChildren = await ChartOfAccount.find({
        company: req.user.company,
        accountCode: { $regex: regexPattern }
      }).session(session).sort({ accountCode: 1 });

      let maxSeq = 0;
      existingChildren.forEach(child => {
        const parts = child.accountCode.split('.');
        const seq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      });

      const nextCode = assignedLedgerInfo.accountCode || `${groupCode}.${String(maxSeq + 1).padStart(3, '0')}`;
      const nextName = assignedLedgerInfo.accountName || name.trim();

      // Check if account already exists (race condition protection)
      let coaDoc = await ChartOfAccount.findOne({ company: req.user.company, accountCode: nextCode }).session(session);
      if (!coaDoc) {
        try {
          const newCoa = new ChartOfAccount({
            accountCode: nextCode,
            accountName: nextName,
            accountType: 'Liability',
            category: 'Accounts Payable',
            parentAccountId: group400000._id,
            parentAccountCode: groupCode,
            hierarchyLevel: 2,
            allowSubAccounts: false,
            isPostingAccount: true,
            company: req.user.company
          });
          coaDoc = await newCoa.save({ session });
        } catch (dbErr) {
          if (dbErr.code === 11000) {
             // Race condition on unique account code. Throw explicit error to tell client to retry.
             await session.abortTransaction();
             session.endSession();
             return res.status(409).json({ message: 'Concurrent supplier creation detected. Please retry.', code: 'RACE_CONDITION' });
          }
          throw dbErr;
        }
      }

      createdCoaId = coaDoc._id;
      assignedLedgerInfo = {
        ledgerAccountId: coaDoc._id,
        accountCode: coaDoc.accountCode,
        accountName: coaDoc.accountName
      };
    }

    const newSupplier = new Supplier({
      name: name.trim(),
      supplierType: supplierType || 'Vendor',
      contact: contact || '',
      email: email || '',
      phone: phone || '',
      website: website || '',
      taxId: taxId || '',
      country: country.trim(),
      taxRegistrationNotes: taxRegistrationNotes || '',
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      paymentInfo: paymentInfo || { defaultPaymentTerms: 'Net 30' },
      accountingInfo: assignedLedgerInfo,
      defaultCarrier: carrier,
      preferredCarrier: carrier,
      preferredForOwner: preferredForOwner || '',
      leadTime: Number(leadTime) || 7,
      notes: notes || '',
      active: active !== undefined ? Boolean(active) : true,
      company: req.user.company
    });

    const supplier = await newSupplier.save({ session });

    if (createdCoaId) {
      await ChartOfAccount.findByIdAndUpdate(createdCoaId, { supplierId: supplier._id }, { session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json(supplier);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// PUT update supplier
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const supplier = await Supplier.findOne({ _id: req.params.id, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    const {
      name,
      supplierType,
      contact,
      email,
      phone,
      website,
      taxId,
      country,
      taxRegistrationNotes,
      billingAddress,
      shippingAddress,
      paymentInfo,
      accountingInfo,
      defaultCarrier,
      preferredCarrier,
      preferredForOwner,
      leadTime,
      notes,
      active
    } = req.body;

    if (name && name.trim() !== supplier.name) {
      const existing = await Supplier.findOne({ company: req.user.company, name: name.trim(), _id: { $ne: supplier._id } });
      if (existing) return res.status(400).json({ message: `Supplier '${name.trim()}' already exists.` });
      supplier.name = name.trim();
    }

    if (supplierType !== undefined) supplier.supplierType = supplierType;
    if (contact !== undefined) supplier.contact = contact;
    if (email !== undefined) supplier.email = email;
    if (phone !== undefined) supplier.phone = phone;
    if (website !== undefined) supplier.website = website;
    if (taxId !== undefined) supplier.taxId = taxId;
    if (country !== undefined) supplier.country = country;
    if (taxRegistrationNotes !== undefined) supplier.taxRegistrationNotes = taxRegistrationNotes;
    if (billingAddress !== undefined) supplier.billingAddress = billingAddress;
    if (shippingAddress !== undefined) supplier.shippingAddress = shippingAddress;
    if (paymentInfo !== undefined) supplier.paymentInfo = { ...supplier.paymentInfo, ...paymentInfo };
    
    if (accountingInfo !== undefined) {
      supplier.accountingInfo = accountingInfo;
      // If a ledger account is linked, update the ChartOfAccount supplier ref
      if (accountingInfo.ledgerAccountId) {
        await ChartOfAccount.findByIdAndUpdate(accountingInfo.ledgerAccountId, { supplierId: supplier._id });
      }
    }

    if (preferredCarrier !== undefined || defaultCarrier !== undefined) {
      const c = preferredCarrier || defaultCarrier || '';
      supplier.preferredCarrier = c;
      supplier.defaultCarrier = c;
    }
    if (preferredForOwner !== undefined) supplier.preferredForOwner = preferredForOwner;
    if (leadTime !== undefined) supplier.leadTime = Number(leadTime);
    if (notes !== undefined) supplier.notes = notes;
    if (active !== undefined) supplier.active = Boolean(active);

    await supplier.save();
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

// DELETE supplier
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    // Protect supplier from deletion if active posted bills exist
    const billsCount = await SupplierBill.countDocuments({ supplierId: req.params.id, company: req.user.company, status: { $ne: 'reversed' } });
    if (billsCount > 0) {
      return res.status(400).json({ message: `Cannot delete supplier because ${billsCount} active bills are associated with this profile. Archive the supplier instead.` });
    }

    const supplier = await Supplier.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    res.json({ message: `Supplier '${supplier.name}' deleted successfully` });
  } catch (err) {
    next(err);
  }
});

export default router;
