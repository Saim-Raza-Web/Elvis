import axios from 'axios';
import aws4 from 'aws4';
import { AmazonConfig } from './AmazonConfig.js';

export class AmazonSPApiClient {
  constructor({ marketplace, accessToken }) {
    if (!marketplace || !marketplace.endpoint || !marketplace.region) {
      throw new Error('Invalid marketplace configuration provided to AmazonSPApiClient');
    }
    this.marketplace = marketplace;
    this.accessToken = accessToken;
    this.awsCreds = AmazonConfig.getAwsCredentials();
  }

  /**
   * Signs and executes an HTTP request to Amazon SP-API.
   * If credentials are not present, it will throw an error instead of making an unauthenticated call.
   */
  async execute({ method, path, query, body }) {
    if (!this.accessToken) {
      throw new Error('Missing LWA access token');
    }

    if (!this.awsCreds.accessKeyId || !this.awsCreds.secretAccessKey) {
      throw new Error('Missing AWS credentials for SP-API signing. Configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
    }

    const host = new URL(this.marketplace.endpoint).host;
    
    const requestOptions = {
      host: host,
      service: 'execute-api',
      region: this.marketplace.region,
      method: method.toUpperCase(),
      path: this.buildPathWithQuery(path, query),
      headers: {
        'x-amz-access-token': this.accessToken,
        'Content-Type': 'application/json'
      }
    };

    if (this.awsCreds.sessionToken) {
      requestOptions.headers['x-amz-security-token'] = this.awsCreds.sessionToken;
    }

    if (body) {
      requestOptions.body = JSON.stringify(body);
    }

    // Sign the request with AWS Signature V4
    aws4.sign(requestOptions, {
      accessKeyId: this.awsCreds.accessKeyId,
      secretAccessKey: this.awsCreds.secretAccessKey
    });

    try {
      const response = await axios({
        method: requestOptions.method,
        url: `${this.marketplace.endpoint}${requestOptions.path}`,
        headers: requestOptions.headers,
        data: requestOptions.body
      });
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  buildPathWithQuery(path, query) {
    if (!query || Object.keys(query).length === 0) return path;
    const params = new URLSearchParams(query);
    return `${path}?${params.toString()}`;
  }

  handleError(error) {
    if (error.response) {
      const status = error.response.status;
      const responseData = error.response.data;
      
      let errorMsg = `Amazon SP-API Error ${status}`;
      if (responseData && responseData.errors && responseData.errors.length > 0) {
         errorMsg += `: ${responseData.errors.map(e => e.message).join('; ')}`;
      }

      if (status === 401) {
        throw new Error(`Unauthorized (401). Invalid or expired LWA token, or invalid Signature V4. ${errorMsg}`);
      } else if (status === 403) {
        throw new Error(`AccessDenied (403). Ensure IAM permissions and Developer profile are correct. ${errorMsg}`);
      } else if (status === 429) {
        throw new Error(`Throttling (429). Rate limit exceeded. ${errorMsg}`);
      } else {
        throw new Error(errorMsg);
      }
    } else if (error.request) {
      throw new Error(`Network/Timeout Error connecting to Amazon SP-API: ${error.message}`);
    } else {
      throw new Error(`SP-API Client Error: ${error.message}`);
    }
  }

  // --- SP-API Business Logic Implementations ---

  /**
   * Fetches orders from Amazon SP-API Orders API.
   * GET /orders/v0/orders
   * 
   * @param {object} options
   * @param {string[]} options.MarketplaceIds - Array of marketplace IDs to filter
   * @param {string} options.CreatedAfter - ISO 8601 timestamp (e.g., "2023-01-01T00:00:00Z")
   * @param {string} options.CreatedBefore - ISO 8601 timestamp
   * @param {string} options.LastUpdatedAfter - ISO 8601 timestamp
   * @param {string[]} options.OrderStatuses - Array of statuses: ["PendingAvailability", "Pending", "Unshipped", "PartiallyShipped", "Shipped", "InvoiceUnconfirmed", "Canceled", "Unfulfillable"]
   * @param {string} options.FulfillmentChannels - Array: ["MFN", "AFN"]
   * @param {string} options.NextToken - Pagination token from previous response
   * @param {number} options.MaxResultsPerPage - Maximum 100 (default: 50)
   * @returns {Promise<{orders: object[], nextToken?: string}>}
   */
  async getOrders(options = {}) {
    const {
      MarketplaceIds = [],
      CreatedAfter,
      CreatedBefore,
      LastUpdatedAfter,
      OrderStatuses = [],
      FulfillmentChannels = [],
      NextToken,
      MaxResultsPerPage = 50
    } = options;

    const query = {};
    
    if (MarketplaceIds && MarketplaceIds.length > 0) {
      query.MarketplaceIds = MarketplaceIds;
    }
    if (CreatedAfter) {
      query.CreatedAfter = CreatedAfter;
    }
    if (CreatedBefore) {
      query.CreatedBefore = CreatedBefore;
    }
    if (LastUpdatedAfter) {
      query.LastUpdatedAfter = LastUpdatedAfter;
    }
    if (OrderStatuses && OrderStatuses.length > 0) {
      query.OrderStatuses = OrderStatuses;
    }
    if (FulfillmentChannels && FulfillmentChannels.length > 0) {
      query.FulfillmentChannels = FulfillmentChannels;
    }
    if (NextToken) {
      query.NextToken = NextToken;
    }
    if (MaxResultsPerPage) {
      query.MaxResultsPerPage = Math.min(100, Math.max(1, MaxResultsPerPage));
    }

    const response = await this.execute({
      method: 'GET',
      path: '/orders/v0/orders',
      query
    });

    return {
      orders: response.Orders || [],
      nextToken: response.NextToken || null
    };
  }

  /**
   * Fetches order items for a specific order.
   * GET /orders/v0/orders/{orderId}/orderItems
   * 
   * @param {string} orderId - Amazon Order ID
   * @returns {Promise<object>}
   */
  async getOrderItems(orderId) {
    if (!orderId) {
      throw new Error('orderId is required for getOrderItems');
    }

    const response = await this.execute({
      method: 'GET',
      path: `/orders/v0/orders/${orderId}/orderItems`
    });

    return {
      orderId,
      orderItems: response.OrderItems || []
    };
  }

  /**
   * Fetches catalog items from Amazon SP-API Catalog API.
   * GET /catalog/2022-04-01/items
   * 
   * @param {object} options
   * @param {string} options.MarketplaceId - Marketplace ID
   * @param {string} options.Query - Query string (ASIN, SKU, or title)
   * @param {string} options.SellerSKU - Filter by specific SKU
   * @param {string} options.ASIN - Filter by specific ASIN
   * @param {string} options.NextToken - Pagination token
   * @returns {Promise<object>}
   */
  async getCatalogItems(options = {}) {
    const {
      MarketplaceId,
      Query,
      SellerSKU,
      ASIN,
      NextToken
    } = options;

    if (!MarketplaceId) {
      throw new Error('MarketplaceId is required for getCatalogItems');
    }

    const query = { MarketplaceId };
    
    if (Query) {
      query.Query = Query;
    }
    if (SellerSKU) {
      query.SellerSKU = SellerSKU;
    }
    if (ASIN) {
      query.ASIN = ASIN;
    }
    if (NextToken) {
      query.NextToken = NextToken;
    }

    const response = await this.execute({
      method: 'GET',
      path: '/catalog/2022-04-01/items',
      query
    });

    return {
      items: response.Items || [],
      nextToken: response.NextToken || null
    };
  }

  /**
   * Updates inventory for a specific SKU in Amazon.
   * PUT /listings/2021-08-01/items/{sellerId}/{sku}
   * 
   * @param {string} sku - Seller SKU
   * @param {number} quantity - Available quantity
   * @returns {Promise<object>}
   */
  async updateInventory(sku, quantity) {
    if (!sku) {
      throw new Error('SKU is required for updateInventory');
    }
    if (quantity === null || quantity === undefined) {
      throw new Error('Quantity is required for updateInventory');
    }

    // Seller ID comes from marketplace configuration (set by AmazonProvider from ConnectedStore)
    const sellerId = this.marketplace.sellerId;
    if (!sellerId) {
      throw new Error('Seller ID is required for inventory updates. Ensure it is passed in marketplace configuration.');
    }

    const body = {
      quantity: {
        amount: parseInt(quantity, 10)
      },
      restockDate: new Date().toISOString().split('T')[0] // Today's date
    };

    const response = await this.execute({
      method: 'PUT',
      path: `/listings/2021-08-01/items/${sellerId}/${sku}`,
      body
    });

    return {
      sku,
      quantity: parseInt(quantity, 10),
      success: true,
      response
    };
  }
}
