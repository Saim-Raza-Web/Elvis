import mongoose from 'mongoose';

const chartOfAccountSchema = new mongoose.Schema({
  accountCode: { 
    type: String, 
    required: true, 
    trim: true 
  }, // e.g. "400", "400.000", "400.000.001" - string preserves dots and leading zeros
  accountName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  accountType: {
    type: String,
    required: true,
    enum: ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'],
    default: 'Asset'
  },
  category: { 
    type: String, 
    default: 'General', 
    trim: true 
  }, // e.g. "Current Asset", "Accounts Payable", "Operating Expense"
  parentAccountId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ChartOfAccount', 
    default: null 
  },
  parentAccountCode: { 
    type: String, 
    default: '', 
    trim: true 
  },
  hierarchyLevel: { 
    type: Number, 
    default: 0 
  }, // 0 = Root (e.g. 400), 1 = Group (e.g. 400.000), 2 = Leaf (e.g. 400.000.001)
  allowSubAccounts: { 
    type: Boolean, 
    default: true 
  },
  isPostingAccount: { 
    type: Boolean, 
    default: true 
  }, // true = can receive journal/bill entries; false = grouping/header account only
  supplierId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Supplier', 
    default: null 
  },
  active: { 
    type: Boolean, 
    default: true 
  },
  description: { 
    type: String, 
    default: '', 
    trim: true 
  },
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true 
  }
}, { timestamps: true });

// Compound unique index per company + accountCode
chartOfAccountSchema.index({ company: 1, accountCode: 1 }, { unique: true });
chartOfAccountSchema.index({ company: 1, parentAccountId: 1 });
chartOfAccountSchema.index({ company: 1, accountType: 1 });
chartOfAccountSchema.index({ company: 1, isPostingAccount: 1 });
chartOfAccountSchema.index({ company: 1, supplierId: 1 });

export default mongoose.model('ChartOfAccount', chartOfAccountSchema);
