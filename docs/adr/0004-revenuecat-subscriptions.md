# 0004. RevenueCat for mobile subscriptions

**Status:** accepted · **Date:** 2026-06-14

RevenueCat manages mobile subscriptions. It handles App Store and Google Play
subscription complexity, receipt validation, and webhook normalization out of
the box.

## Consequences

- Additional vendor dependency and a revenue share above the free tier.

## Considered options

- **Direct Stripe SDK** — rejected: no native App Store subscription support.
