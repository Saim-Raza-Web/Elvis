import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import User from './models/User.js';
import Company from './models/Company.js';
import ChartOfAccount from './models/ChartOfAccount.js';

const STANDARD_SPANISH_PGC_FIXTURE = [
  { accountCode: "100", accountName: "Capital", accountType: "Equity", category: "Capital & Reserves", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "400", accountName: "Suppliers", accountType: "Liability", category: "Accounts Payable", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "400.000", accountName: "Supplier Accounts Group", accountType: "Liability", category: "Accounts Payable", parentAccountCode: "400", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "400.000.001", accountName: "Bag Supplier", accountType: "Liability", category: "Accounts Payable", parentAccountCode: "400.000", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "400.000.002", accountName: "Packaging Supplier", accountType: "Liability", category: "Accounts Payable", parentAccountCode: "400.000", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "410", accountName: "Creditors for Services", accountType: "Liability", category: "Accounts Payable", allowSubAccounts: true, isPostingAccount: true },
  { accountCode: "430", accountName: "Customers", accountType: "Asset", category: "Accounts Receivable", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "430.000.001", accountName: "Customer A", accountType: "Asset", category: "Accounts Receivable", parentAccountCode: "430", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "472", accountName: "Input VAT (Tax Deductible)", accountType: "Asset", category: "Tax Receivables", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "477", accountName: "Output VAT (Taxes Payable)", accountType: "Liability", category: "Tax Payables", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "572", accountName: "Bank Accounts", accountType: "Asset", category: "Cash & Cash Equivalents", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "572.000.001", accountName: "Banco Santander (Main Operating EUR)", accountType: "Asset", category: "Cash & Cash Equivalents", parentAccountCode: "572", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "600", accountName: "Purchases of Merchandise", accountType: "Expense", category: "Cost of Goods Sold", allowSubAccounts: true, isPostingAccount: true },
  { accountCode: "621", accountName: "Rent Expense", accountType: "Expense", category: "Operating Expense", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "628", accountName: "Utilities & Power", accountType: "Expense", category: "Operating Expense", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "624", accountName: "Logistics & Freight Expense", accountType: "Expense", category: "Operating Expense", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "700", accountName: "Sales Revenue", accountType: "Revenue", category: "Operating Revenue", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "700.000.001", accountName: "Product Sales", accountType: "Revenue", category: "Operating Revenue", parentAccountCode: "700", allowSubAccounts: false, isPostingAccount: true }
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('DB connected');

  const users = await User.find({}, 'email name role company');
  console.log('Users in DB:', users.map(u => ({ email: u.email, name: u.name, company: u.company })));

  const companies = await Company.find({}, 'name _id');
  console.log('Companies in DB:', companies.map(c => ({ id: c._id, name: c.name })));

  for (const c of companies) {
    const existingAccounts = await ChartOfAccount.countDocuments({ company: c._id });
    console.log(`Company "${c.name}" (${c._id}) has ${existingAccounts} chart of accounts.`);
    
    if (existingAccounts === 0) {
      console.log(`Seeding Spanish PGC accounts for "${c.name}"...`);
      const codeMap = {};
      for (const item of STANDARD_SPANISH_PGC_FIXTURE) {
        let parentId = null;
        let hierarchyLevel = 0;
        if (item.parentAccountCode && codeMap[item.parentAccountCode]) {
          parentId = codeMap[item.parentAccountCode]._id;
          hierarchyLevel = (codeMap[item.parentAccountCode].hierarchyLevel || 0) + 1;
        }

        const created = await ChartOfAccount.create({
          accountCode: item.accountCode,
          accountName: item.accountName,
          accountType: item.accountType,
          category: item.category,
          parentAccountId: parentId,
          parentAccountCode: item.parentAccountCode || '',
          hierarchyLevel,
          allowSubAccounts: item.allowSubAccounts !== undefined ? item.allowSubAccounts : true,
          isPostingAccount: item.isPostingAccount !== undefined ? item.isPostingAccount : true,
          company: c._id
        });
        codeMap[item.accountCode] = created;
      }
      console.log(`Successfully seeded ${STANDARD_SPANISH_PGC_FIXTURE.length} accounts for "${c.name}".`);
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
