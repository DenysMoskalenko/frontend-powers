import { createFileRoute } from "@tanstack/react-router";
import { CreateUserForm } from "@/features/users/create-user-form";

export const Route = createFileRoute("/users/new")({
  component: NewUserPage,
});

function NewUserPage() {
  const navigate = Route.useNavigate();

  return (
    <div data-testid="users-new-page" className="flex flex-col gap-4">
      <title>New user</title>
      <h1 className="font-semibold text-2xl">New user</h1>
      <CreateUserForm
        onCreated={(user) => navigate({ to: "/users/$userId", params: { userId: user.id } })}
      />
    </div>
  );
}
