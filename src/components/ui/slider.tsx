import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

export function Slider({
  className,
  invert,
  ...props
}: ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { invert?: boolean }) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-8 w-full touch-none items-center select-none", className)}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative h-1.5 w-full grow rounded-full transition-colors",
          invert ? "bg-neutral-300 shadow-inner" : "bg-bg-subtle",
        )}
      >
        <SliderPrimitive.Range
          className={cn(
            "absolute h-full rounded-full transition-colors",
            invert ? "bg-neutral-900" : "bg-accent",
          )}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "block size-5 rounded-full shadow-md focus-visible:outline-none focus-visible:ring-2 transition-transform cursor-grab active:cursor-grabbing",
          invert
            ? "border-2 border-white bg-neutral-950 ring-1 ring-neutral-400 focus-visible:ring-neutral-900/50"
            : "border border-border-strong bg-fg focus-visible:ring-accent/50",
        )}
      />
    </SliderPrimitive.Root>
  );
}

