import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { useToast } from "../../hooks/use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({
        id,
        title,
        description,
        action,
        count,
        ...props
      }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                {title && (
                  <div className="flex items-center gap-2">
                    <ToastTitle>{title}</ToastTitle>
                    {count && count > 1 && (
                      <div className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                        {count}x
                      </div>
                    )}
                  </div>
                )}
              </div>
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
