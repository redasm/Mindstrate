import { describe, expect, it } from 'vitest';
import { extractScriptCaptures } from '../src/project-graph/script-extractor.js';

describe('script extractor', () => {
  it('extracts C# using directives, classes, methods, and UE calls', () => {
    const captures = extractScriptCaptures({
      path: 'CSharp/Game/Weapon.cs',
      language: 'csharp',
      content: `
        using Game.Inventory;
        public class Weapon {
          public void Fire() { UE.FireWeapon(); }
        }
      `,
    });

    expect(captures.map((capture) => `${capture.name}:${capture.text}`)).toEqual(expect.arrayContaining([
      'script.import:Game.Inventory',
      'script.class:Weapon',
      'script.function:Fire',
      'script.ue-call:FireWeapon',
    ]));
  });
});
