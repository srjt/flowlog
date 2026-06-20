import { View, type ViewProps } from 'react-native';

export interface SkeletonProps extends ViewProps {
  className?: string;
}

/** A neutral placeholder block for loading states. Size it with className. */
export function Skeleton({ className = '', ...props }: SkeletonProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`rounded-lg bg-surface ${className}`}
      {...props}
    />
  );
}
