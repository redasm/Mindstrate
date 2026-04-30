import { describe, expect, it } from 'vitest';
import { createUnrealCppParserAdapter } from '../src/project-graph/unreal-cpp-parser-adapter.js';

describe('project graph parser adapters', () => {
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
