import { Field } from "@base-ui/react/field";
import { cx } from "./cx";

interface TextFieldProps extends Omit<Field.Control.Props, "className"> {
  label: string;
  /** A server or form-library error; marks the field invalid. */
  error?: string | undefined;
  /** Layout only (margin, width, placement). */
  className?: string | undefined;
}

export function TextField({ label, error, className, ...props }: TextFieldProps) {
  return (
    <Field.Root invalid={error !== undefined} className={cx("flex flex-col gap-1", className)}>
      <Field.Label className="font-medium text-sm">{label}</Field.Label>
      <Field.Control
        {...props}
        className="h-9 rounded-md border border-control bg-surface px-3 data-invalid:border-danger"
      />
      <Field.Error match={error !== undefined} className="text-danger text-sm">
        {error}
      </Field.Error>
    </Field.Root>
  );
}
