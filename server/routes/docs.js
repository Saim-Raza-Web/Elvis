import express from 'express';

const router = express.Router();

/**
 * OpenAPI 3.0.3 Specification for Elvis WMS API
 */
const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Elvis WMS API',
    version: '1.2.0',
    description: 'Enterprise Warehouse Management System REST API with multi-tenancy, TOTP 2FA, granular role-based access control, inventory integrity, and real-time operations.'
  },
  servers: [
    {
      url: '/api/v1',
      description: 'Current Environment API Base'
    }
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'jwt_token',
        description: 'HttpOnly authentication cookie issued upon successful login or 2FA verification.'
      },
      csrfAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description: 'CSRF token required on all state-changing requests (POST, PUT, PATCH, DELETE) when using cookie authentication.'
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Bearer token for programmatic, script, or legacy client integrations.'
      }
    }
  },
  security: [
    { cookieAuth: [], csrfAuth: [] },
    { bearerAuth: [] }
  ],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'User Login & 2FA Challenge Initiation',
        description: 'Authenticates user with email and password. Returns full session cookie if 2FA is disabled, or a challenge token if 2FA is required.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'admin@elvis.io' },
                  password: { type: 'string', format: 'password', example: 'password123' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Login successful or 2FA challenge issued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { type: 'object' },
                    csrfToken: { type: 'string' },
                    requires2FA: { type: 'boolean' },
                    challengeToken: { type: 'string' }
                  }
                }
              }
            }
          },
          '401': { description: 'Invalid credentials' }
        }
      }
    },
    '/auth/2fa/verify-login': {
      post: {
        tags: ['Authentication', '2FA'],
        summary: 'Verify 2FA Challenge & Establish Session',
        description: 'Exchanges a short-lived 2FA challenge token and 6-digit TOTP code (or 8-character recovery code) for an authenticated session.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['challengeToken', 'code'],
                properties: {
                  challengeToken: { type: 'string' },
                  code: { type: 'string', example: '123456' },
                  isRecoveryCode: { type: 'boolean', default: false }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: '2FA verified. HttpOnly jwt_token cookie set.' },
          '400': { description: 'Invalid or replayed verification code' },
          '401': { description: 'Expired or invalid challenge token' },
          '429': { description: 'Too many failed verification attempts (sliding-window rate limit)' },
          '503': { description: 'Fail-closed: Distributed rate limiter unavailable in production/preview' }
        }
      }
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get Current Authenticated User & Refresh CSRF',
        responses: {
          '200': { description: 'User profile and refreshed session CSRF token' },
          '401': { description: 'Not authenticated' }
        }
      }
    },
    '/roles': {
      get: {
        tags: ['Roles & Permissions'],
        summary: 'List All Roles & Module Permissions',
        description: 'Returns all system roles and company-customized roles with their granular module access matrix.',
        responses: {
          '200': {
            description: 'List of roles and available modules',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    roles: { type: 'array' },
                    availableModules: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['Roles & Permissions'],
        summary: 'Create Custom Role',
        description: 'Creates a custom role scoped to the current tenant company. Requires Admin.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'permissions'],
                properties: {
                  name: { type: 'string', example: 'Quality Lead' },
                  roleId: { type: 'string', example: 'quality_lead' },
                  description: { type: 'string' },
                  color: { type: 'string' },
                  permissions: {
                    type: 'object',
                    description: 'Map of module keys to boolean access flags'
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Role created' },
          '400': { description: 'Invalid data or reserved role name' },
          '403': { description: 'Admin access required' }
        }
      }
    },
    '/roles/{roleId}': {
      put: {
        tags: ['Roles & Permissions'],
        summary: 'Update Role Permissions',
        description: 'Updates permissions or metadata for a custom or system role within the tenant company. Requires Admin.',
        parameters: [
          { name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  permissions: { type: 'object' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Role updated' },
          '400': { description: 'Cannot revoke admin permissions from Administrator role' },
          '403': { description: 'Admin access required' }
        }
      },
      delete: {
        tags: ['Roles & Permissions'],
        summary: 'Delete Custom Role',
        description: 'Deletes a custom role. Cannot delete built-in system roles or roles assigned to active users.',
        parameters: [
          { name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Role deleted' },
          '400': { description: 'Cannot delete system role or role in use' },
          '404': { description: 'Role not found' }
        }
      }
    },
    '/locations': {
      get: {
        tags: ['Locations'],
        summary: 'List Warehouse Locations',
        description: 'Returns storage locations. Enforces server-side permissions for the `locations` module.',
        parameters: [
          { name: 'warehouse', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Locations list' },
          '403': { description: 'Access denied to locations' }
        }
      }
    },
    '/qc': {
      get: {
        tags: ['Quality Control'],
        summary: 'List QC Inspections & Tasks',
        description: 'Returns quality inspection records. Enforces server-side permissions for the `qc` module.',
        responses: {
          '200': { description: 'QC records' },
          '403': { description: 'Access denied to qc' }
        }
      }
    },
    '/returns': {
      get: {
        tags: ['Returns'],
        summary: 'List Customer Returns (RMAs)',
        description: 'Returns customer returns and inspection decisions. Enforces server-side permissions for the `returns` module.',
        responses: {
          '200': { description: 'Returns list' },
          '403': { description: 'Access denied to returns' }
        }
      }
    },
    '/inventory': {
      get: {
        tags: ['Inventory'],
        summary: 'List Authoritative Inventory Balances',
        description: 'Returns physical stock from InventoryBalance and Product allocatable stock.',
        responses: {
          '200': { description: 'Inventory balances' },
          '403': { description: 'Access denied to inventory' }
        }
      }
    },
    '/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List Orders',
        description: 'Returns customer outbound orders and status tracking.',
        responses: {
          '200': { description: 'Orders list' },
          '403': { description: 'Access denied to orders' }
        }
      }
    },
    '/3pl/billing/rate-cards': {
      get: {
        tags: ['3PL Billing'],
        summary: 'List 3PL Billing Rate Cards',
        description: 'Returns tenant-isolated rate cards for storage, inbound, picking, and dispatch billing.',
        responses: {
          '200': { description: 'Rate cards list' },
          '403': { description: 'Access denied to billing' }
        }
      }
    }
  }
};

/**
 * GET /api/v1/docs
 * Returns the complete OpenAPI 3.0 documentation specification.
 */
router.get('/', (req, res) => {
  res.json(openApiSpec);
});

export default router;
