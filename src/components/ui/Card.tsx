import { View, type ViewProps } from 'react-native';

export interface CardProps extends ViewProps {
  className?: string;
}

/** Surface container with consistent padding, radius, and background. */
export function Card({ className = '', children, ...props }: CardProps) {
  return (
    <View
      className={`rounded-2xl bg-surface p-4 ${className}`}
      {...props}
    >
      {children}
    </View>
  );
}
