import { env } from '@/config/env';
import type {
  IPaymentsProvider,
  Offering,
  SubscriptionStatus,
} from '@/providers/payments/IPaymentsProvider';
import { logger } from '@/utils/logger';

const FREE_STATUS: SubscriptionStatus = {
  isActive: false,
  productId: null,
  expiresAt: null,
  willRenew: false,
};

/**
 * RevenueCat payments provider — STUBBED for MVP.
 *
 * Implements the full IPaymentsProvider surface so the rest of the app can be
 * built against it, but returns safe free-tier defaults instead of calling the
 * SDK. Wire `react-native-purchases` at every TODO before launch.
 */
export class RevenueCatProvider implements IPaymentsProvider {
  private readonly iosKey = env.REVENUECAT_API_KEY_IOS;
  private readonly androidKey = env.REVENUECAT_API_KEY_ANDROID;

  async isAvailable(): Promise<boolean> {
    return this.iosKey.trim().length > 0 || this.androidKey.trim().length > 0;
  }

  async configure(userId: string): Promise<void> {
    // TODO(revenuecat): Purchases.configure({ apiKey }) then Purchases.logIn(userId).
    logger.debug('RevenueCatProvider.configure (stub)', { userId });
  }

  async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    // TODO(revenuecat): map Purchases.getCustomerInfo().entitlements.
    return FREE_STATUS;
  }

  async getOfferings(): Promise<Offering[]> {
    // TODO(revenuecat): map Purchases.getOfferings().
    return [];
  }

  async purchase(offeringId: string): Promise<SubscriptionStatus> {
    // TODO(revenuecat): Purchases.purchasePackage(...).
    logger.debug('RevenueCatProvider.purchase (stub)', { offeringId });
    return FREE_STATUS;
  }

  async restore(): Promise<SubscriptionStatus> {
    // TODO(revenuecat): Purchases.restorePurchases().
    return FREE_STATUS;
  }
}
