import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { ApiError } from "@/api/api-error";
import { useAppForm } from "@/shared/hooks/use-app-form";
import { Button } from "@/shared/ui/button";

const unknownCompany = () =>
  new ApiError({
    status: 422,
    message: "validation failed",
    fieldErrors: { company: [{ message: "Company is unknown.", code: "unknown" }] },
    body: {},
  });

function CompanyForm({ steps }: { steps: boolean }) {
  const [companyShown, setCompanyShown] = useState(true);
  const form = useAppForm({
    defaultValues: { name: "", company: "" },
    onSubmit: async () => {
      throw unknownCompany();
    },
  });
  return (
    <form.AppForm>
      <form.Form
        failed="Not saved."
        {...(steps && { onFieldErrors: (fields) => setCompanyShown(fields.includes("company")) })}
      >
        <form.FormError />
        <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
        {companyShown && (
          <form.AppField name="company">
            {(field) => <field.TextField label="Company" />}
          </form.AppField>
        )}
        <Button onClick={() => setCompanyShown(false)}>Hide company</Button>
        <form.SubmitButton pending="Saving">Save</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}

async function fillCompanyThenHideIt(steps: boolean) {
  const user = userEvent.setup();
  render(<CompanyForm steps={steps} />);
  await user.type(screen.getByRole("textbox", { name: "Company" }), "Acme");
  await user.click(screen.getByRole("button", { name: "Hide company" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("a server error for a field the user removed is the form message", async () => {
  await fillCompanyThenHideIt(false);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Not saved. The server gave a reason this form cannot show.",
  );
});

test("in a form in steps, a server error opens its field's step and shows under the field", async () => {
  await fillCompanyThenHideIt(true);

  expect(await screen.findByRole("textbox", { name: "Company" })).toHaveAccessibleDescription(
    "Company is unknown.",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
