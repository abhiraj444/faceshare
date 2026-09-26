import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

export function Switch({
  className,
  invert,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { invert?: boolean }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2",
        invert
          ? "border-neutral-300 bg-neutral-200 data-[state=checked]:bg-neutral-950 focus-visible:ring-neutral-900/50"
          : "border-border bg-bg-subtle data-[state=checked]:bg-accent focus-visible:ring-accent/50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-5 translate-x-0.5 rounded-full transition-transform data-[state=checked]:translate-x-[22px]",
          invert ? "bg-white shadow-sm" : "bg-fg data-[state=checked]:bg-accent-fg",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
