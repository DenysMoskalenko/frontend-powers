import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";

type ToastManager = ReturnType<typeof Toast.createToastManager>;

/** Renders the toasts that `manager.add(...)` creates, from inside or outside React. */
export function ToastProvider({
  manager,
  children,
}: {
  manager: ToastManager;
  children: ReactNode;
}) {
  return (
    <Toast.Provider toastManager={manager}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="flex items-start gap-3 rounded-md border border-line bg-surface p-3 shadow-md transition-[opacity,translate] duration-200 data-ending-style:translate-y-2 data-starting-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:opacity-0 data-limited:hidden motion-reduce:transition-opacity"
    >
      <Toast.Content className="flex-1">
        <Toast.Title className="font-medium" />
        <Toast.Description className="text-muted text-sm" />
      </Toast.Content>
      <Toast.Close className="text-muted text-sm">Dismiss</Toast.Close>
    </Toast.Root>
  ));
}
