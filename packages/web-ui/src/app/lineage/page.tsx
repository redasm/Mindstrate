'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ContextNode = {
  id: string;
  substrateType: string;
  domainType: string;
  title: string;
  content: string;
  tags: string[];
  project?: string;
  status: string;
  qualityScore: number;
};

type ContextEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  strength: number;
};

const SUBSTRATE_ORDER = ['axiom', 'heuristic', 'rule', 'skill', 'pattern', 'summary', 'snapshot', 'episode'];

export default function LineagePage() {
  const [nodes, setNodes] = useState<ContextNode[]>([]);
  const [edges, setEdges] = useState<ContextEdge[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [nodesRes, edgesRes] = await Promise.all([
      fetch('/api/context-graph?limit=80'),
      fetch('/api/context-edges?limit=200'),
    ]);

    if (nodesRes.ok) {
      const data = await nodesRes.json();
      setNodes(data.nodes || []);
    }
    if (edgesRes.ok) {
      const data = await edgesRes.json();
      setEdges(data.edges || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const grouped = useMemo(() => {
    const map = new Map<string, ContextNode[]>();
    for (const substrate of SUBSTRATE_ORDER) {
      map.set(substrate, []);
    }
    for (const node of nodes) {
      const list = map.get(node.substrateType) ?? [];
      list.push(node);
      map.set(node.substrateType, list);
    }
    return map;
  }, [nodes]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Lineage View</h1>
        <p className="mt-1 text-sm text-gray-500">
          Inspect the ECS compression lineage by substrate layer and the relationships connecting nodes.
        </p>
      </div>

      {loading ? <div className="py-12 text-center text-gray-400">Loading lineage view...</div> : null}

      <section className="space-y-6">
        {SUBSTRATE_ORDER.map((substrate) => {
          const group = grouped.get(substrate) ?? [];
          if (group.length === 0) return null;

          return (
            <div key={substrate} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold capitalize text-gray-900">{substrate}</h2>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{group.length}</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.map((node) => {
                  const relatedEdges = edges.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id).slice(0, 6);
                  return (
                    <article key={node.id} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                          {node.domainType}
                        </span>
                        <span className="ml-auto text-xs text-gray-400">quality {node.qualityScore.toFixed(0)}</span>
                      </div>
                      <h3 className="mt-3 font-medium text-gray-900">{node.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-gray-600">{truncate(node.content, 180)}</p>
                      {node.tags.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {node.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="rounded-md bg-white px-2 py-1 text-xs text-gray-500">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {relatedEdges.length > 0 ? (
                        <div className="mt-4 space-y-2 border-t border-gray-200 pt-3 text-xs text-gray-500">
                          {relatedEdges.map((edge) => {
                            const otherId = edge.sourceId === node.id ? edge.targetId : edge.sourceId;
                            const other = nodesById.get(otherId);
                            return (
                              <div key={edge.id} className="rounded-md bg-white p-2">
                                <div className="font-medium text-gray-700">{edge.relationType}</div>
                                <div>{other?.title || otherId}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}
