# PHASE 8C.3 — FINAL ARCHITECTURAL DISCOVERY REPORT
## Payments & Cash GL Integration

**Status:** FINAL ARCHITECTURAL DISCOVERY REMEDIATION COMPLETE — AWAITING GO/NO-GO  
**Date:** 2026-09-08  
**Constraint:** NO implementation. NO schema changes. NO database writes. NO migrations. NO git push.  
**Scope:** Final remediation resolving Quarantined Legacy AR Reconciliation, Historical Cancelled Unreversed Issuances, Allocation Idempotency Contracts, and Out-of-Order Reversal Order Invariance.

---

## TABLE OF CONTENTS
1. Current Architecture (Forensic Ground Truth)
2. Confirmed Defects & Remediation Requirements
3. Source-of-Truth Hierarchy & Architectural Roles
4. Final Payment Entity Architecture (Architecture D)
5. Payment Document Schema & Field Immutability (with Status Snapshot)
6. Authoritative Two-Step Payment & Allocation Posting Model
7. Atomic Transaction Boundaries & Rollback Guarantees
8. Stable Allocation Identity, Status Snapshots & Order-Invariant Reversal
9. Overpayment & Unapplied Cash Policy
10. Customer Deposit Model & Per-Customer Reconciliation
11. Historical Invoice Migration Strategy & Strict Quarantine Matrix
12. Legacy Payment Transaction Reconciliation
13. Payment Reversal Semantics (Exact Mirror-Swap)
14. Invoice Cancellation Policy, Balances & Reversal
15. Payment Method Validation & CoA Account Override
16. Currency Authority & Monetary Precision Policy
17. Cross-Customer & Tenant Isolation Invariants
18. Cache Reconstruction Formulas & Reconciliation Repair Mechanism
19. Fiscal Period Behavior
20. Idempotency Architecture (Payment Creation & Allocation Contracts)
21. Concurrency Analysis & OCC Guards
22. Authorization Matrix
23. Regulatory Compliance (SII Scope Boundary)
24. Legacy `/pay` Endpoint Compatibility Wrapper
25. Payment Numbering Sequence & Backdating Rules
26. Authoritative AR Reconciliation Engine & Mathematical Segregation Invariants
27. Deterministic Invoice Status FSM
28. Audit of Invoice Mutation Routes & Elimination of Financial Bypasses
29. Scope Partitioning: Phase 8C.3 vs Phase 8C.4
30. Exact Implementation Files
31. Comprehensive Adversarial Test Matrix (59 Cases)
32. Final Remediation Summary & Gate Verdict

---

## 1. CURRENT ARCHITECTURE (Forensic Ground Truth)

### 1.1 Invoice Model (`server/models/Invoice.js`)
* **Existing Fields:** `invoiceNumber`, `customerId`, `customerName`, `lines[]`, `subtotal`, `discountTotal`, `totalTax`, `grandTotal`, `taxBreakdown[]`, `status`, `issuedDate`, `dueDate`, `paymentTerms`, `notes`, `bankInfo`, `sentAt`, `sentTo`, `sentBy`, `emailHistory[]`, `accountingJournalEntryId`, `accountingTransactionId`, `orderId`, `shipments[]`, `company`, `timestamps`.
* **Confirmed Absent Fields:**
  * ✗ `amountPaid`
  * ✗ `outstandingAmount`
  * ✗ `payments[]`
  * ✗ `status: 'partially_paid'`
  * ✗ `reversedAt` / `reversedBy` / `reversalReason` / `reversalJournalEntryId`
  * ✗ `historicalReconciliationState`
* **Current Status Enum:** `['draft', 'issued', 'sent', 'paid', 'cancelled']`

### 1.2 Existing `POST /:id/pay` Endpoint (`billing.js:608–652`)
* Blindly sets `invoice.status = 'paid'` without amount checks or partial payment support.
* Creates an orphan single-sided `Transaction` (`type: 'credit'`, `category: 'Revenue'`, `account: 'Cash & Cash Equivalents'`).
* Never credits Accounts Receivable (Account 430) — AR GL balance never moves.
* Categorizes transaction as 'Revenue' (double-counting revenue already recognized on issuance).
* Silently catches errors with `console.warn`.
* Never sets `accountingTransactionId` on the invoice.
* Completely lacks idempotency, MongoDB sessions, and fiscal period checks.

### 1.3 Existing `POST /:id/cancel` Endpoint (`billing.js:655–679`)
* Cancels `issued` or `sent` invoices by updating status to `'cancelled'`, but creates **no reversal JournalEntry** for the issuance JE.
* Reconstructs no GL state, leaving AR and Revenue accounts overstated in historical ledgers.
* Blocks cancellation only for `status === 'paid'`, but has no guard for partial payments.

### 1.4 Company Model (`server/models/Company.js`)
* Explicitly defines base currency: `currency: { type: String, default: 'EUR' }`.
* Currency is an authoritative company configuration field, not an assumption.

### 1.5 JournalEntry Model (`server/models/JournalEntry.js`)
* Lines store: `accountId` (CoA reference), `accountCodeSnapshot`, `accountNameSnapshot`, `account`, `description`, `debit`, `credit`.
* Entry stores: `entryNumber`, `date`, `reference`, `description`, `entryType`, `sourceDocument` (`docType`, `docId`, `docNumber`), `lines[]`, `totalDebit`, `totalCredit`, `status`, `company`.
* **Critical Forensic Finding:** JournalEntry lines do **NOT** store `customerId`. Customer identity exists only via `sourceDocument.docId` linking to `Payment` or `Invoice`.

### 1.6 CompanyAccountingConfig (`server/models/CompanyAccountingConfig.js`)
* All required accounts are already configured and validated:
  * `defaultAccountsReceivableAccountId` → 430 (Asset, posting)
  * `defaultBankAccountId` → 572.000.001 (Asset, posting)
  * `defaultCashAccountId` → 570 (Asset, posting)
  * `defaultCustomerDepositAccountId` → 438 (Liability, posting)
  * `defaultUnbilledReceivableAccountId` → 430.9 (Asset, posting)
  * `defaultTaxPayableAccountId` → 477.0 (Liability, posting)
* Zero schema changes needed on accounting configuration.

---

## 2. CONFIRMED DEFECTS & REMEDIATION REQUIREMENTS

| # | Defect | File & Line | Severity | Remediation |
|---|---|---|---|---|
| 1 | No JournalEntry on payment | `billing.js:632` | 🔴 Critical | Replace with two-step double-entry GL posting |
| 2 | Hardcoded 'Cash & Cash Equivalents' string | `billing.js:640` | 🔴 Critical | Use config-driven CoA ObjectId resolution |
| 3 | AR account never credited on payment | `billing.js:629` | 🔴 Critical | Credit 430 via atomic allocation entry |
| 4 | Wrong category 'Revenue' on payment | `billing.js:639` | 🔴 Critical | Category is 'Asset/Liability' movement, never Revenue |
| 5 | Error silently swallowed | `billing.js:643` | 🔴 Critical | Session aborts and bubbles error to caller |
| 6 | No partial payment support | `Invoice.js` | 🔴 Critical | Add `amountPaid`, `outstandingAmount`, `status: 'partially_paid'` |
| 7 | Direct status write to 'paid' via `PUT /:id` | `billing.js:383` | 🔴 Critical | Strip financial fields from generic PUT; forbid status writes |
| 8 | Mutable lines on issued invoices | `billing.js:353` | 🔴 Critical | Lock lines, customer, and amounts once invoice is issued |
| 9 | No reversal JE on invoice cancellation | `billing.js:673` | 🔴 Critical | Mirror-swap original issuance JE lines exactly |
| 10 | Missing payment & allocation idempotency | `billing.js:608` | 🟠 High | Require `x-idempotency-key` on payment and allocation |
| 11 | Missing fiscal period validation | `billing.js:608` | 🟠 High | Centralize in `JournalEntry.pre('save')` hook |
| 12 | Single-sided legacy payment transactions | Database | 🟠 High | Isolate from AR engine; treat as unverified |

---

## 3. SOURCE-OF-TRUTH HIERARCHY & ARCHITECTURAL ROLES

1. **`JournalEntry` = Accounting Source of Truth (General Ledger):**
   * The double-entry GL ledger is the single source of truth for all monetary movements, balances, and external accounting reporting.
   * Total GL AR balance is always derived from account 430 lines across active non-reversed JEs.
   * Total GL Customer Deposit balance is always derived from account 438 lines across active non-reversed JEs.
2. **`Payment.allocations[]` = Allocation-Event / Subledger Source of Truth:**
   * Authoritative log of discrete events binding received funds to specific invoices.
   * Holds the immutable historical record of who allocated how much, to which invoice, on what date, under which allocation JournalEntry, and what the `previousInvoiceStatus` was.
3. **`Invoice.amountPaid`, `Invoice.outstandingAmount`, `Invoice.status` = Materialized Operational Cache:**
   * Materialized purely for $O(1)$ querying in UI lists, customer statements, and billing dashboards.
   * Deterministically derived from active non-reversed entries in `Payment.allocations[]` for standard active invoices.
4. **`Payment.unappliedAmount`, `Payment.status` = Materialized Operational Cache:**
   * Materialized purely for $O(1)$ querying of remaining unapplied cash / deposit balances.
   * Deterministically derived from `Payment.amount` and active non-reversed entries in `Payment.allocations[]`.
5. **Universal Invariant Rule:**
   * **No generic CRUD route (e.g. `PUT /invoices/:id`, `PATCH /invoices/:id`) may independently mutate these financial caches.**
   * Mutations are exclusively permitted through authorized, transactional accounting endpoints (`POST /payments`, `POST /payments/:id/allocate`, `POST /payments/:id/reverse`, `POST /payments/:paymentId/allocations/:allocationId/reverse`).

---

## 4. FINAL PAYMENT ENTITY ARCHITECTURE (Architecture D)

### Decision: Architecture D — First-Class Payment Model with Embedded Allocations
* **Master Document:** First-class `Payment` document recording the monetary receipt event.
* **Embedded Allocations:** `Payment.allocations[]` records discrete application events against specific invoices.
* **Denormalized Subledger Summary:** `Invoice.payments[]` provides $O(1)$ read access for invoice balance and aging inquiries.
* **Unapplied Balance:** Derived and materialized on `Payment`: `unappliedAmount = amount - sum(active allocations)`.

---

## 5. PAYMENT DOCUMENT SCHEMA & FIELD IMMUTABILITY (with Status Snapshot)

```javascript
Payment {
  paymentNumber:          String,               // IMMUTABLE ("PAY-YYYY-NNNNN")
  company:                ObjectId -> Company,  // IMMUTABLE
  customerId:             ObjectId -> Customer, // IMMUTABLE
  customerNameSnapshot:   String,               // SNAPSHOT
  amount:                 Number,               // IMMUTABLE (EUR cents-safe, > 0)
  currency:               String,               // IMMUTABLE ("EUR")
  paymentDate:            Date,                 // IMMUTABLE (financial posting date)
  method:                 String,               // IMMUTABLE enum ['Bank Transfer', 'Cash', 'Card', 'Cheque']
  paymentAccountId:       ObjectId -> CoA,      // IMMUTABLE (resolved treasury account)
  paymentAccountSnapshot: { code, name },       // SNAPSHOT
  reference:              String,               // IMMUTABLE (bank ref, check #)
  notes:                  String,               // IMMUTABLE after posting
  status:                 String,               // MATERIALIZED enum ['unallocated', 'partially_allocated', 'fully_allocated', 'reversed']
  journalEntryId:         ObjectId -> JE,       // IMMUTABLE (receipt JE: Dr Bank, Cr 438)
  reversalJournalEntryId: ObjectId -> JE,       // SET ON REVERSAL
  reversedAt:             Date,                 // SET ON REVERSAL
  reversedBy:             String,               // SET ON REVERSAL
  reversalReason:         String,               // SET ON REVERSAL
  unappliedAmount:        Number,               // MATERIALIZED (amount - sum(active allocations), min: 0)
  allocations: [{
    allocationId:          ObjectId,            // STABLE UNIQUE IDENTITY (new ObjectId)
    invoiceId:             ObjectId -> Invoice, // IMMUTABLE
    invoiceNumber:         String,              // SNAPSHOT
    previousInvoiceStatus: String,              // IMMUTABLE SNAPSHOT of invoice.status immediately prior to this allocation ('issued', 'sent', 'partially_paid')
    allocatedAmount:       Number,              // IMMUTABLE (> 0)
    allocatedAt:           Date,                // IMMUTABLE
    allocatedBy:           String,              // SNAPSHOT
    journalEntryId:        ObjectId -> JE,      // IMMUTABLE (allocation JE: Dr 438, Cr 430)
    isReversed:            Boolean,             // DEFAULT false, SET true ON REVERSAL
    reversedAt:            Date,                // SET ON REVERSAL
    reversedBy:            String,              // SET ON REVERSAL
    reversalJournalEntryId: ObjectId -> JE,    // SET ON REVERSAL
    reversalReason:        String               // SET ON REVERSAL
  }],
  recordedBy:             String,               // SNAPSHOT
  createdAt:              Date,                 // TIMESTAMPS
  updatedAt:              Date                  // TIMESTAMPS
}
```

---

## 6. AUTHORITATIVE TWO-STEP PAYMENT & ALLOCATION POSTING MODEL

The platform adopts a **Strict Two-Step Accounting Lifecycle** for all payments without exception:

1. **Step 1: Payment Receipt (Creation)**  
   Records inflow of liquid funds into the company treasury. Cash/Bank is debited, and Customer Deposits (Account 438) is credited. **Payment creation NEVER directly credits Accounts Receivable (430).**
2. **Step 2: Payment Allocation**  
   A separate, explicit financial event moving funds from Customer Deposits (438) to Accounts Receivable (430) for a specific invoice.

```
+-----------------------------------------------------------------------------+
| STEP 1: PAYMENT RECEIPT                                                     |
| Debit:  Bank Account (572.000.001) or Cash (570)        [+ Assets]          |
| Credit: Customer Deposits (438)                         [+ Liabilities]     |
| Net: Bank increases, Customer Deposit liability increases. AR is untouched.  |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| STEP 2: PAYMENT ALLOCATION                                                  |
| Debit:  Customer Deposits (438)                         [- Liabilities]     |
| Credit: Accounts Receivable (430)                       [- Assets]          |
| Net: Customer Deposit liability clears, AR asset clears.                    |
+-----------------------------------------------------------------------------+
```

---

## 7. ATOMIC TRANSACTION BOUNDARIES & ROLLBACK GUARANTEES

Every financial operation executes inside a strict MongoDB multi-document ACID transaction session (`session.withTransaction`). If any step or hook fails, all writes in the transaction are completely aborted.

### 7.1 Atomic Payment Creation (`POST /payments`)
* Atomically creates `Payment` document and Receipt JournalEntry (`Dr Cash/Bank, Cr 438`).
* If receipt JE fails (e.g. closed period), entire transaction aborts. Zero orphan Payment records can exist without a receipt JE.

### 7.2 Atomic Payment Allocation (`POST /payments/:id/allocate`)
* Atomically executes:
  1. Capture `previousInvoiceStatus = invoice.status`.
  2. Append allocation subdocument with stable `allocationId` and `previousInvoiceStatus`.
  3. Decrement `Payment.unappliedAmount`.
  4. Update `Payment.status`.
  5. Increment `Invoice.amountPaid`.
  6. Decrement `Invoice.outstandingAmount`.
  7. Update `Invoice.status`.
  8. Append summary to `Invoice.payments[]`.
  9. Create Allocation JournalEntry (`Dr 438, Cr 430`).
  10. Set `allocation.journalEntryId = je._id`.
* If any step fails, entire transaction rolls back. Never can an allocation exist without a JE or vice versa.

### 7.3 Atomic Allocation Reversal (`POST /payments/:paymentId/allocations/:allocationId/reverse`)
* Atomically creates reversal JE (`Dr 430, Cr 438`), marks `isReversed = true`, restores `Payment.unappliedAmount`, decrements `Invoice.amountPaid`, restores `Invoice.outstandingAmount`, and deterministically recomputes `Invoice.status`.
* Rollback guarantee: all-or-nothing.

### 7.4 Atomic Master Payment Reversal (`POST /payments/:id/reverse`)
* Guard: Blocked if any active allocation exists (`allocations.some(a => !a.isReversed)`).
* Atomically creates mirror reversal JE (`Dr 438, Cr Cash/Bank`), marks original receipt JE as reversed, sets `Payment.status = 'reversed'`, and clears `Payment.unappliedAmount = 0`.

---

## 8. STABLE ALLOCATION IDENTITY, STATUS SNAPSHOTS & ORDER-INVARIANT REVERSAL

### 8.1 Stable Identity
* Array indices (`allocations[0]`) are strictly prohibited as financial identities. Each allocation subdocument is assigned an immutable `allocationId: new mongoose.Types.ObjectId()`.
* Allocation records are never deleted. Reversal sets `isReversed: true` and logs audit metadata.
* Endpoint: `POST /payments/:paymentId/allocations/:allocationId/reverse`.

### 8.2 Order-Invariant Status Reversal Architecture
When multiple allocations exist against an invoice (e.g. Allocation A at $T_1$, Allocation B at $T_2$), reversals may occur in any order:
* **Order 1 (Chronological):** Reverse B then reverse A.
* **Order 2 (Out-of-Order):** Reverse A then reverse B.

**Mathematical & State Invariance:**
1. While any active non-reversed allocation remains on the invoice (`amountPaid > 0` and `outstandingAmount > 0.01`), `Invoice.status` is deterministically `'partially_paid'`.
2. When the last remaining allocation is reversed and active allocations reach zero (`amountPaid === 0`):
   * The baseline status is restored from the chronologically earliest allocation ever applied to that invoice (sorted by `allocatedAt` ascending).
   * That earliest allocation captured the true pre-allocation status (`'issued'` or `'sent'`).
3. **Guaranteed Identical End State in BOTH Orders:**
   * $\text{Invoice.amountPaid} = 0$
   * $\text{Invoice.outstandingAmount} = \text{grandTotal}$
   * $\text{Invoice.status} = \text{earliestAllocation.previousInvoiceStatus}$ (`'issued'` or `'sent'`)
   * $\text{Payment.unappliedAmount}$ fully restored
   * GL Account 430 and GL Account 438 return to exact pre-allocation balances.
   * **The reversal logic is 100% order-invariant and independent of array positions.**

---

## 9. OVERPAYMENT & UNAPPLIED CASH POLICY

### Decision: Policy B — Accept Overpayment; Retain Excess in Account 438
* Excess cash above invoice totals is preserved on the `Payment` document as `unappliedAmount` under liability account 438.
* It remains available for subsequent allocation to future invoices or reconciliation.

---

## 10. CUSTOMER DEPOSIT MODEL & PER-CUSTOMER RECONCILIATION

### 10.1 Deposit Representation
* A Customer Deposit is defined as any `Payment` document where `unappliedAmount > 0` and `status !== 'reversed'`.

### 10.2 GL Account 438 vs Customer Identity Boundary
* **Forensic Truth:** The `JournalEntry` schema does not possess a `customerId` column on line items or root.
* **Reconciliation Protocol:**
  1. **Company-Level GL Authority:**
     $$\text{GL Account 438 Net Balance} = \sum \text{Credits}(438) - \sum \text{Debits}(438)$$
  2. **Per-Customer Operational Deposit Subledger:**
     $$\text{Customer Deposit Balance} = \sum \text{Payment.unappliedAmount} \quad (\text{where } \text{customerId} = C \text{ and } \text{status} \ne \text{'reversed'})$$
  3. **Reconciliation Invariant:**
     $$\sum_{\text{all customers}} \text{Customer Deposit Balance} \equiv \text{GL Account 438 Net Balance} \quad (\pm 0.01)$$

---

## 11. HISTORICAL INVOICE MIGRATION STRATEGY & STRICT QUARANTINE MATRIX

### 11.1 Precise Historical State Definitions
* **`null` (or `'STANDARD'`): Standard Operational Invoice.**
  * Normal operational invoice governed by modern double-entry accounting.
* **`'LEGACY_UNVERIFIED'`: Historical Paid Invoice Quarantine.**
  * Invoices marked `paid` before Phase 8C.3 with no double-entry payment JE.
  * **Values frozen:** `amountPaid = grandTotal`, `outstandingAmount = 0`.
  * Its un-cleared issuance JE debit sits in Quarantined Legacy AR Exposure.
* **`'MANUAL_REVIEW_REQUIRED'`: Historical Data Anomaly Quarantine.**
  * Corrupted legacy records, orphan payment txns, or historical cancellations without reversal JEs.
  * **Values strictly frozen:** `amountPaid = 0`, **`outstandingAmount = null`** (NEVER `grandTotal`).
  * Excluded from all payment operations, cache repairs, and active AR sums.

### 11.2 Historical Classification Matrix (Exhaustive & Coherent)

| Category | Historical Condition | `historicalReconciliationState` | `amountPaid` | `outstandingAmount` | Accounting & Operational Rule |
|---|---|---|---|---|---|
| **A. Standard Active / Open** | `status IN ['draft', 'issued', 'sent']` | `null` | `0` | `grandTotal` | Normal active operational invoice. Participates in active AR. |
| **B. Clean Reconciled Cancelled** | `status === 'cancelled'` & (`accountingJournalEntryId == null` OR issuance JE verified reversed) | `null` | `0` | `0` | Reconciled cancelled invoice. Excluded from active AR. |
| **C. Legacy Paid Quarantine** | `status === 'paid'` (no payment JE) | `'LEGACY_UNVERIFIED'` | `grandTotal` | `0` | Quarantined. Issuance JE sits in Quarantined Legacy AR Exposure. |
| **D. Ambiguous Data Anomaly** | `status === 'paid'` & `grandTotal <= 0` | `'MANUAL_REVIEW_REQUIRED'` | `0` | `null` | Quarantined. Blocked from payment engine. |
| **E. Status Conflict (Orphan Txn)** | `status IN ['issued', 'sent']` + orphan payment txn | `'MANUAL_REVIEW_REQUIRED'` | `0` | `null` | Quarantined. Blocked until human review. |
| **F. Cancelled without Reversal JE** | `status === 'cancelled'` & issuance JE exists but is unreversed in GL | `'MANUAL_REVIEW_REQUIRED'` | `0` | `null` | Quarantined. Unreversed issuance debit sits in Quarantined Legacy AR Exposure. |

### 11.3 Strict Quarantine Invariants:
1. **Zero Synthetic JEs:** No synthetic payment JournalEntries are ever created for quarantined records.
2. **Zero Allocation Operations:** Invoices in Categories C, D, E, F cannot receive payment allocations (`400 Bad Request`).
3. **Excluded from Active AR:** Quarantined invoices never contribute to the active subledger AR sum.
4. **Cache Repair Protection:** Automatic cache repair skips Categories C, D, E, F without altering their values.

---

## 12. LEGACY PAYMENT TRANSACTION RECONCILIATION

* Legacy `Transaction` records (`txnId: /^TXN-PAY-/`) are single-sided, unlinked to CoA ObjectIds, and categorized incorrectly as 'Revenue'.
* **They are completely excluded from the new double-entry AR engine.**
* They remain untouched in the database as historical system artifacts.

---

## 13. PAYMENT REVERSAL SEMANTICS (Exact Mirror-Swap)

1. **Blocked if Active Allocations Exist:** All allocations must be reversed prior to master payment reversal.
2. **Exact Mirror-Swap:** Reversal reads original receipt JE lines and swaps debits and credits (`Dr 438 Deposits €700, Cr 572 Bank €700`).
3. **Hard-Fail Guards:**
   * If `!payment.journalEntryId` → `500 HARD FAIL`.
   * If original JE not found or `originalJE.status === 'reversed'` → `409 HARD FAIL`.
   * If current fiscal period is CLOSED → `400 HARD FAIL`.

---

## 14. INVOICE CANCELLATION POLICY, BALANCES & REVERSAL

### 14.1 Cancellation Policy & Balances
* **Draft Invoices:** Permitted. No GL entries exist. `amountPaid = 0`, `outstandingAmount = 0`, `status = 'cancelled'`.
* **Partially Paid or Paid Invoices:** **STRICTLY BLOCKED with 400 Bad Request.** Payments must be reversed first.
* **Issued or Sent Invoices (Zero Payments):** Permitted.
  * **Operational Balances:** Upon cancellation, the invoice balances are explicitly set to:
    $$\text{amountPaid} = 0 \quad \text{and} \quad \text{outstandingAmount} = 0$$
  * **Accounting Reversal:** The original invoice issuance JournalEntry is mirror-reversed in the GL (`Dr 430.9, Dr 477.0, Cr 430`).
  * **Reconciliation Impact:** Since `outstandingAmount = 0` and GL Account 430 has been credited back to 0, **both subledger and GL reflect €0 for the cancelled invoice**, maintaining 100% reconciliation.
  * **Exclusion:** Cancelled invoices are strictly excluded from active AR subledger reconciliation.

### 14.2 Issuance JE Mirror Reversal Fail-Safe
* Reads original issuance JE via `invoice.accountingJournalEntryId`. Hard-fails (500/409) if missing, malformed, or already reversed. Never guesses lines from current totals.
* Idempotency key: `INVOICE_CANCELLATION_${invoice._id}`.

---

## 15. PAYMENT METHOD VALIDATION & CoA ACCOUNT OVERRIDE

### 15.1 Strict Payment Method Validation
* Allowed Enum Values: `['Bank Transfer', 'Cash', 'Card', 'Cheque']`.
* If omitted → defaults to `'Bank Transfer'`.
* If unknown / invalid value provided → **`400 Bad Request`**. No silent fallback.

### 15.2 Treasury Account Override Validation (`paymentAccountId`)
* Optional in `POST /payments`. Strictly validated against `ChartOfAccount`:
  1. Must match `company: req.user.company`.
  2. Must be `active: true` and `isPostingAccount: true`.
  3. Must have `accountType: 'Asset'`.
  4. Must belong to approved treasury categories: Group 57 (Tesorería), config treasury defaults, or categories `['Cash & Cash Equivalents', 'Bank', 'Cash', 'Treasury', 'Clearing']`.
  5. If account is Inventory (Group 30), Fixed Asset (Group 21), or AR (Group 43) → **`400 Bad Request`**.

---

## 16. CURRENCY AUTHORITY & MONETARY PRECISION POLICY

### 16.1 Currency Authority
* Authoritative Source: `Company.currency` schema field (default `'EUR'`).
* Strictly EUR-only in Phase 8. Non-EUR currency returns **`400 Bad Request`**.

### 16.2 Monetary Precision Policy
* Strictly reuses the existing rounding engine from `server/services/invoiceCalculationEngine.js`:
  ```javascript
  export function round2(num) {
    if (typeof num !== 'number' || isNaN(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }
  ```
* Enforced consistently across: `payment.amount`, `allocatedAmount`, `unappliedAmount`, `amountPaid`, `outstandingAmount`, and all JournalEntry debits and credits.

---

## 17. CROSS-CUSTOMER & TENANT ISOLATION INVARIANTS

1. **Tenant Isolation:** `Payment.company.toString() === Invoice.company.toString()` (Mismatch $\implies$ `404 Not Found`).
2. **Customer Matching:** `Payment.customerId.toString() === Invoice.customerId.toString()` (Mismatch $\implies$ `400 Bad Request`).

---

## 18. CACHE RECONSTRUCTION FORMULAS & RECONCILIATION REPAIR MECHANISM

### 18.1 Deterministic Cache Reconstruction Algorithm
```javascript
function reconstructInvoiceCache(invoice, paymentAllocations) {
  // 1. Quarantined Historical State: LEGACY_UNVERIFIED
  if (invoice.historicalReconciliationState === 'LEGACY_UNVERIFIED') {
    return {
      amountPaid: invoice.grandTotal,
      outstandingAmount: 0,
      status: 'paid'
    };
  }

  // 2. Quarantined Historical State: MANUAL_REVIEW_REQUIRED (strictly null outstanding)
  if (invoice.historicalReconciliationState === 'MANUAL_REVIEW_REQUIRED') {
    return {
      amountPaid: 0,
      outstandingAmount: null,
      status: invoice.status
    };
  }

  // 3. Cancelled Invoice: Balances are strictly ZERO
  if (invoice.status === 'cancelled') {
    return {
      amountPaid: 0,
      outstandingAmount: 0,
      status: 'cancelled'
    };
  }

  // 4. Standard Operational Invoice: Derived from Active Allocations
  const invoiceAllocations = paymentAllocations.filter(
    a => a.invoiceId.equals(invoice._id)
  );
  const activeAllocations = invoiceAllocations.filter(a => !a.isReversed);
  
  const amountPaid = round2(
    activeAllocations.reduce((sum, a) => sum + a.allocatedAmount, 0)
  );
  const outstandingAmount = round2(Math.max(0, invoice.grandTotal - amountPaid));
  
  let status;
  if (outstandingAmount <= 0.01) {
    status = 'paid';
  } else if (amountPaid > 0) {
    status = 'partially_paid';
  } else {
    // Zero active allocations: Restore baseline status using earliest allocation snapshot
    const earliestAllocation = invoiceAllocations.sort((a, b) => a.allocatedAt - b.allocatedAt)[0];
    if (earliestAllocation && ['issued', 'sent'].includes(earliestAllocation.previousInvoiceStatus)) {
      status = earliestAllocation.previousInvoiceStatus;
    } else {
      status = invoice.sentAt ? 'sent' : 'issued';
    }
  }

  return { amountPaid, outstandingAmount, status };
}

function reconstructPaymentCache(payment) {
  if (payment.status === 'reversed') {
    return { unappliedAmount: 0, status: 'reversed' };
  }

  const activeAllocations = payment.allocations.filter(a => !a.isReversed);
  const allocatedTotal = round2(activeAllocations.reduce((sum, a) => sum + a.allocatedAmount, 0));
  const unappliedAmount = round2(Math.max(0, payment.amount - allocatedTotal));

  let status = 'unallocated';
  if (unappliedAmount <= 0.01) {
    status = 'fully_allocated';
  } else if (unappliedAmount < payment.amount) {
    status = 'partially_allocated';
  }

  return { unappliedAmount, status };
}
```

### 18.2 Reconciliation Detection & Repair Mechanism
* Query endpoint `GET /api/v1/accounting/ar-reconciliation/audit` compares materialized cache fields against subledger allocation sums and double-entry GL balances.
* Administrative endpoint `POST /api/v1/accounting/ar-reconciliation/repair-cache` (admin-only) recalculates cache fields for standard invoices using `reconstructInvoiceCache()` without altering quarantined historical states.
* **Hard-Fail Policy:** If an allocation exists without a corresponding `JournalEntry` or vice versa, the system refuses automatic repair and raises `CRITICAL_LEDGER_CORRUPTION`.

---

## 19. FISCAL PERIOD BEHAVIOR

* All fiscal period validation is strictly centralized in the [`JournalEntry.pre('save')`](file:///d:/Elvis%20Project/server/models/JournalEntry.js#L74) hook.
* Posting Date: `paymentDate || new Date()`. Closed period $\implies$ **`400 Bad Request`**.
* Reversal Date: `new Date()`. Closed period $\implies$ **`400 Bad Request`**.

---

## 20. IDEMPOTENCY ARCHITECTURE (Payment Creation & Allocation Contracts)

* Pattern: `acquireLock()` (outside transaction) → `withTransaction()` → `completeLock()` (outside transaction).
* **Payment Creation (`POST /payments`):**
  * `x-idempotency-key` HTTP header is **MANDATORY**. Missing key returns **`400 Bad Request`**.
  * Replaying same key + same payload $\implies$ cached `201` response with zero duplicate JEs.
  * Replaying same key + different payload $\implies$ **`409 Conflict`**.
* **Payment Allocation (`POST /payments/:id/allocate`):**
  * `x-idempotency-key` HTTP header is **MANDATORY**. Missing key returns **`400 Bad Request`**.
  * Replaying same key + same payload $\implies$ cached `200` response with zero duplicate allocation subdocuments or JEs.
  * Replaying same key + different payload $\implies$ **`409 Conflict`**.
  * Distinct keys + same `{ paymentId, invoiceId }` $\implies$ valid separate subsequent allocations (permits multiple partial allocations over time).
* **Legacy `/pay` Wrapper:** Generates deterministic internal key: `LEGACY_PAY_INVOICE_${invoiceId}`.

---

## 21. CONCURRENCY ANALYSIS & OCC GUARDS

* Mongoose versioning (`__v`) is enforced on both `Payment` and `Invoice` models.
* Race conditions attempting to allocate more than `unappliedAmount` or `outstandingAmount` fail at the version check (`409 Conflict`).
* `Invoice.outstandingAmount` and `Payment.unappliedAmount` have schema constraint `{ min: 0 }`.

---

## 22. AUTHORIZATION MATRIX

| Endpoint / Operation | Allowed Roles | Middleware |
|---|---|---|
| `POST /payments` (Record Payment) | `admin`, `manager` | `requireRole(['admin', 'manager'])` |
| `POST /payments/:id/allocate` | `admin`, `manager` | `requireRole(['admin', 'manager'])` |
| `POST /payments/:id/reverse` | `admin` ONLY | `requireRole(['admin'])` |
| `POST /payments/:paymentId/allocations/:allocationId/reverse` | `admin` ONLY | `requireRole(['admin'])` |
| `GET /payments` & `GET /payments/:id` | `admin`, `manager` | `requireRole(['admin', 'manager'])` |
| `POST /invoices/:id/cancel` | `admin` ONLY | `requireRole(['admin'])` |

---

## 23. REGULATORY COMPLIANCE (SII Scope Boundary)

* Spanish Tax Agency (AEAT) SII regulations mandate reporting for Invoice Issuance and Credit Notes.
* **Payment receipts are NOT SII reportable events.**
* Recording a payment, allocating a deposit, or reversing a payment does NOT generate a `ComplianceOutboxEvent`.

---

## 24. LEGACY `/pay` ENDPOINT COMPATIBILITY WRAPPER

* Route: `POST /api/v1/billing/invoices/:id/pay` (in `server/routes/billing.js`).
* **Behavior:** Delegates to the authoritative two-step payment engine.
  * Posts Step 1 Receipt: Dr Bank, Cr 438.
  * Posts Step 2 Allocation: Dr 438, Cr 430.
  * Updates invoice balances (`amountPaid = grandTotal`, `outstandingAmount = 0`, `status = 'paid'`).
* Returns legacy response structure + `X-Deprecation-Notice` header.
* Cannot create its own Transaction or bypass GL logic.

---

## 25. PAYMENT NUMBERING SEQUENCE & BACKDATING RULES

* **Format:** `PAY-YYYY-NNNNN` (e.g. `PAY-2026-00001`).
* **Authoritative Year:** System creation year (`new Date().getFullYear()`) ensures strictly monotonic sequence numbers without retroactively inserting numbers into closed historical calendar years.
* `paymentDate` independently governs the GL posting date and fiscal period check.

---

## 26. AUTHORITATIVE AR RECONCILIATION ENGINE & MATHEMATICAL SEGREGATION INVARIANTS

### 26.1 Mathematical Segregation of Quarantined Legacy AR
Because historical invoices marked `paid` or `cancelled` prior to Phase 8C.3 may have had issuance JEs without matching payment or reversal JEs, raw GL Account 430 contains un-cleared historical debits. These are segregated explicitly:

$$\text{Raw GL Account 430 Net Balance} \equiv \text{Active Subledger AR} + \text{Quarantined Legacy AR Exposure} \quad (\pm 0.01)$$

Where:
* **$\text{Active Subledger AR}$:**
  $$\text{Active Subledger AR} = \sum_{\substack{\text{Invoice where } \text{status} \in \text{['issued', 'sent', 'partially_paid']} \\ \text{and historicalReconciliationState is null / 'STANDARD'}}} \text{Invoice.outstandingAmount}$$
* **$\text{Quarantined Legacy AR Exposure}$:**
  $$\text{Quarantined Legacy AR Exposure} = \sum_{\substack{\text{LEGACY\_UNVERIFIED invoices} \\ \text{with unreversed issuance JEs}}} \text{grandTotal} \; + \sum_{\substack{\text{MANUAL\_REVIEW\_REQUIRED Category F} \\ \text{(cancelled with unreversed issuance JEs)}}} \text{grandTotal}$$

### 26.2 Operational Active AR Invariant
$$\text{Active Subledger AR} \equiv \text{Raw GL Account 430 Net Balance} - \text{Quarantined Legacy AR Exposure} \quad (\pm 0.01)$$

### 26.3 Active Standard Invoice Balance Invariant
$$\text{For all standard active invoices: } \text{Invoice.grandTotal} \equiv \text{Invoice.amountPaid} + \text{Invoice.outstandingAmount}$$

### 26.4 Cancelled Invoice Invariant
$$\text{For all cancelled invoices: } \text{Invoice.amountPaid} \equiv 0 \quad \land \quad \text{Invoice.outstandingAmount} \equiv 0$$

### 26.5 Quarantined State Invariants
$$\text{LEGACY\_UNVERIFIED} \implies \text{amountPaid} \equiv \text{grandTotal} \quad \land \quad \text{outstandingAmount} \equiv 0$$
$$\text{MANUAL\_REVIEW\_REQUIRED} \implies \text{amountPaid} \equiv 0 \quad \land \quad \text{outstandingAmount} \equiv \text{null}$$

### 26.6 Company Deposit Invariant
$$\sum_{\text{active payments}} \text{Payment.unappliedAmount} \equiv \text{GL Account 438 Net Balance} \quad (\pm 0.01)$$

---

## 27. DETERMINISTIC INVOICE STATUS FSM

### 27.1 Status Enum
`['draft', 'issued', 'sent', 'partially_paid', 'paid', 'cancelled']`

### 27.2 Transition & Reversal Rules
* `draft` → `issued` (via `POST /:id/issue`)
* `issued` → `sent` (via `POST /:id/send`)
* `issued` / `sent` → `partially_paid` (allocation applied, `outstandingAmount > 0.01`)
* `issued` / `sent` / `partially_paid` → `paid` (allocation applied, `outstandingAmount <= 0.01`)
* `paid` → `partially_paid` (allocation reversed, active allocations remain)
* `partially_paid` → `issued` (final allocation reversed, earliest allocation snapshot was `issued`)
* `partially_paid` → `sent` (final allocation reversed, earliest allocation snapshot was `sent`)
* `paid` → `issued` (single full allocation reversed, earliest allocation snapshot was `issued`)
* `paid` → `sent` (single full allocation reversed, earliest allocation snapshot was `sent`)
* `issued` / `sent` → `cancelled` (via `POST /:id/cancel`, only if zero payments exist; sets balances to 0)

---

## 28. AUDIT OF INVOICE MUTATION ROUTES & ELIMINATION OF FINANCIAL BYPASSES

1. **`PUT /api/v1/billing/invoices/:id` (`billing.js:320-402`):**
   * Remove `'paid'` and `'partially_paid'` from `allowedTransitions`.
   * Lock financial fields: if `invoice.status !== 'draft'`, reject updates to `lines`, `customerId`, `subtotal`, `grandTotal`, `totalTax`.
   * Explicitly strip and reject `amountPaid`, `outstandingAmount`, `payments[]`, `accountingJournalEntryId`, `reversedAt`, `historicalReconciliationState`.
2. **`POST /api/v1/billing/invoices` (`billing.js:220-315`):**
   * Initialize `amountPaid = 0`, `outstandingAmount = grandTotal`, `payments = []`. Reject payload attempts to set `status: 'paid'`.

---

## 29. SCOPE PARTITIONING: PHASE 8C.3 vs PHASE 8C.4

| Feature / Workflow | Phase 8C.3 (Current) | Phase 8C.4 (Deferred) |
|---|:---:|:---:|
| Payment Recording (`POST /payments`) | ✅ YES | — |
| Payment Allocation to Invoices | ✅ YES | — |
| Allocation Reversal | ✅ YES | — |
| Master Payment Reversal | ✅ YES | — |
| Customer Deposit Accounting (438) | ✅ YES | — |
| Invoice Cancellation Issuance Reversal | ✅ YES | — |
| Legacy `/pay` Compatibility Wrapper | ✅ YES | — |
| Customer Cash Refunds (Payback) | ❌ NO | ✅ Phase 8C.4 |
| Customer Deposit Refunds | ❌ NO | ✅ Phase 8C.4 |
| Credit Notes (Commercial Discounts/Returns) | ❌ NO | ✅ Phase 8C.4 |
| Credit Note Allocation to Invoices | ❌ NO | ✅ Phase 8C.4 |
| SII Outbox Events for Credit Notes | ❌ NO | ✅ Phase 8C.4 |

---

## 30. EXACT IMPLEMENTATION FILES

1. `server/models/Invoice.js` (MODIFY)
   * Add fields: `amountPaid`, `outstandingAmount`, `currency`, `payments[]`, `reversedAt`, `reversedBy`, `reversalReason`, `reversalJournalEntryId`, `historicalReconciliationState`.
   * Update `status` enum to include `'partially_paid'`.
2. `server/models/Payment.js` (NEW)
   * First-class Payment model with embedded `allocations[]` schema (including `previousInvoiceStatus`).
3. `server/routes/billing.js` (MODIFY)
   * Patch `PUT /:id` to eliminate financial bypasses and lock issued invoices.
   * Patch `POST /:id/cancel` with mirror-reversal of issuance JE and zero balance enforcement.
   * Replace `POST /:id/pay` with non-bypassing compatibility wrapper.
4. `server/routes/payments.js` (NEW)
   * Endpoints: `POST /`, `GET /`, `GET /:id`, `POST /:id/allocate`, `POST /:id/reverse`, `POST /:paymentId/allocations/:allocationId/reverse`.
5. `server/server.js` (MODIFY)
   * Mount `/api/v1/payments` router.
6. `server/migrations/migrate_invoice_payment_fields.js` (NEW — Step 1)
   * Sets `amountPaid`, `outstandingAmount`, `historicalReconciliationState` per Classification Matrix.

---

## 31. COMPREHENSIVE ADVERSARIAL TEST MATRIX (59 Cases)

| # | Test Scenario | Expected Outcome |
|---|---|---|
| 1 | Full Payment Lifecycle (Receipt + Allocation) | Step 1: Dr Bank 500, Cr Deposit 500. Step 2: Dr Deposit 500, Cr AR 500. Inv status='paid', outstanding=0. |
| 2 | Partial Payment Lifecycle | Step 1: Dr Bank 300, Cr Deposit 300. Step 2: Dr Deposit 300, Cr AR 300. Inv status='partially_paid', outstanding=200. |
| 3 | Multiple Payments against single Invoice | Two partial payments accumulate `amountPaid`. Final payment sets status='paid', outstanding=0. |
| 4 | One Payment Split Across Multiple Invoices | Payment €1000 creates 2 allocations (€400, €600). Each invoice balance decrements accurately. Deposit nets 0. |
| 5 | Pure Unapplied Payment (Customer Deposit) | Payment €1000 with 0 allocations. Dr Bank €1000, Cr 438 €1000. `Payment.status = 'unallocated'`, unapplied=€1000. |
| 6 | Overpayment Handling | Payment €700 against €500 invoice. €500 allocated (Dr 438, Cr 430). €200 remains in 438. `unappliedAmount = 200`. |
| 7 | Mandatory Idempotency Key Missing (Payment) | `POST /payments` without `x-idempotency-key` returns **`400 Bad Request`**. |
| 8 | Duplicate Legitimate Payments with Different Keys | Two identical €500 payments for same customer with distinct keys are **both allowed**. |
| 9 | Idempotent Payment Replay | Replaying same `x-idempotency-key` and payload returns cached 201 response with 0 duplicate JEs. |
| 10 | Idempotency Key Payload Conflict | Replaying same `x-idempotency-key` with modified amount returns **`409 Conflict`**. |
| 11 | Invalid Payment Method | Providing `method: 'Bitcoin'` returns **`400 Bad Request`**. |
| 12 | Valid Payment Method Defaulting | Omitting `method` defaults to `'Bank Transfer'` and resolves `defaultBankAccountId`. |
| 13 | Payment Account Override Valid | Providing valid treasury CoA ID (Account 570) resolves and posts Dr 570. |
| 14 | Payment Account Override Invalid (Inventory Asset) | Providing Inventory Asset CoA ID (Account 300) returns **`400 Bad Request`**. |
| 15 | Currency Mismatch | Providing `currency: 'USD'` returns **`400 Bad Request`** (EUR-only enforcement). |
| 16 | Stable Allocation ID Assignment | Allocation subdocument possesses immutable `allocationId: ObjectId`. |
| 17 | Allocation Reversal Accounting | Allocation reversal posts Dr 430 €500, Cr 438 €500. Restores `unappliedAmount` and `outstandingAmount`. |
| 18 | Allocation Reversal Immutability | Allocation document is NOT deleted; marked `isReversed: true` with audit fields. |
| 19 | Duplicate Allocation Reversal | Re-reversing already reversed allocation is idempotent (returns 200, no duplicate JE). |
| 20 | Master Payment Reversal Blocked by Active Allocations | `POST /payments/:id/reverse` fails with **`400 Bad Request`** if any allocation is not yet reversed. |
| 21 | Master Payment Reversal Mirror Accounting | After allocations reversed, payment reversal mirror-swaps original JE: Dr 438 €700, Cr Bank €700. |
| 22 | Payment Reversal in Closed Fiscal Period | JE hook catches closed period on reversal date and aborts with **`400 Bad Request`**. |
| 23 | Invoice Cancellation Mirror Reversal | Cancelling issued invoice mirrors original issuance JE (Dr 430.9, Dr 477.0, Cr 430). |
| 24 | Invoice Cancellation Blocked on Paid/Partially Paid | Cancelling invoice with `amountPaid > 0` returns **`400 Bad Request`**. |
| 25 | Invoice Cancellation Hard Fail on Missing Issuance JE | Issued invoice missing `accountingJournalEntryId` hard fails with 500. Never guesses lines. |
| 26 | Elimination of Bypass: Generic `PUT /:id` | Attempting to update status to `'paid'` via `PUT /:id` returns **`400 Bad Request`**. |
| 27 | Elimination of Bypass: Modifying Issued Invoice Lines | Attempting to alter lines/totals of an issued invoice via `PUT /:id` returns **`400 Bad Request`**. |
| 28 | Concurrent Allocation Race (Double-Spend Protection) | Two concurrent allocations exceeding `unappliedAmount` trigger OCC version conflict (`409`). |
| 29 | Tenant Isolation Enforcement | Attempting to allocate payment of Company A to invoice of Company B returns **`404 Not Found`**. |
| 30 | Customer Match Enforcement | Attempting to allocate payment of Customer A to invoice of Customer B returns **`400 Bad Request`**. |
| 31 | Backdated Payment Numbering | Payment with `paymentDate: 2025-12-30` entered in 2026 receives `PAY-2026-NNNNN`. |
| 32 | Historical Migration Classification | Ambiguous legacy paid invoices tagged `MANUAL_REVIEW_REQUIRED`, `outstandingAmount = null`. |
| 33 | Historical Paid Invoices Isolated | Legacy paid invoices marked `LEGACY_UNVERIFIED` with zero synthetic JEs backfilled. |
| 34 | Company-Level 438 Deposit Reconciliation | $\sum \text{unappliedAmount}$ matches GL Account 438 balance within float tolerance ($\pm 0.01$). |
| 35 | End-to-End AR Subledger vs GL Invariant | Full lifecycle of 10 payments, allocations, and reversals maintains active AR subledger vs GL balance. |
| 36 | Rollback A: Payment Creation JE Failure | Trigger failure during receipt JE creation. Verify Payment was NOT created and Counter rolled back. |
| 37 | Rollback B: Allocation JE Failure | Trigger failure during allocation JE creation. Verify allocation NOT appended and balances untouched. |
| 38 | Rollback C: Allocation Invoice Update Failure | Trigger failure during Invoice balance update. Verify allocation JE rolled back and Payment untouched. |
| 39 | Rollback D: Allocation Payment Update Failure | Trigger failure during Payment unapplied update. Verify allocation JE rolled back and Invoice untouched. |
| 40 | Rollback E: Allocation Reversal JE Failure | Trigger failure during allocation reversal JE. Verify allocation remains `isReversed: false` and balances unchanged. |
| 41 | Rollback F: Master Reversal JE Failure | Trigger failure during master payment reversal JE. Verify Payment remains active and balances unchanged. |
| 42 | Cancelled Invoice Zero Balance & GL Mirror | Cancel issued invoice (€500): JE reversed, `amountPaid = 0`, `outstandingAmount = 0`, GL 430 net is €0. |
| 43 | Cancelled Invoice Excluded from Active AR | Verify cancelled invoice does not appear in active AR balance summation. |
| 44 | Cache Repair Protection for LEGACY_UNVERIFIED | Run cache repair across database. Verify `LEGACY_UNVERIFIED` invoice retains `amountPaid = grandTotal`, `outstandingAmount = 0`. |
| 45 | LEGACY_UNVERIFIED Excluded from AR GL Invariant | Active AR subledger vs GL 430 equation holds without interference from `LEGACY_UNVERIFIED` invoices. |
| 46 | MANUAL_REVIEW_REQUIRED Allocation Block | Attempting to allocate payment against `MANUAL_REVIEW_REQUIRED` invoice returns **`400 Bad Request`**. |
| 47 | Historical State Immutability | Attempting to modify `historicalReconciliationState` via `PUT /:id` or cache repair is rejected. |
| 48 | MANUAL_REVIEW_REQUIRED Balance Consistency | Verify `MANUAL_REVIEW_REQUIRED` invoices always have `outstandingAmount = null` and are excluded from AR sum. |
| 49 | Cache Repair Ignores MANUAL_REVIEW_REQUIRED | Running cache repair preserves `outstandingAmount = null` on `MANUAL_REVIEW_REQUIRED` invoices. |
| 50 | Deterministic Reversal Path: Issued Baseline | `issued` → `partially_paid` → `paid` → reverse → `partially_paid` → reverse → **`issued`**. |
| 51 | Deterministic Reversal Path: Sent Baseline | `sent` → `partially_paid` → `paid` → reverse → `partially_paid` → reverse → **`sent`**. |
| 52 | Multi-Allocation Deterministic Restoration | Reversing multiple allocations restores exact previous state via `previousInvoiceStatus` snapshot. |
| 53 | **Active AR vs Quarantined Legacy AR Segregation** | Verify $\text{Active AR} \equiv \text{Raw GL 430} - \text{Quarantined Legacy AR Exposure}$. |
| 54 | **Historical Cancelled without Reversal JE Classification** | Historical cancelled invoice with unreversed issuance JE tagged `MANUAL_REVIEW_REQUIRED`, `outstandingAmount = null`. |
| 55 | **Mandatory Idempotency Key Missing (Allocation)** | `POST /payments/:id/allocate` without `x-idempotency-key` returns **`400 Bad Request`**. |
| 56 | **Allocation Idempotency Replay** | Replaying same key + same payload on allocation returns cached 200 with zero duplicate allocations or JEs. |
| 57 | **Allocation Idempotency Conflict** | Replaying same allocation key with different payload returns **`409 Conflict`**. |
| 58 | **Multiple Legitimate Allocations Allowed** | Making two separate allocations to same invoice with different keys succeeds. |
| 59 | **Out-of-Order Allocation Reversal Equivalence** | Verify (reverse A then B) produces identical final balances, status, and GL impact as (reverse B then A). |

---

## 32. FINAL REMEDIATION SUMMARY & GATE VERDICT

### Summary of Resolved Contradictions:
1. **Quarantined Legacy AR Segregation:** Raw GL Account 430 is explicitly segregated: $\text{Raw GL 430} \equiv \text{Active Subledger AR} + \text{Quarantined Legacy AR Exposure}$. Active AR reconciliation is mathematically airtight.
2. **Historical Cancelled Invoice Quarantine:** Historical cancelled invoices with unreversed issuance JEs are classified as `MANUAL_REVIEW_REQUIRED` (`_migrationNote = 'HISTORICAL_CANCELLED_WITHOUT_REVERSAL_JE'`), preventing orphaned issuance debits from corrupting active AR.
3. **Allocation Idempotency Contracts:** Mandatory `x-idempotency-key` on `POST /payments/:id/allocate` with strict replay caching (200) and payload conflict detection (409). Permits multiple legitimate allocations with distinct keys.
4. **Out-of-Order Reversal Order Invariance:** Multi-step allocation reversals deterministically restore true baseline status (`'issued'` vs `'sent'`) regardless of reversal sequence (A-then-B vs B-then-A) via earliest historical allocation snapshot.
5. **Adversarial Test Matrix:** Expanded to **59 comprehensive tests**, covering all transaction rollbacks, legacy quarantines, idempotency contracts, and reversal permutations.

# FINAL PRE-IMPLEMENTATION GATE

**VERDICT: GO**

Remaining Unresolved Items: **NONE (0)**
