import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import * as z from "zod";
import { getListUsersQueryOptions, getListUsersSuspenseQueryOptions } from "@/api/generated/api";
import { pageCount, toListParams } from "@/features/users/pagination";
import { UserTable } from "@/features/users/user-table";
import { loadQuery } from "@/shared/lib/load-query";

// `.catch(undefined)`: a hand-edited URL falls back to the first page instead of failing.
const searchSchema = z.object({
  page: z.int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/users/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => toListParams(search.page ?? 1),
  // Same key and fetch as the component's suspense options; `loadQuery` rejects those under
  // exactOptionalPropertyTypes.
  loader: async ({ context, deps }) => {
    const users = await loadQuery(context.queryClient, getListUsersQueryOptions(deps));
    // A page past the end (an edited URL, the last user on it deleted) opens the last page.
    if (users.items.length === 0 && deps.offset > 0) {
      const last = pageCount(users);
      throw redirect({
        to: "/users",
        search: (prev) => ({ ...prev, page: last > 1 ? last : undefined }),
        replace: true,
      });
    }
    return users;
  },
  component: UsersPage,
});

function UsersPage() {
  const params = Route.useLoaderDeps();
  const page = Route.useSearch({ select: (search) => search.page ?? 1 });
  const { data } = useSuspenseQuery(getListUsersSuspenseQueryOptions(params));
  const pages = pageCount(data);

  return (
    <div data-testid="users-list-page" className="flex flex-col gap-4">
      <title>Users</title>
      <h1 className="font-semibold text-2xl">Users</h1>
      <UserTable users={data.items} />
      <nav aria-label="Pagination" className="flex items-center gap-4">
        <Link
          from={Route.fullPath}
          search={(prev) => ({ ...prev, page: page > 2 ? page - 1 : undefined })}
          disabled={page <= 1}
        >
          Previous
        </Link>
        <span>
          Page {page} of {pages}
        </span>
        <Link
          from={Route.fullPath}
          search={(prev) => ({ ...prev, page: page + 1 })}
          disabled={page >= pages}
        >
          Next
        </Link>
      </nav>
    </div>
  );
}
