import { redirect } from 'next/navigation';

// "图谱"(graph) merged into the unified "项目图谱" relationship-graph view.
export default async function GraphRedirect({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  redirect(`/p/${encodeURIComponent(project)}/project-graph`);
}
