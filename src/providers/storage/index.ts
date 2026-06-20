import type { IStorageProvider } from '@/providers/storage/IStorageProvider';
import { SupabaseStorageProvider } from '@/providers/storage/SupabaseStorageProvider';

/**
 * Storage provider selector. Only Supabase today; structured as a swap point
 * so an alternative backend can be added behind the same interface.
 */
export const storageProvider: IStorageProvider = new SupabaseStorageProvider();

export type { IStorageProvider } from '@/providers/storage/IStorageProvider';
