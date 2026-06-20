import type {
  IPaymentsProvider,
  Offering,
  SubscriptionStatus,
} from '@/providers/payments/IPaymentsProvider';

const FREE: SubscriptionStatus = {
  isActive: false,
  productId: null,
  expiresAt: null,
  willRenew: false,
};

/** Full-interface payments mock. */
export class MockPaymentsProvider implements IPaymentsProvider {
  available = true;
  status: SubscriptionStatus = FREE;
  offerings: Offering[] = [];

  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async configure(): Promise<void> {}
  async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    return this.status;
  }
  async getOfferings(): Promise<Offering[]> {
    return this.offerings;
  }
  async purchase(): Promise<SubscriptionStatus> {
    return this.status;
  }
  async restore(): Promise<SubscriptionStatus> {
    return this.status;
  }
}
