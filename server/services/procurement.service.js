import Order from '../models/Order.js';
import InventoryBalance from '../models/InventoryBalance.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import SupplierProduct from '../models/SupplierProduct.js';
import Product from '../models/Product.js';

export async function evaluateOrderForProcurement(orderId, companyId) {
  try {
    const order = await Order.findOne({ _id: orderId, company: companyId });
    if (!order) return;

    if (order.order_type !== 'B2B') {
      console.log(`Procurement skipped for Order ${orderId} (type: ${order.order_type})`);
      return; // Only B2B orders trigger procurement
    }

    // Atomic Lock Acquisition
    const now = new Date();
    const lockExpiry = new Date(now.getTime() + 5 * 60 * 1000); // 5 minute lock
    const lockedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        company: companyId,
        $or: [
          { procurementStatus: 'NOT_REQUIRED' },
          { procurementStatus: 'ERROR' },
          { procurementStatus: 'PROCESSING', procurementLockExpiresAt: { $lt: now } }
        ]
      },
      {
        procurementStatus: 'PROCESSING',
        procurementLockExpiresAt: lockExpiry
      },
      { new: true }
    );

    if (!lockedOrder) {
      // Order is already being processed or has already been evaluated/procured
      console.log(`Procurement skipped or already locked for Order ${orderId}`);
      return;
    }

    const orderToProcess = lockedOrder;
    const newPurchaseOrders = [];

    // Group shortages by supplier to create consolidated POs
    const supplierPoMap = new Map(); // supplierId -> lines[]
    let hasUnassignedShortages = false;
    let procuredSomething = false;

    for (const line of orderToProcess.product_lines) {
      // 1. Determine Required Qty
      const requiredQty = line.qty;

      // 2. Check Available Usable Stock across all warehouses
      const balances = await InventoryBalance.find({ 
        company: companyId, 
        sku: line.sku 
      });
      const availableQty = balances.reduce((sum, b) => sum + (b.qtyAvailable || 0), 0);

      // 3. Check Outstanding Procurement
      const outstandingPos = await PurchaseOrder.find({
        company: companyId,
        status: { $in: ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] },
        'lines.sku': line.sku
      });
      
      let outstandingQty = 0;
      outstandingPos.forEach(po => {
        po.lines.forEach(poLine => {
          if (poLine.sku === line.sku) {
            outstandingQty += (poLine.quantityOrdered - poLine.quantityReceived);
          }
        });
      });

      // 4. Calculate True Shortage
      // shortage = max(0, ordered - available - outstanding)
      const shortage = Math.max(0, requiredQty - availableQty - outstandingQty);

      if (shortage > 0) {
        // 5. Lookup Product ID by SKU
        const product = await Product.findOne({ company: companyId, sku: line.sku });
        if (!product) {
          hasUnassignedShortages = true;
          console.warn(`Product not found for SKU ${line.sku}, cannot procure`);
          continue;
        }

        // 6. Select Supplier
        const supplierProducts = await SupplierProduct.find({ 
          company: companyId, 
          productId: product._id,
          active: true 
        }).sort({ isPreferred: -1, purchaseCost: 1 });

        let selectedSupplierProduct = supplierProducts.length > 0 ? supplierProducts[0] : null;

        if (!selectedSupplierProduct) {
          // No supplier assigned!
          hasUnassignedShortages = true;
          console.warn(`No active supplier found for SKU ${line.sku} to fulfill shortage of ${shortage}`);
          continue;
        }

        // 6. Apply MOQ
        const poQty = Math.max(shortage, selectedSupplierProduct.moq || 1);

        // 7. Add to PO grouping
        const supplierIdStr = selectedSupplierProduct.supplierId.toString();
        if (!supplierPoMap.has(supplierIdStr)) {
          supplierPoMap.set(supplierIdStr, {
            supplierId: selectedSupplierProduct.supplierId,
            currency: selectedSupplierProduct.currency || 'EUR',
            lines: []
          });
        }

        const supplierData = supplierPoMap.get(supplierIdStr);
        supplierData.lines.push({
          productId: selectedSupplierProduct.productId,
          sku: line.sku,
          supplierSku: selectedSupplierProduct.supplierSku,
          description: `Auto-procured for Sales Order ${orderToProcess.orderId}`,
          quantityOrdered: poQty,
          unitCost: selectedSupplierProduct.purchaseCost,
          taxRate: selectedSupplierProduct.taxRate || 21,
          lineSubtotal: parseFloat((poQty * selectedSupplierProduct.purchaseCost).toFixed(2)),
          taxAmount: parseFloat((poQty * selectedSupplierProduct.purchaseCost * ((selectedSupplierProduct.taxRate || 21) / 100)).toFixed(2)),
          lineTotal: parseFloat((poQty * selectedSupplierProduct.purchaseCost * (1 + (selectedSupplierProduct.taxRate || 21) / 100)).toFixed(2))
        });
        
        procuredSomething = true;
      }
    }

    // Generate actual POs
    if (procuredSomething) {
      for (const [supplierIdStr, poData] of supplierPoMap.entries()) {
        const poCount = await PurchaseOrder.countDocuments({ company: companyId });
        const poNumber = `PO-${new Date().getFullYear()}-${String(poCount + 1).padStart(5, '0')}`;
        
        const newPo = new PurchaseOrder({
          poNumber,
          company: companyId,
          supplierId: poData.supplierId,
          source: 'automatic_procurement',
          sourceOrderId: orderToProcess._id,
          status: 'DRAFT', // or CONFIRMED based on config
          currency: poData.currency,
          warehouse: orderToProcess.warehouse || 'MIA', // Default or inherit from SO
          notes: `Generated automatically for Order ${orderToProcess.orderId}`,
          lines: poData.lines
        });

        // pre-save hook will calculate totals
        await newPo.save();
        newPurchaseOrders.push(newPo._id);
      }
    }

    // Update Traceability on Order
    if (newPurchaseOrders.length > 0) {
      orderToProcess.linkedPurchaseOrders.push(...newPurchaseOrders);
      orderToProcess.procurementStatus = hasUnassignedShortages ? 'PARTIALLY_PROCURED' : 'PROCURED';
    } else if (hasUnassignedShortages) {
      orderToProcess.procurementStatus = 'ERROR'; // Indicates attention needed
    } else {
      orderToProcess.procurementStatus = 'NOT_REQUIRED';
    }

    orderToProcess.procurementLockExpiresAt = null;
    await orderToProcess.save();

  } catch (error) {
    console.error('Procurement Evaluation Error:', error);
    try {
      await Order.findByIdAndUpdate(orderId, {
        procurementStatus: 'ERROR',
        procurementLockExpiresAt: null
      });
    } catch (e) {
      console.error('Failed to rollback procurement status:', e);
    }
    // Do NOT throw error back to the caller, as this is an async background task. 
    // We don't want to roll back the B2B order!
  }
}
