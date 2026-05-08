import { describe, expect, it } from 'vitest';
import { createScriptRegexParserAdapter } from '../src/project-graph/script-parser-adapter.js';
import { createTreeSitterSourceParser } from '../src/project-graph/tree-sitter-source-parser.js';
import { createUnrealCppParserAdapter } from '../src/project-graph/unreal-cpp-parser-adapter.js';

describe('project graph parser adapters', () => {
  it('adapts script regex extraction behind the parser boundary', () => {
    const parser = createScriptRegexParserAdapter();
    const result = parser.parse({
      path: 'Python/tools.py',
      language: 'python',
      content: 'import unreal\nclass ImportTool:\n  def run(self):\n    unreal.EditorAssetLibrary()\n',
    });

    expect(parser.id).toBe('script-regex');
    expect(parser.languages).toEqual(expect.arrayContaining(['python', 'lua', 'csharp']));
    expect(result.captures.map((capture) => `${capture.name}:${capture.text}`)).toEqual(expect.arrayContaining([
      'script.import:unreal',
      'script.class:ImportTool',
      'script.function:run',
      'script.ue-call:EditorAssetLibrary',
    ]));
    expect(result.captures.every((capture) => capture.extractorId === 'script-regex')).toBe(true);
  });

  it('captures Unreal C++ reflection symbols through the parser adapter boundary', () => {
    const parser = createUnrealCppParserAdapter();
    const result = parser.parse({
      path: 'Source/Client/Public/InventoryComponent.h',
      language: 'cpp',
      content: [
        '#pragma once',
        'UCLASS()',
        'class CLIENT_API UInventoryComponent : public UObject {',
        '  GENERATED_BODY()',
        '  UFUNCTION(BlueprintCallable)',
        '  void AddItem();',
        '};',
      ].join('\n'),
    });

    expect(parser.languages).toContain('cpp');
    expect(result).toMatchObject({
      path: 'Source/Client/Public/InventoryComponent.h',
      language: 'cpp',
      hasErrors: false,
    });
    expect(result.captures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'unreal.class',
        text: 'UInventoryComponent',
        startLine: 2,
        endLine: 2,
      }),
      expect.objectContaining({
        name: 'unreal.function',
        text: 'AddItem',
        startLine: 5,
        endLine: 5,
      }),
    ]));
  });

  it('extracts Python imports, symbols, calls, and UE bindings through tree-sitter', () => {
    const parser = createTreeSitterSourceParser();
    const result = parser.parse({
      path: 'Python/tools.py',
      language: 'python',
      content: 'import unreal\nfrom Game.Inventory import Item\nclass ImportTool:\n  def run(self):\n    unreal.EditorAssetLibrary()\n    helper()\n',
    });

    expect(parser.languages).toContain('python');
    expect(result.hasErrors).toBe(false);
    expect(result.captures.map((capture) => `${capture.name}:${capture.text}`)).toEqual(expect.arrayContaining([
      'script.import:unreal',
      'script.import:Game.Inventory',
      'script.class:ImportTool',
      'script.function:run',
      'script.ue-call:EditorAssetLibrary',
      'call.function:helper',
    ]));
    expect(result.captures.every((capture) => capture.extractorId === 'tree-sitter-source')).toBe(true);
  });

  it('extracts C# using directives, symbols, calls, and UE bindings through tree-sitter', () => {
    const parser = createTreeSitterSourceParser();
    const result = parser.parse({
      path: 'CSharp/Game/Weapon.cs',
      language: 'csharp',
      content: 'using Game.Inventory;\npublic class Weapon {\n  public void Fire() { UE.FireWeapon(); helper(); }\n}\n',
    });

    expect(parser.languages).toContain('csharp');
    expect(result.hasErrors).toBe(false);
    expect(result.captures.map((capture) => `${capture.name}:${capture.text}`)).toEqual(expect.arrayContaining([
      'script.import:Game.Inventory',
      'script.class:Weapon',
      'script.function:Fire',
      'script.ue-call:FireWeapon',
      'call.function:helper',
    ]));
    expect(result.captures.every((capture) => capture.extractorId === 'tree-sitter-source')).toBe(true);
  });

  it('extracts C++ includes, symbols, and calls through tree-sitter', () => {
    const parser = createTreeSitterSourceParser();
    const result = parser.parse({
      path: 'Source/Game/Player.cpp',
      language: 'cpp',
      content: '#include "InventoryComponent.h"\nclass UInventoryComponent : public UObject {\npublic:\n  void AddItem();\n};\nvoid Fire() { AddItem(); }\n',
    });

    expect(parser.languages).toContain('cpp');
    expect(result.hasErrors).toBe(false);
    expect(result.captures.map((capture) => `${capture.name}:${capture.text}`)).toEqual(expect.arrayContaining([
      'import.source:"InventoryComponent.h"',
      'class.name:UInventoryComponent',
      'function.name:AddItem',
      'function.name:Fire',
      'call.function:AddItem',
    ]));
    expect(result.captures.every((capture) => capture.extractorId === 'tree-sitter-source')).toBe(true);
  });
});
