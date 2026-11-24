import { Link } from "@tanstack/react-router";
import type { UserResponse } from "@/api/generated/api";
import { formatDateTime } from "@/shared/lib/format-date";

export function UserTable({ users }: { users: readonly UserResponse[] }) {
  if (users.length === 0) return <p>No users yet.</p>;
  return (
    // A narrow screen scrolls the table, never the page.
    <div className="overflow-x-auto">
      <table aria-label="Users" className="w-full text-left">
        <thead className="text-muted text-sm">
          <tr>
            <th className="py-2 pr-4">Name</th>
            <th className="pr-4">Email</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} data-testid={`users-row-${user.id}`} className="border-line border-t">
              <td className="py-2 pr-4">
                <Link to="/users/$userId" params={{ userId: user.id }}>
                  {user.name}
                </Link>
              </td>
              <td className="pr-4">{user.email}</td>
              <td className="whitespace-nowrap">{formatDateTime(user.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
