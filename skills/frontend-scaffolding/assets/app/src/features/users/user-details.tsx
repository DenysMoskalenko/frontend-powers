import type { UserResponse } from "@/api/generated/api";
import { formatDateTime } from "@/shared/lib/format-date";

export function UserDetails({ user }: { user: UserResponse }) {
  return (
    <dl className="grid grid-cols-label gap-x-6 gap-y-2">
      <dt className="text-muted">Email</dt>
      <dd>{user.email}</dd>
      <dt className="text-muted">Created</dt>
      <dd>{formatDateTime(user.created_at)}</dd>
    </dl>
  );
}
