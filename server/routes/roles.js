import express from 'express';
import Role from '../models/Role.js';
import User from '../models/User.js';
import { protect, requireRole, csrfProtection } from '../middleware/auth.js';
import { ROLE_DEFINITIONS, PERMISSION_MODULES, ROLE_PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

router.use(protect);

/**
 * GET /api/v1/roles
 * Returns all roles applicable to the user's company (system roles + company custom roles/overrides).
 */
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.user.company;
    if (!companyId) {
      return res.status(403).json({ message: 'Company context required' });
    }

    // Fetch company custom roles / overrides
    const customRoles = await Role.find({ company: companyId }).lean();
    const customRoleMap = new Map();
    for (const r of customRoles) {
      customRoleMap.set(r.roleId, r);
    }

    // Merge system definitions with company overrides
    const resultRoles = ROLE_DEFINITIONS.map(sysRole => {
      if (customRoleMap.has(sysRole.id)) {
        const override = customRoleMap.get(sysRole.id);
        customRoleMap.delete(sysRole.id);
        const permsObj = override.permissions instanceof Map
          ? Object.fromEntries(override.permissions)
          : (override.permissions || sysRole.permissions);

        return {
          id: sysRole.id,
          name: override.name || sysRole.name,
          description: override.description || sysRole.description,
          color: override.color || sysRole.color,
          isSystem: true,
          permissions: permsObj
        };
      }
      return {
        ...sysRole,
        permissions: { ...sysRole.permissions }
      };
    });

    // Append custom roles created by the company
    for (const [_, customRole] of customRoleMap) {
      const permsObj = customRole.permissions instanceof Map
        ? Object.fromEntries(customRole.permissions)
        : (customRole.permissions || {});

      resultRoles.push({
        id: customRole.roleId,
        name: customRole.name,
        description: customRole.description || '',
        color: customRole.color || 'text-indigo-500 bg-indigo-500/10',
        isSystem: false,
        permissions: permsObj,
        _id: customRole._id
      });
    }

    res.json({
      roles: resultRoles,
      availableModules: PERMISSION_MODULES
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/roles
 * Create a new custom role for the company.
 * Requires admin role. Prevents privilege escalation.
 */
router.post('/', csrfProtection, requireRole('admin'), async (req, res, next) => {
  try {
    const companyId = req.user.company;
    if (!companyId) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { name, roleId: requestedId, description, color, permissions } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Role name is required' });
    }

    const roleId = (requestedId || name.toLowerCase().replace(/[^a-z0-9_]/g, '_')).trim().toLowerCase();
    if (!roleId || roleId.length < 2) {
      return res.status(400).json({ message: 'Valid role identifier is required' });
    }

    // Prevent overwriting system roles via POST
    const isSystemRole = ROLE_DEFINITIONS.some(r => r.id === roleId);
    if (isSystemRole) {
      return res.status(400).json({
        message: `Role ID '${roleId}' is reserved for built-in system roles. Use PUT to modify permissions.`
      });
    }

    // Check duplicate role in this company
    const existing = await Role.findOne({ company: companyId, roleId });
    if (existing) {
      return res.status(400).json({ message: `Role '${roleId}' already exists in this company` });
    }

    // Normalize permissions to valid modules only
    const normalizedPerms = {};
    for (const mod of PERMISSION_MODULES) {
      normalizedPerms[mod] = Boolean(permissions?.[mod]);
    }

    const newRole = await Role.create({
      company: companyId,
      roleId,
      name: name.trim(),
      description: (description || '').trim(),
      color: color || 'text-indigo-500 bg-indigo-500/10',
      isSystem: false,
      permissions: normalizedPerms
    });

    res.status(201).json({
      id: newRole.roleId,
      name: newRole.name,
      description: newRole.description,
      color: newRole.color,
      isSystem: false,
      permissions: normalizedPerms,
      _id: newRole._id
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/roles/:roleId
 * Update role permissions or metadata.
 * Requires admin role. Prevents revoking admin's own admin/settings access.
 */
router.put('/:roleId', csrfProtection, requireRole('admin'), async (req, res, next) => {
  try {
    const companyId = req.user.company;
    if (!companyId) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const roleId = req.params.roleId.toLowerCase().trim();
    const { name, description, color, permissions } = req.body;

    // Security guard: Admin role cannot have core permissions revoked
    if (roleId === 'admin') {
      if (permissions && (permissions.admin === false || permissions.settings === false)) {
        return res.status(400).json({
          message: 'Security policy: Administrator role cannot have admin or settings permissions revoked'
        });
      }
    }

    // Normalize permissions to valid modules
    const normalizedPerms = {};
    if (permissions && typeof permissions === 'object') {
      for (const mod of PERMISSION_MODULES) {
        if (roleId === 'admin' && (mod === 'admin' || mod === 'settings')) {
          normalizedPerms[mod] = true;
        } else {
          normalizedPerms[mod] = Boolean(permissions[mod]);
        }
      }
    }

    const isSystemRole = ROLE_DEFINITIONS.some(r => r.id === roleId);

    if (!isSystemRole) {
      const exists = await Role.findOne({ company: companyId, roleId });
      if (!exists) {
        return res.status(404).json({ message: `Role '${roleId}' not found` });
      }
    }

    const updateFields = {
      permissions: normalizedPerms
    };
    if (name) updateFields.name = name.trim();
    if (description !== undefined) updateFields.description = description.trim();
    if (color) updateFields.color = color.trim();
    if (isSystemRole) updateFields.isSystem = true;

    const updated = await Role.findOneAndUpdate(
      { company: companyId, roleId },
      { $set: updateFields },
      { new: true, upsert: isSystemRole, setDefaultsOnInsert: true }
    );

    res.json({
      id: updated.roleId,
      name: updated.name || (ROLE_DEFINITIONS.find(r => r.id === roleId)?.name || roleId),
      description: updated.description,
      color: updated.color,
      isSystem: isSystemRole,
      permissions: normalizedPerms,
      _id: updated._id
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/roles/:roleId
 * Delete a custom role.
 * Security: Rejects deleting system roles or roles currently in use by company users.
 */
router.delete('/:roleId', csrfProtection, requireRole('admin'), async (req, res, next) => {
  try {
    const companyId = req.user.company;
    if (!companyId) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const roleId = req.params.roleId.toLowerCase().trim();

    // Prevent deleting system roles
    const isSystemRole = ROLE_DEFINITIONS.some(r => r.id === roleId);
    if (isSystemRole) {
      return res.status(400).json({ message: `Cannot delete built-in system role '${roleId}'` });
    }

    // Check if any user in this company is assigned this role
    const usersWithRole = await User.countDocuments({ company: companyId, role: roleId });
    if (usersWithRole > 0) {
      return res.status(400).json({
        message: `Cannot delete role '${roleId}': it is currently assigned to ${usersWithRole} user(s). Reassign them first.`
      });
    }

    const deleted = await Role.findOneAndDelete({ company: companyId, roleId });
    if (!deleted) {
      return res.status(404).json({ message: `Role '${roleId}' not found` });
    }

    res.json({ message: `Role '${roleId}' successfully deleted` });
  } catch (err) {
    next(err);
  }
});

export default router;
