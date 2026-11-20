import { createFileRoute } from "@tanstack/react-router";
import { CreateUserForm } from "@/features/users/create-user-form";

export const Route = createFileRoute("/users/new")({
  component: NewUserPage,
});

function NewUserPage() {
  const navigate = Route.useNavigate();

  return (
    <>
      <title>New user</title>
      <h1 className="font-semibold text-2xl">New user</h1>
      <CreateUserForm
        onCreated={(user) => navigate({ to: "/users/$userId", params: { userId: user.id } })}
      />
    </>
  );
}
