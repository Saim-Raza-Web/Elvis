import mongoose from 'mongoose';

const complianceConfigSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  
  verifactuEnabled: { type: Boolean, default: false },
  siiEnabled: { type: Boolean, default: false },
  
  // Encrypted Certificate data
  certificatePfxEncrypted: { type: String, default: null }, // Base64 encoded encrypted string
  certificatePasswordEncrypted: { type: String, default: null }, // Base64 encoded encrypted string
  
  // Initialization Vector for this specific record's encryption
  encryptionIv: { type: String, default: null },
  
  certificateExpiry: { type: Date, default: null },
  certificateSubject: { type: String, default: null }
}, { timestamps: true });

export default mongoose.model('ComplianceConfig', complianceConfigSchema);
