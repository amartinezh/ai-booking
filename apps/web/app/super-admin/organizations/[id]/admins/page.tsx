import { getOrgAdmins } from "../../../../actions/org-admins";
import OrgAdminsClient from "./components/OrgAdminsClient";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OrgAdminsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admins = await getOrgAdmins(params.id);

  const serialized = admins.map(a => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
  }));

  return <OrgAdminsClient organizationId={params.id} initialAdmins={serialized} />;
}
