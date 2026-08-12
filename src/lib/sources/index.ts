/**
 * Public entry point for the source layer.
 *
 * Import from '@/lib/sources' rather than reaching into provider modules, so
 * adding a provider stays a one-line change in registry.ts.
 */
export type { ExternalSource, SourceProvider } from './provider';
export { getProvider, getProviders, getConfiguredProviders } from './registry';
export { normaliseUrl } from './web';
export {
  cacheSource,
  syncAllProviders,
  searchProviders,
  syncSourceContent,
  listSourcesForDocument,
  type SyncReport,
} from './cache';
