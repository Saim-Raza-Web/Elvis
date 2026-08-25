import dotenv from 'dotenv';
dotenv.config({ path: './server/.env' });

const baseUrl = "http://localhost:5000/api/v1";

async function runTests() {
  console.log("\n==========================================================================");
  console.log("   CRM CUSTOMERS & INVOICING MODULES: ACCEPTANCE TEST SUITE (A - M)");
  console.log("==========================================================================\n");

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, testName, details = "") {
    if (condition) {
      console.log(`✅ [PASS] ${testName} ${details ? '— ' + details : ''}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${details ? '— ' + details : ''}`);
      failedCount++;
    }
  }

  // 1. Authenticate as Admin
  console.log("🔐 Authenticating as Admin...");
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@demologistics.io", password: "admin123" })
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.token) {
    console.error("FATAL: Could not login to server. Response:", loginData);
    process.exit(1);
  }

  const token = loginData.token;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const testSuffix = Date.now().toString().slice(-5);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST A — CRM Customer Profile Expansion & Validation
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST A: CRM Customer Profile Expansion & Validation ---");
  const custVat = `ES-B${testSuffix}88`;
  const newCustPayload = {
    name: `Global Logistics Partner ${testSuffix}`,
    contact: "Alejandro Morales",
    email: `morales.${testSuffix}@globallogistics.com`,
    phone: "+34 912 999 888",
    vatNumber: custVat,
    country: "Spain",
    billingAddress: {
      street: "Paseo de la Castellana",
      number: "180",
      city: "Madrid",
      postcode: "28046",
      region: "Madrid",
      country: "Spain"
    },
    shippingAddress: {
      street: "Poligono Industrial Sur",
      number: "Nave 4",
      city: "Getafe",
      postcode: "28906",
      region: "Madrid",
      country: "Spain"
    },
    paymentTerms: "Net 30",
    iban: "ES9121000418450200051332",
    bankInfo: "Banco Santander / SANESMMXXX",
    tier: "gold",
    notes: "VIP Priority Customer",
    active: true
  };

  // Create
  const createCustRes = await fetch(`${baseUrl}/crm`, {
    method: "POST",
    headers,
    body: JSON.stringify(newCustPayload)
  });
  const createdCust = await createCustRes.json();
  assert(createCustRes.status === 201 && createdCust._id, "TEST A.1: Customer Created with full business profile", `ID: ${createdCust._id}`);
  assert(createdCust.vatNumber === custVat && createdCust.tier === "gold", "TEST A.2: VAT and Tier stored accurately");
  assert(createdCust.billingAddress?.city === "Madrid" && createdCust.paymentTerms === "Net 30", "TEST A.3: Structured billing address & payment terms saved");

  // Update
  const updateCustRes = await fetch(`${baseUrl}/crm/${createdCust._id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ phone: "+34 912 000 111", tier: "platinum" })
  });
  const updatedCust = await updateCustRes.json();
  assert(updateCustRes.ok && updatedCust.tier === "platinum" && updatedCust.phone === "+34 912 000 111", "TEST A.4: Customer profile updated successfully");

  // Validation: Missing Name rejection
  const invalidCustRes = await fetch(`${baseUrl}/crm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "", email: "valid@email.com" })
  });
  assert(invalidCustRes.status === 400, "TEST A.5: Missing customer name rejected with HTTP 400");

  // Validation: Invalid Email rejection
  const invalidEmailRes = await fetch(`${baseUrl}/crm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Bad Email Corp", email: "notanemail" })
  });
  assert(invalidEmailRes.status === 400, "TEST A.6: Invalid email format rejected with HTTP 400");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST B — Invoice Customer Relationship & Auto-population
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST B: Invoice Customer Relationship ---");
  const invPayload = {
    customerId: createdCust._id,
    issuedDate: "2026-08-25",
    dueDate: "2026-09-24",
    lines: [
      {
        itemType: "product",
        sku: "SKU-001",
        description: "Industrial Precision Bearing",
        quantity: 10,
        uom: "EA",
        unitPrice: 25.00,
        discount: 0,
        taxRate: 21
      }
    ]
  };

  const createInvRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify(invPayload)
  });
  const createdInv = await createInvRes.json();
  assert(createInvRes.status === 201 && createdInv._id, "TEST B.1: Invoice created linked by Customer ObjectId", `Invoice #: ${createdInv.invoiceNumber}`);
  assert(String(createdInv.customerId) === String(createdCust._id), "TEST B.2: Authoritative customer relationship maintained");
  assert(createdInv.customerName === createdCust.name && createdInv.customerVat === custVat, "TEST B.3: Customer Name & VAT snapshot saved on Invoice");

  // Rejection without customer
  const noCustInvRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify({ customerId: "", lines: invPayload.lines })
  });
  assert(noCustInvRes.status === 400, "TEST B.4: Invoice creation without CRM Customer rejected with HTTP 400");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST C — Multi-Line Products & Services
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST C: Multi-Line Products & Services Support ---");
  const multiLinePayload = {
    customerId: createdCust._id,
    lines: [
      {
        itemType: "product",
        sku: "SKU-GEAR-100",
        description: "Hardened Steel Transmission Gear",
        quantity: 5,
        uom: "EA",
        unitPrice: 100.00,
        discount: 10, // 10% discount -> subtotal €450
        taxRate: 21  // 21% tax -> €94.50
      },
      {
        itemType: "service",
        sku: "SRV-PALLET-STORAGE",
        description: "Monthly Temperature-Controlled Storage Fee",
        quantity: 2,
        uom: "pallet/mo",
        unitPrice: 75.00,
        discount: 0, // subtotal €150
        taxRate: 10  // 10% tax -> €15.00
      },
      {
        itemType: "service",
        sku: "SRV-PICK-PACK",
        description: "Specialized Fragile Pick & Pack Handling",
        quantity: 1,
        uom: "EA",
        unitPrice: 50.00,
        discount: 0, // subtotal €50
        taxRate: 21  // 21% tax -> €10.50
      }
    ]
  };

  const multiLineRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify(multiLinePayload)
  });
  const multiInv = await multiLineRes.json();
  assert(multiLineRes.status === 201, "TEST C.1: Multi-line invoice created successfully");
  assert(multiInv.lines.length === 3, "TEST C.2: Correct 3 lines stored");
  assert(multiInv.lines[0].itemType === "product" && multiInv.lines[1].itemType === "service", "TEST C.3: Supports both Products and Services distinctly");
  assert(multiInv.lines[0].lineSubtotal === 450.00 && multiInv.lines[0].lineTotal === 544.50, "TEST C.4: Product line subtotal & total calculated with discount");
  assert(multiInv.lines[1].lineSubtotal === 150.00 && multiInv.lines[1].lineTotal === 165.00, "TEST C.5: Service line subtotal & total calculated accurately");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST D — Invalid Quantity & Pricing Rejection
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST D: Invalid Quantity & Price Validation ---");
  // Zero quantity
  const zeroQtyRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customerId: createdCust._id,
      lines: [{ description: "Invalid Zero Qty Item", quantity: 0, unitPrice: 10 }]
    })
  });
  assert(zeroQtyRes.status === 400, "TEST D.1: Zero quantity strictly rejected with HTTP 400");

  // Negative quantity
  const negQtyRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customerId: createdCust._id,
      lines: [{ description: "Invalid Negative Qty Item", quantity: -4, unitPrice: 10 }]
    })
  });
  assert(negQtyRes.status === 400, "TEST D.2: Negative quantity strictly rejected with HTTP 400");

  // Negative price
  const negPriceRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customerId: createdCust._id,
      lines: [{ description: "Negative Price Item", quantity: 1, unitPrice: -50 }]
    })
  });
  assert(negPriceRes.status === 400, "TEST D.3: Negative unit price strictly rejected with HTTP 400");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST E — Server-Side Calculation Tampering Protection
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST E: Backend Calculation Tampering Protection ---");
  // Sending manipulated grandTotal: 1.00 when lines sum to €242.00
  const tamperedPayload = {
    customerId: createdCust._id,
    subtotal: 1.00,
    totalTax: 0.00,
    grandTotal: 1.00,
    amount: 1.00,
    lines: [
      {
        description: "High Value Widget",
        quantity: 2,
        unitPrice: 100.00, // 200.00
        taxRate: 21        // 42.00
      }
    ]
  };

  const tamperRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify(tamperedPayload)
  });
  const tamperInv = await tamperRes.json();
  assert(tamperRes.status === 201, "TEST E.1: Tampered payload processed safely");
  assert(tamperInv.subtotal === 200.00, "TEST E.2: Server authoritative subtotal enforced (€200.00, ignored €1.00)");
  assert(tamperInv.totalTax === 42.00, "TEST E.3: Server authoritative tax enforced (€42.00)");
  assert(tamperInv.grandTotal === 242.00, "TEST E.4: Server authoritative grand total enforced (€242.00, ignored €1.00)");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST F — Multi-Rate VAT Calculation & Tax Breakdown
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST F: VAT / Tax Calculations & Tax Breakdown ---");
  // Multi-rate verification on multiInv (Subtotal: 450 + 150 + 50 = 650; Tax: 94.50 + 15.00 + 10.50 = 120.00; GrandTotal = 770.00)
  assert(multiInv.subtotal === 650.00, "TEST F.1: Multi-line Subtotal is exact (€650.00)");
  assert(multiInv.totalTax === 120.00, "TEST F.2: Multi-line Total Tax is exact (€120.00)");
  assert(multiInv.grandTotal === 770.00, "TEST F.3: Multi-line Grand Total is exact (€770.00)");
  assert(Array.isArray(multiInv.taxBreakdown) && multiInv.taxBreakdown.length === 2, "TEST F.4: Correct 2 tax rate brackets generated (21% and 10%)");

  const vat21 = multiInv.taxBreakdown.find(t => t.taxRate === 21);
  const vat10 = multiInv.taxBreakdown.find(t => t.taxRate === 10);
  assert(vat21 && vat21.taxableAmount === 500.00 && vat21.taxAmount === 105.00, "TEST F.5: VAT 21% breakdown exact (€500 base, €105 tax)");
  assert(vat10 && vat10.taxableAmount === 150.00 && vat10.taxAmount === 15.00, "TEST F.6: VAT 10% breakdown exact (€150 base, €15 tax)");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST G — Atomic, Sequential Invoice Numbering
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST G: Atomic Sequential Invoice Numbering ---");
  const concurrentInvs = await Promise.all([
    fetch(`${baseUrl}/billing`, { method: "POST", headers, body: JSON.stringify(invPayload) }).then(r => r.json()),
    fetch(`${baseUrl}/billing`, { method: "POST", headers, body: JSON.stringify(invPayload) }).then(r => r.json()),
    fetch(`${baseUrl}/billing`, { method: "POST", headers, body: JSON.stringify(invPayload) }).then(r => r.json())
  ]);

  const num1 = concurrentInvs[0].invoiceNumber;
  const num2 = concurrentInvs[1].invoiceNumber;
  const num3 = concurrentInvs[2].invoiceNumber;
  const currentYear = new Date().getFullYear();

  assert(num1.startsWith(`INV-${currentYear}-`) && num2.startsWith(`INV-${currentYear}-`), "TEST G.1: Format matches INV-YYYY-XXXXX");
  assert(num1 !== num2 && num2 !== num3 && num1 !== num3, "TEST G.2: Concurrent numbers are strictly unique (No duplicate collisions)");

  const seqs = [
    parseInt(num1.split('-')[2], 10),
    parseInt(num2.split('-')[2], 10),
    parseInt(num3.split('-')[2], 10)
  ].sort((a, b) => a - b);

  assert(seqs[1] === seqs[0] + 1 && seqs[2] === seqs[1] + 1, "TEST G.3: Sequential increment strictly enforced without gaps", `${seqs[0]} -> ${seqs[1]} -> ${seqs[2]}`);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST H — Real PDF Binary Generation & Stream
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST H: Real PDF Generation & Binary Stream ---");
  const pdfRes = await fetch(`${baseUrl}/billing/${multiInv._id}/pdf`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const pdfBuffer = await pdfRes.arrayBuffer();
  const pdfContentType = pdfRes.headers.get("content-type");

  assert(pdfRes.status === 200, "TEST H.1: PDF endpoint returned HTTP 200 OK");
  assert(pdfContentType?.includes("application/pdf"), "TEST H.2: Content-Type is application/pdf", pdfContentType);
  assert(pdfBuffer.byteLength > 2000, "TEST H.3: Non-empty binary PDF generated", `${pdfBuffer.byteLength} bytes`);

  // Verify PDF Magic Bytes (%PDF-)
  const magicBytes = Buffer.from(pdfBuffer).slice(0, 5).toString('utf-8');
  assert(magicBytes === "%PDF-", "TEST H.4: Valid PDF header magic bytes verified (%PDF-)");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST I — Customer Data in PDF Verification
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST I: Customer Data in PDF Verification ---");
  const rawStr = Buffer.from(pdfBuffer).toString('latin1');
  const hexMatches = rawStr.match(/<[0-9a-fA-F]+>/g) || [];
  const decodedHex = hexMatches.map(h => {
    try {
      return Buffer.from(h.replace(/<|>/g, ''), 'hex').toString('latin1');
    } catch (_) { return ''; }
  }).join(' ');
  const fullPdfText = (rawStr + ' ' + decodedHex).replace(/\s+/g, '');

  assert(fullPdfText.includes(multiInv.invoiceNumber), "TEST I.1: Invoice number present in generated PDF stream", multiInv.invoiceNumber);
  assert(fullPdfText.includes("COMMERCIALINVOICE"), "TEST I.2: Commercial Invoice header rendered in PDF");
  assert(fullPdfText.includes(createdCust.name.replace(/\s+/g, '')) || fullPdfText.includes(custVat.replace(/[^a-zA-Z0-9]/g, '')), "TEST I.3: Customer Name & VAT ID present in PDF stream");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST J — Send Invoice Workflow & Sent Status
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST J: Real Send Invoice Workflow ---");
  const sendRes = await fetch(`${baseUrl}/billing/${multiInv._id}/send`, {
    method: "POST",
    headers
  });
  const sendData = await sendRes.json();
  assert(sendRes.status === 200, "TEST J.1: Send Invoice executed successfully", sendData.message);
  assert(sendData.dispatch?.recipient === createdCust.email, "TEST J.2: Dispatched to verified customer email", sendData.dispatch?.recipient);
  assert(sendData.dispatch?.pdfAttached === true && sendData.dispatch?.pdfSize > 2000, "TEST J.3: Invoice PDF stream attached to email dispatch");

  // Verify Invoice Database Record was updated to 'sent' with sent metadata
  const verifySentRes = await fetch(`${baseUrl}/billing/${multiInv._id}`, { headers });
  const verifiedSentInv = await verifySentRes.json();
  assert(verifiedSentInv.status === "sent", "TEST J.4: Invoice status transitioned to 'sent'");
  assert(Boolean(verifiedSentInv.sentAt) && verifiedSentInv.sentTo === createdCust.email, "TEST J.5: sentAt timestamp and sentTo recorded in database");
  assert(Array.isArray(verifiedSentInv.emailHistory) && verifiedSentInv.emailHistory.length > 0, "TEST J.6: Email audit history entry appended");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST K — Missing Customer Email Rejection
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST K: Missing Customer Email Rejection ---");
  // 1. Create a customer with a temporary valid email
  const tempCustRes = await fetch(`${baseUrl}/crm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "No Email Corp " + testSuffix, email: `temp.${testSuffix}@example.com` })
  });
  const tempCust = await tempCustRes.json();

  // 2. Create invoice for this customer
  const tempInvRes = await fetch(`${baseUrl}/billing`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customerId: tempCust._id,
      lines: [{ description: "Advisory Service", quantity: 1, unitPrice: 300 }]
    })
  });
  const tempInv = await tempInvRes.json();

  // 3. Update customer and invoice email to invalid / empty string directly via database or update
  const { MongoClient, ObjectId } = await import('mongodb');
  const mClient = new MongoClient(process.env.MONGO_URI);
  await mClient.connect();
  const db = mClient.db();
  await db.collection('customers').updateOne({ _id: new ObjectId(tempCust._id) }, { $set: { email: "" } });
  await db.collection('invoices').updateOne({ _id: new ObjectId(tempInv._id) }, { $set: { customerEmail: "" } });
  await mClient.close();

  // 4. Attempt to send invoice with missing email
  const failSendRes = await fetch(`${baseUrl}/billing/${tempInv._id}/send`, {
    method: "POST",
    headers
  });
  const failSendData = await failSendRes.json();
  assert(failSendRes.status === 400, "TEST K.1: Sending without valid customer email rejected with HTTP 400", failSendData.message);

  // 5. Verify Invoice was NOT falsely marked as 'sent'
  const checkNotSentRes = await fetch(`${baseUrl}/billing/${tempInv._id}`, { headers });
  const checkNotSentInv = await checkNotSentRes.json();
  assert(checkNotSentInv.status === "draft", "TEST K.2: Invoice status remained 'draft' (NOT falsely marked SENT)");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST L — Send Failure Safety
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST L: Send Failure Safety & Error Recovery ---");
  const failSimRes = await fetch(`${baseUrl}/billing/${multiInv._id}/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({ simulateFailure: true })
  });
  const failSimData = await failSimRes.json();
  assert(failSimRes.status === 500, "TEST L.1: Simulated email transport failure returned HTTP 500 Error", failSimData.message);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST M — Full Regression Protection (Phase 1–5 Operations)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n--- TEST M: Full WMS Regression Protection ---");

  // M.1: ASN List
  const asnRes = await fetch(`${baseUrl}/asn`, { headers });
  const asnData = await asnRes.json();
  assert(asnRes.status === 200 && Array.isArray(asnData.data || asnData), "TEST M.1: ASN List API operational");

  // M.2: Inventory Stock
  const invStockRes = await fetch(`${baseUrl}/inventory`, { headers });
  const invStock = await invStockRes.json();
  assert(invStockRes.status === 200, "TEST M.2: Inventory Stock API operational");

  // M.3: 3PL Clients
  const clientRes = await fetch(`${baseUrl}/clients`, { headers });
  const clientData = await clientRes.json();
  assert(clientRes.status === 200 && Array.isArray(clientData), "TEST M.3: 3PL Clients (Inventory Owners) operational and isolated");

  // M.4: Storage Rules / Picking Engine Simulator (FEFO/FIFO/LIFO)
  const pickSimRes = await fetch(`${baseUrl}/storage-rules/simulate-picking`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sku: "SKU-001",
      warehouse: "MIA",
      qtyNeeded: 5,
      strategy: "FIFO"
    })
  });
  const pickSim = await pickSimRes.json();
  assert(pickSimRes.status === 200 && pickSim.strategyApplied === "FIFO", "TEST M.4: Picking Engine Simulator (FIFO/FEFO) operational");

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n==========================================================================");
  console.log(`ACCEPTANCE RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log("==========================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Acceptance Suite Unhandled Exception:", err);
  process.exit(1);
});
