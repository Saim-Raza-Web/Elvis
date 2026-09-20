import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Company from '../models/Company.js';

/**
 * Service: ABC Classification Engine (Stage 5B)
 *
 * Implements the frozen Stage 5B specification:
 * - Rolling 30-day confirmed sales volume.
 * - Source: Order with status indicating valid sales.
 * - Only counts ordered quantity (product_lines.qty).
 * - Pareto thresholds:
 *     A: Cumulative volume through 80% (top mover guaranteed A)
 *     B: Cumulative volume >80% through 95%
 *     C: Cumulative volume >95% through 100%
 * - Zero confirmed sales default to 'C'.
 * - Stable deterministic tie-break: confirmedPickVolume DESC, then sku ASC.
 * - Product materialized fields updated: sku_abc_class, abc_calc_date, abc_pick_count_period.
 * - abc_class_override is strictly preserved and never mutated.
 * - Zero physical inventory or accounting mutations.
 */
export const abcEngine = {
  /**
   * Calculate and materialize ABC classifications for all products of a company.
   *
   * @param {ObjectId|String} companyId - Tenant company partition
   * @param {Date} [referenceDate=new Date()] - Reference point for 30-day rolling window
   * @returns {Promise<Object>} Calculation results and summary
   */
  async calculateCompanyABC(companyId, referenceDate = new Date()) {
    if (!companyId) {
      throw new Error('companyId is required for ABC classification');
    }

    const companyObjectId = typeof companyId === 'string'
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    const refDate = new Date(referenceDate);
    const windowStart = new Date(refDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Aggregation Pipeline: 30-day rolling sales volume per SKU
    const pipeline = [
      {
        $match: {
          company: companyObjectId,
          status: { $in: ['shipped', 'delivered', 'processing', 'picked', 'READY FOR SHIPPING', 'packed', 'partially_fulfilled'] },
          date: { $gte: windowStart, $lte: refDate }
        }
      },
      { $unwind: '$product_lines' },
      {
        $match: {
          'product_lines.qty': { $gt: 0 } // Only positive sales quantities
        }
      },
      {
        $group: {
          _id: '$product_lines.sku',
          confirmedPickVolume: { $sum: '$product_lines.qty' }
        }
      },
      {
        $sort: {
          confirmedPickVolume: -1,
          _id: 1 // Deterministic lexical tie-break on SKU
        }
      }
    ];

    const pickResults = await Order.aggregate(pipeline);

    // 2. Fetch all products of the company
    const allProducts = await Product.find({ company: companyObjectId });

    const totalVolume = pickResults.reduce((sum, r) => sum + r.confirmedPickVolume, 0);
    const volumeMap = new Map();
    for (const r of pickResults) {
      volumeMap.set(r._id, r.confirmedPickVolume);
    }

    // 3. Pareto 80/15/5 Distribution Calculation
    const skuClassifications = new Map();
    let runningVolume = 0;

    for (let i = 0; i < pickResults.length; i++) {
      const { _id: sku, confirmedPickVolume } = pickResults[i];
      runningVolume += confirmedPickVolume;
      const runningPct = totalVolume > 0 ? (runningVolume / totalVolume) * 100 : 0;

      let assignedClass = 'C';
      if (i === 0) {
        // Top moving SKU is always Class A when volume exists
        assignedClass = 'A';
      } else if (runningPct <= 80.0) {
        assignedClass = 'A';
      } else if (runningPct <= 95.0) {
        assignedClass = 'B';
      } else {
        assignedClass = 'C';
      }

      skuClassifications.set(sku, {
        abcClass: assignedClass,
        volume: confirmedPickVolume,
        runningPct: Number(runningPct.toFixed(4))
      });
    }

    // 4. Materialize on Product documents
    const summary = {
      totalProducts: allProducts.length,
      totalPickVolume: totalVolume,
      counts: { A: 0, B: 0, C: 0 },
      overridesPreserved: 0,
      updatedSKUs: []
    };

    for (const prod of allProducts) {
      const vol = volumeMap.get(prod.sku) || 0;
      const calcClass = skuClassifications.get(prod.sku)?.abcClass || 'C';

      if (prod.abc_class_override) {
        summary.overridesPreserved++;
      }

      summary.counts[calcClass]++;

      // Atomic update targeting only ABC fields — Product.qty_available is never touched
      await Product.updateOne(
        { _id: prod._id, company: companyObjectId },
        {
          $set: {
            sku_abc_class: calcClass,
            abc_calc_date: refDate,
            abc_pick_count_period: vol
          }
        }
      );

      summary.updatedSKUs.push({
        sku: prod.sku,
        calculatedClass: calcClass,
        effectiveClass: prod.abc_class_override || calcClass,
        volume: vol,
        hasOverride: Boolean(prod.abc_class_override),
        override: prod.abc_class_override || null
      });
    }

    return {
      success: true,
      companyId: companyObjectId,
      referenceDate: refDate,
      windowStart,
      ...summary
    };
  },

  /**
   * Weekly scheduled worker shell.
   * Iterates all active companies and runs ABC calculation independently per company.
   */
  async runWeeklyAbcWorker() {
    const companies = await Company.find({});
    const results = [];

    for (const comp of companies) {
      try {
        const res = await this.calculateCompanyABC(comp._id);
        results.push({ companyId: comp._id, name: comp.name, status: 'SUCCESS', summary: res.counts });
      } catch (err) {
        console.error(`[ABC Worker] Failed to calculate for company ${comp._id}:`, err.message);
        results.push({ companyId: comp._id, name: comp.name, status: 'FAILED', error: err.message });
      }
    }

    return results;
  }
};
