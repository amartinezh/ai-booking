import { getOrganizations } from "../../actions/organizations";
import OrganizationsClient from "./components/OrganizationsClient";
import { Prisma } from "@antigravity/database";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OrganizationsPage() {
  const organizations = await getOrganizations();

  // Convert Prisma Date to ISO strings since React Server Components pass pure JSON
  const serialized = organizations.map(org => ({
    ...org,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  }));

  return <OrganizationsClient initialOrganizations={serialized} />;
}
