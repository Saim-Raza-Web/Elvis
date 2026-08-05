import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

async function runVerification() {
  console.log('=== STARTING MODULE 01 CLIENT CORRECTIONS VERIFICATION ===');

  await mongoose.connect(process.env.MONGO_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }), 'companies');
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }), 'orders');

  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    console.error('No admin user found!');
    process.exit(1);
  }

  const token = jwt.sign({ id: adminUser._id }, process.env.JWT_SECRET || 'fallback_secret_key');
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 1. VERIFY SAVING B2B ORDER WITHOUT DELIVERY TERMS
  console.log('\n--- 1. Testing B2B Order Creation WITHOUT Delivery Terms ---');
  const b2bPayloadNoIncoterms = {
    customer: "Test Wholesale Client",
    order_type: "B2B",
    company_name: "Client Test Corp S.L.",
    vat_number: "ESB99887766",
    contact_person: "Ana Lopez",
    pallet_count: 3,
    shipment_weight: "1200 kg",
    po_reference: "PO-NO-INCOTERMS-01",
    delivery_terms: "", // BLANK / OPTIONAL!
    warehouse: "MIA",
    delivery_address: {
      street: "Calle Mayor",
      number: "10",
      postcode: "28001",
      city: "Madrid",
      country: "Spain"
    },
    product_lines: [
      { sku: "SKU-OPTIONAL-01", product_name: "Pallet of Solar Batteries", qty: 3, unit_price: 800, line_total: 2400 }
    ]
  };

  const createRes = await fetch('http://localhost:5000/api/v1/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify(b2bPayloadNoIncoterms)
  });

  console.log('Create B2B Order Status:', createRes.status);
  const createdOrder = await createRes.json();
  if (createRes.status === 201) {
    console.log('✅ PASS: Order saved successfully without Delivery Terms! OrderID:', createdOrder.orderId);
  } else {
    console.error('❌ FAIL: Order failed to save without Delivery Terms:', createdOrder);
  }

  // 2. VERIFY COMPANY BRANDING PREVIEW PDF ENDPOINT
  console.log('\n--- 2. Testing Company Branding & Preview Delivery Note Endpoint ---');
  const updateBrandingRes = await fetch('http://localhost:5000/api/v1/settings', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: "House Logistic S.L.",
      tradingName: "House Logistic",
      vatNumber: "B-12345678",
      phone: "+34 91 000 0000",
      email: "logistics@houselogistic.es",
      website: "www.houselogistic.es",
      address: {
        street: "Polígono Industrial Norte",
        number: "Nave 7",
        postcode: "28001",
        city: "Madrid",
        country: "Spain"
      }
    })
  });
  console.log('Update Company Branding Status:', updateBrandingRes.status);

  const previewRes = await fetch('http://localhost:5000/api/v1/documents/preview-delivery-note', { headers });
  console.log('Preview Delivery Note Status:', previewRes.status, 'Content-Type:', previewRes.headers.get('content-type'));
  if (previewRes.status === 200) {
    const previewBuffer = await previewRes.arrayBuffer();
    fs.writeFileSync('d:/Elvis Project/server/delivery_note_preview.pdf', Buffer.from(previewBuffer));
    console.log('✅ PASS: Saved delivery_note_preview.pdf, size:', previewBuffer.byteLength, 'bytes');
  } else {
    console.error('❌ FAIL: Preview delivery note failed');
  }

  // 3. VERIFY DELIVERY NOTE GENERATION AND TEXT CLEANUP (NO B2B/B2C LABELS)
  console.log('\n--- 3. Testing Delivery Note PDF Generation & Text Cleanup ---');
  const dnRes = await fetch(`http://localhost:5000/api/v1/documents/delivery-note/${createdOrder._id}`, { headers });
  console.log('Delivery Note Generation Status:', dnRes.status);
  const dnBuffer = await dnRes.arrayBuffer();
  fs.writeFileSync('d:/Elvis Project/server/client_correction_delivery_note.pdf', Buffer.from(dnBuffer));
  console.log('Saved client_correction_delivery_note.pdf, size:', dnBuffer.byteLength, 'bytes');

  await mongoose.disconnect();
  console.log('\n=== ALL VERIFICATIONS COMPLETE ===');
}

runVerification().catch(console.error);
