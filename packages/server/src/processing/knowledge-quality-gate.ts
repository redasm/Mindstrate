import type { CreateKnowledgeInput, QualityGateResult } from '@mindstrate/protocol';

export class KnowledgeQualityGate {
  check(input: CreateKnowledgeInput): QualityGateResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let score = 0;
    const maxScore = 100;
    const typesNeedingProblem = ['bug_fix', 'troubleshooting', 'gotcha'];
    const typesNeedingCode = ['bug_fix', 'pattern', 'how_to'];

    if (!input.title?.trim()) {
      errors.push('Title is required and cannot be empty');
    } else {
      score += 15;
      if (input.title.trim().length < 5) {
        warnings.push('Title is very short (< 5 chars), consider being more descriptive');
      }
    }

    if (!input.solution?.trim()) {
      errors.push('Solution is required and cannot be empty');
    } else {
      score += 20;
      if (input.solution.trim().length < 20) {
        warnings.push('Solution is very short (< 20 chars), consider adding more detail');
      }
    }

    if (!input.type) {
      errors.push('Knowledge type is required');
    } else {
      score += 10;
    }

    if (input.problem?.trim()) {
      score += 15;
    } else if (input.type && typesNeedingProblem.includes(input.type)) {
      warnings.push(`Knowledge type "${input.type}" should include a problem description`);
    }

    if (input.tags?.length) {
      score += 10;
    } else {
      warnings.push('No tags provided — tags improve discoverability');
    }

    if (input.context?.language) {
      score += 10;
    } else {
      warnings.push('No programming language specified');
    }

    if (input.context?.framework) {
      score += 5;
    }

    if (input.codeSnippets?.length) {
      score += 10;
    } else if (input.type && typesNeedingCode.includes(input.type)) {
      warnings.push(`Knowledge type "${input.type}" would benefit from code snippets`);
    }

    if (input.type === 'workflow') {
      if (input.actionable?.steps?.length) {
        score += 5;
      } else {
        warnings.push('Workflow knowledge should include actionable steps');
      }
    }

    if (input.actionable) {
      if (input.actionable.steps?.length) score += 3;
      if (input.actionable.preconditions?.length) score += 1;
      if (input.actionable.verification) score += 1;
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      completenessScore: Math.min(score, maxScore),
    };
  }
}
