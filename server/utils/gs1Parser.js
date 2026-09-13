/**
 * Pure GS1 Application Identifier (AI) Barcode Parser (Stage 6)
 *
 * Implements the frozen GS1 specification:
 * - Supported Application Identifiers:
 *     AI (00)   -> SSCC-18 (18 digits, modulo-10 check digit)
 *     AI (01)   -> GTIN-14 (14 digits, modulo-10 check digit)
 *     AI (10)   -> Lot / Batch Number (1-20 alphanumeric characters)
 *     AI (17)   -> Expiry Date YYMMDD (normalized to YYYY-MM-DD)
 *     AI (30)   -> Variable Count (1-8 numeric digits)
 *     AI (310n) -> Net Weight in kilograms (6 numeric digits with decimal n)
 *     AI (37)   -> Number of Units (1-8 numeric digits)
 *
 * Purely functional: Zero database calls, zero network calls, zero side effects.
 */

// ASCII 29 Group Separator
const GS = String.fromCharCode(29);

/**
 * Calculates and verifies GS1 Modulo-10 check digit.
 * Odd positions from right (excluding check digit) have weight 3, even have weight 1.
 *
 * @param {string} digits - Full numeric string including check digit at the end
 * @returns {boolean} True if check digit is valid
 */
export function validateGS1CheckDigit(digits) {
  if (!digits || typeof digits !== 'string' || !/^\d+$/.test(digits)) {
    return false;
  }
  const len = digits.length;
  const expectedCheckDigit = parseInt(digits[len - 1], 10);
  let sum = 0;

  for (let i = 0; i < len - 1; i++) {
    const d = parseInt(digits[i], 10);
    const posFromRight = (len - 1) - i;
    const weight = posFromRight % 2 === 1 ? 3 : 1;
    sum += d * weight;
  }

  const calculatedCheckDigit = (10 - (sum % 10)) % 10;
  return calculatedCheckDigit === expectedCheckDigit;
}

/**
 * Normalizes barcode input by resolving human-readable parentheses or bracketed tokens.
 * e.g. "(01)10012345678902(10)LOT1" or "<GS>" -> stream representation with GS.
 */
function normalizeBarcodeString(raw) {
  if (typeof raw !== 'string') return '';
  let str = raw.trim();

  // Replace common scanner tokens with ASCII 29
  str = str.replace(/<GS>/gi, GS).replace(/\[GS\]/gi, GS).replace(/\^\]/g, GS);

  // If input uses parenthesis notation e.g. "(01)...(10)...", convert to standard stream
  if (str.includes('(') && str.includes(')')) {
    const parts = [];
    const regex = /\((\d{2,4})\)([^()]*)/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      const ai = match[1];
      const val = match[2];
      parts.push({ ai, val });
    }

    if (parts.length > 0) {
      let reconstructed = '';
      for (let i = 0; i < parts.length; i++) {
        const { ai, val } = parts[i];
        reconstructed += ai + val;
        // If variable length and not the last element, append GS
        if (['10', '30', '37'].includes(ai) && i < parts.length - 1) {
          reconstructed += GS;
        }
      }
      return reconstructed;
    }
  }

  return str;
}

/**
 * Validates calendar date and resolves century for YYMMDD.
 * Standard sliding window: 00..50 -> 2000..2050, 51..99 -> 1951..1999.
 * Day 00 is resolved to the last day of the month per GS1 General Specifications.
 */
function parseGS1Date(yymmdd) {
  if (!yymmdd || yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) {
    return { valid: false, error: 'Expiry date must be exactly 6 numeric digits (YYMMDD)' };
  }

  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = parseInt(yymmdd.substring(2, 4), 10);
  let dd = parseInt(yymmdd.substring(4, 6), 10);

  if (mm < 1 || mm > 12) {
    return { valid: false, error: `Invalid expiry month: ${mm} (must be 01-12)` };
  }

  const fullYear = yy <= 50 ? 2000 + yy : 1900 + yy;

  // Days in month calculation (accounting for leap years)
  const isLeapYear = (fullYear % 4 === 0 && fullYear % 100 !== 0) || (fullYear % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[mm - 1];

  if (dd === 0) {
    // GS1 rule: day 00 indicates last day of month
    dd = maxDay;
  } else if (dd < 1 || dd > maxDay) {
    return { valid: false, error: `Invalid expiry day: ${dd} for month ${mm} in year ${fullYear}` };
  }

  const formattedMonth = String(mm).padStart(2, '0');
  const formattedDay = String(dd).padStart(2, '0');
  const isoDate = `${fullYear}-${formattedMonth}-${formattedDay}`;

  return { valid: true, date: isoDate };
}

/**
 * Parses a GS1 Barcode string into structured application data.
 *
 * @param {string} rawInput - The raw barcode string
 * @returns {Object} Structured parse result or error
 */
export function parseGS1Barcode(rawInput) {
  if (rawInput === null || rawInput === undefined || typeof rawInput !== 'string') {
    return {
      success: false,
      error: {
        code: 'INVALID_GS1_BARCODE',
        message: 'Barcode input must be a non-empty string',
        position: 0
      }
    };
  }

  const input = normalizeBarcodeString(rawInput);
  if (!input) {
    return {
      success: false,
      error: {
        code: 'INVALID_GS1_BARCODE',
        message: 'Barcode input is empty after trimming',
        position: 0
      }
    };
  }

  const data = {};
  const rawElements = [];
  const encounteredAIs = new Set();
  let idx = 0;
  const len = input.length;

  while (idx < len) {
    // Skip any leading GS separators
    if (input[idx] === GS) {
      idx++;
      continue;
    }

    // Determine Application Identifier (2-digit or 4-digit)
    const ai2 = input.substring(idx, idx + 2);
    const ai4 = input.substring(idx, idx + 4);

    // AI (01) -> GTIN-14
    if (ai2 === '01') {
      if (encounteredAIs.has('01')) {
        return { success: false, error: { code: 'DUPLICATE_GS1_AI', message: 'Duplicate AI (01) encountered', ai: '01', position: idx } };
      }
      idx += 2;
      const val = input.substring(idx, idx + 14);
      if (val.length < 14) {
        return { success: false, error: { code: 'TRUNCATED_GS1_ELEMENT', message: 'AI (01) GTIN-14 is truncated', ai: '01', position: idx } };
      }
      if (!/^\d{14}$/.test(val)) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (01) GTIN-14 must contain exactly 14 digits', ai: '01', position: idx } };
      }
      if (!validateGS1CheckDigit(val)) {
        return { success: false, error: { code: 'INVALID_CHECK_DIGIT', message: 'AI (01) GTIN-14 check digit validation failed', ai: '01', position: idx } };
      }
      data.gtin14 = val;
      rawElements.push({ ai: '01', name: 'gtin14', value: val });
      encounteredAIs.add('01');
      idx += 14;
      continue;
    }

    // AI (00) -> SSCC-18
    if (ai2 === '00') {
      if (encounteredAIs.has('00')) {
        return { success: false, error: { code: 'DUPLICATE_GS1_AI', message: 'Duplicate AI (00) encountered', ai: '00', position: idx } };
      }
      idx += 2;
      const val = input.substring(idx, idx + 18);
      if (val.length < 18) {
        return { success: false, error: { code: 'TRUNCATED_GS1_ELEMENT', message: 'AI (00) SSCC-18 is truncated', ai: '00', position: idx } };
      }
      if (!/^\d{18}$/.test(val)) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (00) SSCC-18 must contain exactly 18 digits', ai: '00', position: idx } };
      }
      if (!validateGS1CheckDigit(val)) {
        return { success: false, error: { code: 'INVALID_CHECK_DIGIT', message: 'AI (00) SSCC-18 check digit validation failed', ai: '00', position: idx } };
      }
      data.sscc18 = val;
      rawElements.push({ ai: '00', name: 'sscc18', value: val });
      encounteredAIs.add('00');
      idx += 18;
      continue;
    }

    // AI (17) -> Expiry Date YYMMDD
    if (ai2 === '17') {
      if (encounteredAIs.has('17')) {
        return { success: false, error: { code: 'DUPLICATE_GS1_AI', message: 'Duplicate AI (17) encountered', ai: '17', position: idx } };
      }
      idx += 2;
      const val = input.substring(idx, idx + 6);
      if (val.length < 6) {
        return { success: false, error: { code: 'TRUNCATED_GS1_ELEMENT', message: 'AI (17) Expiry date is truncated', ai: '17', position: idx } };
      }
      const parsedDate = parseGS1Date(val);
      if (!parsedDate.valid) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: parsedDate.error, ai: '17', position: idx } };
      }
      data.expiryDate = parsedDate.date;
      rawElements.push({ ai: '17', name: 'expiryDate', value: parsedDate.date });
      encounteredAIs.add('17');
      idx += 6;
      continue;
    }

    // AI (310n) -> Net Weight in kg
    if (/^310[0-9]/.test(ai4)) {
      if (encounteredAIs.has('310n')) {
        return { success: false, error: { code: 'DUPLICATE_GS1_AI', message: 'Duplicate AI (310n) encountered', ai: ai4, position: idx } };
      }
      const decimalDec = parseInt(ai4[3], 10);
      idx += 4;
      const val = input.substring(idx, idx + 6);
      if (val.length < 6) {
        return { success: false, error: { code: 'TRUNCATED_GS1_ELEMENT', message: 'AI (310n) weight value is truncated', ai: ai4, position: idx } };
      }
      if (!/^\d{6}$/.test(val)) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (310n) weight must contain exactly 6 digits', ai: ai4, position: idx } };
      }
      const rawInt = parseInt(val, 10);
      const weightKg = Number((rawInt / Math.pow(10, decimalDec)).toFixed(decimalDec));
      data.netWeightKg = weightKg;
      rawElements.push({ ai: ai4, name: 'netWeightKg', value: weightKg });
      encounteredAIs.add('310n');
      idx += 6;
      continue;
    }

    // AI (10) -> Lot / Batch Number (Variable length up to 20 chars)
    if (ai2 === '10') {
      if (encounteredAIs.has('10')) {
        return { success: false, error: { code: 'DUPLICATE_GS1_AI', message: 'Duplicate AI (10) encountered', ai: '10', position: idx } };
      }
      idx += 2;
      let endIdx = input.indexOf(GS, idx);
      if (endIdx === -1) endIdx = len;
      let val = input.substring(idx, endIdx);

      if (val.length === 0) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (10) lot number cannot be empty', ai: '10', position: idx } };
      }
      if (val.length > 20) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (10) lot number exceeds 20 characters', ai: '10', position: idx } };
      }

      data.lotNumber = val;
      rawElements.push({ ai: '10', name: 'lotNumber', value: val });
      encounteredAIs.add('10');
      idx = endIdx === len ? len : endIdx + 1;
      continue;
    }

    // AI (30) -> Variable Count (Variable length up to 8 digits)
    if (ai2 === '30') {
      if (encounteredAIs.has('30')) {
        return { success: false, error: { code: 'DUPLICATE_GS1_AI', message: 'Duplicate AI (30) encountered', ai: '30', position: idx } };
      }
      idx += 2;
      let endIdx = input.indexOf(GS, idx);
      if (endIdx === -1) endIdx = len;
      let val = input.substring(idx, endIdx);

      if (val.length === 0) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (30) variable count cannot be empty', ai: '30', position: idx } };
      }
      if (val.length > 8 || !/^\d+$/.test(val)) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (30) count must be 1 to 8 digits', ai: '30', position: idx } };
      }

      const countNum = parseInt(val, 10);
      data.variableCount = countNum;
      rawElements.push({ ai: '30', name: 'variableCount', value: countNum });
      encounteredAIs.add('30');
      idx = endIdx === len ? len : endIdx + 1;
      continue;
    }

    // AI (37) -> Number of Units (Variable length up to 8 digits)
    if (ai2 === '37') {
      if (encounteredAIs.has('37')) {
        return { success: false, error: { code: 'DUPLICATE_GS1_AI', message: 'Duplicate AI (37) encountered', ai: '37', position: idx } };
      }
      idx += 2;
      let endIdx = input.indexOf(GS, idx);
      if (endIdx === -1) endIdx = len;
      let val = input.substring(idx, endIdx);

      if (val.length === 0) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (37) number of units cannot be empty', ai: '37', position: idx } };
      }
      if (val.length > 8 || !/^\d+$/.test(val)) {
        return { success: false, error: { code: 'INVALID_GS1_VALUE', message: 'AI (37) units must be 1 to 8 digits', ai: '37', position: idx } };
      }

      const unitsNum = parseInt(val, 10);
      data.numberOfUnits = unitsNum;
      rawElements.push({ ai: '37', name: 'numberOfUnits', value: unitsNum });
      encounteredAIs.add('37');
      idx = endIdx === len ? len : endIdx + 1;
      continue;
    }

    // If we reach here, an unsupported AI or malformed character sequence was encountered
    const unknownAi = ai4.startsWith('31') ? ai4 : ai2;
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_GS1_AI',
        message: `Unsupported or invalid GS1 Application Identifier: '${unknownAi}'`,
        ai: unknownAi,
        position: idx
      }
    };
  }

  if (rawElements.length === 0) {
    return {
      success: false,
      error: {
        code: 'INVALID_GS1_BARCODE',
        message: 'No valid GS1 Application Identifiers found in input',
        position: 0
      }
    };
  }

  return {
    success: true,
    data,
    rawElements
  };
}
