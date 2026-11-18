import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import TenantManagement from "@/components/TenantManagement";
import SchoolAdminManagement from "@/components/SchoolAdminManagement";

export default async function ManagePage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.isSchoolAdmin && !user.isTenantManager) {
    return <SchoolAdminManagement
      managerName={user.fullName}
      managerEmail={user.email}
      managerSchoolSlug={user.school.slug}
      managerProfileImagePath={user.profileImagePath}
      schoolId={user.school.id}
    />;
  }
  if (!user.isTenantManager) redirect(`/${encodeURIComponent(user.school.slug)}/overview`);
  return <TenantManagement managerName={user.fullName} managerEmail={user.email} managerSchoolSlug={user.school.slug} managerProfileImagePath={user.profileImagePath} />;
}
