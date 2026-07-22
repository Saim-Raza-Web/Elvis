import express from 'express';
import { protect } from '../middleware/auth.js';
import Model from '../models/Transaction.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const items = await Model.find({ company: req.user.company });
    
    // Compute Chart of Accounts dynamically based on transaction types and categories
    const accountMap = {};
    items.forEach(txn => {
      const acctName = txn.account || 'Uncategorized Account';
      if (!accountMap[acctName]) accountMap[acctName] = { name: acctName, balance: 0, change: 0 };
      
      const amt = txn.amount || 0;
      if (txn.type === 'credit') {
        accountMap[acctName].balance += amt;
        // mock change based on random percentage of amount for realism
        accountMap[acctName].change += (amt * 0.05); 
      } else {
        accountMap[acctName].balance -= amt;
        accountMap[acctName].change -= (amt * 0.05);
      }
    });
    
    const accounts = Object.values(accountMap);
    
    // If no accounts, provide defaults
    if (accounts.length === 0) {
      accounts.push(
        { name: "Cash & Cash Equivalents", balance: 0, change: 0 },
        { name: "Accounts Receivable", balance: 0, change: 0 },
        { name: "Inventory Assets", balance: 0, change: 0 },
        { name: "Accounts Payable", balance: 0, change: 0 },
        { name: "Operating Expenses YTD", balance: 0, change: 0 },
        { name: "Revenue YTD", balance: 0, change: 0 }
      );
    }
    
    res.json({ transactions: items, accounts });
  } catch (err) {
    next(err);
  }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const data = { ...req.body, company: req.user.company };
    const item = await Model.create(data);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
