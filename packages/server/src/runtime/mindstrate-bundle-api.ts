import type { PortableContextBundle } from '@mindstrate/protocol/models';
import type {
  CreateBundleOptions,
  EditableBundleFiles,
  InstallBundleFromRegistryOptions,
  InstallBundleResult,
  InstallEditableBundleFilesResult,
  PublishBundleOptions,
  PublishBundleResult,
  ValidateBundleResult,
} from '../bundles/index.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateBundleApi {
  constructor(private readonly services: MindstrateRuntime) {}

  createBundle(options: CreateBundleOptions): PortableContextBundle {
    return this.services.bundleManager.createBundle(options);
  }

  validateBundle(bundle: PortableContextBundle): ValidateBundleResult {
    return this.services.bundleManager.validateBundle(bundle);
  }

  installBundle(bundle: PortableContextBundle): InstallBundleResult {
    return this.services.bundleManager.installBundle(bundle);
  }

  installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult> {
    return this.services.bundleManager.installBundleFromRegistry(options);
  }

  publishBundle(bundle: PortableContextBundle, options?: PublishBundleOptions): PublishBundleResult {
    return this.services.bundleManager.publishBundle(bundle, options);
  }

  createEditableBundleFiles(bundle: PortableContextBundle): EditableBundleFiles {
    return this.services.bundleManager.createEditableBundleFiles(bundle);
  }

  installEditableBundleFiles(files: EditableBundleFiles): InstallEditableBundleFilesResult {
    return this.services.bundleManager.installEditableBundleFiles(files);
  }

  installEditableBundleDirectory(directory: string): InstallEditableBundleFilesResult {
    return this.services.bundleManager.installEditableBundleDirectory(directory);
  }
}
