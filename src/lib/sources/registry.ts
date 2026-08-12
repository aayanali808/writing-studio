import { notionProvider } from './notion';
import { webProvider } from './web';
import type { SourceProvider } from './provider';

/**
 * The provider registry.
 *
 * Adding a new source integration is a one-line change here plus its
 * implementation file — nothing else in the app knows which providers exist.
 */
const providers: SourceProvider[] = [notionProvider, webProvider];

export function getProviders(): SourceProvider[] {
  return providers;
}

export function getProvider(id: string): SourceProvider | undefined {
  return providers.find((provider) => provider.id === id);
}

/** Providers that are usable right now — token present, config valid. */
export function getConfiguredProviders(): SourceProvider[] {
  return providers.filter((provider) => provider.isConfigured());
}
