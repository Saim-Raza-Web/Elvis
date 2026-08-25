/**
 * Invoice Calculation Engine
 * Authoritative backend calculations for line items, subtotals, tax breakdown, and grand totals.
 * Enforces precise 2-decimal rounding to prevent floating-point inaccuracies.
 */

export function round2(num) {
  if (typeof num !== 'number' || isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Validates and calculates an array of invoice lines.
 * Returns validated lines, subtotal, discountTotal, totalTax, grandTotal, and taxBreakdown.
 */
export function calculateInvoice(rawLines = []) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error('At least one invoice line item is required.');
  }

  const calculatedLines = [];
  const taxMap = new Map(); // taxRate -> { taxableAmount, taxAmount }
  let subtotal = 0;
  let discountTotal = 0;
  let totalTax = 0;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx];
    const lineNum = idx + 1;

    // 1. Validation: Quantity
    const qty = Number(raw.quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error(`Line #${lineNum}: Quantity must be a valid positive number greater than 0. Received '${raw.quantity}'.`);
    }

    // 2. Validation: Unit Price
    const unitPrice = Number(raw.unitPrice);
    if (isNaN(unitPrice) || unitPrice < 0) {
      throw new Error(`Line #${lineNum}: Unit price must be a valid non-negative number. Received '${raw.unitPrice}'.`);
    }

    // 3. Validation: Description
    const description = (raw.description || raw.name || '').trim();
    if (!description) {
      throw new Error(`Line #${lineNum}: Description is required.`);
    }

    // 4. Discount & Tax Rate
    const discount = Number(raw.discount) || 0;
    if (discount < 0 || discount > 100) {
      throw new Error(`Line #${lineNum}: Discount must be between 0% and 100%. Received '${raw.discount}'.`);
    }

    const taxRate = Number(raw.taxRate !== undefined ? raw.taxRate : 21);
    if (isNaN(taxRate) || taxRate < 0) {
      throw new Error(`Line #${lineNum}: Tax rate must be a valid non-negative percentage. Received '${raw.taxRate}'.`);
    }

    // 5. Line Math
    const gross = round2(qty * unitPrice);
    const discAmount = round2(gross * (discount / 100));
    const lineSubtotal = round2(gross - discAmount);
    const lineTax = round2(lineSubtotal * (taxRate / 100));
    const lineTotal = round2(lineSubtotal + lineTax);

    subtotal = round2(subtotal + lineSubtotal);
    discountTotal = round2(discountTotal + discAmount);
    totalTax = round2(totalTax + lineTax);

    // 6. Tax Breakdown Accumulation
    const existingTax = taxMap.get(taxRate) || { taxableAmount: 0, taxAmount: 0 };
    existingTax.taxableAmount = round2(existingTax.taxableAmount + lineSubtotal);
    existingTax.taxAmount = round2(existingTax.taxAmount + lineTax);
    taxMap.set(taxRate, existingTax);

    calculatedLines.push({
      itemType: raw.itemType === 'service' ? 'service' : 'product',
      productId: raw.productId || undefined,
      sku: (raw.sku || '').trim(),
      description,
      quantity: qty,
      uom: (raw.uom || 'EA').trim(),
      unitPrice,
      discount,
      taxRate,
      lineSubtotal,
      lineTax,
      lineTotal
    });
  }

  const grandTotal = round2(subtotal + totalTax);

  const taxBreakdown = Array.from(taxMap.entries())
    .map(([rate, data]) => ({
      taxRate: rate,
      taxableAmount: round2(data.taxableAmount),
      taxAmount: round2(data.taxAmount)
    }))
    .sort((a, b) => b.taxRate - a.taxRate);

  return {
    lines: calculatedLines,
    subtotal,
    discountTotal,
    totalTax,
    grandTotal,
    taxBreakdown,
    itemCount: calculatedLines.reduce((acc, l) => acc + l.quantity, 0)
  };
}
