// `d3-force-3d` ships no TypeScript types. We only need `forceCollide` here; it
// is the same package `force-graph` (via react-force-graph-2d) uses internally,
// so the force we register is compatible with the renderer's simulation.
declare module 'd3-force-3d' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function forceCollide(radius?: number | ((node: any) => number)): any;
}
