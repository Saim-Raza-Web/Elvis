import mongoose from 'mongoose';
import Client from '../models/Client.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import ASN from '../models/ASN.js';
import Order from '../models/Order.js';
import PutawayTask from '../models/PutawayTask.js';
import PickTask from '../models/PickTask.js';
import ActivityLog from '../models/ActivityLog.js';

export async function runPhase4Cleanup(companyId, operatorEmail = 'system_admin') {
  const auditLogs = [];

  // ─────────────────────────────────────────────────────────────
  //  M2 CLEANUP: Remove Auto-generated 3PL Owners safely
  // ─────────────────────────────────────────────────────────────
  const ownerRegex = /^(Client|Audit)-3PL-.{10,}$/;
  const queryCompany = companyId ? { company: companyId } : {};
  const generatedClients = await Client.find({ ...queryCompany, name: ownerRegex });

  let cleanedOwnersCount = 0;
  let reattributedOwnersCount = 0;

  for (const client of generatedClients) {
    const ownerName = client.name;
    const cid = client.company;

    // Audit operational references
    const [asnCount, orderCount, invCount, putCount, pickCount] = await Promise.all([
      ASN.countDocuments({ company: cid, owner: ownerName }),
      Order.countDocuments({ company: cid, $or: [{ owner: ownerName }, { company_name: ownerName }] }),
      InventoryBalance.countDocuments({ company: cid, owner: ownerName }),
      PutawayTask.countDocuments({ company: cid, owner: ownerName }),
      PickTask.countDocuments({ company: cid, owner: ownerName }),
    ]);

    const totalRefs = asnCount + orderCount + invCount + putCount + pickCount;
    if (totalRefs > 0) {
      // Find or default to real client 'Apple Distribution 3PL'
      const fallbackClient = await Client.findOne({ company: cid, name: { $not: ownerRegex } }) || { name: 'Apple Distribution 3PL' };
      const fallbackName = fallbackClient.name;

      // Reassign operational records safely
      await Promise.all([
        ASN.updateMany({ company: cid, owner: ownerName }, { owner: fallbackName }),
        Order.updateMany({ company: cid, owner: ownerName }, { owner: fallbackName }),
        InventoryBalance.updateMany({ company: cid, owner: ownerName }, { owner: fallbackName }),
        PutawayTask.updateMany({ company: cid, owner: ownerName }, { owner: fallbackName }),
        PickTask.updateMany({ company: cid, owner: ownerName }, { owner: fallbackName }),
        InventoryTransaction.updateMany({ company: cid, owner: ownerName }, { owner: fallbackName })
      ]);

      await ActivityLog.create({
        logId: 'LOG-M2-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        user: operatorEmail,
        role: 'admin',
        action: 'M2_OWNER_MIGRATION',
        module: 'Settings/Clients',
        detail: `Migrated ${totalRefs} operational records from generated owner '${ownerName}' to '${fallbackName}' before deletion.`,
        timestamp: new Date(),
        company: cid
      });
      reattributedOwnersCount++;
    }

    await Client.findByIdAndDelete(client._id);
    cleanedOwnersCount++;
  }

  auditLogs.push(`M2 Owners Cleanup: Deleted ${cleanedOwnersCount} auto-generated owners (${reattributedOwnersCount} reattributed to legitimate 3PL clients).`);

  // ─────────────────────────────────────────────────────────────
  //  N1 CLEANUP: Consolidate Duplicate "Agua Cortés 1.5L" Products
  // ─────────────────────────────────────────────────────────────
  const targetCompany = companyId || (await Client.findOne())?.company;
  if (targetCompany) {
    // 1. Ensure Master Product exists
    let masterProduct = await Product.findOne({ company: targetCompany, sku: 'AGUA-COR-15L' });
    if (!masterProduct) {
      masterProduct = await Product.create({
        sku: 'AGUA-COR-15L',
        name: 'Agua Cortés 1.5L',
        category: 'BEVERAGE',
        unitBarcode: '8414807559838',
        price: 1.20,
        qty_available: 0,
        company: targetCompany
      });
    }

    // 2. Find duplicate Agua Cortés SKUs matching SKU-P3-178698* or name "Agua Cortés 1.5L"
    const duplicateProducts = await Product.find({
      company: targetCompany,
      sku: { $ne: 'AGUA-COR-15L' },
      $or: [
        { sku: { $regex: /^SKU-P3-178698/i } },
        { name: { $regex: /Agua Cortés/i } }
      ]
    });

    if (duplicateProducts.length > 0) {
      let totalQtyConsolidated = 0;
      const dupSkus = duplicateProducts.map(p => p.sku);

      for (const dup of duplicateProducts) {
        const dupBalances = await InventoryBalance.find({ company: targetCompany, sku: dup.sku });
        for (const bal of dupBalances) {
          const qty = bal.qtyAvailable || bal.qty_available || 0;
          if (qty > 0) {
            // Find or update matching balance on master SKU
            let masterBal = await InventoryBalance.findOne({
              company: targetCompany,
              sku: 'AGUA-COR-15L',
              bin: bal.bin,
              lotNumber: bal.lotNumber || 'DEFAULT-LOT'
            });

            if (masterBal) {
              masterBal.qtyAvailable = (masterBal.qtyAvailable || 0) + qty;
              await masterBal.save();
            } else {
              await InventoryBalance.create({
                company: targetCompany,
                warehouse: bal.warehouse || 'MIA',
                zone: bal.zone || 'Z-STORAGE',
                bin: bal.bin,
                sku: 'AGUA-COR-15L',
                owner: bal.owner || 'Apple Distribution 3PL',
                lotNumber: bal.lotNumber || 'DEFAULT-LOT',
                batchNumber: bal.batchNumber || '',
                expiryDate: bal.expiryDate,
                qtyAvailable: qty
              });
            }
            totalQtyConsolidated += qty;
          }
          await InventoryBalance.findByIdAndDelete(bal._id);
        }

        // Re-attribute transactions, ASNs, PutawayTasks, PickTasks
        await Promise.all([
          InventoryTransaction.updateMany({ company: targetCompany, sku: dup.sku }, { sku: 'AGUA-COR-15L' }),
          PutawayTask.updateMany({ company: targetCompany, sku: dup.sku }, { sku: 'AGUA-COR-15L', productName: 'Agua Cortés 1.5L' }),
          PickTask.updateMany({ company: targetCompany, sku: dup.sku }, { sku: 'AGUA-COR-15L', productName: 'Agua Cortés 1.5L' }),
          ASN.updateMany(
            { company: targetCompany, 'items.sku': dup.sku },
            { $set: { 'items.$[elem].sku': 'AGUA-COR-15L', 'items.$[elem].name': 'Agua Cortés 1.5L' } },
            { arrayFilters: [{ 'elem.sku': dup.sku }] }
          )
        ]);

        await Product.findByIdAndDelete(dup._id);
      }

      // Update Master Product available Qty
      const totalMasterBal = await InventoryBalance.aggregate([
        { $match: { company: targetCompany, sku: 'AGUA-COR-15L' } },
        { $group: { _id: null, total: { $sum: '$qtyAvailable' } } }
      ]);
      const newMasterQty = totalMasterBal[0]?.total || 0;
      masterProduct.qty_available = newMasterQty;
      await masterProduct.save();

      // Audit Record
      await ActivityLog.create({
        logId: 'LOG-N1-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        user: operatorEmail,
        role: 'admin',
        action: 'N1_DUPLICATE_CONSOLIDATION',
        module: 'Inventory',
        detail: `Consolidated ${duplicateProducts.length} duplicate Agua Cortés SKUs (${dupSkus.join(', ')}) into master SKU AGUA-COR-15L. Total stock moved: ${totalQtyConsolidated} units.`,
        timestamp: new Date(),
        company: targetCompany
      });

      auditLogs.push(`N1 Agua Cortés Cleanup: Consolidated ${duplicateProducts.length} duplicate SKUs into AGUA-COR-15L. ${totalQtyConsolidated} units consolidated.`);
    } else {
      auditLogs.push(`N1 Agua Cortés Cleanup: No duplicate SKUs found. Master SKU AGUA-COR-15L verified.`);
    }
  }

  return auditLogs;
}
