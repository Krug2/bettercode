"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LucideProps } from "lucide-react";
import { BookmarkIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";

export type CheckpointProps = HTMLAttributes<HTMLDivElement>;

/**
 * Turn boundary between exchanges: a quiet full-width hairline with a small
 * centered restore pill. Kept intentionally faint so the transcript reads as
 * messages separated by lines — hovering the row raises it to full strength.
 */
export const Checkpoint = ({
  className,
  children,
  ...props
}: CheckpointProps) => (
  <div
    className={cn(
      "group/checkpoint relative mt-1 flex h-7 w-full items-center justify-center text-muted-foreground",
      className
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/40 transition-colors duration-150 group-hover/checkpoint:bg-border/70"
    />
    <span className="relative flex items-center gap-1 rounded-full bg-background px-1.5 opacity-50 transition-opacity duration-150 group-hover/checkpoint:opacity-100">
      {children}
    </span>
  </div>
);

export type CheckpointIconProps = LucideProps;

export const CheckpointIcon = ({
  className,
  children,
  ...props
}: CheckpointIconProps) =>
  children ?? (
    <BookmarkIcon className={cn("size-3 shrink-0", className)} {...props} />
  );

export type CheckpointTriggerProps = ComponentProps<typeof Button> & {
  tooltip?: string;
};

export const CheckpointTrigger = ({
  children,
  className,
  variant = "ghost",
  size = "sm",
  tooltip,
  ...props
}: CheckpointTriggerProps) => {
  const button = (
    <Button
      size={size}
      type="button"
      variant={variant}
      className={cn(
        "h-6 gap-1.5 px-1.5 text-[10.5px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );

  return tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent align="center" side="bottom">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  ) : (
    button
  );
};
