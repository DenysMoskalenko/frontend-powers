import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ApiError } from "@/api/api-error";
import { getGetUserQueryOptions, getGetUserSuspenseQueryOptions } from "@/api/generated/api";
import { GetUserParams } from "@/api/generated/api.zod";
import { UserDetails } from "@/features/users/user-details";

export const Route = createFileRoute("/users/$userId")({
  loader: async ({ context, params }) => {
    // The API rejects a malformed id with 400; to the user it is a user that does not exist.
    if (!GetUserParams.safeParse({ id: params.userId }).success) throw notFound();
    try {
      await context.queryClient.query({
        ...getGetUserQueryOptions(params.userId),
        staleTime: "static",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: UserPage,
  notFoundComponent: UserNotFound,
});

function UserPage() {
  const { userId } = Route.useParams();
  const { data: user } = useSuspenseQuery(getGetUserSuspenseQueryOptions(userId));

  return (
    <>
      <title>{user.name}</title>
      <h1 className="font-semibold text-2xl">{user.name}</h1>
      <UserDetails user={user} />
    </>
  );
}

function UserNotFound() {
  return (
    <>
      <title>User not found</title>
      <h1 className="font-semibold text-2xl">User not found</h1>
      <Link to="/users">Back to users</Link>
    </>
  );
}
