import type { IPaymentsProvider } from '@/providers/payments/IPaymentsProvider';
import { RevenueCatProvider } from '@/providers/payments/RevenueCatProvider';

/**
 * Payments provider selector. RevenueCat (stubbed) today; swap point for a
 * different billing vendor behind the same interface.
 */
export const paymentsProvider: IPaymentsProvider = new RevenueCatProvider();

export type {
  IPaymentsProvider,
  SubscriptionStatus,
  Offering,
} from '@/providers/payments/IPaymentsProvider';
