import { describe, expect, it } from 'vitest';
import { createScriptRegexParserAdapter } from '../src/project-graph/script-parser-adapter.js';
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
});
