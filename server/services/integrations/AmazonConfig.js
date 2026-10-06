export const AMAZON_MARKETPLACES = {
  US: { marketplaceId: 'ATVPDKIKX0DER', region: 'us-east-1', endpoint: 'https://sellingpartnerapi-na.amazon.com', countryCode: 'US', name: 'US Site' },
  CA: { marketplaceId: 'A2EUQ1WTGCTBG2', region: 'us-east-1', endpoint: 'https://sellingpartnerapi-na.amazon.com', countryCode: 'CA', name: 'Canada Site' },
  MX: { marketplaceId: 'A1AM78C64UM0Y8', region: 'us-east-1', endpoint: 'https://sellingpartnerapi-na.amazon.com', countryCode: 'MX', name: 'Mexico Site' },
  BR: { marketplaceId: 'A2Q3Y263D00KWC', region: 'us-east-1', endpoint: 'https://sellingpartnerapi-na.amazon.com', countryCode: 'BR', name: 'Brazil Site' },
  ES: { marketplaceId: 'A1RKKUPIHCS9HS', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'ES', name: 'Spain Site (ES)' },
  UK: { marketplaceId: 'A1F83G8C2ARO7P', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'GB', name: 'UK Site (UK)' },
  FR: { marketplaceId: 'A13V1IB3VIYZZH', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'FR', name: 'France Site (FR)' },
  DE: { marketplaceId: 'A1PA6795UKMFR9', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'DE', name: 'Germany Site (DE)' },
  IT: { marketplaceId: 'APJ6JZADPQGVX', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'IT', name: 'Italy Site (IT)' },
  NL: { marketplaceId: 'A1805IZSGTT6O6', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'NL', name: 'Netherlands Site (NL)' },
  SE: { marketplaceId: 'A2NODRKZP88ZB9', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'SE', name: 'Sweden Site (SE)' },
  PL: { marketplaceId: 'A1C3SOZRARQ6R3', region: 'eu-west-1', endpoint: 'https://sellingpartnerapi-eu.amazon.com', countryCode: 'PL', name: 'Poland Site (PL)' },
  JP: { marketplaceId: 'A1VC38T7YXB528', region: 'us-west-2', endpoint: 'https://sellingpartnerapi-fe.amazon.com', countryCode: 'JP', name: 'Japan Site (JP)' },
  SG: { marketplaceId: 'A19VAU5U5O7RUS', region: 'us-west-2', endpoint: 'https://sellingpartnerapi-fe.amazon.com', countryCode: 'SG', name: 'Singapore Site (SG)' },
  AU: { marketplaceId: 'A39IBJ37TRP1C6', region: 'us-west-2', endpoint: 'https://sellingpartnerapi-fe.amazon.com', countryCode: 'AU', name: 'Australia Site (AU)' }
};

export class AmazonConfig {
  static getAppCredentials() {
    return {
      appId: process.env.AMAZON_APP_ID || '',
      lwaClientId: process.env.AMAZON_LWA_CLIENT_ID || '',
      lwaClientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || ''
    };
  }

  static getAwsCredentials() {
    // Return AWS credentials from env vars if IAM user/role approach is implemented.
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      sessionToken: process.env.AWS_SESSION_TOKEN || '',
      roleArn: process.env.AMAZON_SP_API_ROLE_ARN || ''
    };
  }

  /**
   * Optionally uses AWS STS to assume an IAM role for SP-API access.
   * This is useful when using a role-based permission model instead of long-lived IAM user credentials.
   * 
   * @returns {Promise<{accessKeyId: string, secretAccessKey: string, sessionToken: string}>}
   */
  static async assumeRole() {
    const roleArn = process.env.AMAZON_SP_API_ROLE_ARN;
    if (!roleArn) {
      // No role configured, return original credentials
      return this.getAwsCredentials();
    }

    const baseCreds = this.getAwsCredentials();
    if (!baseCreds.accessKeyId || !baseCreds.secretAccessKey) {
      throw new Error('Cannot assume role: base AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) are missing.');
    }

    try {
      // Note: This requires AWS SDK for STS. If not installed, this will fail.
      // For now, we return the base credentials if STS is not available.
      // This is intentionally a no-op unless the AWS SDK is added and configured.
      console.warn('[AmazonConfig] STS AssumeRole is configured but AWS SDK is not installed. Using base credentials.');
      return baseCreds;
    } catch (error) {
      console.error('[AmazonConfig] Failed to assume role:', error.message);
      throw new Error(`Failed to assume IAM role: ${error.message}`);
    }
  }

  static validateAppCredentials() {
    const creds = this.getAppCredentials();
    const missing = [];
    if (!creds.appId) missing.push('AMAZON_APP_ID');
    if (!creds.lwaClientId) missing.push('AMAZON_LWA_CLIENT_ID');
    if (!creds.lwaClientSecret) missing.push('AMAZON_LWA_CLIENT_SECRET');

    if (missing.length > 0) {
      throw new Error(`Missing required Amazon SP-API App configuration: ${missing.join(', ')}`);
    }
    return creds;
  }

  static isProductionConfigured() {
    try {
      this.validateAppCredentials();
      return true;
    } catch {
      return false;
    }
  }

  static getMarketplace(siteId) {
    const mkp = AMAZON_MARKETPLACES[siteId.toUpperCase()];
    if (!mkp) {
      throw new Error(`Unsupported Amazon site ID: ${siteId}`);
    }
    return mkp;
  }
}
