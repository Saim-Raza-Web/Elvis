import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { protect, getJwtSecret, generateCsrfToken, csrfProtection } from '../middleware/auth.js';
import {
  generateTotpSecret,
  generateProvisioningUri,
  generateQrCode,
  verifyTotpCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
  logTotpEvent,
  checkRateLimit,
  clearRateLimit,
  onSuccessfulVerification
} from '../services/totpService.js';

import Company from '../models/Company.js';

const router = express.Router();

/**
 * Helper to set HttpOnly cookie with appropriate security settings
 */
function setAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  const expiresInDays = 7; // Match default JWT_EXPIRES_IN
  
  res.cookie('jwt_token', token, {
    httpOnly: true,
    secure: isProduction, // Secure flag only in production
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    // Don't set domain unless deploying to subdomain
  });
}

/**
 * Helper to set CSRF token cookie
 */
function setCsrfCookie(res, csrfToken) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.cookie('csrf_token', csrfToken, {
    httpOnly: false, // Client needs to read this for state-changing requests
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

// Register route
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new Company for the user
    const company = await Company.create({
      name: `${name || email.split('@')[0]}'s Workspace`,
      plan: 'starter'
    });
    
    const user = await User.create({ email, password: hashedPassword, name, role: 'admin', company: company._id });
    
    // Link user to company
    company.users.push(user._id);
    await company.save();
    
    const secret = getJwtSecret();
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    const token = jwt.sign({ id: user._id }, secret, {
      expiresIn
    });
    
    // Issue HttpOnly cookie
    setAuthCookie(res, token);
    
    // Generate and set CSRF token
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    
    // Return user data without token (token is now in cookie)
    const userWithoutPassword = await User.findById(user._id).select('-password');
    return res.status(201).json({ 
      user: userWithoutPassword,
      csrfToken 
    });
  } catch (error) {
    next(error);
  }
});

// Login route
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    
    // If 2FA is enabled, issue a challenge token instead of full session
    if (user.totpEnabled) {
      const secret = getJwtSecret();
      const challengeToken = jwt.sign(
        { id: user._id, type: '2fa_challenge' },
        secret,
        { expiresIn: '5m' } // Short-lived for 2FA verification
      );
      
      await logTotpEvent(user._id, user.company, 'login_challenge', { email: user.email });
      
      return res.json({
        requires2FA: true,
        challengeToken,
        message: 'Two-factor authentication required'
      });
    }
    
    // Standard login without 2FA
    const secret = getJwtSecret();
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    const token = jwt.sign({ id: user._id }, secret, {
      expiresIn
    });
    
    // Issue HttpOnly cookie
    setAuthCookie(res, token);
    
    // Generate and set CSRF token
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    
    // Return user data without token (token is now in cookie)
    const userWithoutPassword = await User.findById(user._id).select('-password');
    return res.json({ 
      user: userWithoutPassword,
      csrfToken 
    });
  } catch (error) {
    next(error);
  }
});

// Protected route
router.get('/me', protect, csrfProtection, async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');

  // Generate new CSRF token for the session
  const csrfToken = generateCsrfToken();
  setCsrfCookie(res, csrfToken);

  res.json({ user, csrfToken });
});

// Logout route
router.post('/logout', protect, csrfProtection, async (req, res) => {
  // Clear auth cookie
  res.clearCookie('jwt_token', {
    path: '/',
    // Match the sameSite settings used when setting
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  });
  
  // Clear CSRF cookie
  res.clearCookie('csrf_token', {
    path: '/',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  });
  
  res.json({ message: 'Logged out successfully' });
});

/**
 * POST /api/v1/auth/2fa/verify-login
 * Verify TOTP or recovery code during login
 */
router.post('/2fa/verify-login', async (req, res, next) => {
  try {
    const { challengeToken, code, isRecoveryCode = false } = req.body;
    
    if (!challengeToken || !code) {
      return res.status(400).json({ message: 'Challenge token and code are required' });
    }

    // Verify challenge token
    const secret = getJwtSecret();
    let decoded;
    try {
      decoded = jwt.verify(challengeToken, secret);
    } catch (error) {
      return res.status(401).json({ message: 'Invalid or expired challenge token' });
    }

    if (decoded.type !== '2fa_challenge') {
      return res.status(401).json({ message: 'Invalid challenge token type' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.totpEnabled) {
      return res.status(401).json({ message: 'Invalid user or 2FA not enabled' });
    }

    // Rate limit verification attempts (atomic sliding window check and record)
    const rateLimit = await checkRateLimit(user._id, req);
    if (!rateLimit.allowed) {
      if (rateLimit.retryAfter) {
        res.set('Retry-After', String(rateLimit.retryAfter));
      }
      return res.status(rateLimit.statusCode || 429).json({ message: rateLimit.message });
    }

    let verification;
    
    if (isRecoveryCode) {
      // Verify recovery code
      verification = verifyRecoveryCode(code, user.totpRecoveryCodes);
      
      if (verification.valid) {
        // Atomically remove used recovery code to prevent race conditions
        const hashedCode = hashRecoveryCode(code);
        const updatedUser = await User.findByIdAndUpdate(
          user._id,
          { $pull: { totpRecoveryCodes: hashedCode } },
          { returnDocument: 'after' }
        );
        
        if (!updatedUser) {
          return res.status(500).json({ message: 'Failed to consume recovery code' });
        }
        
        await logTotpEvent(user._id, user.company, 'recovery_code_used', { remainingCodes: updatedUser.totpRecoveryCodes.length });
      }
    } else {
      // Verify TOTP code
      const totpSecret = user.getTotpSecret();
      verification = await verifyTotpCode(code, totpSecret, user.totpLastUsed);
      
      if (verification.valid) {
        // Atomic update to prevent race condition: only set totpLastUsed if it hasn't been set to this code
        const updatedUser = await User.findOneAndUpdate(
          { _id: user._id, $or: [{ totpLastUsed: { $ne: code } }, { totpLastUsed: { $exists: false } }] },
          { $set: { totpLastUsed: code } },
          { returnDocument: 'after' }
        );
        
        if (!updatedUser) {
          // Race condition: another request already used this code
          verification = { valid: false, message: 'Code already used' };
        }
      }
    }

    if (!verification.valid) {
      await logTotpEvent(user._id, user.company, 'login_failed', { reason: verification.message });
      return res.status(400).json({ message: verification.message });
    }

    // Issue full session token
    const sessionToken = jwt.sign({ id: user._id }, secret, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
    
    // Issue HttpOnly cookie
    setAuthCookie(res, sessionToken);
    
    // Generate and set CSRF token
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    
    // Apply success policy to rate limiter
    await onSuccessfulVerification(user._id, req, rateLimit.memberId);
    
    await logTotpEvent(user._id, user.company, 'login_success', { method: isRecoveryCode ? 'recovery_code' : 'totp' });
    
    // Return user data without token
    const userWithoutPassword = await User.findById(user._id).select('-password');
    return res.json({
      user: userWithoutPassword,
      csrfToken,
      message: 'Login successful'
    });
  } catch (error) {
    next(error);
  }
});

// Get all companies the user belongs to
router.get('/companies', protect, csrfProtection, async (req, res, next) => {
  try {
    const companies = await Company.find({ users: req.user._id });
    res.json(companies);
  } catch (error) {
    next(error);
  }
});

// Switch active company
router.put('/company/:id', protect, csrfProtection, async (req, res, next) => {
  try {
    const companyId = req.params.id;
    // Verify the user belongs to this company
    const company = await Company.findOne({ _id: companyId, users: req.user._id });
    if (!company) {
      return res.status(403).json({ message: 'Access denied or company not found' });
    }

    // Update active company on user
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { company: companyId },
      { new: true }
    ).select('-password');

    res.json(updatedUser);
  } catch (error) {
    next(error);
  }
});

// Create a new company
router.post('/companies', protect, csrfProtection, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Company name is required' });

    const newCompany = await Company.create({
      name,
      plan: 'starter'
    });

    // Add user to company users array
    newCompany.users.push(req.user._id);
    await newCompany.save();

    // Automatically switch active context
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { company: newCompany._id },
      { new: true }
    ).select('-password');

    res.status(201).json({ company: newCompany, user: updatedUser });
  } catch (error) {
    next(error);
  }
});

router.put('/password', protect, csrfProtection, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

// ── TOTP Two-Factor Authentication Routes ──

/**
 * POST /api/v1/auth/2fa/setup
 * Start TOTP setup - generates secret and QR code
 */
router.post('/2fa/setup', protect, csrfProtection, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Check if 2FA is already enabled
    if (user.totpEnabled) {
      return res.status(400).json({ message: '2FA is already enabled' });
    }

    // Check if there's already a pending setup
    if (user.totpSetupPending) {
      return res.status(400).json({ message: '2FA setup already in progress. Complete or cancel the current setup first.' });
    }

    // Generate new TOTP secret
    const secret = generateTotpSecret();
    const provisioningUri = generateProvisioningUri(user.email, secret, 'Elvis WMS');
    const qrCode = await generateQrCode(provisioningUri);

    // Store secret as pending (not yet enabled)
    user.setTotpSecret(secret);
    user.totpSetupPending = true;
    await user.save();

    await logTotpEvent(user._id, user.company, 'setup_started', { email: user.email });

    res.json({
      secret,
      qrCode,
      message: 'Scan the QR code with your authenticator app'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/2fa/verify
 * Verify TOTP code to enable 2FA
 */
router.post('/2fa/verify', protect, csrfProtection, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    const user = await User.findById(req.user._id);
    
    if (!user.totpSetupPending) {
      return res.status(400).json({ message: 'No pending 2FA setup' });
    }

    // Rate limit setup verification attempts
    const rateLimit = await checkRateLimit(req.user._id, req);
    if (!rateLimit.allowed) {
      if (rateLimit.retryAfter) {
        res.set('Retry-After', String(rateLimit.retryAfter));
      }
      return res.status(rateLimit.statusCode || 429).json({ message: rateLimit.message });
    }

    const secret = user.getTotpSecret();
    const verification = await verifyTotpCode(code, secret, user.totpLastUsed);

    if (!verification.valid) {
      await logTotpEvent(user._id, user.company, 'verify_failed', { reason: verification.message });
      return res.status(400).json({ message: verification.message });
    }

    // Generate recovery codes
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = recoveryCodes.map(hashRecoveryCode);

    // Enable 2FA
    user.totpEnabled = true;
    user.totpSetupPending = false;
    user.totpRecoveryCodes = hashedRecoveryCodes;
    user.totpLastUsed = code;
    await user.save();

    await logTotpEvent(user._id, user.company, 'enabled', { recoveryCodesCount: recoveryCodes.length });

    // Apply success policy to rate limiter
    await onSuccessfulVerification(user._id, req, rateLimit.memberId);

    res.json({
      message: '2FA enabled successfully',
      recoveryCodes,
      warning: 'Save these recovery codes securely. They will not be shown again.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/2fa/disable
 * Disable 2FA (requires password re-authentication)
 */
router.post('/2fa/disable', protect, csrfProtection, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: 'Password is required to disable 2FA' });
    }

    const user = await User.findById(req.user._id);
    
    if (!user.totpEnabled) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    // Disable 2FA
    user.totpEnabled = false;
    user.totpSecret = undefined;
    user.totpRecoveryCodes = [];
    user.totpLastUsed = undefined;
    await user.save();

    await logTotpEvent(user._id, user.company, 'disabled', { reason: 'User initiated' });

    res.json({ message: '2FA disabled successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/2fa/regenerate-codes
 * Regenerate recovery codes (requires password re-authentication)
 */
router.post('/2fa/regenerate-codes', protect, csrfProtection, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: 'Password is required to regenerate codes' });
    }

    const user = await User.findById(req.user._id);
    
    if (!user.totpEnabled) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    // Generate new recovery codes
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = recoveryCodes.map(hashRecoveryCode);

    user.totpRecoveryCodes = hashedRecoveryCodes;
    await user.save();

    await logTotpEvent(user._id, user.company, 'regenerated_codes', { recoveryCodesCount: recoveryCodes.length });

    res.json({
      message: 'Recovery codes regenerated',
      recoveryCodes,
      warning: 'Save these new recovery codes securely. Previous codes are now invalid.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/auth/2fa/status
 * Get 2FA status for current user
 */
router.get('/2fa/status', protect, csrfProtection, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('totpEnabled totpSetupPending');
    res.json({
      enabled: user.totpEnabled,
      setupPending: user.totpSetupPending
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/2fa/cancel-setup
 * Cancel pending 2FA setup
 */
router.post('/2fa/cancel-setup', protect, csrfProtection, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user.totpSetupPending) {
      return res.status(400).json({ message: 'No pending 2FA setup to cancel' });
    }

    // Clear pending setup
    user.totpSecret = undefined;
    user.totpSetupPending = false;
    await user.save();

    await logTotpEvent(user._id, user.company, 'setup_cancelled', { email: user.email });

    res.json({ message: '2FA setup cancelled' });
  } catch (error) {
    next(error);
  }
});

export default router;
