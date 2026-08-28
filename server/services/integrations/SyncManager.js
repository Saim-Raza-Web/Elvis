import ConnectedStore from '../../models/ConnectedStore.js';
import IntegrationSyncLog from '../../models/IntegrationSyncLog.js';
import Product from '../../models/Product.js';
import Order from '../../models/Order.js';
import Customer from '../../models/Customer.js';
import { providerRegistry } from './ProviderRegistry.js';

const SYNC_LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes lock expiration

export class SyncManager {
  /**
   * Acquires a concurrency lock on a ConnectedStore document.
   * Prevents simultaneous duplicate sync jobs.
   */
  static async acquireLock(storeId, companyId) {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() + SYNC_LOCK_TIMEOUT_MS);

    const store = await ConnectedStore.findOneAndUpdate(
      {
        _id: storeId,
        company: companyId,
        $or: [
          { isSyncing: false },
          { isSyncing: true, syncLockExpiresAt: { $lt: now } } // Take over expired lock
        ]
      },
      {
        isSyncing: true,
        syncLockExpiresAt: lockExpiry,
        status: 'syncing'
      },
      { new: true }
    );

    return store;
  }

  /**
   * Releases concurrency lock on ConnectedStore.
   */
  static async releaseLock(storeId, finalStatus = 'connected', lastError = '') {
    await ConnectedStore.findByIdAndUpdate(storeId, {
      isSyncing: false,
      syncLockExpiresAt: null,
      status: finalStatus,
      lastSyncAt: new Date(),
      ...(finalStatus === 'connected' ? { lastSuccessfulSyncAt: new Date(), lastError: '' } : { lastError })
    });
  }

  /**
   * Executes a full or selective synchronization for a store.
   * @param {string} storeId - Store MongoDB ObjectId
   * @param {string} companyId - Tenant Company ObjectId
   * @param {object} options - { syncType: 'full'|'product'|'order'|'inventory', trigger: 'manual'|'scheduled'|'webhook' }
   */
  static async runSync(storeId, companyId, options = {}) {
    const syncType = options.syncType || 'full';
    const trigger = options.trigger || 'manual';
    const startTime = Date.now();

    // 1. Acquire Concurrency Lock
    const store = await this.acquireLock(storeId, companyId);
    if (!store) {
      throw new Error(`Store is currently syncing or locked. Simultaneous duplicate sync prevented.`);
    }

    // 2. Initialize Audit Log
    const syncLog = await IntegrationSyncLog.create({
      company: companyId,
      connectedStore: storeId,
      provider: store.provider,
      syncType,
      trigger,
      status: 'started',
      startedAt: new Date()
    });

    let recordsProcessed = 0;
    let recordsCreated = 0;
    let recordsUpdated = 0;
    let recordsFailed = 0;
    const errorDetails = [];

    try {
      const provider = providerRegistry.get(store.provider);
      const settings = store.syncSettings || {};

      // ── A. PRODUCT SYNCHRONIZATION ─────────────────────────────────
      if ((syncType === 'full' || syncType === 'product') && settings.syncProducts !== false) {
        try {
          const externalProducts = await provider.fetchProducts(store);
          for (const extItem of externalProducts) {
            recordsProcessed++;
            try {
              if (!extItem.sku) {
                recordsFailed++;
                errorDetails.push({ item: extItem.name || 'Unknown Product', reason: 'Missing SKU' });
                continue;
              }

              // Match against internal product catalog by tenant + SKU
              let internalProduct = await Product.findOne({ company: companyId, sku: extItem.sku });

              if (internalProduct) {
                // Update existing product without overwriting manual custom fields
                internalProduct.price = extItem.price !== undefined ? extItem.price : internalProduct.price;
                if (settings.inventoryDirection === 'store_to_wms') {
                  internalProduct.qty_available = extItem.quantity || 0;
                  internalProduct.qty_ecommerce = extItem.quantity || 0;
                }
                if (extItem.barcode && !internalProduct.unitBarcode) {
                  internalProduct.unitBarcode = extItem.barcode;
                }
                await internalProduct.save();
                recordsUpdated++;
              } else {
                // Create new product record in Elvis WMS
                await Product.create({
                  sku: extItem.sku,
                  name: extItem.name || extItem.sku,
                  category: extItem.category || 'GEN',
                  price: extItem.price || 0,
                  qty_available: extItem.quantity || 0,
                  qty_reserved: 0,
                  qty_blocked: 0,
                  qty_ecommerce: extItem.quantity || 0,
                  qty_customer_owned: 0,
                  status: extItem.status || 'Active',
                  warehouse: settings.defaultWarehouse || 'MIA',
                  unitBarcode: extItem.barcode || '',
                  company: companyId
                });
                recordsCreated++;
              }
            } catch (err) {
              recordsFailed++;
              errorDetails.push({ item: extItem.sku || 'Product', reason: err.message });
            }
          }
        } catch (err) {
          errorDetails.push({ item: 'Product Sync Stage', reason: err.message });
        }
      }

      // ── B. ORDER SYNCHRONIZATION ───────────────────────────────────
      if ((syncType === 'full' || syncType === 'order') && settings.syncOrders !== false) {
        try {
          const externalOrders = await provider.fetchOrders(store);
          for (const extOrder of externalOrders) {
            recordsProcessed++;
            try {
              if (!extOrder.externalOrderId) {
                recordsFailed++;
                errorDetails.push({ item: 'External Order', reason: 'Missing externalOrderId' });
                continue;
              }

              // Check if order already imported into Elvis WMS
              const existingOrder = await Order.findOne({
                company: companyId,
                $or: [
                  { notes: new RegExp(extOrder.externalOrderId, 'i') },
                  { orderId: extOrder.externalOrderId }
                ]
              });

              if (existingOrder) {
                // Duplicate order prevented
                continue;
              }

              // Ensure CRM Customer exists
              if (extOrder.customerEmail) {
                let customer = await Customer.findOne({ company: companyId, email: extOrder.customerEmail.toLowerCase() });
                if (!customer) {
                  await Customer.create({
                    name: extOrder.customerName || 'Online Customer',
                    email: extOrder.customerEmail.toLowerCase(),
                    country: extOrder.deliveryAddress?.country || 'Spain',
                    shippingAddress: extOrder.deliveryAddress || {},
                    company: companyId
                  });
                }
              }

              // Generate internal order ID
              const prefix = settings.orderPrefix || 'ORD-';
              const internalOrderId = `${prefix}${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

              // Map product lines
              const productLines = (extOrder.items || []).map(item => ({
                sku: item.sku || 'GENERAL-ITEM',
                product_name: item.name || item.sku || 'Product Item',
                qty: Math.max(1, Number(item.quantity) || 1),
                unit_price: Number(item.price) || 0,
                line_total: Number(item.total) || (Number(item.quantity || 1) * Number(item.price || 0))
              }));

              await Order.create({
                orderId: internalOrderId,
                customer: extOrder.customerName || 'Online Customer',
                email: extOrder.customerEmail || 'orders@store.com',
                order_type: 'B2C',
                channel: store.provider,
                store_id: store._id,
                warehouse: settings.defaultWarehouse || 'MIA',
                status: 'pending',
                date: extOrder.date || new Date(),
                product_lines: productLines,
                delivery_address: extOrder.deliveryAddress || {},
                subtotal: extOrder.subtotal || 0,
                vat_amount: extOrder.taxTotal || 0,
                total: extOrder.grandTotal || 0,
                notes: `Imported from ${store.provider} (${store.storeName}) • External Ref: ${extOrder.externalOrderId}`,
                company: companyId
              });

              recordsCreated++;
            } catch (err) {
              recordsFailed++;
              errorDetails.push({ item: extOrder.externalOrderId || 'Order', reason: err.message });
            }
          }
        } catch (err) {
          errorDetails.push({ item: 'Order Sync Stage', reason: err.message });
        }
      }

      // ── C. INVENTORY SYNCHRONIZATION ───────────────────────────────
      if ((syncType === 'full' || syncType === 'inventory') && settings.syncInventory !== false) {
        try {
          const direction = settings.inventoryDirection || 'wms_to_store';
          if (direction === 'wms_to_store') {
            // WMS is authoritative: Push available stock to marketplace
            const internalProducts = await Product.find({ company: companyId }).limit(100);
            for (const p of internalProducts) {
              recordsProcessed++;
              try {
                await provider.updateExternalInventory(store, p.sku, p.qty_available || 0);
                recordsUpdated++;
              } catch (err) {
                recordsFailed++;
                errorDetails.push({ item: `Inventory Push ${p.sku}`, reason: err.message });
              }
            }
          } else if (direction === 'store_to_wms') {
            // Store is authoritative: Handled in product sync stage above
          }
          // If 'manual_only': No auto overwrite
        } catch (err) {
          errorDetails.push({ item: 'Inventory Sync Stage', reason: err.message });
        }
      }

      const durationMs = Date.now() - startTime;
      const finalStatus = errorDetails.length > 0 && recordsCreated === 0 && recordsUpdated === 0 ? 'failed' : 'completed';
      const summaryText = `Processed: ${recordsProcessed} | Created: ${recordsCreated} | Updated: ${recordsUpdated} | Failed: ${recordsFailed}`;

      // Complete Log
      syncLog.status = finalStatus;
      syncLog.completedAt = new Date();
      syncLog.durationMs = durationMs;
      syncLog.recordsProcessed = recordsProcessed;
      syncLog.recordsCreated = recordsCreated;
      syncLog.recordsUpdated = recordsUpdated;
      syncLog.recordsFailed = recordsFailed;
      syncLog.errorDetails = errorDetails;
      syncLog.summary = summaryText;
      await syncLog.save();

      // Release Lock
      await this.releaseLock(storeId, 'connected');

      return {
        success: finalStatus === 'completed',
        syncLogId: syncLog._id,
        durationMs,
        recordsProcessed,
        recordsCreated,
        recordsUpdated,
        recordsFailed,
        summary: summaryText
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      syncLog.status = 'failed';
      syncLog.completedAt = new Date();
      syncLog.durationMs = durationMs;
      syncLog.recordsFailed = recordsFailed + 1;
      syncLog.errorDetails.push({ item: 'Global Execution', reason: err.message });
      syncLog.summary = `Sync failed: ${err.message}`;
      await syncLog.save();

      await this.releaseLock(storeId, 'error', err.message);
      throw err;
    }
  }
}

export default SyncManager;
