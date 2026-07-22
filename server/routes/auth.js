import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

import Company from '../models/Company.js';

const router = express.Router();

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
      plan: 'free'
    });
    
    const user = await User.create({ email, password: hashedPassword, name, role: 'admin', company: company._id });
    
    // Link user to company
    company.users.push(user._id);
    await company.save();
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_key';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    const token = jwt.sign({ id: user._id }, secret, {
      expiresIn
    });
    return res.status(201).json({ token, user });
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
    
    const secret = process.env.JWT_SECRET || 'fallback_secret_key';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    const token = jwt.sign({ id: user._id }, secret, {
      expiresIn
    });
    
    return res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

// Protected route
router.get('/me', protect, async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  res.json(user);
});

// Get all companies the user belongs to
router.get('/companies', protect, async (req, res, next) => {
  try {
    const companies = await Company.find({ users: req.user._id });
    res.json(companies);
  } catch (error) {
    next(error);
  }
});

// Switch active company
router.put('/company/:id', protect, async (req, res, next) => {
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
router.post('/companies', protect, async (req, res, next) => {
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

export default router;
