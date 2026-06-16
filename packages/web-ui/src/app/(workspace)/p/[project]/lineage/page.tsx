import { redirect } from 'next/navigation';

// "溯源"(lineage) merged into the unified "项目图谱" relationship-graph view.
export default async function LineageRedirect({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  redirect(`/p/${encodeURIComponent(project)}/project-graph`);
}
