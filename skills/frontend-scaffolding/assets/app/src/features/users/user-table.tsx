import { Link } from "@tanstack/react-router";
import type { UserResponse } from "@/api/generated/api";
import { formatDateTime } from "@/shared/lib/format-date";

export function UserTable({ users }: { users: readonly UserResponse[] }) {
  if (users.length === 0) return <p>No users yet.</p>;
  return (
    <table aria-label="Users" className="w-full text-left">
      <thead className="text-muted text-sm">
        <tr>
          <th className="py-2">Name</th>
          <th>Email</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id} className="border-line border-t">
            <td className="py-2">
              <Link to="/users/$userId" params={{ userId: user.id }}>
                {user.name}
              </Link>
            </td>
            <td>{user.email}</td>
            <td>{formatDateTime(user.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
