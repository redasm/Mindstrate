'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { truncateText } from '@mindstrate/protocol/text';
import {
  SUBSTRATE_ORDER,
  fetchContextEdges,
  fetchContextGraph,
  type ContextGraphEdgeDto,
  type ContextGraphNodeDto,
} from '@/lib/context-graph-api';

export default function LineagePage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-gray-400">Loading lineage view...</div>}>
      <LineagePageContent />
    </Suspense>
  );
}

function LineagePageContent() {
  const searchParams = useSearchParams();
  const [nodes, setNodes] = useState<ContextGraphNodeDto[]>([]);
  const [edges, setEdges] = useState<ContextGraphEdgeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [substrateFilter, setSubstrateFilter] = useState('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [graphNodes, graphEdges] = await Promise.all([
        fetchContextGraph(80),
        fetchContextEdges(200),
      ]);
      setNodes(graphNodes);
      setEdges(graphEdges);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const nodeId = searchParams.get('node');
    if (nodeId) {
      setSelectedNodeId(nodeId);
    }
  }, [searchParams]);

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const filteredNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (substrateFilter !== 'all' && node.substrateType !== substrateFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      const haystack = `${node.title}\n${node.content}\n${node.domainType}\n${node.tags.join(' ')}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [nodes, query, substrateFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, ContextGraphNodeDto[]>();
    for (const substrate of SUBSTRATE_ORDER) {
      map.set(substrate, []);
    }
    for (const node of filteredNodes) {
      const list = map.get(node.substrateType) ?? [];
      list.push(node);
      map.set(node.substrateType, list);
    }
    return map;
  }, [filteredNodes]);

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;
  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter((edge) => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId);
  }, [edges, selectedNodeId]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Lineage View</h1>
        <p className="mt-1 text-sm text-gray-500">
          Inspect the ECS compression lineage by substrate layer and the relationships connecting nodes.
        </p>
      </div>

      {loading ? <div className="py-12 text-center text-gray-400">Loading lineage view...</div> : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Search Nodes</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, content, domain, or tags"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Substrate Filter</label>
            <select
              value={substrateFilter}
              onChange={(e) => setSubstrateFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="all">All Layers</option>
              {SUBSTRATE_ORDER.map((substrate) => (
                <option key={substrate} value={substrate}>
                  {substrate}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-500">
          Showing {filteredNodes.length} of {nodes.length} nodes
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
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
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        selectedNodeId === node.id
                          ? 'border-brand-300 bg-brand-50'
                          : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                          {node.domainType}
                        </span>
                        <span className="ml-auto text-xs text-gray-400">quality {node.qualityScore.toFixed(0)}</span>
                      </div>
                      <h3 className="mt-3 font-medium text-gray-900">{node.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-gray-600">{truncateText(node.content, 180)}</p>
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
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>

        <aside className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Node Details</h2>

          {!selectedNode ? (
            <p className="mt-6 text-sm text-gray-400">Select a node to inspect its lineage details.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                    {selectedNode.substrateType}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                    {selectedNode.domainType}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-gray-900">{selectedNode.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{selectedNode.content}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Status" value={selectedNode.status} />
                <Detail label="Quality" value={selectedNode.qualityScore.toFixed(0)} />
                <Detail label="Project" value={selectedNode.project || 'Global'} />
                <Detail label="Node ID" value={selectedNode.id} mono />
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-900">Tags</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedNode.tags.length > 0 ? selectedNode.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">
                      {tag}
                    </span>
                  )) : <span className="text-sm text-gray-400">No tags</span>}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-900">Relationships</h4>
                {selectedEdges.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-400">No relationships recorded for this node.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedEdges.map((edge) => {
                      const outgoing = edge.sourceId === selectedNode.id;
                      const otherId = outgoing ? edge.targetId : edge.sourceId;
                      const other = nodesById.get(otherId);
                      return (
                        <div key={edge.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                          <div className="font-medium text-gray-900">
                            {outgoing ? 'Outgoing' : 'Incoming'} {edge.relationType}
                          </div>
                          <div className="mt-1 text-gray-600">{other?.title || otherId}</div>
                          <div className="mt-1 text-xs text-gray-400">strength {edge.strength.toFixed(2)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-sm text-gray-700 ${mono ? 'break-all font-mono' : ''}`}>{value}</div>
    </div>
  );
}
