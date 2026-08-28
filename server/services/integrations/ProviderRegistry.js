import { ShopifyProvider } from './ShopifyProvider.js';
import { WooCommerceProvider } from './WooCommerceProvider.js';
import { AmazonProvider } from './AmazonProvider.js';
import { EbayProvider } from './EbayProvider.js';
import { TemuProvider } from './TemuProvider.js';
import { MiraviaProvider } from './MiraviaProvider.js';
import { AliexpressProvider } from './AliexpressProvider.js';
import { TiktokShopProvider } from './TiktokShopProvider.js';

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.registerDefaultProviders();
  }

  registerDefaultProviders() {
    // Client priority order
    this.register(new AmazonProvider());
    this.register(new TemuProvider());
    this.register(new MiraviaProvider());
    this.register(new AliexpressProvider());
    this.register(new ShopifyProvider());
    this.register(new TiktokShopProvider());
    this.register(new WooCommerceProvider());
    this.register(new EbayProvider());
  }

  /**
   * Registers a new integration provider.
   * @param {BaseIntegrationProvider} providerInstance
   */
  register(providerInstance) {
    if (!providerInstance || !providerInstance.providerCode) {
      throw new Error('Provider must have a valid providerCode');
    }
    this.providers.set(providerInstance.providerCode.toUpperCase(), providerInstance);
  }

  /**
   * Resolves a provider by code.
   * @param {string} providerCode
   * @returns {BaseIntegrationProvider}
   */
  get(providerCode) {
    if (!providerCode) return null;
    const provider = this.providers.get(providerCode.toUpperCase());
    if (!provider) {
      throw new Error(`Unsupported integration provider: ${providerCode}. Supported: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    return provider;
  }

  /**
   * Returns list of all registered provider info objects for UI presentation.
   */
  listAll() {
    return Array.from(this.providers.values()).map(p => p.getProviderInfo());
  }
}

export const providerRegistry = new ProviderRegistry();
export default providerRegistry;
