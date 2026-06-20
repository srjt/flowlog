/**
 * Payments provider contract — abstracts subscription management so the billing
 * vendor can be swapped without touching app logic. Active: RevenueCat
 * (stubbed for MVP).
 */
export interface SubscriptionStatus {
  isActive: boolean;
  productId: string | null;
  expiresAt: string | null;
  willRenew: boolean;
}

export interface Offering {
  identifier: string;
  displayName: string;
  priceString: string;
}

export interface IPaymentsProvider {
  /** Associate the billing SDK with the signed-in user. */
  configure(userId: string): Promise<void>;

  /** Current subscription status for the user. */
  getSubscriptionStatus(): Promise<SubscriptionStatus>;

  /** Available purchasable offerings. */
  getOfferings(): Promise<Offering[]>;

  /** Begin purchase of an offering; resolves with the resulting status. */
  purchase(offeringId: string): Promise<SubscriptionStatus>;

  /** Restore previously-purchased entitlements. */
  restore(): Promise<SubscriptionStatus>;

  isAvailable(): Promise<boolean>;
}
