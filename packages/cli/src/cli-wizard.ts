import type * as readline from 'node:readline/promises';

export interface Choice<T extends string> {
  label: string;
  value: T;
  description?: string;
}

export const formatChoicePrompt = <T extends string>(
  title: string,
  choices: Choice<T>[],
  defaultIndex: number,
): string => [
    title,
    ...choices.map((choice, index) => {
      const description = choice.description ? ` - ${choice.description}` : '';
      return `  ${index + 1}. ${choice.label}${description}`;
    }),
    `Choose [${defaultIndex + 1}]: `,
  ].join('\n');

export const parseChoiceIndex = (
  input: string,
  choiceCount: number,
  defaultIndex: number,
): number | null => {
  const trimmed = input.trim();
  if (!trimmed) return defaultIndex;
  const selected = Number(trimmed);
  if (!Number.isInteger(selected) || selected < 1 || selected > choiceCount) return null;
  return selected - 1;
};

export const chooseOption = async <T extends string>(
  rl: readline.Interface,
  title: string,
  choices: Choice<T>[],
  defaultIndex = 0,
): Promise<T> => {
  while (true) {
    const answer = await rl.question(formatChoicePrompt(title, choices, defaultIndex));
    const selected = parseChoiceIndex(answer, choices.length, defaultIndex);
    if (selected !== null) return choices[selected].value;
    console.log(`Please choose a number from 1 to ${choices.length}.`);
  }
};

export const askOptional = async (
  rl: readline.Interface,
  prompt: string,
): Promise<string | undefined> => {
  const answer = await rl.question(`${prompt}: `);
  return answer.trim() || undefined;
};
