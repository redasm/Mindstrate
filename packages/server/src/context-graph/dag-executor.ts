export interface DagNode<T> {
  deps?: string[];
  run: (context: DagExecutionContext) => Promise<T> | T;
}

export interface DagExecutionContext {
  get<T>(nodeId: string): Promise<T>;
}

export class DagExecutor {
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly active = new Set<string>();
  private readonly executionOrder: string[] = [];

  constructor(private readonly nodes: Record<string, DagNode<unknown>>) {}

  async run<T>(target: string): Promise<{ value: T; executionOrder: string[] }> {
    const value = await this.resolve<T>(target);
    return { value, executionOrder: [...this.executionOrder] };
  }

  private resolve<T>(nodeId: string): Promise<T> {
    const cached = this.cache.get(nodeId);
    if (cached) {
      return cached as Promise<T>;
    }

    const node = this.nodes[nodeId];
    if (!node) {
      throw new Error(`Unknown DAG node: ${nodeId}`);
    }
    if (this.active.has(nodeId)) {
      throw new Error(`Cycle detected while resolving DAG node: ${nodeId}`);
    }

    this.active.add(nodeId);
    const promise = (async () => {
      try {
        for (const dep of node.deps ?? []) {
          await this.resolve(dep);
        }
        const value = await node.run({
          get: <R>(depId: string) => this.resolve<R>(depId),
        });
        this.executionOrder.push(nodeId);
        return value;
      } finally {
        this.active.delete(nodeId);
      }
    })();

    this.cache.set(nodeId, promise);
    return promise as Promise<T>;
  }
}
