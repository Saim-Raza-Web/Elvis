import mongoose from 'mongoose';

const chartOfAccountImportLogSchema = new mongoose.Schema({
  importId: { 
    type: String, 
    required: true 
  }, // e.g. "COA-IMP-2026-0001"
  fileName: { 
    type: String, 
    default: 'chart_of_accounts.xlsx' 
  },
  importMode: { 
    type: String, 
    enum: ['create_new_only', 'update_existing', 'dry_run'], 
    default: 'create_new_only' 
  },
  totalRows: { 
    type: Number, 
    default: 0 
  },
  createdCount: { 
    type: Number, 
    default: 0 
  },
  updatedCount: { 
    type: Number, 
    default: 0 
  },
  skippedCount: { 
    type: Number, 
    default: 0 
  },
  failedCount: { 
    type: Number, 
    default: 0 
  },
  errorDetails: [{
    rowNumber: Number,
    accountCode: String,
    reason: String
  }],
  importedBy: { 
    type: String, 
    default: 'System' 
  },
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true 
  }
}, { timestamps: true });

chartOfAccountImportLogSchema.index({ company: 1, createdAt: -1 });

export default mongoose.model('ChartOfAccountImportLog', chartOfAccountImportLogSchema);
