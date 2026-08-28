import express from 'express';
import Supplier from '../models/Supplier.js';
import ChartOfAccount from '../models/ChartOfAccount.js';
import SupplierBill from '../models/SupplierBill.js';
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

// Helper: Ensure parent supplier group exists (e.g. 400 & 400.000)
async function ensureSupplierGroupAccounts(companyId) {
  let root400 = await ChartOfAccount.findOne({ company: companyId, accountCode: '400' });
  if (!root400) {
    root400 = await ChartOfAccount.create({
      accountCode: '400',
      accountName: 'Suppliers',
      accountType: 'Liability',
      category: 'Accounts Payable',
      hierarchyLevel: 0,
      allowSubAccounts: true,
      isPostingAccount: false,
      company: companyId
    });
  }

  let group400000 = await ChartOfAccount.findOne({ company: companyId, accountCode: '400.000' });
  if (!group400000) {
    group400000 = await ChartOfAccount.create({
      accountCode: '400.000',
      accountName: 'Supplier Accounts Group',
      accountType: 'Liability',
      category: 'Accounts Payable',
      parentAccountId: root400._id,
      parentAccountCode: '400',
      hierarchyLevel: 1,
      allowSubAccounts: true,
      isPostingAccount: false,
      company: companyId
    });
  }

  return { root400, group400000 };
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

// POST create supplier
router.post('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

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

    if (!name || !name.trim()) return res.status(400).json({ message: 'Supplier name is required' });
    if (!country || !country.trim()) return res.status(400).json({ message: 'Country is required' });

    const existing = await Supplier.findOne({ company: req.user.company, name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: `Supplier '${name.trim()}' already exists.` });
    }

    const carrier = preferredCarrier || defaultCarrier || '';

    // Handle Ledger Account Creation or Linkage
    let assignedLedgerInfo = accountingInfo || {};
    let createdCoaId = null;

    if (createLedgerAccount || (!assignedLedgerInfo.accountCode && createLedgerAccount !== false)) {
      const { group400000 } = await ensureSupplierGroupAccounts(req.user.company);
      
      // Calculate next sub-account code under 400.000 (e.g. 400.000.001)
      const existingChildren = await ChartOfAccount.find({
        company: req.user.company,
        accountCode: { $regex: /^400\.000\.\d+$/ }
      }).sort({ accountCode: 1 });

      let maxSeq = 0;
      existingChildren.forEach(child => {
        const parts = child.accountCode.split('.');
        const seq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      });

      const nextCode = assignedLedgerInfo.accountCode || `400.000.${String(maxSeq + 1).padStart(3, '0')}`;
      const nextName = assignedLedgerInfo.accountName || name.trim();

      // Check if account already exists
      let coaDoc = await ChartOfAccount.findOne({ company: req.user.company, accountCode: nextCode });
      if (!coaDoc) {
        coaDoc = await ChartOfAccount.create({
          accountCode: nextCode,
          accountName: nextName,
          accountType: 'Liability',
          category: 'Accounts Payable',
          parentAccountId: group400000._id,
          parentAccountCode: '400.000',
          hierarchyLevel: 2,
          allowSubAccounts: false,
          isPostingAccount: true,
          company: req.user.company
        });
      }

      createdCoaId = coaDoc._id;
      assignedLedgerInfo = {
        ledgerAccountId: coaDoc._id,
        accountCode: coaDoc.accountCode,
        accountName: coaDoc.accountName
      };
    }

    const supplier = await Supplier.create({
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

    if (createdCoaId) {
      await ChartOfAccount.findByIdAndUpdate(createdCoaId, { supplierId: supplier._id });
    }

    res.status(201).json(supplier);
  } catch (err) {
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
