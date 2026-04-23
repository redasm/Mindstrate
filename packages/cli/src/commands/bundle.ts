/**
 * CLI Command: bundle
 *
 * Minimal portable context bundle workflow.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PortableContextBundle } from '@mindstrate/protocol/models';
import { createMemory } from '../helpers.js';

export const bundleCommand = new Command('bundle')
  .description('Create, install, validate, and publish portable ECS context bundles');

bundleCommand
  .command('create <name>')
  .description('Create a portable ECS context bundle JSON file')
  .option('-p, --project <project>', 'Project scope')
  .option('-o, --output <file>', 'Output file path', 'mindstrate-bundle.json')
  .option('--output-dir <dir>', 'Output editable bundle directory instead of a single JSON file')
  .option('-d, --description <text>', 'Bundle description')
  .action(async (name, options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const bundle = memory.createBundle({
        name,
        project: options.project,
        description: options.description,
      });
      if (options.outputDir) {
        const files = memory.createEditableBundleFiles(bundle);
        fs.mkdirSync(options.outputDir, { recursive: true });
        for (const [relativePath, content] of Object.entries(files)) {
          const outputPath = path.join(options.outputDir, relativePath);
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, content, 'utf-8');
        }
        console.log(`Editable bundle created: ${options.outputDir}`);
      } else {
        fs.writeFileSync(options.output, JSON.stringify(bundle, null, 2), 'utf-8');
        console.log(`Bundle created: ${options.output}`);
      }
      console.log(`  Nodes: ${bundle.nodeIds.length}`);
      console.log(`  Edges: ${bundle.edgeIds.length}`);
    } catch (error) {
      console.error('Bundle create failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

bundleCommand
  .command('validate <file>')
  .description('Validate a portable ECS context bundle JSON file')
  .action(async (file) => {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }

    const memory = createMemory();

    try {
      await memory.init();
      const bundle = JSON.parse(fs.readFileSync(file, 'utf-8')) as PortableContextBundle;
      const result = memory.validateBundle(bundle);
      if (!result.valid) {
        console.error('Bundle validation failed:');
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }
      console.log('Bundle is valid.');
    } catch (error) {
      console.error('Bundle validation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

bundleCommand
  .command('install <file>')
  .description('Install a portable ECS context bundle JSON file')
  .action(async (file) => {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }

    const memory = createMemory();

    try {
      await memory.init();
      const bundle = JSON.parse(fs.readFileSync(file, 'utf-8')) as PortableContextBundle;
      const result = memory.installBundle(bundle);
      console.log('Bundle installed.');
      console.log(`  Installed nodes: ${result.installedNodes}`);
      console.log(`  Updated nodes:   ${result.updatedNodes}`);
      console.log(`  Installed edges: ${result.installedEdges}`);
      console.log(`  Skipped edges:   ${result.skippedEdges}`);
    } catch (error) {
      console.error('Bundle install failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

bundleCommand
  .command('publish <file>')
  .description('Prepare a portable ECS context bundle for distribution')
  .option('-r, --registry <url>', 'Bundle registry URL', 'local')
  .option('-v, --visibility <mode>', 'Distribution visibility: public, private, or unlisted', 'unlisted')
  .action(async (file, options) => {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }

    const memory = createMemory();

    try {
      await memory.init();
      const bundle = JSON.parse(fs.readFileSync(file, 'utf-8')) as PortableContextBundle;
      const result = memory.publishBundle(bundle, {
        registry: options.registry,
        visibility: options.visibility,
      });
      console.log('Bundle publication manifest:');
      console.log(JSON.stringify(result.manifest, null, 2));
    } catch (error) {
      console.error('Bundle publish failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
