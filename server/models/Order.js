import mongoose from 'mongoose';

const productLineSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  product_name: { type: String, required: true },
  qty: { type: Number, required: true, min: 1 },
  unit_price: { type: Number, required: true, min: 0 },
  line_total: { type: Number, required: true },
}, { _id: false });

const deliveryAddressSchema = new mongoose.Schema({
  street: String,
  number: String,
  postcode: String,
  city: String,
  region: String,
  country: String,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },

  // ── Core fields ────────────────────────────────────
  customer: String,
  email: String,
  order_type: { type: String, enum: ['B2C', 'B2B'], default: 'B2C' },
  channel: String,
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'EcommerceChannel' },
  warehouse: String,
  status: { type: String, enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  date: Date,
  notes: String,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },

  // ── Product Lines ──────────────────────────────────
  product_lines: [productLineSchema],

  // ── Financial Totals (auto-calculated) ────────────
  items: { type: Number, default: 0 },       // item count (kept for backward compat)
  subtotal: { type: Number, default: 0 },
  vat_rate: { type: Number, default: 21 },   // percentage, e.g. 21 for 21%
  vat_amount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },       // grand total = subtotal + vat

  // ── Delivery Address (B2C & B2B) ──────────────────
  delivery_address: deliveryAddressSchema,

  // ── B2C Shipping ──────────────────────────────────
  tracking_number: String,
  package_weight: String,
  package_dimensions: String,

  // ── B2B Fields ────────────────────────────────────
  company_name: String,
  vat_number: String,
  contact_person: String,
  contact_phone: String,
  pallet_count: Number,
  shipment_weight: String,
  delivery_terms: { type: String, enum: ['EXW', 'FCA', 'DDP', ''], default: '' },
  agreed_delivery_date: Date,
  po_reference: String,                       // Customer PO reference

  // ── Delivery Note ─────────────────────────────────
  delivery_note_number: String,               // Sequential: DN-000001, DN-000002…
  delivery_note_generated_at: Date,
}, { timestamps: true });

// Virtual: compute totals from product_lines before saving
orderSchema.pre('save', function () {
  if (this.product_lines && this.product_lines.length > 0) {
    this.subtotal = this.product_lines.reduce((sum, line) => sum + (line.line_total || 0), 0);
    this.vat_amount = parseFloat((this.subtotal * (this.vat_rate / 100)).toFixed(2));
    this.total = parseFloat((this.subtotal + this.vat_amount).toFixed(2));
    this.items = this.product_lines.reduce((sum, line) => sum + (line.qty || 0), 0);
  }
});

export default mongoose.model('Order', orderSchema);